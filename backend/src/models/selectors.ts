import { Prisma } from '@prisma/client';

// Soft-delete guard: models with a `deletedAt` column should exclude deleted
// rows from list/get by default.
export const notDeleted = { deletedAt: null } as const;

// ─── Product ─────────────────────────────────────────────────────────────────

// Per-reseller marketplace offer (price + stock). The storefront buy box picks
// the cheapest active, in-stock offer across these.
export const offerSelect = {
  id: true,
  resellerId: true,
  reseller: { select: { id: true, name: true } },
  eppPrice: true,
  resellerPrice: true,
  smartEppPrice: true,
  mop: true,
  quantity: true,
  freeGiftId: true,
  freeGift: { select: { id: true, title: true, description: true } },
  status: true,
  isActive: true,
} satisfies Prisma.ProductOfferSelect;

// Lightweight shape for product list rows.
export const productListSelect = {
  id: true,
  sku: true,
  name: true,
  brand: true,
  status: true,
  subCategory: true,
  mrp: true,
  mop: true,
  familyKey: true,
  optionColor: true,
  optionVariant: true,
  categoryId: true,
  category: { select: { id: true, name: true, slug: true } },
  offers: { where: notDeleted, select: offerSelect },
  // First image only — powers the list thumbnail (falls back to a gradient).
  images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
  // Inbound-vendor provenance + admin show/hide (for the Vendor tag/filter).
  hidden: true,
  sourceId: true,
  source: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

// Full product resource for detail/create/update responses.
export const productFullInclude = {
  category: { select: { id: true, name: true, slug: true } },
  freeGift: { select: { id: true, title: true, description: true } },
  images: { orderBy: { position: 'asc' } },
  offers: { where: notDeleted, orderBy: { eppPrice: 'asc' }, select: offerSelect },
  visibilities: true,
} satisfies Prisma.ProductInclude;

// ─── Order ───────────────────────────────────────────────────────────────────

export const orderListSelect = {
  id: true,
  orderNo: true,
  type: true,
  status: true,
  total: true,
  subtotal: true,
  createdAt: true,
  company: { select: { id: true, name: true } },
  employee: { select: { id: true, employeeCode: true, user: { select: { fullName: true } } } },
  reseller: { select: { id: true, name: true } },
  shipment: {
    select: { status: true, awbNumber: true, dispatchedAt: true, courier: { select: { code: true, name: true } } },
  },
  items: {
    select: {
      quantity: true,
      product: {
        select: { name: true, reseller: { select: { name: true } }, sourceId: true, source: { select: { name: true } } },
      },
    },
  },
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;

export const orderFullInclude = {
  company: { select: { id: true, name: true, gstin: true } },
  employee: {
    select: {
      id: true,
      employeeCode: true,
      department: true,
      user: { select: { fullName: true, email: true, phone: true } },
    },
  },
  reseller: { select: { id: true, name: true } },
  address: true,
  coupon: { select: { id: true, code: true, type: true } },
  // Explicit item select (NOT `include`): carries the voucher fulfilment STATUS
  // for the admin, but never the raw credential (voucherCode/voucherPin/…). The
  // buyer's own order detail uses `shopOrderFullInclude` below, which adds them.
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      voucherFulfilment: { select: { status: true, denomination: true, deliveredAt: true } },
      product: { select: { id: true, name: true, sku: true, sourceId: true, source: { select: { name: true } } } },
    },
  },
  statusHistory: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { id: true, fullName: true } } },
  },
  payments: {
    select: {
      id: true,
      method: true,
      gateway: true,
      baseAmount: true,
      surcharge: true,
      gstOnSurcharge: true,
      total: true,
      status: true,
      gatewayTxnId: true,
      createdAt: true,
    },
  },
  shipment: {
    include: {
      courier: { select: { code: true, name: true } },
      fulfillmentPartner: { select: { id: true, name: true } },
      trackingEvents: { orderBy: { occurredAt: 'asc' } },
    },
  },
  documents: {
    select: { id: true, docType: true, source: true, number: true, fileUrl: true, createdAt: true },
  },
} satisfies Prisma.OrderInclude;

// Buyer-facing order detail: everything in orderFullInclude PLUS the issued voucher
// credential on each item (card number/pin/type/redemption/expiry). Used ONLY by
// the shopper's own getOrder (employee-scoped), so codes never appear in admin or
// list payloads. `hubbleOrderRef` stays internal — serialize() strips *Ref keys.
export const shopOrderFullInclude = {
  ...orderFullInclude,
  items: {
    select: {
      id: true,
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      voucherFulfilment: {
        select: {
          status: true,
          denomination: true,
          deliveredAt: true,
          voucherCode: true,
          voucherPin: true,
          voucherCardType: true,
          redemptionUrl: true,
          voucherExpiry: true,
          fulfilmentError: true,
        },
      },
      product: { select: { id: true, name: true, sku: true, sourceId: true, source: { select: { name: true } } } },
    },
  },
} satisfies Prisma.OrderInclude;

// ─── Coupon ──────────────────────────────────────────────────────────────────

export const couponInclude = {
  reseller: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.CouponInclude;

// ─── Users (safe fields only — never expose passwordHash) ────────────────────

export const userSafeSelect = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  role: true,
  status: true,
  twoFactorEnabled: true,
  registrationSource: true,
  qrDiscountEligible: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
