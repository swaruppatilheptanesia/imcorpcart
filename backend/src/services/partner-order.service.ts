import { Prisma, OrderType, OrderSource, OrderStatus, ProductStatus, AddressType, ShipmentStatus } from '@prisma/client';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { pickBuyBox, shopProductInclude } from './shop.service';
import { ORDER_FOR_SHIPMENT } from './reseller.service';
import { resolveBasePrice, vendorPrice } from './partner.service';
import { estimateDelivery } from './delivery.service';
import { enqueueWebhook, notifyPartnerOrderStatus } from './webhook.service';
import { parsePagination, pageMeta } from '../utils/pagination';
import {
  buildEpodEnvelope,
  partnerOrderViewSelect,
  partnerStatusFromOrder,
  partnerStatusFromShipment,
  resolvePodFile,
  toPartnerOrderView,
  type PartnerStatusCode,
  type TimelineEntry,
} from './partner-order-view';
import type { PartnerPrincipal } from '../types/express';
import type { AcceptOrderInput, EpodQuery, PartnerOrderListQuery } from '../validators/partner.schema';

const D = (n: number) => new Prisma.Decimal(n);
const PRICE_TOLERANCE = 1; // ₹ — posted price may differ from our configured price by at most this

interface PricedLine {
  productId: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  resellerId: string | null;
}

// Structured rejection so the partner gets an exact, machine-readable reason.
type RejectCode = 'NOT_IN_CATALOGUE' | 'OUT_OF_STOCK' | 'PRICE_MISMATCH' | 'PINCODE_UNSERVICEABLE';
interface Rejection {
  code: RejectCode;
  sku?: string;
  message: string;
  expected?: number;
  got?: number;
}

// Validate a partner-posted order against our buy box + serviceability, then (on
// success) create one Order per fulfilling seller. Deduplicated on the partner's
// own order id (externalRef) — re-posting the same id returns the existing order
// instead of creating a duplicate, so posts are safe to retry.
export async function acceptOrder(partner: PartnerPrincipal, input: AcceptOrderInput) {
  // 1. Dedup by the partner's own order id — a retry returns the existing order.
  const existing = await prisma.order.findFirst({
    where: { partnerId: partner.id, externalRef: input.externalRef },
    select: { orderNo: true, checkoutGroup: true },
  });
  if (existing) {
    return { statusCode: 200, body: { status: 'ACCEPTED', orderNo: existing.orderNo, checkoutGroup: existing.checkoutGroup, duplicate: true } };
  }

  // 2. Validate + price each line against the partner's catalogue entry (the
  // configured basis + commission), and check availability.
  const lines: PricedLine[] = [];
  const rejections: Rejection[] = [];
  for (const item of input.items) {
    const entry = await prisma.partnerCatalogueEntry.findFirst({
      where: { partnerId: partner.id, product: { sku: item.sku, status: ProductStatus.ACTIVE, ...notDeleted } },
      include: { product: { include: shopProductInclude } },
    });
    if (!entry) {
      rejections.push({ code: 'NOT_IN_CATALOGUE', sku: item.sku, message: `SKU not in your catalogue: ${item.sku}` });
      continue;
    }
    const product = entry.product;
    const winner = pickBuyBox(product.offers);
    if (!winner || winner.quantity < item.qty) {
      rejections.push({ code: 'OUT_OF_STOCK', sku: item.sku, message: `Out of stock: ${item.sku}` });
      continue;
    }
    const unitPrice = vendorPrice(resolveBasePrice(product, entry.priceBasis), entry.commissionPct);
    if (item.price !== undefined && Math.abs(item.price - unitPrice) > PRICE_TOLERANCE) {
      rejections.push({ code: 'PRICE_MISMATCH', sku: item.sku, message: `Price mismatch for ${item.sku}`, expected: unitPrice, got: item.price });
      continue;
    }
    lines.push({ productId: product.id, sku: item.sku, quantity: item.qty, unitPrice, resellerId: winner.resellerId ?? null });
  }

  // 3. Pincode serviceability.
  const eta = await estimateDelivery(input.shipping.pincode);
  if (!eta.serviceable) {
    rejections.push({ code: 'PINCODE_UNSERVICEABLE', message: `Not serviceable to pincode ${input.shipping.pincode}` });
  }

  if (rejections.length) {
    return { statusCode: 422, body: { status: 'REJECTED', reasons: rejections } };
  }

  // 4. Create one order per fulfilling seller (mirrors the storefront split-loop,
  // minus payment/wallet — partner orders are post-paid B2B).
  const groups = new Map<string, PricedLine[]>();
  for (const l of lines) {
    const g = l.resellerId ?? '__house__';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(l);
  }
  const groupList = [...groups.values()];
  const baseNo = Date.now().toString().slice(-8);
  const checkoutGroup = nanoid(12);

  const result = await prisma.$transaction(async (tx) => {
    const address = await tx.address.create({
      data: {
        type: AddressType.OFFICE,
        contactName: input.shipping.name,
        contactPhone: input.shipping.phone,
        line1: input.shipping.line1,
        line2: input.shipping.line2 ?? null,
        city: input.shipping.city,
        state: input.shipping.state,
        pincode: input.shipping.pincode,
      },
    });

    const orderNos: string[] = [];
    for (let gi = 0; gi < groupList.length; gi += 1) {
      const gLines = groupList[gi];
      const subtotal = gLines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      const order = await tx.order.create({
        data: {
          orderNo: groupList.length > 1 ? `IMC-${baseNo}-${gi + 1}` : `IMC-${baseNo}`,
          type: OrderType.EPP,
          source: OrderSource.PARTNER,
          partnerId: partner.id,
          externalRef: input.externalRef,
          dealerCode: input.dealerCode ?? null,
          dealerName: input.dealerName ?? null,
          dealerMobile: input.dealerMobile ?? null,
          deliveryInstructions: input.deliveryInstructions ?? null,
          resellerId: gLines[0].resellerId,
          checkoutGroup,
          addressId: address.id,
          subtotal: D(subtotal),
          total: D(subtotal),
          status: OrderStatus.PLACED,
          items: {
            create: gLines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: D(l.unitPrice),
              lineTotal: D(l.unitPrice * l.quantity),
            })),
          },
          statusHistory: { create: { status: OrderStatus.PLACED, note: `Accepted via partner API (${partner.slug})` } },
        },
      });
      orderNos.push(order.orderNo);
    }
    const body = { status: 'ACCEPTED', orderNo: orderNos[0], checkoutGroup, orderCount: orderNos.length, orderNos };
    return { statusCode: 201, body };
  });

  // Best-effort audit (actorId is a User FK, so the partner id goes in entityId).
  prisma.auditLog
    .create({ data: { action: 'partner.order.accept', entityType: 'Partner', entityId: partner.id, after: { externalRef: input.externalRef, orderNos: result.body.orderNos, checkoutGroup } } })
    .catch(() => undefined);
  await enqueueWebhook(partner.id, 'order.accepted', { externalRef: input.externalRef, orderNo: result.body.orderNo, checkoutGroup, status: 'PLACED', at: new Date().toISOString() });
  return result;
}

// Cancel a partner's order (the whole order / checkout group). Only PLACED or
// CONFIRMED orders are cancellable. Partner orders don't reserve offer stock at
// placement (stock is fulfillment-managed), so there is nothing to restore.
export async function cancelPartnerOrder(partner: PartnerPrincipal, ref: string, reason?: string) {
  const orders = await prisma.order.findMany({
    where: { partnerId: partner.id, OR: [{ orderNo: ref }, { externalRef: ref }] },
    select: { id: true, orderNo: true, status: true },
  });
  if (!orders.length) throw AppError.notFound('Order not found');

  const blocked = orders.find((o) => o.status !== OrderStatus.PLACED && o.status !== OrderStatus.CONFIRMED);
  if (blocked) {
    return {
      statusCode: 422,
      body: {
        status: 'REJECTED',
        reasons: [{ code: 'NOT_CANCELLABLE', orderNo: blocked.orderNo, message: `Order ${blocked.orderNo} is ${blocked.status} and can no longer be cancelled` }],
      },
    };
  }

  await prisma.$transaction(async (tx) => {
    for (const o of orders) {
      await tx.order.update({ where: { id: o.id }, data: { status: OrderStatus.CANCELLED, cancelReason: reason ?? null } });
      await tx.orderStatusHistory.create({
        data: { orderId: o.id, status: OrderStatus.CANCELLED, note: reason ? `Cancelled by partner: ${reason}` : 'Cancelled by partner' },
      });
    }
  });

  for (const o of orders) await notifyPartnerOrderStatus(o.id, { event: 'order.cancelled' });

  return { statusCode: 200, body: { status: 'CANCELLED', orderNo: orders[0].orderNo, orderNos: orders.map((o) => o.orderNo) } };
}

// ── Pull surface ─────────────────────────────────────────────────────────────
// Everything below answers "what is the state of my orders?" without a webhook.
// All three read the shared view (services/partner-order-view.ts), so a partner
// polling and a partner receiving pushes are looking at the same object.

const scope = (partner: PartnerPrincipal): Prisma.OrderWhereInput => ({
  partnerId: partner.id,
  source: OrderSource.PARTNER,
});

const byRef = (ref: string): Prisma.OrderWhereInput => ({ OR: [{ orderNo: ref }, { externalRef: ref }] });

/**
 * The DB condition that produces a given partner status.
 *
 * Must agree with `effectiveStatus` — that function decides what we *report*,
 * this one decides what we *return*, and a partner filtering by DELIVERED and
 * getting a row labelled Dispatched would rightly file a bug.
 */
function whereForStatus(code: PartnerStatusCode): Prisma.OrderWhereInput {
  switch (code) {
    case 'CONFIRMED':
      return {
        status: { in: [OrderStatus.PLACED, OrderStatus.CONFIRMED] },
        OR: [{ shipment: null }, { shipment: { status: ShipmentStatus.PENDING } }],
      };
    case 'DISPATCHED':
      return {
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.RETURNED] },
        OR: [{ shipment: { status: ShipmentStatus.DISPATCHED } }, { status: OrderStatus.DISPATCHED, shipment: null }],
      };
    case 'IN_TRANSIT':
    case 'OUT_FOR_DELIVERY':
    case 'FAILED':
      return {
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.RETURNED] },
        shipment: { status: ShipmentStatus[code] },
      };
    case 'DELIVERED':
      return {
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.RETURNED] },
        OR: [{ shipment: { status: ShipmentStatus.DELIVERED } }, { status: OrderStatus.DELIVERED, shipment: null }],
      };
    case 'CANCELLED':
      return { status: OrderStatus.CANCELLED };
    case 'RETURNED':
      return { status: OrderStatus.RETURNED };
  }
}

/**
 * List the partner's orders, newest change first.
 *
 * `updatedSince` has to look at three clocks. A transit update writes the
 * shipment and only syncs `Order.status` when the *order* status changes — and
 * IN_TRANSIT → OUT_FOR_DELIVERY maps to the same DISPATCHED — so the order row
 * is often untouched by a change the partner very much wants to hear about. An
 * ePOD upload touches neither: it writes a document.
 */
export async function listPartnerOrders(partner: PartnerPrincipal, query: PartnerOrderListQuery) {
  const p = parsePagination(query);
  // Taken before the query so a row written mid-read is caught by the next poll
  // rather than skipped.
  const syncedAt = new Date();

  const and: Prisma.OrderWhereInput[] = [scope(partner)];
  if (query.status) and.push(whereForStatus(query.status));
  if (query.dealerCode) and.push({ dealerCode: query.dealerCode });
  if (query.updatedSince) {
    const gte = query.updatedSince;
    and.push({
      OR: [
        { updatedAt: { gte } },
        { shipment: { updatedAt: { gte } } },
        { documents: { some: { docType: 'POD', createdAt: { gte } } } },
      ],
    });
  }

  const where: Prisma.OrderWhereInput = { AND: and };
  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: partnerOrderViewSelect,
      orderBy: [{ updatedAt: 'desc' }, { orderNo: 'desc' }],
      skip: p.skip,
      take: p.take,
    }),
    prisma.order.count({ where }),
  ]);

  const etaCache = new Map<string, string | null>();
  const data = await Promise.all(rows.map((o) => toPartnerOrderView(o, { etaCache })));
  return { data, meta: { ...pageMeta(total, p), syncedAt: syncedAt.toISOString() } };
}

/**
 * One order (or the several it split into) by our orderNo or their externalRef,
 * with the full transition history.
 */
export async function getPartnerOrder(partner: PartnerPrincipal, ref: string) {
  const orders = await prisma.order.findMany({
    where: { AND: [scope(partner), byRef(ref)] },
    select: partnerOrderViewSelect,
    orderBy: { orderNo: 'asc' },
  });
  if (!orders.length) throw AppError.notFound('Order not found');

  const etaCache = new Map<string, string | null>();
  return Promise.all(
    orders.map(async (o) => toPartnerOrderView(o, { etaCache, timeline: await timelineFor(o.id, o.shipment?.id ?? null) })),
  );
}

/** Status history + courier scans, merged into one chronological list. */
async function timelineFor(orderId: string, shipmentId: string | null): Promise<TimelineEntry[]> {
  const [history, scans] = await Promise.all([
    prisma.orderStatusHistory.findMany({
      where: { orderId },
      select: { status: true, note: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    shipmentId
      ? prisma.shipmentTrackingEvent.findMany({
          where: { shipmentId },
          select: { status: true, description: true, occurredAt: true },
          orderBy: { occurredAt: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const scanEntries: TimelineEntry[] = scans.map((e) => {
    const st = partnerStatusFromShipment(e.status);
    return { status: st.label, statusCode: st.code, at: e.occurredAt.toISOString(), note: e.description };
  });

  // A transit update writes a courier scan AND an order-status row in the same
  // transaction, and the order's view of it is the coarser one (IN_TRANSIT is
  // recorded as DISPATCHED). Keeping both would show the parcel going
  // "In Transit → Dispatched" in the same second. Drop the echo — matched on
  // both the moment and the exact status the scan would have produced, so a
  // genuine status change that merely happens to land nearby survives.
  const SAME_MOMENT_MS = 2000;
  const echoes = scans.map((e) => ({ at: e.occurredAt.getTime(), status: ORDER_FOR_SHIPMENT[e.status] }));
  const historyEntries: TimelineEntry[] = history
    .filter((h) => !echoes.some((e) => e.status === h.status && Math.abs(e.at - h.createdAt.getTime()) <= SAME_MOMENT_MS))
    .map((h) => {
      const st = partnerStatusFromOrder(h.status);
      return { status: st.label, statusCode: st.code, at: h.createdAt.toISOString(), note: h.note };
    });

  return [...historyEntries, ...scanEntries].sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The proof of delivery for an order.
 *
 * `json` returns the same envelope the `order.epod` webhook pushes, with the
 * document base64-encoded — one parser serves both transports. `file` streams
 * the stored PDF/image.
 */
export async function getPartnerOrderEpod(partner: PartnerPrincipal, ref: string, query: EpodQuery) {
  const orders = await prisma.order.findMany({
    where: {
      AND: [scope(partner), byRef(ref), ...(query.orderNo ? [{ orderNo: query.orderNo }] : [])],
    },
    select: partnerOrderViewSelect,
    orderBy: { orderNo: 'asc' },
  });
  if (!orders.length) throw AppError.notFound('Order not found');

  const withPod = orders.filter((o) => o.documents.length > 0);
  if (!withPod.length) {
    throw AppError.notFound('No proof of delivery has been captured for this order yet');
  }

  if (query.format === 'file') {
    if (withPod.length > 1) {
      // Handing back "the first one" could give them the wrong consignee's
      // signature, so make them name the order they mean.
      throw new AppError(
        409,
        'AMBIGUOUS_REF',
        `This reference covers ${withPod.length} orders with a proof of delivery — pass ?orderNo= to choose one.`,
        { orderNos: withPod.map((o) => o.orderNo) },
      );
    }
    const file = resolvePodFile(withPod[0].documents[0]);
    if (!file) throw AppError.notFound('No proof of delivery has been captured for this order yet');
    return { kind: 'file' as const, file };
  }

  const data = await Promise.all(
    withPod.map(async (o) => {
      const envelope = buildEpodEnvelope(o)!;
      const { fileUrl, ...rest } = envelope;
      const file = resolvePodFile(o.documents[0]);
      if (!file) throw AppError.notFound('The proof of delivery for this order is unavailable');
      const buf = await fs.readFile(file.filePath);
      return { ...rest, document: buf.toString('base64') };
    }),
  );
  return { kind: 'json' as const, data };
}
