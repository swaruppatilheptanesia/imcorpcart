import { z } from 'zod';

const partnerStatus = z.enum(['ACTIVE', 'ONBOARDING', 'SUSPENDED']);
const priceBasis = z.enum(['MRP', 'MOP', 'EPP']);

// ── Admin: partner registry ──────────────────────────────────────────────────
export const createPartnerBody = z.object({
  name: z.string().trim().min(1).max(120),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().trim().max(20).optional(),
  status: partnerStatus.optional(),
  active: z.boolean().optional(),
  webhookUrl: z.string().url().max(500).optional(),
  ipAllowlist: z.array(z.string().trim().min(1)).optional(),
  priceField: priceBasis.optional(), // default price basis for new catalogue entries
  commissionPct: z.number().min(0).max(100).optional(),
  features: z.record(z.string(), z.unknown()).nullish(),
});

export const updatePartnerBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().trim().max(20).nullish(),
  status: partnerStatus.optional(),
  active: z.boolean().optional(),
  webhookUrl: z.string().url().max(500).nullish(),
  ipAllowlist: z.array(z.string().trim().min(1)).optional(),
  priceField: priceBasis.optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  features: z.record(z.string(), z.unknown()).nullish(),
});

// ── Admin: partner catalogue ─────────────────────────────────────────────────
export const catalogueCandidatesQuery = z.object({
  q: z.string().trim().optional(),
  categoryId: z.string().trim().optional(),
  subCategory: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(1000).optional(),
});

export const addCatalogueBody = z
  .object({
    productIds: z.array(z.string().min(1)).max(1000).optional(),
    categoryId: z.string().trim().optional(),
    subCategory: z.string().trim().optional(),
    priceBasis: priceBasis.optional(),
    commissionPct: z.number().min(0).max(100).optional(),
  })
  .refine((v) => (v.productIds && v.productIds.length > 0) || Boolean(v.categoryId), {
    message: 'Provide productIds or a categoryId',
  });

export const updateCatalogueEntryBody = z.object({
  priceBasis: priceBasis.optional(),
  commissionPct: z.number().min(0).max(100).optional(),
  // Manual per-product base price (₹). `null` clears it; omitted leaves it alone.
  offerPrice: z.number().positive().max(9_999_999).nullable().optional(),
});

// `bucket` deliberately reuses the admin order-list vocabulary (orderListQuery)
// rather than inventing a second one for the same chips.
// Admin: a partner's activity log (Overview tab). `event` narrows to one audit
// action; `period` is resolved to an IST day boundary server-side.
export const partnerActivityQuery = z.object({
  q: z.string().trim().optional(),
  event: z.enum(['all', 'order', 'auth_fail']).optional(),
  period: z.enum(['all', 'today', '7d', '30d']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const partnerOrdersQuery = z.object({
  q: z.string().trim().optional(),
  bucket: z.enum(['all', 'active', 'delivered', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// ── Partner API ──────────────────────────────────────────────────────────────

// Polling: `updatedSince` is the previous response's `meta.syncedAt`. `status`
// is the partner status vocabulary (see services/partner-order-view.ts), not our
// internal OrderStatus enum — partners never see that.
export const partnerOrderListQuery = z.object({
  updatedSince: z.coerce.date().optional(),
  status: z
    .enum(['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'RETURNED', 'FAILED'])
    .optional(),
  dealerCode: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// `file` streams the document; `json` (the default) returns it base64-encoded in
// the same envelope the order.epod webhook pushes. `orderNo` disambiguates when
// one externalRef split into several orders.
export const epodQuery = z.object({
  format: z.enum(['json', 'file']).optional(),
  orderNo: z.string().trim().max(60).optional(),
});
export const partnerCatalogueQuery = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

export const deliveryQuery = z.object({
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  sku: z.string().trim().min(1).optional(),
});

export const cancelOrderBody = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const acceptOrderBody = z.object({
  externalRef: z.string().trim().min(1).max(120),
  dealerCode: z.string().trim().max(120).optional(),
  dealerName: z.string().trim().max(200).optional(),
  dealerMobile: z.string().trim().max(20).optional(),
  deliveryInstructions: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        qty: z.coerce.number().int().positive(),
        price: z.coerce.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(100),
  shipping: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(4).max(20),
    line1: z.string().trim().min(1).max(200),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100),
    state: z.string().trim().min(1).max(100),
    pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
  }),
  note: z.string().max(500).optional(),
});

export type CreatePartnerInput = z.infer<typeof createPartnerBody>;
export type UpdatePartnerInput = z.infer<typeof updatePartnerBody>;
export type PartnerCatalogueQuery = z.infer<typeof partnerCatalogueQuery>;
export type DeliveryQuery = z.infer<typeof deliveryQuery>;
export type AcceptOrderInput = z.infer<typeof acceptOrderBody>;
export type CancelOrderInput = z.infer<typeof cancelOrderBody>;
export type CatalogueCandidatesQuery = z.infer<typeof catalogueCandidatesQuery>;
export type AddCatalogueInput = z.infer<typeof addCatalogueBody>;
export type UpdateCatalogueEntryInput = z.infer<typeof updateCatalogueEntryBody>;
export type PartnerOrdersQuery = z.infer<typeof partnerOrdersQuery>;
export type PartnerActivityQuery = z.infer<typeof partnerActivityQuery>;
export type PartnerOrderListQuery = z.infer<typeof partnerOrderListQuery>;
export type EpodQuery = z.infer<typeof epodQuery>;
