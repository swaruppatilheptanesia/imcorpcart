import {
  Prisma,
  OrderStatus,
  OrderType,
  ProductStatus,
  PaymentMethod,
  PaymentStatus,
  GatewayProvider,
  VoucherFulfilmentStatus,
} from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { nanoid } from 'nanoid';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { getRazorpay } from '../config/razorpay';
import { HUBBLE_ADAPTER } from '../config/hubble';
import { isDemoLoginEmail } from '../config/constants';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted, orderFullInclude, shopOrderFullInclude } from '../models/selectors';
import { resolveEmployee } from '../utils/scope';
import { isLive as isCampaignLive } from './campaign.service';
import { listActiveBanners } from './banner.service';
import { listApprovedReviews } from './review.service';
import { kickoffVoucherFulfilments } from './voucher-fulfilment.service';
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

export const shopProductInclude = {
  category: { select: { slug: true, name: true } },
  // Provenance — used to detect a gift-card (Hubble voucher) line at checkout.
  source: { select: { adapter: true, active: true } },
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

interface VoucherSpec {
  denominations: number[];
  min: number | null;
  max: number | null;
  type: string | null; // FIXED | FLEXIBLE
}

interface Presentation {
  g1?: string;
  g2?: string;
  newness?: number;
  shades?: { name: string; g1: string; g2: string; stock: number }[];
  rows?: { k: string; v: string }[];
  voucher?: VoucherSpec;
}

// A gift-card line — imported from Hubble (provenance is the authoritative signal;
// the "vouchers" category slug is a fallback). Voucher lines are priced by the
// buyer's chosen denomination (carried in the cart line's `shade`), not the offer.
export function isVoucherProduct(p: ShopProductRow): boolean {
  return p.source?.adapter === HUBBLE_ADAPTER || p.category.slug === 'vouchers';
}
export function voucherSpecOf(p: ShopProductRow): VoucherSpec | null {
  return ((p.specs ?? {}) as Presentation).voucher ?? null;
}

// Validate a chosen gift-card amount against the brand's Hubble acceptance rules —
// exactly what Hubble will accept on POST /v1/partners/orders — so we never charge
// the buyer for an amount that would then be rejected. Whole rupees only (Hubble
// denominations are integers); FIXED brands accept only a listed denomination;
// FLEXIBLE brands accept an integer within [min, max] (bounds are required — if a
// flexible brand imported without them we can't verify acceptance, so we refuse).
// Throws AppError.badRequest on any violation.
function assertValidVoucherAmount(spec: VoucherSpec | null, amount: number, productName: string): void {
  const label = productName ? `"${productName}"` : 'this gift card';
  if (!spec) throw AppError.badRequest(`Gift-card options are unavailable for ${label}`);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw AppError.badRequest(`Enter a whole-rupee amount for ${label}`);
  }
  const denoms = spec.denominations ?? [];
  if (denoms.length) {
    if (!denoms.includes(amount)) {
      throw AppError.badRequest(`Choose a valid gift-card amount (${denoms.map((d) => `₹${d}`).join(', ')})`);
    }
    return;
  }
  // FLEXIBLE (custom-amount) brand — both bounds must be known to accept a value.
  if (spec.min == null || spec.max == null) {
    throw AppError.badRequest(`Gift-card amount options are unavailable for ${label} right now`);
  }
  if (amount < spec.min || amount > spec.max) {
    throw AppError.badRequest(`Amount for ${label} must be between ₹${spec.min} and ₹${spec.max}`);
  }
}

// Offers eligible for the buy box: active, in stock, and priced.
function eligibleOffers(offers: ShopOfferRow[]): ShopOfferRow[] {
  return offers.filter(
    (o) => o.isActive && o.status === ProductStatus.ACTIVE && o.quantity > 0 && toNumber(o.eppPrice) > 0,
  );
}

// The winning offer: the cheapest eligible one by EPP price. (Public MOP is a
// single admin-set product price, so the buy box is always chosen by EPP.)
export function pickBuyBox(offers: ShopOfferRow[]): ShopOfferRow | null {
  const elig = eligibleOffers(offers);
  if (!elig.length) return null;
  return [...elig].sort((a, b) => toNumber(a.eppPrice) - toNumber(b.eppPrice))[0];
}

// Cashback (₹) a shopper earns per unit at a given paid price. PERCENT → % of
// price; FIXED → flat ₹/unit; NONE → 0. Line cashback = this × quantity.
function cashbackPerUnit(
  cashbackType: ShopProductRow['cashbackType'],
  cashbackValue: ShopProductRow['cashbackValue'],
  unitPrice: number,
): number {
  const v = toNumber(cashbackValue);
  if (!v) return 0;
  if (cashbackType === 'PERCENT') return Math.round((unitPrice * v) / 100);
  if (cashbackType === 'FIXED') return Math.round(v);
  return 0;
}

// Map a DB product (+ its seeded presentation blob + marketplace offers) to the
// storefront's StoreProduct shape so the frontend adapter stays trivial.
export function toStoreProduct(p: ShopProductRow, opts: { public?: boolean } = {}) {
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
    // Cashback (₹/unit) earned on purchase, at the price being shown.
    cashback: cashbackPerUnit(p.cashbackType, p.cashbackValue, opts.public ? mop : epp),
    // Tax + policy attributes (shown Amazon-style on the product page).
    hsnCode: p.hsnCode ?? null,
    gstPercent: p.gstPercent != null ? toNumber(p.gstPercent) : null,
    termsText: p.termsText ?? '',
    warrantyText: p.warrantyText ?? '',
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
    // Gift-card (Hubble voucher) product: structured denominations for the
    // checkout picker + a flag so the storefront renders the amount selector and
    // the "code delivered after purchase" note. Null for normal products.
    voucher: isVoucherProduct(p) ? pres.voucher ?? { denominations: [], min: null, max: null, type: null } : null,
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
export const HAS_LIVE_OFFER = {
  offers: { some: { isActive: true, status: ProductStatus.ACTIVE, quantity: { gt: 0 }, deletedAt: null } },
} satisfies Prisma.ProductWhereInput;

// Admin visibility gate applied on every storefront query: a product is shown
// only if the admin hasn't hidden it (`hidden: false`) AND — for imported vendor
// products — its VendorSource is active (vendor suspend hides all its products).
// Internal/bulk products (sourceId null) are always vendor-OK.
export const STOREFRONT_SHOWABLE = {
  hidden: false,
  OR: [{ sourceId: null }, { source: { is: { active: true } } }],
} satisfies Prisma.ProductWhereInput;

// Sibling SKUs of a product's variant family (self included), for the detail
// page's colour/variant selectors. Empty family → just the product itself.
async function familyMembersOf(
  p: ShopProductRow,
  opts: { public?: boolean },
): Promise<ReturnType<typeof toFamilyMember>[]> {
  if (!p.familyKey) return [toFamilyMember(toStoreProduct(p, opts))];
  const rows = await prisma.product.findMany({
    where: { familyKey: p.familyKey, status: ProductStatus.ACTIVE, ...notDeleted, ...STOREFRONT_SHOWABLE, ...HAS_LIVE_OFFER },
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
    where: { status: ProductStatus.ACTIVE, ...notDeleted, ...STOREFRONT_SHOWABLE, ...HAS_LIVE_OFFER },
    include: shopProductInclude,
    orderBy: { createdAt: 'desc' },
  });
  // Every SKU is shown as its own card — variant families are NOT collapsed
  // (each colour/variant combination is a separate product on the storefront).
  return { data: serialize(rows.map((r) => toStoreProduct(r))) };
}

export async function getProduct(id: string) {
  const p = await prisma.product.findFirst({
    where: { id, ...notDeleted, ...STOREFRONT_SHOWABLE },
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
    where: { status: ProductStatus.ACTIVE, ...notDeleted, ...STOREFRONT_SHOWABLE, ...HAS_LIVE_OFFER },
    include: shopProductInclude,
    orderBy: { createdAt: 'desc' },
  });
  // Every SKU is shown as its own card — see listProducts.
  return { data: serialize(rows.map((r) => toStoreProduct(r, { public: true }))) };
}

export async function getPublicProduct(id: string) {
  const p = await prisma.product.findFirst({
    where: { id, status: ProductStatus.ACTIVE, ...notDeleted, ...STOREFRONT_SHOWABLE },
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
    // Gift-card line: the chosen amount lives in `shade` and is the line price.
    const voucher = isVoucherProduct(it.product);
    const denomination = voucher ? Number(it.shade) || 0 : null;
    return {
      itemId: it.id,
      productId: it.productId,
      shade: it.shade ?? '',
      denomination, // null for normal products; ₹ face value for vouchers
      voucher: p.voucher, // structured denomination options (null for normal products)
      qty: it.quantity,
      name: p.name,
      brand: p.brand,
      vendor: p.vendor,
      group: p.group, // category slug — for category-scoped discount preview
      price: voucher && denomination ? denomination : p.price,
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

  // Gift-card (Hubble voucher) line: the buyer must choose an amount, carried in
  // `shade` (the compound-unique cart key keeps different amounts as separate
  // lines). Validate against the brand's allowed denominations / min–max.
  if (isVoucherProduct(product)) {
    if (!shade) throw AppError.badRequest('Please choose a gift-card amount');
    assertValidVoucherAmount(voucherSpecOf(product), Number(shade), product.name);
  }

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

// Credit/Debit are merged into one "Card" option (CREDIT_CARD is the canonical row).
const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.UPI]: 'UPI',
  [PaymentMethod.NET_BANKING]: 'Net Banking',
  [PaymentMethod.CREDIT_CARD]: 'Card',
  [PaymentMethod.DEBIT_CARD]: 'Debit Card',
};

// Per-method surcharge (+ GST-on-surcharge) as configured by the Super Admin.
// Returns 0/0 when the method is unset or its config row is inactive.
async function surchargeFor(method?: PaymentMethod): Promise<{ pct: number; gstPct: number }> {
  if (!method) return { pct: 0, gstPct: 0 };
  const cfg = await prisma.paymentMethodConfig.findUnique({ where: { method } });
  if (!cfg || !cfg.active) return { pct: 0, gstPct: 0 };
  return { pct: toNumber(cfg.surchargePercent), gstPct: toNumber(cfg.gstOnSurchargePercent) };
}

// ─── Wallet (spendable cashback) ─────────────────────────────────────────────

// Cached wallet balance for an employee (0 if no wallet yet).
async function getWalletBalance(employeeId: string): Promise<number> {
  const w = await prisma.wallet.findUnique({ where: { employeeId }, select: { balance: true } });
  return w ? toNumber(w.balance) : 0;
}

type WalletTx = Prisma.TransactionClient;
interface WalletRef { referenceType?: string; referenceId?: string; note?: string }

// Move money into the wallet (append EARN entry + bump cached balance). Runs in
// the caller's transaction so it commits atomically with the order/delivery.
export async function creditWallet(tx: WalletTx, employeeId: string, amount: number, ref: WalletRef = {}) {
  if (amount <= 0) return;
  const wallet = await tx.wallet.upsert({
    where: { employeeId },
    create: { employeeId, balance: new Prisma.Decimal(0) },
    update: {},
  });
  const balanceAfter = toNumber(wallet.balance) + amount;
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: new Prisma.Decimal(balanceAfter) } });
  await tx.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      type: 'EARN',
      amount: new Prisma.Decimal(amount),
      balanceAfter: new Prisma.Decimal(balanceAfter),
      referenceType: ref.referenceType ?? null,
      referenceId: ref.referenceId ?? null,
      note: ref.note ?? null,
    },
  });
}

// Spend from the wallet (append SPEND entry + drop cached balance). Guards against
// overspend using the live balance inside the transaction.
async function debitWallet(tx: WalletTx, employeeId: string, amount: number, ref: WalletRef = {}) {
  if (amount <= 0) return;
  const wallet = await tx.wallet.findUnique({ where: { employeeId } });
  const current = wallet ? toNumber(wallet.balance) : 0;
  if (!wallet || current < amount) {
    throw AppError.badRequest('Insufficient wallet balance — please retry checkout');
  }
  const balanceAfter = current - amount;
  await tx.wallet.update({ where: { id: wallet.id }, data: { balance: new Prisma.Decimal(balanceAfter) } });
  await tx.walletLedgerEntry.create({
    data: {
      walletId: wallet.id,
      type: 'SPEND',
      amount: new Prisma.Decimal(amount),
      balanceAfter: new Prisma.Decimal(balanceAfter),
      referenceType: ref.referenceType ?? null,
      referenceId: ref.referenceId ?? null,
      note: ref.note ?? null,
    },
  });
}

// Price the current cart authoritatively: resolve buy-box offers, validate the
// coupon, apply exhibition + coupon discounts, split by fulfilling reseller,
// redeem wallet balance (when requested), then add the chosen payment method's
// surcharge + GST-on-surcharge. Backs both createPaymentOrder (amount to charge)
// and placeOrder (the amounts written to the split orders) so they can never drift.
async function priceCart(userId: string, couponCode?: string, method?: PaymentMethod, useWallet?: boolean) {
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
    // Gift-card lines are priced by the buyer's chosen denomination (carried in the
    // cart line's `shade`), not the offer's "from" price. Re-validate here — the last
    // gate before payment — against the brand's Hubble rules, so a stale/invalid amount
    // is rejected BEFORE we charge (never pay-then-Hubble-refuses).
    const voucher = isVoucherProduct(it.product);
    const denomination = voucher ? Number(it.shade) : null;
    if (voucher) {
      assertValidVoucherAmount(voucherSpecOf(it.product), Number(it.shade), p.name);
    }
    return {
      it,
      p,
      resellerId: offer.resellerId ?? null,
      unitPrice: voucher ? (denomination as number) : toNumber(offer.eppPrice),
      isVoucher: voucher,
      denomination,
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

  // Payment surcharge (+ GST on it) for the chosen method, applied per group below.
  const { pct: surchargePct, gstPct } = await surchargeFor(method);

  // Group lines by fulfilling reseller (null = first-party/house) → one order each.
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = l.resellerId ?? '__house__';
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }

  // Per-group amounts — pass 1: coupon/exhibition discounts + the pre-wallet
  // payable and the cashback the group earns. Coupon share: a reseller-scoped
  // coupon applies only to its own group; a platform coupon splits proportionally
  // (last group takes the rounding remainder).
  let couponRemainder = totalDiscount;
  const groupList = [...groups.entries()];
  const bases = groupList.map(([key, gLines], gi) => {
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
    const gPayableBeforeWallet = Math.max(0, gSubtotal - gExhibition - gCouponDiscount);
    // Cashback earned = sum over lines of (per-unit cashback × qty), on the paid price.
    const gCashback = gLines.reduce(
      (s, l) => s + cashbackPerUnit(l.it.product.cashbackType, l.it.product.cashbackValue, l.unitPrice) * l.it.quantity,
      0,
    );

    return { resellerId, gLines, gSubtotal, gCouponDiscount, gExhibition, gPayableBeforeWallet, gCashback };
  });

  // Wallet redemption: apply as much of the live balance as possible, capped at
  // the total pre-wallet payable, split across groups (last group takes remainder).
  const totalPayableBeforeWallet = bases.reduce((s, g) => s + g.gPayableBeforeWallet, 0);
  const walletBalance = useWallet ? await getWalletBalance(employeeId) : 0;
  const walletApplied = Math.min(walletBalance, totalPayableBeforeWallet);
  let walletRemainder = walletApplied;

  // Pass 2: allocate wallet, then surcharge + GST on the reduced payable.
  const priced = bases.map((g, gi) => {
    let gWalletApplied = 0;
    if (walletApplied > 0) {
      gWalletApplied =
        gi === bases.length - 1
          ? walletRemainder
          : totalPayableBeforeWallet > 0
            ? Math.round((walletApplied * g.gPayableBeforeWallet) / totalPayableBeforeWallet)
            : 0;
      gWalletApplied = Math.min(gWalletApplied, g.gPayableBeforeWallet);
      walletRemainder -= gWalletApplied;
    }
    const gPayable = Math.max(0, g.gPayableBeforeWallet - gWalletApplied);
    // Payment surcharge + GST-on-surcharge for the chosen method (0 when unset),
    // charged only on the Razorpay-paid remainder (not the wallet-paid part).
    const gSurcharge = Math.round((gPayable * surchargePct) / 100);
    const gGst = Math.round((gSurcharge * gstPct) / 100);
    const gTotal = gPayable + gSurcharge + gGst;

    return {
      resellerId: g.resellerId,
      gLines: g.gLines,
      gSubtotal: g.gSubtotal,
      gCouponDiscount: g.gCouponDiscount,
      gExhibition: g.gExhibition,
      gWalletApplied,
      gCashback: g.gCashback,
      gPayable,
      gSurcharge,
      gGst,
      gTotal,
    };
  });

  const grandTotal = priced.reduce((s, g) => s + g.gTotal, 0);

  return { employeeId, companyId, cart, subtotal, coupon, dbCoupon, qr, priced, grandTotal, walletApplied };
}

// Razorpay reports the instrument the shopper actually used; map it onto our
// PaymentMethod enum. Credit/debit are merged into one "Card" (CREDIT_CARD) — the
// modal can't separate them, so a single card rate avoids false mismatches.
function mapRazorpayMethod(payment: { method?: string }): PaymentMethod {
  switch (payment.method) {
    case 'netbanking':
      return PaymentMethod.NET_BANKING;
    case 'card':
      return PaymentMethod.CREDIT_CARD;
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

// Refund a captured payment we've decided not to honour (amount/method mismatch),
// so the shopper is never charged for an order that isn't created. Best-effort:
// a refund failure is logged, not surfaced — the caller still rejects the order.
async function refundQuietly(paymentId: string) {
  try {
    await getRazorpay().payments.refund(paymentId, {});
  } catch (e) {
    console.error(`[shop] refund failed for ${paymentId}:`, e);
  }
}

// View-only demo accounts can browse/cart but never purchase — enforced
// server-side (not just hidden in the UI) regardless of the global flag.
async function assertNotViewOnly(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { viewOnly: true, email: true } });
  if (u?.viewOnly || isDemoLoginEmail(u?.email))
    throw AppError.forbidden('This is a view-only demo account — checkout is disabled');
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
  const { grandTotal, priced, walletApplied } = await priceCart(userId, input.couponCode, input.method, input.useWallet);
  if (grandTotal <= 0) throw AppError.badRequest('Nothing to pay — place the order directly');

  const surcharge = priced.reduce((s, g) => s + g.gSurcharge, 0);
  const gst = priced.reduce((s, g) => s + g.gGst, 0);

  const orderParams: Record<string, unknown> = {
    amount: Math.round(grandTotal * 100), // paise
    currency: 'INR',
    receipt: `imc_${nanoid(10)}`,
  };
  // The account's Checkout Configuration decides which methods the modal renders
  // (the account needs this to show any methods). Surcharge integrity is enforced
  // server-side in placeOrder (verify captured method + auto-refund a mismatch).
  if (env.RAZORPAY_CHECKOUT_CONFIG_ID) {
    orderParams.checkout_config_id = env.RAZORPAY_CHECKOUT_CONFIG_ID;
  }
  const rzOrder = await razorpay.orders.create(orderParams as unknown as Parameters<typeof razorpay.orders.create>[0]);

  return {
    keyId: env.RAZORPAY_KEY_ID,
    rzpOrderId: rzOrder.id,
    amount: Number(rzOrder.amount),
    currency: rzOrder.currency,
    surcharge,
    gst,
    walletApplied,
    total: grandTotal,
  };
}

export async function placeOrder(userId: string, input: PlaceOrderInput) {
  if (!env.CHECKOUT_ENABLED) {
    throw AppError.forbidden('Checkout is temporarily unavailable — online payments are launching soon');
  }
  await assertNotViewOnly(userId);
  const { employeeId, companyId, cart, coupon, dbCoupon, qr, priced, grandTotal, walletApplied } =
    await priceCart(userId, input.couponCode, input.method, input.useWallet);

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
    // A captured payment that we can't turn into an order must be refunded so the
    // shopper is never charged for nothing.
    if (Number(payment.amount) !== Math.round(grandTotal * 100)) {
      await refundQuietly(razorpayPaymentId);
      throw AppError.badRequest('Paid amount does not match the cart total — you have been refunded, please retry checkout');
    }
    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      throw AppError.badRequest('Payment was not completed — please retry checkout');
    }
    // The instrument actually used must match the method the cart was priced for
    // (surcharge differs by method); otherwise the paid amount would be for a
    // different fee than we recorded. Refund the mismatch and place no order.
    payMethod = mapRazorpayMethod(payment as { method?: string });
    if (input.method && payMethod !== input.method) {
      await refundQuietly(razorpayPaymentId);
      throw AppError.badRequest('You paid with a different method than selected — you have been refunded, please retry checkout');
    }

    gatewayOrderId = razorpayOrderId;
    gatewayTxnId = razorpayPaymentId;
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
    const voucherItemIds: string[] = []; // gift-card lines to kick off after commit

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
          surcharge: D(g.gSurcharge),
          gst: D(g.gGst),
          walletUsed: D(g.gWalletApplied),
          cashbackEarned: D(g.gCashback),
          total: D(g.gTotal),
          status: OrderStatus.PLACED,
          statusHistory: {
            create: { status: OrderStatus.PLACED, changedById: userId, note: 'Order placed' },
          },
        },
      });
      orderIds.push(order.id);

      // Order lines (created individually so we can attach a VoucherFulfilment to
      // each gift-card line). A voucher's issuance state lives in its own table
      // (different lifecycle than a physical line); it starts PENDING and the
      // Hubble order is placed after payment is committed (post-commit kickoff).
      for (const l of g.gLines) {
        const oi = await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: l.it.productId,
            quantity: l.it.quantity,
            unitPrice: D(l.unitPrice),
            lineTotal: D(l.unitPrice * l.it.quantity),
          },
        });
        if (l.isVoucher) {
          await tx.voucherFulfilment.create({
            data: {
              orderItemId: oi.id,
              denomination: D(l.denomination as number),
              status: VoucherFulfilmentStatus.PENDING,
            },
          });
          voucherItemIds.push(oi.id);
        }
      }

      // Record the captured gateway payment against each split order (they all
      // share the one Razorpay order; amounts are this order's slice).
      if (gatewayTxnId && gatewayOrderId) {
        await tx.payment.create({
          data: {
            orderId: order.id,
            method: payMethod,
            gateway: GatewayProvider.RAZORPAY,
            baseAmount: D(g.gPayable),
            surcharge: D(g.gSurcharge),
            gstOnSurcharge: D(g.gGst),
            total: D(g.gTotal),
            status: PaymentStatus.CAPTURED,
            gatewayOrderId,
            gatewayTxnId,
          },
        });
      }
    }

    // Spend the redeemed wallet balance (one SPEND entry for the whole checkout).
    if (walletApplied > 0) {
      await debitWallet(tx, employeeId, walletApplied, {
        referenceType: 'ORDER',
        referenceId: checkoutGroup,
        note: 'Wallet used at checkout',
      });
    }

    // Drain the cart.
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    // A FIRST_ORDER exhibition discount is consumed by this checkout.
    if (qr?.mode === 'FIRST_ORDER') {
      await tx.user.update({ where: { id: userId }, data: { qrDiscountEligible: false } });
    }

    return { orderIds, voucherItemIds };
  });

  // Fire off voucher (Hubble) fulfilment for any gift-card lines, AFTER the paid
  // order is committed — a Hubble outage never rolls back the payment, and the
  // long async issuance never blocks the checkout response. Fire-and-forget; the
  // engine flips each fulfilment PENDING → PROCESSING/DELIVERED/FAILED and delivers.
  if (created.voucherItemIds.length) {
    void kickoffVoucherFulfilments(created.voucherItemIds);
  }

  // Return the first split order (full), plus checkout-group metadata so the
  // confirmation screen can note the split.
  const full = await prisma.order.findUnique({ where: { id: created.orderIds[0] }, include: orderFullInclude });
  return serialize({ ...full, checkoutGroup, orderCount: created.orderIds.length });
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
  const [rows, vouchers] = await Promise.all([
    prisma.orderStatusHistory.findMany({
      where: { order: { employeeId } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { order: { select: { orderNo: true, total: true } } },
    }),
    // Delivered gift-card codes surface their own "voucher ready" alert.
    prisma.voucherFulfilment.findMany({
      where: { status: VoucherFulfilmentStatus.DELIVERED, deliveredAt: { not: null }, orderItem: { order: { employeeId } } },
      orderBy: { deliveredAt: 'desc' },
      take: 20,
      select: {
        id: true,
        deliveredAt: true,
        orderItem: { select: { product: { select: { brand: true, name: true } }, order: { select: { orderNo: true } } } },
      },
    }),
  ]);
  const statusAlerts = rows.map((h) => {
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
  const voucherAlerts = vouchers.map((v) => ({
    id: `voucher-${v.id}`,
    type: 'order',
    title: 'Gift card ready',
    body: `Your ${v.orderItem.product.brand || v.orderItem.product.name} gift card is ready — tap order #${v.orderItem.order.orderNo} to view the code.`,
    at: v.deliveredAt as Date,
  }));
  const data = [...statusAlerts, ...voucherAlerts].sort((a, b) => +new Date(b.at) - +new Date(a.at));
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
    // Employee-scoped, so it's safe to return issued voucher credentials here (and
    // only here) via shopOrderFullInclude.
    where: { employeeId, OR: [{ id }, { orderNo: id }] },
    include: shopOrderFullInclude,
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

  // Active payment methods + their surcharge, for the Checkout method picker.
  // Debit is excluded — credit/debit are one "Card" option (CREDIT_CARD row).
  const methodRows = await prisma.paymentMethodConfig.findMany({
    where: { active: true, method: { not: PaymentMethod.DEBIT_CARD } },
    orderBy: { surchargePercent: 'asc' },
  });
  const paymentMethods = (methodRows.length ? methodRows : []).map((m) => ({
    method: m.method,
    label: PAYMENT_METHOD_LABELS[m.method],
    surchargePercent: toNumber(m.surchargePercent),
    gstOnSurchargePercent: toNumber(m.gstOnSurchargePercent),
  }));
  if (!paymentMethods.length) {
    paymentMethods.push({ method: PaymentMethod.UPI, label: 'UPI', surchargePercent: 0, gstOnSurchargePercent: 0 });
  }

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
    walletBalance: await getWalletBalance(employee.id),
    addresses: employee.addresses.map(toAddress),
    paymentMethods,
    qrDiscount: qr
      ? { percent: qr.percent, campaignName: qr.campaignName, categorySlug: qr.categorySlug, categoryName: qr.categoryName }
      : null,
  });
}

// ─── Wallet (balance + transaction history) ──────────────────────────────────

export async function getWallet(userId: string) {
  const { id: employeeId } = await resolveEmployee(userId);
  const wallet = await prisma.wallet.findUnique({
    where: { employeeId },
    include: { entries: { orderBy: { createdAt: 'desc' }, take: 100 } },
  });
  return serialize({
    balance: wallet ? toNumber(wallet.balance) : 0,
    entries: (wallet?.entries ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      amount: toNumber(e.amount),
      balanceAfter: toNumber(e.balanceAfter),
      note: e.note,
      referenceType: e.referenceType,
      referenceId: e.referenceId,
      createdAt: e.createdAt,
    })),
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
