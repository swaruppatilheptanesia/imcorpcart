import { Prisma, OrderType, OrderSource, OrderStatus, ProductStatus, AddressType } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { pickBuyBox, shopProductInclude } from './shop.service';
import { resolveBasePrice, vendorPrice } from './partner.service';
import { estimateDelivery } from './delivery.service';
import { enqueueWebhook, notifyPartnerOrderStatus } from './webhook.service';
import type { PartnerPrincipal } from '../types/express';
import type { AcceptOrderInput } from '../validators/partner.schema';

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

// Partner reads one of its orders by our orderNo or their externalRef.
export async function getPartnerOrder(partner: PartnerPrincipal, ref: string) {
  const orders = await prisma.order.findMany({
    where: { partnerId: partner.id, OR: [{ orderNo: ref }, { externalRef: ref }] },
    include: { items: { include: { product: { select: { sku: true, name: true } } } } },
    orderBy: { orderNo: 'asc' },
  });
  if (!orders.length) throw AppError.notFound('Order not found');
  return serialize(
    orders.map((o) => ({
      orderNo: o.orderNo,
      externalRef: o.externalRef,
      status: o.status,
      checkoutGroup: o.checkoutGroup,
      dealerCode: o.dealerCode,
      dealerName: o.dealerName,
      dealerMobile: o.dealerMobile,
      deliveryInstructions: o.deliveryInstructions,
      cancelReason: o.cancelReason,
      subtotal: o.subtotal,
      total: o.total,
      createdAt: o.createdAt,
      items: o.items.map((it) => ({ sku: it.product.sku, name: it.product.name, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.lineTotal })),
    })),
  );
}
