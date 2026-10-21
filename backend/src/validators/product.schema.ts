import { z } from 'zod';
import { ProductStatus, CashbackType, CourierCode, DeliveryMode } from '@prisma/client';
import { money } from './common.schema';

// Frontend "group" filter maps to a top-level category slug (phones/accessories/bags).
export const productListQuery = z.object({
  q: z.string().trim().optional(),
  group: z.string().trim().optional(), // category slug or id
  status: z.nativeEnum(ProductStatus).optional(),
  source: z.string().trim().optional(), // filter to one VendorSource's imported products
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// Accept an absolute URL (http/https) or a root-relative path like
// "/uploads/<file>" returned by the upload endpoint.
const imageUrl = z
  .string()
  .min(1)
  .refine((s) => /^https?:\/\//.test(s) || s.startsWith('/'), {
    message: 'Must be an absolute URL or a root-relative path',
  });

const imageInput = z.object({
  url: imageUrl,
  alt: z.string().optional(),
  position: z.number().int().nonnegative().optional(),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

const shadeInput = z.object({
  name: z.string().trim().min(1).max(60),
  g1: hex,
  g2: hex,
  stock: z.number().int().nonnegative(),
});

const specRowInput = z.object({
  k: z.string().trim().min(1).max(60),
  v: z.string().trim().min(1).max(200),
});

// The Super Admin authors the product MASTER (descriptive fields + list MRP).
// Per-reseller selling prices + stock live on ProductOffer (see offer schemas).
export const createProductBody = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(80).optional(),
  description: z.string().max(4000).optional(),
  categoryId: z.string().min(1),
  subCategory: z.string().trim().max(60).optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  smartEpp: z.boolean().optional(), // product comes under Smart EPP (SEPP)
  mrp: money.optional(), // product-level list price
  mop: money.optional(), // public / pre-login price (admin-set; falls back to MRP)
  cashbackType: z.nativeEnum(CashbackType).optional(), // NONE | PERCENT | FIXED
  cashbackValue: money.optional(), // percent (PERCENT) or ₹/unit (FIXED)
  // Tax + policy attributes (master-level, admin-set).
  // HSN/SAC is 4, 6 or 8 digits under GST (the required length depends on
  // turnover). Same rule as the bulk sheet, so the form can't accept what an
  // import would reject.
  hsnCode: z
    .string()
    .trim()
    .regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN must be 4, 6 or 8 digits')
    .nullable()
    .optional(),
  gstPercent: z.number().min(0).max(100).nullable().optional(),
  termsText: z.string().max(4000).optional(),
  warrantyText: z.string().max(2000).optional(),
  countryOfOrigin: z.string().trim().max(60).nullable().optional(),
  // Authored point-wise copy shown on the product page.
  aboutItem: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  inTheBox: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
  // ADLD & theft plan, as a % of the EPP price. Display-only on the storefront.
  protectionPlanAvailable: z.boolean().optional(),
  protectionPlanPct: z.number().min(0).max(100).nullable().optional(),
  // Up to 4 SKUs for "Frequently bought together", resolved on read.
  frequentlyBoughtSkus: z.string().trim().max(400).nullable().optional(),
  // Preferred courier + transport mode, pre-selected at dispatch (never enforced).
  courierCode: z.nativeEnum(CourierCode).nullable().optional(),
  deliveryMode: z.nativeEnum(DeliveryMode).nullable().optional(),
  // Amazon-style variant family (separate sibling SKUs share a familyKey).
  familyKey: z.string().trim().max(80).nullable().optional(),
  optionColor: z.string().trim().max(60).nullable().optional(),
  optionVariant: z.string().trim().max(60).nullable().optional(),
  variantOptions: z.string().max(400).optional(),
  freebieText: z.string().max(200).optional(), // first-party fallback freebie
  hidden: z.boolean().optional(), // admin show/hide on the storefront
  shades: z.array(shadeInput).max(24).optional(),
  specRows: z.array(specRowInput).max(30).optional(),
  images: z.array(imageInput).max(8).optional(),
  g1: hex.optional(),
  g2: hex.optional(),
});

export const updateProductBody = createProductBody.partial();

// ─── Marketplace offers (Super-Admin attach / edit a reseller's listing) ──────

const offerPricing = z.object({
  eppPrice: money.optional(),
  resellerPrice: money.optional(), // reseller's own price (commission = eppPrice − resellerPrice)
  smartEppPrice: money.optional(),
  quantity: z.number().int().nonnegative().optional(),
  freeGiftId: z.string().min(1).nullable().optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  isActive: z.boolean().optional(),
});

// Attach a seller to a product. resellerId null/omitted = first-party/house offer.
export const attachOfferBody = offerPricing.extend({
  resellerId: z.string().min(1).nullable().optional(),
});

export const updateOfferBody = offerPricing;

export const bulkProductBody = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
    action: z.enum(['deactivate', 'priceUpdate']),
    adjustment: z.enum(['increasePct', 'decreasePct', 'setAmount']).optional(),
    value: z.number().optional(),
  })
  .refine((v) => v.action !== 'priceUpdate' || (v.adjustment && v.value !== undefined), {
    message: 'priceUpdate requires `adjustment` and `value`',
    path: ['adjustment'],
  });

export type CreateProductInput = z.infer<typeof createProductBody>;
export type UpdateProductInput = z.infer<typeof updateProductBody>;
export type AttachOfferInput = z.infer<typeof attachOfferBody>;
export type UpdateOfferInput = z.infer<typeof updateOfferBody>;
export type BulkProductInput = z.infer<typeof bulkProductBody>;
export type ProductListQuery = z.infer<typeof productListQuery>;
