import { Prisma, OrderType, OrderSource, OrderStatus, ProductStatus, AddressType } from '@prisma/client';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { pickBuyBox } from './shop.service';
import { estimateDelivery } from './delivery.service';
import { enqueueWebhook } from './webhook.service';
import type { PartnerPrincipal } from '../types/express';
import type { AcceptOrderInput } from '../validators/partner.schema';

const D = (n: number) => new Prisma.Decimal(n);
const PRICE_TOLERANCE = 1; // ₹ — posted price may differ from our EPP by at most this

interface PricedLine {
  productId: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  resellerId: string | null;
}

// Validate a partner-posted order against our buy box + serviceability, then (on
// success) create one Order per fulfilling seller. Idempotent on (partner, key).
export async function acceptOrder(partner: PartnerPrincipal, key: string, input: AcceptOrderInput) {
  // 1. Idempotency replay.
  const prior = await prisma.partnerIdempotencyKey.findUnique({
    where: { partnerId_key: { partnerId: partner.id, key } },
  });
  if (prior) return { statusCode: prior.statusCode, body: prior.responseJson, replay: true };

  // 2. Dedup by the partner's own order id (a retry without an idempotency key).
  if (input.externalRef) {
    const existing = await prisma.order.findFirst({
      where: { partnerId: partner.id, externalRef: input.externalRef },
      select: { orderNo: true, checkoutGroup: true },
    });
    if (existing) {
      const body = { status: 'ACCEPTED', orderNo: existing.orderNo, checkoutGroup: existing.checkoutGroup, duplicate: true };
      return persist(partner.id, key, 200, body);
    }
  }

  // 3. Validate + price each line against the current buy box.
  const scopeSlugs = partner.catalogScope?.categorySlugs;
  const lines: PricedLine[] = [];
  const rejections: string[] = [];
  for (const item of input.items) {
    const product = await prisma.product.findFirst({
      where: { sku: item.sku, status: ProductStatus.ACTIVE, ...notDeleted },
      include: { category: { select: { slug: true } }, offers: { where: notDeleted, include: { reseller: { select: { name: true } }, freeGift: { select: { title: true } } } } },
    });
    if (!product) {
      rejections.push(`Unknown or inactive SKU: ${item.sku}`);
      continue;
    }
    if (scopeSlugs && scopeSlugs.length && !scopeSlugs.includes(product.category.slug)) {
      rejections.push(`SKU not in your catalogue scope: ${item.sku}`);
      continue;
    }
    const winner = pickBuyBox(product.offers);
    if (!winner || winner.quantity < item.qty) {
      rejections.push(`Out of stock: ${item.sku}`);
      continue;
    }
    const unitPrice = toNumber(winner.eppPrice);
    if (item.price !== undefined && Math.abs(item.price - unitPrice) > PRICE_TOLERANCE) {
      rejections.push(`Price mismatch for ${item.sku}: expected ₹${unitPrice}, got ₹${item.price}`);
      continue;
    }
    lines.push({ productId: product.id, sku: item.sku, quantity: item.qty, unitPrice, resellerId: winner.resellerId ?? null });
  }

  // 4. Pincode serviceability.
  const eta = await estimateDelivery(input.shipping.pincode);
  if (!eta.serviceable) rejections.push(`Not serviceable to pincode ${input.shipping.pincode}`);

  if (rejections.length) {
    const body = { status: 'REJECTED', reasons: rejections };
    return persist(partner.id, key, 422, body);
  }

  // 5. Create one order per fulfilling seller (mirrors the storefront split-loop,
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

  // Create the orders AND the idempotency record atomically, so a crash can't
  // leave orphan orders without a replayable response.
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
          externalRef: input.externalRef ?? null,
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
    await tx.partnerIdempotencyKey.create({
      data: { partnerId: partner.id, key, statusCode: 201, responseJson: body, checkoutGroup },
    });
    return { statusCode: 201, body, replay: false as const };
  });

  // Best-effort audit (actorId is a User FK, so the partner id goes in entityId).
  prisma.auditLog
    .create({ data: { action: 'partner.order.accept', entityType: 'Partner', entityId: partner.id, after: { externalRef: input.externalRef, orderNos: result.body.orderNos, checkoutGroup } } })
    .catch(() => undefined);
  await enqueueWebhook(partner.id, 'order.accepted', { externalRef: input.externalRef, orderNo: result.body.orderNo, checkoutGroup, status: 'PLACED', at: new Date().toISOString() });
  return result;
}

// Store an idempotency record for a non-created outcome (reject / dedup) so a
// replay returns the identical response.
async function persist(partnerId: string, key: string, statusCode: number, body: Record<string, unknown>) {
  const checkoutGroup = (body.checkoutGroup as string | undefined) ?? null;
  await prisma.partnerIdempotencyKey.create({
    data: { partnerId, key, statusCode, responseJson: body as Prisma.InputJsonValue, checkoutGroup },
  });
  return { statusCode, body, replay: false };
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
      subtotal: o.subtotal,
      total: o.total,
      createdAt: o.createdAt,
      items: o.items.map((it) => ({ sku: it.product.sku, name: it.product.name, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.lineTotal })),
    })),
  );
}
