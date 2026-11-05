import { Prisma } from '@prisma/client';
import { AppError } from '../utils/AppError';
import { HUBBLE_ADAPTER } from '../config/hubble';

// The one place order stock moves.
//
// An order line is fulfilled by its seller's ProductOffer — the row keyed by
// (productId, Order.resellerId), null reseller = the house offer. That is the
// same row the buy box chose, because orders are split one per seller. Placing
// an order takes the units off that offer (and, for a colour-swatch product, off
// the colour's `specs.shades[].stock`, which add-to-cart enforces); cancelling
// puts them back. Every caller runs these inside the transaction that creates or
// cancels the order, so stock and order can never disagree.
//
// Gift cards are skipped: their "stock" is the vendor feed's figure, rewritten
// on every sync, and the card is issued and funded by Hubble, not taken off a
// shelf.

type Tx = Prisma.TransactionClient;

/** Thrown when a line's stock is not there. `details` names the product. */
export class OutOfStockError extends AppError {
  constructor(
    readonly sku: string,
    readonly productName: string,
    readonly available: number,
  ) {
    super(
      409,
      'OUT_OF_STOCK',
      available > 0 ? `Only ${available} left of "${productName}"` : `"${productName}" is out of stock`,
      { sku, available },
    );
    Object.setPrototypeOf(this, OutOfStockError.prototype);
  }
}

const lineSelect = {
  id: true,
  productId: true,
  quantity: true,
  shade: true,
  product: {
    select: {
      sku: true,
      name: true,
      specs: true,
      source: { select: { adapter: true } },
      category: { select: { slug: true } },
    },
  },
} satisfies Prisma.OrderItemSelect;
type Line = Prisma.OrderItemGetPayload<{ select: typeof lineSelect }>;

// Same rule as isVoucherProduct in shop.service.ts, on the narrower shape.
const isVoucher = (p: Line['product']) => p.source?.adapter === HUBBLE_ADAPTER || p.category.slug === 'vouchers';

type Shade = { name: string; stock?: number };
const shadesOf = (specs: Prisma.JsonValue): Shade[] => {
  const s = specs && typeof specs === 'object' && !Array.isArray(specs) ? (specs as { shades?: unknown }).shades : null;
  return Array.isArray(s) ? (s as Shade[]) : [];
};

/** Take `qty` off the seller's offer, or throw — never below zero, race-safe. */
async function takeFromOffer(tx: Tx, productId: string, resellerId: string | null, qty: number, sku: string, name: string) {
  const offer = await tx.productOffer.findFirst({
    where: { productId, resellerId, deletedAt: null },
    select: { id: true, quantity: true },
  });
  if (!offer) throw new OutOfStockError(sku, name, 0);
  // Conditional decrement: if another order took the stock between our read
  // and this write, no row matches and we refuse instead of going negative.
  const taken = await tx.productOffer.updateMany({
    where: { id: offer.id, quantity: { gte: qty } },
    data: { quantity: { decrement: qty } },
  });
  if (taken.count === 0) {
    const now = await tx.productOffer.findUnique({ where: { id: offer.id }, select: { quantity: true } });
    throw new OutOfStockError(sku, name, Math.max(0, now?.quantity ?? 0));
  }
}

async function giveToOffer(tx: Tx, productId: string, resellerId: string | null, qty: number) {
  const back = await tx.productOffer.updateMany({
    where: { productId, resellerId, deletedAt: null },
    data: { quantity: { increment: qty } },
  });
  if (back.count === 0) {
    // The offer was removed since the order was placed; nothing to return to.
    console.warn(`[stock] no live offer to restock (product ${productId}, reseller ${resellerId ?? 'house'})`);
  }
}

/**
 * Move a colour's swatch stock by `delta` (negative = take). Only products that
 * carry per-colour stock are touched; taking more than the colour has refuses.
 */
async function moveShadeStock(tx: Tx, productId: string, shade: string | null, delta: number, sku: string, name: string) {
  if (!shade) return;
  const p = await tx.product.findUnique({ where: { id: productId }, select: { specs: true } });
  const shades = shadesOf(p?.specs ?? null);
  const i = shades.findIndex((s) => s.name === shade && typeof s.stock === 'number');
  if (i < 0) return;
  const next = (shades[i].stock as number) + delta;
  if (next < 0) throw new OutOfStockError(sku, `${name} (${shade})`, Math.max(0, shades[i].stock as number));
  const updated = shades.map((s, j) => (j === i ? { ...s, stock: next } : s));
  await tx.product.update({
    where: { id: productId },
    data: { specs: { ...((p?.specs as object) ?? {}), shades: updated } as Prisma.InputJsonValue },
  });
}

async function loadOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, resellerId: true, stockDeductedAt: true, stockRestoredAt: true, items: { select: lineSelect } },
  });
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

/** Take every line of a just-created order off its seller's stock. */
export async function deductOrderStock(tx: Tx, orderId: string): Promise<void> {
  const order = await loadOrder(tx, orderId);
  if (order.stockDeductedAt) return;
  for (const l of order.items) {
    if (isVoucher(l.product)) continue;
    await takeFromOffer(tx, l.productId, order.resellerId, l.quantity, l.product.sku, l.product.name);
    await moveShadeStock(tx, l.productId, l.shade, -l.quantity, l.product.sku, l.product.name);
  }
  await tx.order.update({ where: { id: order.id }, data: { stockDeductedAt: new Date() } });
}

/**
 * Put a cancelled order's units back. At most once, and only if they were
 * deducted — an order placed before stock deduction existed restocks nothing.
 */
export async function restoreOrderStock(tx: Tx, orderId: string): Promise<boolean> {
  const order = await loadOrder(tx, orderId);
  if (!order.stockDeductedAt || order.stockRestoredAt) return false;
  for (const l of order.items) {
    if (isVoucher(l.product)) continue;
    await giveToOffer(tx, l.productId, order.resellerId, l.quantity);
    await moveShadeStock(tx, l.productId, l.shade, l.quantity, l.product.sku, l.product.name);
  }
  await tx.order.update({ where: { id: order.id }, data: { stockRestoredAt: new Date() } });
  return true;
}

/**
 * A colour substitution on an order whose stock was already taken: return the
 * line's units to the old product/colour and take them from the new one.
 * A no-op for orders that never deducted (placed before this existed).
 */
export async function moveLineStock(
  tx: Tx,
  orderId: string,
  itemId: string,
  to: { productId: string; shade: string | null },
): Promise<void> {
  const order = await loadOrder(tx, orderId);
  if (!order.stockDeductedAt || order.stockRestoredAt) return;
  const l = order.items.find((i) => i.id === itemId);
  if (!l || isVoucher(l.product)) return;

  if (to.productId !== l.productId) {
    const target = await tx.product.findUnique({ where: { id: to.productId }, select: { sku: true, name: true } });
    await giveToOffer(tx, l.productId, order.resellerId, l.quantity);
    await takeFromOffer(tx, to.productId, order.resellerId, l.quantity, target?.sku ?? '', target?.name ?? 'Product');
  }
  await moveShadeStock(tx, l.productId, l.shade, l.quantity, l.product.sku, l.product.name);
  if (to.shade) {
    const target = to.productId === l.productId ? l.product : await tx.product.findUnique({ where: { id: to.productId }, select: { sku: true, name: true } });
    await moveShadeStock(tx, to.productId, to.shade, -l.quantity, target?.sku ?? '', target?.name ?? 'Product');
  }
}
