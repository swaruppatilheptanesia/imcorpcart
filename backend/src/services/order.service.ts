import path from 'path';
import fs from 'fs/promises';
import { Prisma, OrderStatus, OrderSource, ProductStatus, DocumentType, DocumentSource } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { parsePagination, pageMeta } from '../utils/pagination';
import { orderListSelect, orderFullInclude, notDeleted } from '../models/selectors';
import { serialize, toNumber } from '../models/serializers';
import { applyTransit } from './reseller.service';
import { shopProductInclude, toStoreProduct, pickBuyBox } from './shop.service';
import { retryVoucherFulfilment, resendVoucherEmail } from './voucher-fulfilment.service';
import { notifyPartnerOrderStatus, notifyPartnerEpod } from './webhook.service';
import { PRIVATE_UPLOAD_DIR } from '../config/document-upload';
import type { OrderListQuery, OverrideStatusInput, ColourSwapInput, EpodInput } from '../validators/order.schema';
import type { TransitUpdateInput } from '../validators/reseller.schema';

// The coarse buckets the Orders screen filters by. Exported so the partner
// detail page's Orders tab filters by the same three chips rather than defining
// its own.
export const BUCKET_STATUSES: Record<string, OrderStatus[]> = {
  active: [OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED],
  delivered: [OrderStatus.DELIVERED],
  cancelled: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
};

export async function listOrders(query: OrderListQuery) {
  const p = parsePagination(query);
  const where: Prisma.OrderWhereInput = {};

  if (query.status) {
    where.status = query.status;
  } else if (query.bucket && query.bucket !== 'all') {
    where.status = { in: BUCKET_STATUSES[query.bucket] };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: orderListSelect,
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.order.count({ where }),
  ]);

  return { data: serialize(rows), meta: pageMeta(total, p) };
}

export async function getOrder(id: string) {
  // Accept either the cuid `id` or the human `orderNo` (frontend routes by number).
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNo: id }] },
    include: orderFullInclude,
  });
  if (!order) throw AppError.notFound('Order not found');
  return serialize(order);
}

// Guard against nonsensical status jumps (e.g. re-opening a delivered order).
const TERMINAL: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.RETURNED];

export async function overrideStatus(id: string, input: OverrideStatusInput, actorId: string) {
  const order = await prisma.order.findFirst({ where: { OR: [{ id }, { orderNo: id }] } });
  if (!order) throw AppError.notFound('Order not found');
  if (order.status === input.status) {
    throw AppError.badRequest(`Order is already ${input.status}`);
  }
  if (TERMINAL.includes(order.status)) {
    throw AppError.badRequest(`Cannot change status of a ${order.status} order`);
  }

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { status: input.status } }),
    prisma.orderStatusHistory.create({
      data: { orderId: order.id, status: input.status, changedById: actorId, note: input.note },
    }),
  ]);

  // Tell the origin partner. Outside the transaction so a rolled-back change is
  // never pushed; a no-op for internal orders (the notifier checks order.source).
  // Without this an admin could move a partner order to DELIVERED here and the
  // partner would never hear — only the transit path used to notify.
  await notifyPartnerOrderStatus(order.id);

  return getOrder(order.id);
}

// Admin-driven fulfilment: update the real shipment/transit status for ANY order
// (in particular house/first-party vendor orders, which have no reseller to do
// it). Reuses the reseller portal's transit engine (shipment upsert + Order.status
// sync + tracking events + cashback + partner webhook), unscoped.
export async function updateTransit(id: string, input: TransitUpdateInput, actorId: string) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNo: id }] },
    include: { shipment: true },
  });
  if (!order) throw AppError.notFound('Order not found');
  await applyTransit(order, input, actorId);
  return getOrder(order.id);
}

// Admin action: retry issuing a stuck/failed gift-card (Hubble voucher) line.
// Idempotent on the Hubble referenceId, so a double-tap never double-issues.
export async function retryVoucher(orderId: string, itemId: string) {
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, order: { OR: [{ id: orderId }, { orderNo: orderId }] } },
    select: { id: true, orderId: true, voucherFulfilment: { select: { id: true } } },
  });
  if (!item) throw AppError.notFound('Voucher line not found');
  if (!item.voucherFulfilment) throw AppError.badRequest('This line is not a gift-card voucher');
  await retryVoucherFulfilment(item.id);
  return getOrder(item.orderId);
}

// Admin action: re-send an already-issued gift-card email to the buyer (support).
// The raw code is read server-side and never returned to the admin.
export async function resendVoucher(orderId: string, itemId: string) {
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, order: { OR: [{ id: orderId }, { orderNo: orderId }] } },
    select: { id: true, voucherFulfilment: { select: { status: true } } },
  });
  if (!item) throw AppError.notFound('Voucher line not found');
  if (item.voucherFulfilment?.status !== 'DELIVERED') throw AppError.badRequest('This voucher has not been issued yet');
  await resendVoucherEmail(item.id);
  return { sent: true };
}

export async function cancelOrder(id: string, note: string | undefined, actorId: string) {
  const order = await prisma.order.findFirst({ where: { OR: [{ id }, { orderNo: id }] } });
  if (!order) throw AppError.notFound('Order not found');
  if (order.status === OrderStatus.CANCELLED) throw AppError.badRequest('Order is already cancelled');
  if (order.status === OrderStatus.DELIVERED) throw AppError.badRequest('Delivered orders cannot be cancelled');

  const reason = note ?? 'Cancelled by admin';

  await prisma.$transaction([
    // cancelReason is what the partner webhook sends as `remarks`; this used to
    // be left null here while the partner-initiated cancel set it.
    prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.CANCELLED, cancelReason: reason },
    }),
    prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: OrderStatus.CANCELLED,
        changedById: actorId,
        note: reason,
      },
    }),
  ]);

  await notifyPartnerOrderStatus(order.id, { event: 'order.cancelled' });

  return getOrder(order.id);
}

// ─── Colour substitution ─────────────────────────────────────────────────────
// When the colour a buyer ordered turns out to be unavailable, staff confirm an
// alternative with them off-platform and swap it here, instead of refunding and
// asking them to order the available colour again.
//
// The catalog expresses colour two different ways and both are offered:
//   • swatch     — a `Product.specs.shades[]` entry on the SAME product, so the
//                  swap is a label change and the price cannot move.
//   • sibling SKU — a different Product sharing `familyKey` with the same
//                  `optionVariant` and a different `optionColor`, each carrying
//                  its own ProductOffer and price.
//
// What a swap never does is move money. `unitPrice`/`lineTotal` and every Order
// total stay exactly as charged, because the order was paid through Razorpay with
// one captured Payment verified against the priced cart — rewriting the total
// would desynchronise it from the money actually taken. A price gap is therefore
// RECORDED on the line (`substitution.priceDelta`) for off-platform settlement,
// never charged.

// Colour is editable only before anything ships: once a parcel is moving, the
// colour on the order has to match what is physically in it.
const SWAPPABLE_STATUSES: OrderStatus[] = [OrderStatus.PLACED, OrderStatus.CONFIRMED];

export interface ColourOption {
  kind: 'shade' | 'sku';
  /** What the operator picks from, e.g. "Black Titanium". */
  label: string;
  /** The shade name to store on the line. */
  shade: string;
  /** Set only for a sibling-SKU swap — the product the line moves to. */
  productId: string | null;
  stock: number;
  listPrice: number;
  /** listPrice − what this line was charged. Non-zero is settled off-platform. */
  priceDelta: number;
  current: boolean;
}

async function loadLineForSwap(orderId: string, itemId: string) {
  const item = await prisma.orderItem.findFirst({
    // Accept the cuid or the human orderNo, like every other order mutation.
    where: { id: itemId, order: { OR: [{ id: orderId }, { orderNo: orderId }] } },
    select: {
      id: true,
      productId: true,
      quantity: true,
      unitPrice: true,
      shade: true,
      voucherFulfilment: { select: { id: true } },
      substitution: true,
      order: {
        select: {
          id: true,
          orderNo: true,
          status: true,
          source: true,
          resellerId: true,
          shipment: { select: { dispatchedAt: true } },
        },
      },
      // shopProductInclude (not a narrow select) so the ordered colour's CURRENT
      // buy-box price is available — see the price-gap note in colourOptionsFor.
      product: { include: shopProductInclude },
    },
  });
  if (!item) throw AppError.notFound('Order line not found');
  return item;
}

type LineForSwap = Awaited<ReturnType<typeof loadLineForSwap>>;

function assertSwappable(item: LineForSwap): void {
  if (item.voucherFulfilment) {
    throw AppError.badRequest('Gift cards have no colour to change.');
  }
  if (item.order.source === OrderSource.PARTNER) {
    // A partner's own system is the line of record for these; editing here would
    // silently desynchronise the two.
    throw AppError.badRequest('Partner-API orders are edited through the partner, not here.');
  }
  if (item.order.shipment?.dispatchedAt) {
    throw AppError.badRequest(
      'This order has already been dispatched — the colour on it must match what shipped.',
    );
  }
  if (!SWAPPABLE_STATUSES.includes(item.order.status)) {
    throw AppError.badRequest(
      `This order is ${item.order.status.toLowerCase()} — the colour can only be changed before dispatch.`,
    );
  }
}

/** Every colour this line could be swapped to, with live stock. The single source
 *  of truth for eligibility: the picker renders it and the write re-checks it. */
async function colourOptionsFor(item: LineForSwap): Promise<ColourOption[]> {
  const charged = toNumber(item.unitPrice);
  const currentLabel = item.shade ?? item.product.optionColor ?? null;
  // The price gap must be measured CURRENT-against-CURRENT, never against the
  // charged price: `unitPrice` is a snapshot frozen at checkout, so a catalogue
  // price change since then would otherwise be reported as a colour price
  // difference. (A live order carries unitPrice 15449 against a 14999 offer.)
  const sourceNow = toNumber(pickBuyBox(item.product.offers)?.eppPrice ?? item.unitPrice);
  const out: ColourOption[] = [];

  // 1. Swatches on this very product. The colour is presentation on one SKU, so
  //    there is no separate price and the delta is always zero.
  const specs = (item.product.specs ?? {}) as { shades?: { name?: string; stock?: number }[] };
  for (const sh of specs.shades ?? []) {
    if (!sh?.name) continue;
    out.push({
      kind: 'shade',
      label: sh.name,
      shade: sh.name,
      productId: null,
      stock: Number(sh.stock ?? 0),
      // Shades share one ProductOffer, so a swatch swap is price-neutral by
      // construction — there is no second price to differ from.
      listPrice: sourceNow,
      priceDelta: 0,
      current: currentLabel === sh.name,
    });
  }

  // 2. Sibling SKUs — same family, SAME storage/variant (this is a colour swap,
  //    not a spec upgrade), different colour.
  if (item.product.familyKey) {
    const siblings = await prisma.product.findMany({
      where: {
        familyKey: item.product.familyKey,
        id: { not: item.product.id },
        optionVariant: item.product.optionVariant,
        optionColor: { not: null },
        status: ProductStatus.ACTIVE,
        ...notDeleted,
      },
      include: shopProductInclude,
    });
    for (const sib of siblings) {
      const offer = pickBuyBox(sib.offers);
      // Orders are split one per seller (placeOrder), with Order.resellerId set,
      // so a sibling that a DIFFERENT reseller fulfils cannot join this order —
      // it would put a line in the wrong seller's book. Leave it out entirely
      // rather than offering something that must then be refused.
      if (offer && (offer.resellerId ?? null) !== (item.order.resellerId ?? null)) continue;
      const sp = toStoreProduct(sib);
      out.push({
        kind: 'sku',
        label: sib.optionColor as string,
        shade: sib.optionColor as string,
        productId: sib.id,
        stock: sp.stock,
        listPrice: sp.price,
        priceDelta: Math.round((sp.price - sourceNow) * 100) / 100,
        current: false,
      });
    }
  }

  // In stock first, then alphabetical — the operator is looking for something
  // they can actually ship.
  return out.sort((a, b) => (b.stock > 0 ? 1 : 0) - (a.stock > 0 ? 1 : 0) || a.label.localeCompare(b.label));
}

/** Admin: the colours this order line could be changed to. */
export async function listColourOptions(orderId: string, itemId: string) {
  const item = await loadLineForSwap(orderId, itemId);
  const options = await colourOptionsFor(item);
  return serialize({
    itemId: item.id,
    productName: item.product.name,
    current: item.shade ?? item.product.optionColor ?? null,
    quantity: item.quantity,
    charged: toNumber(item.unitPrice),
    // Why the action is unavailable, so the UI can say so instead of showing an
    // empty picker.
    editable: !item.voucherFulfilment
      && !item.order.shipment?.dispatchedAt
      && SWAPPABLE_STATUSES.includes(item.order.status),
    options,
  });
}

/** Admin: change this line's colour to one the vendor can actually ship. The
 *  buyer is confirmed off-platform; this only records and applies the decision. */
export async function swapItemColour(
  orderId: string,
  itemId: string,
  input: ColourSwapInput,
  actorId: string,
) {
  const item = await loadLineForSwap(orderId, itemId);
  assertSwappable(item);

  const options = await colourOptionsFor(item);
  // Never trust the posted colour — it must be one the server itself computed,
  // which is also exactly what the operator was shown.
  const target = options.find((o) =>
    input.productId ? o.productId === input.productId : o.kind === 'shade' && o.shade === input.shade,
  );
  if (!target) throw AppError.badRequest('That colour is not available for this product.');
  if (target.current) throw AppError.badRequest(`This line is already ${target.label}.`);
  if (target.stock < item.quantity) {
    throw AppError.badRequest(
      target.stock <= 0
        ? `${target.label} is out of stock too.`
        : `Only ${target.stock} of ${target.label} in stock — this line is for ${item.quantity}. ` +
          'The whole line has to move to one colour.',
    );
  }

  const from = item.shade ?? item.product.optionColor ?? null;
  // A second swap must not bury what was originally bought: carry the first
  // record's `orderedColour` forward rather than overwriting it with the
  // previous swap's target.
  const prior = (item.substitution ?? null) as { orderedColour?: string | null } | null;
  const substitution = {
    // Presence of a prior record decides this, not its value: `?? from` would
    // overwrite a legitimately-null original (a pre-migration line) with the
    // previous swap's target on the second swap.
    orderedColour: prior ? prior.orderedColour ?? null : from,
    from,
    to: target.label,
    fromProductId: target.productId ? item.productId : null,
    toProductId: target.productId,
    chargedUnitPrice: toNumber(item.unitPrice),
    newListPrice: target.listPrice,
    priceDelta: target.priceDelta,
    reason: input.reason,
    at: new Date().toISOString(),
    byId: actorId,
  };

  await prisma.$transaction([
    prisma.orderItem.update({
      where: { id: item.id },
      data: {
        shade: target.shade,
        // A sibling swap repoints the line at the other SKU. unitPrice/lineTotal
        // are deliberately NOT rewritten — see the note at the top of this section.
        ...(target.productId ? { productId: target.productId } : {}),
        substitution: substitution as Prisma.InputJsonValue,
      },
    }),
    prisma.orderStatusHistory.create({
      data: {
        orderId: item.order.id,
        // Unchanged: a colour swap is not a status change. This row exists as an
        // operator trail; the buyer-visible record is `OrderItem.substitution`.
        status: item.order.status,
        changedById: actorId,
        note: `Colour changed ${from ?? 'unspecified'} → ${target.label}: ${input.reason}`,
      },
    }),
  ]);

  // A manual, money-adjacent override deserves an audit row. Best-effort: losing
  // the log must never fail the swap that already committed.
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'order.item_colour_swapped',
        entityType: 'OrderItem',
        entityId: item.id,
        before: { shade: from, productId: item.productId, orderNo: item.order.orderNo },
        after: substitution as Prisma.InputJsonValue,
      },
    });
  } catch (logErr) {
    console.error('[orders] failed to write colour-swap audit', logErr);
  }

  return getOrder(item.order.id);
}

// ─── Proof of delivery (ePOD) ────────────────────────────────────────────────
// Staff upload the courier's delivery proof against a delivered order. For an
// order that came in through the partner API this also pushes the document to
// the partner as base64, so there is no separate "now send it" step to forget.

async function loadOrderForEpod(id: string, resellerId?: string) {
  const order = await prisma.order.findFirst({
    where: {
      OR: [{ id }, { orderNo: id }],
      // Set by the reseller portal, so a reseller can only ever attach a proof
      // to an order they actually fulfilled. Absent for the admin.
      ...(resellerId ? { resellerId } : {}),
    },
    include: {
      shipment: { select: { id: true, deliveredAt: true } },
      documents: { where: { docType: DocumentType.POD }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

export async function attachOrderEpod(
  id: string,
  file: Express.Multer.File | undefined,
  input: EpodInput,
  actorId: string,
  opts: { resellerId?: string } = {},
) {
  if (!file) throw AppError.badRequest('No file provided (expected field "file")');
  const order = await loadOrderForEpod(id, opts.resellerId);

  // A proof of delivery before delivery is a mistake, not an edge case.
  if (order.status !== OrderStatus.DELIVERED) {
    // Remove the file multer already wrote, so a rejected upload leaves nothing.
    await fs.unlink(file.path).catch(() => undefined);
    throw AppError.badRequest(`Proof of delivery can only be attached to a delivered order (this one is ${order.status}).`);
  }

  // When the courier captured the proof — not when we uploaded it. Defaults to
  // the recorded delivery time, which is the closest thing we know.
  const capturedAt = input.capturedAt ?? order.shipment?.deliveredAt ?? new Date();

  const doc = await prisma.orderDocument.create({
    data: {
      orderId: order.id,
      docType: DocumentType.POD,
      source: DocumentSource.UPLOADED,
      fileUrl: file.path,
      generatedAt: capturedAt,
      uploadedById: actorId,
      // A reported field, so it gets a real column. It is mirrored into
      // metadata for anything still reading the old JSON path.
      issueNote: input.note ?? null,
      metadata: {
        fileName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        ...(input.note ? { note: input.note } : {}),
      },
    },
  });

  // Convenience pointer for the fulfilment views; OrderDocument is the record.
  if (order.shipment) {
    await prisma.shipment.update({ where: { id: order.shipment.id }, data: { podUrl: file.path } });
  }

  // Post-commit, and a no-op for internal orders.
  const delivery = await notifyPartnerEpod(order.id);

  return { document: serialize(doc), pushedToPartner: Boolean(delivery) };
}

/** Re-queue the ePOD push, for when the partner's endpoint was down. */
export async function resendOrderEpod(id: string) {
  const order = await loadOrderForEpod(id);
  if (order.source !== OrderSource.PARTNER) {
    throw AppError.badRequest('This order did not come from a partner, so there is nothing to send.');
  }
  if (!order.documents.length) throw AppError.badRequest('No proof of delivery has been uploaded yet.');
  const delivery = await notifyPartnerEpod(order.id);
  if (!delivery) throw AppError.badRequest('This partner has no webhook URL configured.');
  return { queued: true };
}

/** The stored ePOD file itself. Authenticated — these are never served statically. */
export async function getOrderEpodFile(id: string) {
  const order = await loadOrderForEpod(id);
  const doc = order.documents[0];
  if (!doc?.fileUrl) throw AppError.notFound('No proof of delivery for this order');

  // Resolve under the private directory and refuse anything that escapes it, so
  // a tampered row can never read an arbitrary file off disk.
  const resolved = path.resolve(doc.fileUrl);
  if (!resolved.startsWith(PRIVATE_UPLOAD_DIR + path.sep)) {
    throw AppError.notFound('No proof of delivery for this order');
  }
  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  return {
    filePath: resolved,
    fileName: typeof meta.fileName === 'string' ? meta.fileName : path.basename(resolved),
    mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'application/octet-stream',
  };
}
