import {
  Prisma,
  OrderStatus,
  OrderType,
  ProductStatus,
  PaymentMethod,
  PaymentStatus,
  GatewayProvider,
} from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { getRazorpay } from '../config/razorpay';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted, orderFullInclude } from '../models/selectors';
import { resolveEmployee } from '../utils/scope';
import { isLive as isCampaignLive } from './campaign.service';
import { listActiveBanners } from './banner.service';
import { listApprovedReviews } from './review.service';
import type {
  AddToCartInput,
  UpdateCartInput,
  PlaceOrderInput,
  CreatePaymentOrderInput,
} from '../validators/shop.schema';

const PRODUCT_STATUS_OUT: Record<ProductStatus, string> = {
  ACTIVE: 'active',
  DRAFT: 'draft',
  INACTIVE: 'inactive',
};

const shopProductInclude = {
  category: { select: { slug: true, name: true } },
  offers: {
    where: notDeleted,
    include: {
      reseller: { select: { name: true } },
      freeGift: { select: { title: true } },
    },
  },
  images: { orderBy: { position: 'asc' }, select: { url: true } },
} satisfies Prisma.ProductInclude;

type ShopProductRow = Prisma.ProductGetPayload<{ include: typeof shopProductInclude }>;
type ShopOfferRow = ShopProductRow['offers'][number];

interface Presentation {
  g1?: string;
  g2?: string;
  newness?: number;
  shades?: { name: string; g1: string; g2: string; stock: number }[];
  rows?: { k: string; v: string }[];
}

// Offers eligible for the buy box: active, in stock, and priced.
function eligibleOffers(offers: ShopOfferRow[]): ShopOfferRow[] {
  return offers.filter(
    (o) => o.isActive && o.status === ProductStatus.ACTIVE && o.quantity > 0 && toNumber(o.eppPrice) > 0,
  );
}

// The winning offer: the cheapest eligible one by EPP price. (Public MOP is a
// single admin-set product price, so the buy box is always chosen by EPP.)
function pickBuyBox(offers: ShopOfferRow[]): ShopOfferRow | null {
  const elig = eligibleOffers(offers);
  if (!elig.length) return null;
  return [...elig].sort((a, b) => toNumber(a.eppPrice) - toNumber(b.eppPrice))[0];
}

// Map a DB product (+ its seeded presentation blob + marketplace offers) to the
// storefront's StoreProduct shape so the frontend adapter stays trivial.
function toStoreProduct(p: ShopProductRow, opts: { public?: boolean } = {}) {
  const pres = (p.specs ?? {}) as Presentation;
  const mrp = toNumber(p.mrp);
  const elig = eligibleOffers(p.offers);
  const winner = pickBuyBox(p.offers);
  // Public (pre-login) price = the admin-set MOP (falls back to MRP); EPP for employees.
  const mop = p.mop != null ? toNumber(p.mop) : mrp;
  const epp = winner ? toNumber(winner.eppPrice) : mrp;
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    brand: p.brand ?? '',
    // Vendor stays hidden from employees in the UI; the winning seller's name is
    // still carried for order attribution / admin views.
    vendor: winner?.reseller?.name ?? 'imcorpcart',
    sellerCount: elig.length,
    // Amazon-style variant family (separate sibling SKUs).
    familyKey: p.familyKey ?? null,
    optionColor: p.optionColor ?? null,
    optionVariant: p.optionVariant ?? null,
    familyColors: 1, // overwritten by collapseFamilies for grouped cards

    group: p.category.slug,
    cat: p.subCategory ?? '',
    status: PRODUCT_STATUS_OUT[p.status],
    // Anonymous visitors see MOP; authenticated employees see the EPP price.
    price: opts.public ? mop : epp,
    mop,
    mrp,
    stock: winner?.quantity ?? 0,
    // Real aggregate from approved reviews (recomputed on moderation). `reviews`
    // (count) is the source of truth for whether a rating exists — the UI hides
    // stars entirely when it's 0, so an unrated product never shows a fake score.
    rating: p.rating ?? 0,
    reviews: p.reviewCount ?? 0,
    desc: p.description ?? '',
    // The winning offer's free gift is the badge; first-party/bulk products fall
    // back to the master free-text freebie.
    freebie: winner?.freeGift
      ? { enabled: true, description: winner.freeGift.title }
      : { enabled: Boolean(p.freebieText), description: p.freebieText ?? '' },
    variants: p.variantOptions ? p.variantOptions.split(',').map((v) => v.trim()).filter(Boolean) : [],
    shades: pres.shades ?? [],
    specs: pres.rows ?? [],
    g1: pres.g1 ?? '#dfe3ea',
    g2: pres.g2 ?? '#b3b9c4',
    // Uploaded photos (ordered). `image` = first, for the card thumb; `images` = full
    // gallery. Both fall back to the gradient on the frontend when empty.
    image: p.images[0]?.url ?? null,
    images: p.images.map((img) => img.url),
    newness: pres.newness ?? 0,
  };
}

type StoreProductLite = ReturnType<typeof toStoreProduct>;

// Buy-box winner for checkout (authed EPP): the offer whose price/stock/reseller
// a line is fulfilled by. Returns null when nothing is buyable.
function winningOfferFor(p: ShopProductRow): ShopOfferRow | null {
  return pickBuyBox(p.offers);
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

// The storefront filters/sorts/facets client-side over the full active catalog
// (only ~22 SKUs), so we return everything active in one shot.
// Products with at least one active, in-stock offer are the buyable catalog.
const HAS_LIVE_OFFER = {
  offers: { some: { isActive: true, status: ProductStatus.ACTIVE, quantity: { gt: 0 }, deletedAt: null } },
} satisfies Prisma.ProductWhereInput;

// Sibling SKUs of a product's variant family (self included), for the detail
// page's colour/variant selectors. Empty family → just the product itself.
async function familyMembersOf(
  p: ShopProductRow,
  opts: { public?: boolean },
): Promise<ReturnType<typeof toFamilyMember>[]> {
  if (!p.familyKey) return [toFamilyMember(toStoreProduct(p, opts))];
  const rows = await prisma.product.findMany({
    where: { familyKey: p.familyKey, status: ProductStatus.ACTIVE, ...notDeleted, ...HAS_LIVE_OFFER },
    include: shopProductInclude,
  });
  const self = rows.some((r) => r.id === p.id) ? rows : [p, ...rows];
  return self.map((r) => toFamilyMember(toStoreProduct(r, opts)));
}

function toFamilyMember(sp: StoreProductLite) {
  return {
    id: sp.id,
    sku: sp.sku,
    optionColor: sp.optionColor,
    optionVariant: sp.optionVariant,
    price: sp.price,
    mop: sp.mop,
    image: sp.image,
    g1: sp.g1,
    g2: sp.g2,
    inStock: sp.stock > 0,
  };
}

export async function listProducts() {
  const rows = await prisma.product.findMany({
    where: { status: ProductStatus.ACTIVE, ...notDeleted, ...HAS_LIVE_OFFER },
    include: shopProductInclude,
    orderBy: { createdAt: 'desc' },
  });
  // Every SKU is shown as its own card — variant families are NOT collapsed
  // (each colour/variant combination is a separate product on the storefront).
  return { data: serialize(rows.map((r) => toStoreProduct(r))) };
}

export async function getProduct(id: string) {
  const p = await prisma.product.findFirst({
    where: { id, ...notDeleted },
    include: shopProductInclude,
  });
  if (!p) throw AppError.notFound('Product not found');
  const product = toStoreProduct(p);
  const family = await familyMembersOf(p, {});
  const reviews = await listApprovedReviews(p.id);

  const relatedRows = await prisma.product.findMany({
    where: {
      categoryId: p.categoryId,
      status: ProductStatus.ACTIVE,
      ...notDeleted,
      id: { not: p.id },
      // Don't surface this product's own siblings as "related".
      ...(p.familyKey ? { OR: [{ familyKey: null }, { familyKey: { not: p.familyKey } }] } : {}),
    },
    include: shopProductInclude,
    take: 4,
  });

  return serialize({ product, related: relatedRows.map((r) => toStoreProduct(r)), family, reviews });
}

// ─── Public catalog (no auth) — MOP-priced, EPP never exposed ────────────────

export async function listPublicProducts() {
  const rows = await prisma.product.findMany({
    where: { status: ProductStatus.ACTIVE, ...notDeleted, ...HAS_LIVE_OFFER },
    include: shopProductInclude,
    orderBy: { createdAt: 'desc' },
  });
  // Every SKU is shown as its own card — see listProducts.
  return { data: serialize(rows.map((r) => toStoreProduct(r, { public: true }))) };
}

export async function getPublicProduct(id: string) {
  const p = await prisma.product.findFirst({
    where: { id, status: ProductStatus.ACTIVE, ...notDeleted },
    include: shopProductInclude,
  });
  if (!p) throw AppError.notFound('Product not found');
  const product = toStoreProduct(p, { public: true });
  const family = await familyMembersOf(p, { public: true });
  const reviews = await listApprovedReviews(p.id);

  const relatedRows = await prisma.product.findMany({
    where: {
      categoryId: p.categoryId,
      status: ProductStatus.ACTIVE,
      ...notDeleted,
      id: { not: p.id },
      ...(p.familyKey ? { OR: [{ familyKey: null }, { familyKey: { not: p.familyKey } }] } : {}),
    },
    include: shopProductInclude,
    take: 4,
  });

  return serialize({ product, related: relatedRows.map((r) => toStoreProduct(r, { public: true })), family, reviews });
}

// ─── Coupons ─────────────────────────────────────────────────────────────────

interface StoreCouponShape {
  code: string;
  type: 'pct' | 'flat';
  val: number;
  cap?: number;
  min?: number;
  scope: string;
  label: string;
}

function toStoreCoupon(c: Prisma.CouponGetPayload<{ include: { category: true } }>): StoreCouponShape {
  const type = c.type === 'PERCENT' ? 'pct' : 'flat';
  const val = toNumber(c.value);
  const cap = c.maxDiscount === null ? undefined : toNumber(c.maxDiscount);
  const min = toNumber(c.minOrderValue) || undefined;
  const scope = c.category?.slug ?? 'all';
  const label =
    type === 'pct'
      ? `${val}% off${cap ? ` · up to ₹${cap.toLocaleString('en-IN')}` : ''}`
      : `₹${val.toLocaleString('en-IN')} off${min ? ` over ₹${min.toLocaleString('en-IN')}` : ''}`;
  return { code: c.code, type, val, cap, min, scope, label };
}

export async function listCoupons() {
  const rows = await prisma.coupon.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    include: { category: true },
  });
  return { data: rows.map(toStoreCoupon) };
}

// Active storefront promo banners (Super-Admin managed) for the Home carousel.
export function listBanners() {
  return listActiveBanners();
}

// Coupon/checkout math — replicated exactly from the storefront coupon.ts.
function computeDiscount(coupon: StoreCouponShape | null, subtotal: number): number {
  if (!coupon) return 0;
  if (subtotal < (coupon.min ?? 0)) return 0;
  const d =
    coupon.type === 'pct'
      ? Math.min(Math.round((subtotal * coupon.val) / 100), coupon.cap ?? Infinity)
      : coupon.val;
  return Math.min(d, subtotal);
}

// ─── Cart ────────────────────────────────────────────────────────────────────

const cartItemInclude = {
  product: { include: shopProductInclude },
} satisfies Prisma.CartItemInclude;

async function loadCart(employeeId: string) {
  const cart = await prisma.cart.findUnique({
    where: { employeeId },
    include: { items: { include: cartItemInclude, orderBy: { createdAt: 'asc' } } },
  });
  return cart;
}

function shadeStock(product: StoreProductLite, shade: string | null): number {
  if (shade) {
    const s = product.shades.find((sh) => sh.name === shade);
    if (s) return s.stock;
  }
  return product.stock;
}

function serializeCart(
  cart: Prisma.CartGetPayload<{ include: { items: { include: typeof cartItemInclude } } }> | null,
) {
  const lines = (cart?.items ?? []).map((it) => {
    const p = toStoreProduct(it.product);
    return {
      itemId: it.id,
      productId: it.productId,
      shade: it.shade ?? '',
      qty: it.quantity,
      name: p.name,
      brand: p.brand,
      vendor: p.vendor,
      group: p.group, // category slug — for category-scoped discount preview
      price: p.price,
      mrp: p.mrp,
      g1: p.g1,
      g2: p.g2,
      shades: p.shades,
      freebie: p.freebie,
      stock: shadeStock(p, it.shade),
      // Amazon-style line detail: short description + spec highlights.
      desc: p.desc,
      specs: p.specs,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return serialize({ id: cart?.id ?? null, lines, subtotal });
}

export async function getCart(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  return serializeCart(await loadCart(employeeId));
}

export async function addToCart(userId: string, input: AddToCartInput) {
  const { id: employeeId } = await resolveEmployee(userId);
  const shade = input.shade?.trim() || null;
  const qty = input.qty ?? 1;

  const product = await prisma.product.findFirst({
    where: { id: input.productId, ...notDeleted },
    include: shopProductInclude,
  });
  if (!product) throw AppError.notFound('Product not found');
  const sp = toStoreProduct(product);
  const available = shadeStock(sp, shade);

  const cart = await prisma.cart.upsert({
    where: { employeeId },
    create: { employeeId },
    update: {},
  });

  // findFirst (not findUnique) — the compound-unique input can't express a null
  // shade, and Postgres treats null shades as distinct rows anyway.
  const existing = await prisma.cartItem.findFirst({
    where: { cartId: cart.id, productId: input.productId, shade },
  });
  const nextQty = (existing?.quantity ?? 0) + qty;
  if (available > 0 && nextQty > available) {
    throw AppError.badRequest(`Only ${available} in stock for this option`);
  }

  if (existing) {
    await prisma.cartItem.update({ where: { id: existing.id }, data: { quantity: nextQty } });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId: input.productId, shade, quantity: qty },
    });
  }

  return serializeCart(await loadCart(employeeId));
}

export async function updateCartItem(userId: string, itemId: string, input: UpdateCartInput) {
  const { id: employeeId } = await resolveEmployee(userId);
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { employeeId } },
    include: { product: { include: shopProductInclude } },
  });
  if (!item) throw AppError.notFound('Cart item not found');

  if (input.qty <= 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
  } else {
    const available = shadeStock(toStoreProduct(item.product), item.shade);
    if (available > 0 && input.qty > available) {
      throw AppError.badRequest(`Only ${available} in stock for this option`);
    }
    await prisma.cartItem.update({ where: { id: item.id }, data: { quantity: input.qty } });
  }

  return serializeCart(await loadCart(employeeId));
}

export async function removeCartItem(userId: string, itemId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const item = await prisma.cartItem.findFirst({ where: { id: itemId, cart: { employeeId } } });
  if (!item) throw AppError.notFound('Cart item not found');
  await prisma.cartItem.delete({ where: { id: item.id } });
  return serializeCart(await loadCart(employeeId));
}

// ─── Coupon validation (against the live cart) ───────────────────────────────

async function findStoreCoupon(code: string): Promise<StoreCouponShape | null> {
  const c = await prisma.coupon.findFirst({
    where: { code: code.trim().toUpperCase(), status: 'ACTIVE' },
    include: { category: true },
  });
  return c ? toStoreCoupon(c) : null;
}

export async function validateCoupon(userId: string, code: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const cart = await loadCart(employeeId);
  const lines = (cart?.items ?? []).map((it) => ({
    p: toStoreProduct(it.product),
    qty: it.quantity,
  }));
  const subtotal = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const cats = new Set(lines.map((l) => l.p.group));

  const coupon = await findStoreCoupon(code);
  if (!coupon) return { ok: false as const, error: 'Invalid coupon code' };
  if (coupon.scope !== 'all' && !cats.has(coupon.scope)) {
    return { ok: false as const, error: `This code only applies to ${coupon.scope}` };
  }
  if (subtotal < (coupon.min ?? 0)) {
    const need = (coupon.min ?? 0) - subtotal;
    return { ok: false as const, error: `Add ₹${need.toLocaleString('en-IN')}+ to use this code` };
  }
  return { ok: true as const, coupon, discount: computeDiscount(coupon, subtotal) };
}

// ─── Checkout ────────────────────────────────────────────────────────────────

// The exhibition (QR campaign) discount the buyer is currently entitled to, or
// null. FIRST_ORDER/FOREVER were earned at registration and apply regardless of
// the campaign window (FIRST_ORDER is consumed by placeOrder); WHILE_ACTIVE
// only applies while the campaign is ACTIVE and in-window.
async function qrDiscountFor(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { qrDiscountEligible: true, qrCampaign: { include: { category: true } } },
  });
  if (!u?.qrDiscountEligible || !u.qrCampaign) return null;
  const c = u.qrCampaign;
  if (c.discountMode === 'WHILE_ACTIVE' && !isCampaignLive(c)) return null;
  return {
    campaignId: c.id,
    campaignName: c.name,
    percent: toNumber(c.discountPercent),
    mode: c.discountMode,
    // null = all categories; otherwise the discount applies only to lines whose
    // product category slug matches (p.group).
    categorySlug: c.category?.slug ?? null,
    categoryName: c.category?.name ?? null,
  };
}

// Price the current cart authoritatively: resolve buy-box offers, validate the
// coupon, apply exhibition + coupon discounts, split by fulfilling reseller.
// Payment is always Razorpay (the shopper picks UPI/card/net-banking inside the
// gateway), so there is no per-method surcharge. Backs both createPaymentOrder
// (amount to charge) and placeOrder (the amounts written to the split orders) so
// they can never drift.
async function priceCart(userId: string, couponCode?: string) {
  const { id: employeeId, companyId } = await resolveEmployee(userId);

  const cart = await loadCart(employeeId);
  if (!cart || cart.items.length === 0) throw AppError.badRequest('Your cart is empty');

  // Resolve each cart line to its buy-box (cheapest active, in-stock) offer.
  // The offer decides the unit price and the fulfilling reseller. A line whose
  // product has no live offer can't be purchased.
  const lines = cart.items.map((it) => {
    const p = toStoreProduct(it.product);
    const offer = winningOfferFor(it.product);
    if (!offer) throw AppError.badRequest(`"${p.name}" is out of stock`);
    return {
      it,
      p,
      resellerId: offer.resellerId ?? null,
      unitPrice: toNumber(offer.eppPrice),
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.it.quantity, 0);

  // Coupon (optional) — validated against the whole cart (category scope), then
  // applied per split order below.
  let coupon: StoreCouponShape | null = null;
  const cats = new Set(lines.map((l) => l.p.group));
  if (couponCode) {
    coupon = await findStoreCoupon(couponCode);
    if (coupon && coupon.scope !== 'all' && !cats.has(coupon.scope)) coupon = null;
  }
  const dbCoupon = coupon
    ? await prisma.coupon.findUnique({ where: { code: coupon.code }, select: { id: true, resellerId: true } })
    : null;
  const totalDiscount = computeDiscount(coupon, subtotal);

  // Exhibition (QR campaign) discount reduces subtotal first, before coupons.
  const qr = await qrDiscountFor(userId);

  // Group lines by fulfilling reseller (null = first-party/house) → one order each.
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = l.resellerId ?? '__house__';
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }

  // Per-group amounts. Coupon share: a reseller-scoped coupon applies only to
  // its own group; a platform coupon splits proportionally (last group takes
  // the rounding remainder).
  let couponRemainder = totalDiscount;
  const groupList = [...groups.entries()];
  const priced = groupList.map(([key, gLines], gi) => {
    const resellerId = key === '__house__' ? null : key;
    const gSubtotal = gLines.reduce((s, l) => s + l.unitPrice * l.it.quantity, 0);

    let gCouponDiscount = 0;
    if (coupon && totalDiscount > 0) {
      if (dbCoupon?.resellerId) {
        gCouponDiscount = dbCoupon.resellerId === resellerId ? computeDiscount(coupon, gSubtotal) : 0;
      } else if (gi === groupList.length - 1) {
        gCouponDiscount = couponRemainder;
      } else {
        gCouponDiscount = Math.round((totalDiscount * gSubtotal) / subtotal);
        couponRemainder -= gCouponDiscount;
      }
    }

    // Exhibition (QR) discount base: a category-scoped campaign discounts only
    // the matching-category lines; an unscoped campaign discounts the whole group.
    const gExhBase = qr?.categorySlug
      ? gLines.filter((l) => l.p.group === qr.categorySlug).reduce((s, l) => s + l.unitPrice * l.it.quantity, 0)
      : gSubtotal;
    const gExhibition = qr ? Math.round((gExhBase * qr.percent) / 100) : 0;
    const gPayable = Math.max(0, gSubtotal - gExhibition - gCouponDiscount);
    // No payment surcharge/GST — Razorpay carries any gateway fee, not the buyer.
    const gTotal = gPayable;

    return { resellerId, gLines, gSubtotal, gCouponDiscount, gExhibition, gPayable, gTotal };
  });

  const grandTotal = priced.reduce((s, g) => s + g.gTotal, 0);

  return { employeeId, companyId, cart, subtotal, coupon, dbCoupon, qr, priced, grandTotal };
}

// Razorpay reports the instrument the shopper actually used (`payment.method`);
// map it onto our PaymentMethod enum for the recorded row.
function mapRazorpayMethod(method?: string): PaymentMethod {
  switch (method) {
    case 'netbanking':
      return PaymentMethod.NET_BANKING;
    case 'card':
      return PaymentMethod.CREDIT_CARD; // Razorpay doesn't split credit/debit here
    case 'upi':
    default:
      return PaymentMethod.UPI;
  }
}

// Razorpay signs `order_id|payment_id` with the key secret; a mismatch means the
// callback fields were tampered with (or belong to another merchant).
function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string) {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw AppError.badRequest('Payment gateway is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET)');
  }
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw AppError.badRequest('Payment verification failed');
  }
}

// View-only demo accounts can browse/cart but never purchase — enforced
// server-side (not just hidden in the UI) regardless of the global flag.
async function assertNotViewOnly(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { viewOnly: true } });
  if (u?.viewOnly) throw AppError.forbidden('This is a view-only demo account — checkout is disabled');
}

// Step 1 of checkout: price the cart and open a Razorpay order for the grand
// total. The frontend feeds the returned id into the Razorpay Checkout modal;
// the signed result comes back through placeOrder.
export async function createPaymentOrder(userId: string, input: CreatePaymentOrderInput) {
  if (!env.CHECKOUT_ENABLED) {
    throw AppError.forbidden('Checkout is temporarily unavailable — online payments are launching soon');
  }
  await assertNotViewOnly(userId);
  const razorpay = getRazorpay();
  const { grandTotal } = await priceCart(userId, input.couponCode);
  if (grandTotal <= 0) throw AppError.badRequest('Nothing to pay — place the order directly');

  const orderParams: Record<string, unknown> = {
    amount: Math.round(grandTotal * 100), // paise
    currency: 'INR',
    receipt: `imc_${nanoid(10)}`,
  };
  // Apply the saved Checkout Configuration (e.g. Card + UPI only) when set.
  if (env.RAZORPAY_CHECKOUT_CONFIG_ID) {
    orderParams.checkout_config_id = env.RAZORPAY_CHECKOUT_CONFIG_ID;
  }
  const rzOrder = await razorpay.orders.create(orderParams as unknown as Parameters<typeof razorpay.orders.create>[0]);

  return {
    keyId: env.RAZORPAY_KEY_ID,
    rzpOrderId: rzOrder.id,
    amount: Number(rzOrder.amount),
    currency: rzOrder.currency,
  };
}

export async function placeOrder(userId: string, input: PlaceOrderInput) {
  if (!env.CHECKOUT_ENABLED) {
    throw AppError.forbidden('Checkout is temporarily unavailable — online payments are launching soon');
  }
  await assertNotViewOnly(userId);
  const { employeeId, companyId, cart, coupon, dbCoupon, qr, priced, grandTotal } =
    await priceCart(userId, input.couponCode);

  // Payment is always via Razorpay — a verified gateway result is required for
  // any payable checkout. Only a fully-discounted ₹0 cart places without one.
  let gatewayOrderId: string | null = null;
  let gatewayTxnId: string | null = null;
  let payMethod: PaymentMethod = PaymentMethod.UPI;
  if (grandTotal > 0) {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = input;
    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      throw AppError.badRequest('Payment is required to place this order');
    }
    verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

    // A captured payment can back exactly one checkout.
    const reused = await prisma.payment.findFirst({
      where: { gatewayTxnId: razorpayPaymentId },
      select: { id: true },
    });
    if (reused) throw AppError.conflict('This payment has already been used for an order');

    // Fetch the captured payment: confirm it belongs to this order, that the
    // amount matches the re-priced cart (guards against the cart changing between
    // opening the modal and paying), and read the instrument used.
    const payment = await getRazorpay().payments.fetch(razorpayPaymentId);
    if (payment.order_id !== razorpayOrderId) {
      throw AppError.badRequest('Payment does not match this order — please retry checkout');
    }
    if (Number(payment.amount) !== Math.round(grandTotal * 100)) {
      throw AppError.badRequest('Paid amount does not match the cart total — please retry checkout');
    }
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      throw AppError.badRequest('Payment was not completed — please retry checkout');
    }

    gatewayOrderId = razorpayOrderId;
    gatewayTxnId = razorpayPaymentId;
    payMethod = mapRazorpayMethod(payment.method);
  }

  const checkoutGroup = nanoid(12);
  const baseNo = Date.now().toString().slice(-8);
  const D = (n: number) => new Prisma.Decimal(n);

  const created = await prisma.$transaction(async (tx) => {
    // Shipping address (shared across the split orders): the chosen one, else the
    // default, else an auto-created fallback.
    let address = input.addressId
      ? await tx.address.findFirst({ where: { id: input.addressId, employeeId } })
      : await tx.address.findFirst({ where: { employeeId, isBilling: false }, orderBy: { isDefault: 'desc' } });
    if (input.addressId && !address) throw AppError.badRequest('Delivery address not found');
    if (!address) {
      const emp = await tx.employee.findUnique({
        where: { id: employeeId },
        select: { user: { select: { fullName: true, phone: true } } },
      });
      address = await tx.address.create({
        data: {
          type: 'OFFICE',
          employeeId,
          contactName: emp?.user.fullName ?? 'Employee',
          contactPhone: emp?.user.phone ?? '0000000000',
          line1: 'Corporate address on file',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
          isDefault: true,
        },
      });
    }

    // Billing address: null = same as shipping. Validate ownership when given.
    let billingAddressId: string | null = null;
    if (input.billingAddressId && input.billingAddressId !== address.id) {
      const billing = await tx.address.findFirst({ where: { id: input.billingAddressId, employeeId } });
      if (!billing) throw AppError.badRequest('Billing address not found');
      billingAddressId = billing.id;
    }

    const orderIds: string[] = [];

    for (let gi = 0; gi < priced.length; gi += 1) {
      const g = priced[gi];

      const order = await tx.order.create({
        data: {
          orderNo: priced.length > 1 ? `IMC-${baseNo}-${gi + 1}` : `IMC-${baseNo}`,
          type: OrderType.EPP,
          employeeId,
          companyId,
          resellerId: g.resellerId,
          checkoutGroup,
          addressId: address.id,
          billingAddressId,
          couponId: g.gCouponDiscount > 0 ? dbCoupon?.id ?? null : null,
          couponCode: g.gCouponDiscount > 0 ? coupon?.code ?? null : null,
          couponDiscount: D(g.gCouponDiscount),
          subtotal: D(g.gSubtotal),
          exhibitionDiscount: D(g.gExhibition),
          exhibitionCampaignId: g.gExhibition > 0 ? qr?.campaignId ?? null : null,
          surcharge: D(0),
          gst: D(0),
          total: D(g.gTotal),
          status: OrderStatus.PLACED,
          items: {
            create: g.gLines.map((l) => ({
              productId: l.it.productId,
              quantity: l.it.quantity,
              unitPrice: D(l.unitPrice),
              lineTotal: D(l.unitPrice * l.it.quantity),
            })),
          },
          statusHistory: {
            create: { status: OrderStatus.PLACED, changedById: userId, note: 'Order placed' },
          },
        },
      });
      orderIds.push(order.id);

      // Record the captured gateway payment against each split order (they all
      // share the one Razorpay order; amounts are this order's slice).
      if (gatewayTxnId && gatewayOrderId) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            method: payMethod,
            gateway: GatewayProvider.RAZORPAY,
            baseAmount: D(g.gPayable),
            surcharge: D(0),
            gstOnSurcharge: D(0),
            total: D(g.gTotal),
            status: PaymentStatus.CAPTURED,
            gatewayOrderId,
            gatewayTxnId,
          },
        });
      }
    }

    // Drain the cart.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    // A FIRST_ORDER exhibition discount is consumed by this checkout.
    if (qr?.mode === 'FIRST_ORDER') {
      await tx.user.update({ where: { id: userId }, data: { qrDiscountEligible: false } });
    }

    return orderIds;
  });

  // Return the first split order (full), plus checkout-group metadata so the
  // confirmation screen can note the split.
  const full = await prisma.order.findUnique({ where: { id: created[0] }, include: orderFullInclude });
  return serialize({ ...full, checkoutGroup, orderCount: created.length });
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

// The shopper's alerts, derived live from their own orders' status history —
// no Notification rows are written (that model is the future delivery bus).
const NOTIF_SHAPE: Record<string, { type: string; title: string; body: (o: string) => string }> = {
  PLACED: { type: 'payment', title: 'Order placed', body: (o) => `Your order ${o} was placed successfully.` },
  CONFIRMED: { type: 'order', title: 'Order confirmed', body: (o) => `${o} has been confirmed by the vendor.` },
  DISPATCHED: { type: 'delivery', title: 'Order dispatched', body: (o) => `${o} is on its way.` },
  DELIVERED: { type: 'delivery', title: 'Order delivered', body: (o) => `${o} was delivered.` },
  CANCELLED: { type: 'order', title: 'Order cancelled', body: (o) => `${o} was cancelled.` },
  RETURNED: { type: 'order', title: 'Order returned', body: (o) => `${o} was returned.` },
};

export async function listNotifications(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const rows = await prisma.orderStatusHistory.findMany({
    where: { order: { employeeId } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { order: { select: { orderNo: true, total: true } } },
  });
  const data = rows.map((h) => {
    const shape = NOTIF_SHAPE[h.status] ?? NOTIF_SHAPE.CONFIRMED;
    const orderNo = `#${h.order.orderNo}`;
    return {
      id: h.id,
      type: shape.type,
      title: shape.title,
      body:
        h.status === 'PLACED'
          ? `${orderNo} — ₹${toNumber(h.order.total).toLocaleString('en-IN')} confirmed.`
          : shape.body(orderNo),
      at: h.createdAt,
    };
  });
  return { data: serialize(data) };
}

// ─── Orders / tracking ───────────────────────────────────────────────────────

export async function listOrders(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const rows = await prisma.order.findMany({
    where: { employeeId },
    orderBy: { createdAt: 'desc' },
    select: {
      orderNo: true,
      status: true,
      total: true,
      createdAt: true,
      checkoutGroup: true,
      reseller: { select: { name: true } },
      shipment: { select: { status: true, courier: { select: { name: true } } } },
      items: { select: { quantity: true, product: { select: { name: true } } } },
    },
  });
  return { data: serialize(rows) };
}

export async function getOrder(userId: string, id: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const order = await prisma.order.findFirst({
    where: { employeeId, OR: [{ id }, { orderNo: id }] },
    include: orderFullInclude,
  });
  if (!order) throw AppError.notFound('Order not found');
  return serialize(order);
}

export async function getTracking(userId: string, id: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const order = await prisma.order.findFirst({
    where: { employeeId, OR: [{ id }, { orderNo: id }] },
    select: {
      orderNo: true,
      status: true,
      createdAt: true,
      shipment: {
        include: {
          courier: { select: { code: true, name: true } },
          trackingEvents: { orderBy: { occurredAt: 'asc' } },
        },
      },
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!order) throw AppError.notFound('Order not found');
  return serialize(order);
}

// ─── Wishlist ────────────────────────────────────────────────────────────────

export async function getWishlist(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const rows = await prisma.wishlistItem.findMany({
    where: { employeeId },
    orderBy: { createdAt: 'desc' },
    include: { product: { include: shopProductInclude } },
  });
  return { data: serialize(rows.map((w) => toStoreProduct(w.product))) };
}

export async function addWishlist(userId: string, productId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  await prisma.wishlistItem.upsert({
    where: { employeeId_productId: { employeeId, productId } },
    create: { employeeId, productId },
    update: {},
  });
  return getWishlist(userId);
}

export async function removeWishlist(userId: string, productId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  await prisma.wishlistItem
    .delete({ where: { employeeId_productId: { employeeId, productId } } })
    .catch(() => undefined);
  return getWishlist(userId);
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const employee = await prisma.employee.findFirst({
    where: { userId, ...notDeleted },
    include: {
      user: { select: { fullName: true, email: true, phone: true, viewOnly: true } },
      company: { select: { name: true, status: true, smartEppEnabled: true } },
      addresses: { orderBy: { isDefault: 'desc' } },
    },
  });
  if (!employee) throw AppError.forbidden('No employee profile is linked to this account');

  const spent = await prisma.order.aggregate({
    where: { employeeId: employee.id, status: { in: [OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED, OrderStatus.DELIVERED] } },
    _sum: { total: true },
  });

  // Exhibition (QR) discount the shopper is currently entitled to, for the
  // cart/checkout preview. The authoritative math stays in placeOrder.
  const qr = await qrDiscountFor(userId);

  return serialize({
    name: employee.user.fullName,
    email: employee.user.email,
    phone: employee.user.phone,
    company: employee.company.name,
    companyStatus: employee.company.status,
    smartEppEnabled: employee.company.smartEppEnabled,
    // View-only demo accounts never see checkout, even when the global flag is on.
    checkoutEnabled: env.CHECKOUT_ENABLED && !employee.user.viewOnly,
    viewOnly: employee.user.viewOnly,
    program: employee.program,
    creditLimit: employee.creditLimit === null ? null : toNumber(employee.creditLimit),
    creditUsed: toNumber(spent._sum.total),
    addresses: employee.addresses.map(toAddress),
    qrDiscount: qr
      ? { percent: qr.percent, campaignName: qr.campaignName, categorySlug: qr.categorySlug, categoryName: qr.categoryName }
      : null,
  });
}

// ─── Addresses (shipping list + one billing) ─────────────────────────────────

function toAddress(a: Prisma.AddressGetPayload<object>) {
  return {
    id: a.id,
    label: a.label,
    type: a.type,
    contactName: a.contactName,
    contactPhone: a.contactPhone,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    state: a.state,
    pincode: a.pincode,
    isBilling: a.isBilling,
    isDefault: a.isDefault,
  };
}

interface AddressInput {
  contactName?: string;
  contactPhone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  type?: 'OFFICE' | 'HOME' | 'COMPANY_DEFINED';
  label?: string;
  isBilling?: boolean;
  isDefault?: boolean;
}

export async function listAddresses(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const rows = await prisma.address.findMany({
    where: { employeeId },
    orderBy: [{ isBilling: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
  });
  return { data: serialize(rows.map(toAddress)) };
}

export async function createAddress(userId: string, input: AddressInput) {
  const { id: employeeId } = await resolveEmployee(userId);
  const isBilling = Boolean(input.isBilling);
  // Single billing address per employee.
  if (isBilling) {
    await prisma.address.updateMany({ where: { employeeId, isBilling: true }, data: { isBilling: false } });
  }
  // Single default among shipping addresses.
  const isDefault = !isBilling && Boolean(input.isDefault);
  if (isDefault) {
    await prisma.address.updateMany({ where: { employeeId, isBilling: false }, data: { isDefault: false } });
  }
  const created = await prisma.address.create({
    data: {
      employeeId,
      type: input.type ?? 'OFFICE',
      label: input.label ?? null,
      contactName: input.contactName ?? '',
      contactPhone: input.contactPhone ?? '',
      line1: input.line1 ?? '',
      line2: input.line2 ?? null,
      city: input.city ?? '',
      state: input.state ?? '',
      pincode: input.pincode ?? '',
      isBilling,
      isDefault,
    },
  });
  return serialize(toAddress(created));
}

export async function updateAddress(userId: string, id: string, input: AddressInput) {
  const { id: employeeId } = await resolveEmployee(userId);
  const existing = await prisma.address.findFirst({ where: { id, employeeId } });
  if (!existing) throw AppError.notFound('Address not found');

  const isBilling = input.isBilling ?? existing.isBilling;
  if (isBilling && !existing.isBilling) {
    await prisma.address.updateMany({ where: { employeeId, isBilling: true }, data: { isBilling: false } });
  }
  const isDefault = isBilling ? false : (input.isDefault ?? existing.isDefault);
  if (isDefault && !existing.isDefault) {
    await prisma.address.updateMany({ where: { employeeId, isBilling: false }, data: { isDefault: false } });
  }

  const updated = await prisma.address.update({
    where: { id },
    data: {
      type: input.type ?? existing.type,
      label: input.label ?? existing.label,
      contactName: input.contactName ?? existing.contactName,
      contactPhone: input.contactPhone ?? existing.contactPhone,
      line1: input.line1 ?? existing.line1,
      line2: input.line2 ?? existing.line2,
      city: input.city ?? existing.city,
      state: input.state ?? existing.state,
      pincode: input.pincode ?? existing.pincode,
      isBilling,
      isDefault,
    },
  });
  return serialize(toAddress(updated));
}

export async function deleteAddress(userId: string, id: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const existing = await prisma.address.findFirst({ where: { id, employeeId } });
  if (!existing) throw AppError.notFound('Address not found');
  const orderCount = await prisma.order.count({ where: { addressId: id } });
  if (orderCount > 0) {
    throw AppError.badRequest("This address is used by an order and can't be deleted");
  }
  await prisma.address.delete({ where: { id } });
  return { ok: true };
}
