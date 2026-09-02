import { z } from 'zod';

const catalogScope = z.object({ categorySlugs: z.array(z.string().trim()).optional() });
const partnerStatus = z.enum(['ACTIVE', 'ONBOARDING', 'SUSPENDED']);

// ── Admin: partner registry ──────────────────────────────────────────────────
export const createPartnerBody = z.object({
  name: z.string().trim().min(1).max(120),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().trim().max(20).optional(),
  status: partnerStatus.optional(),
  active: z.boolean().optional(),
  webhookUrl: z.string().url().max(500).optional(),
  ipAllowlist: z.array(z.string().trim().min(1)).optional(),
  catalogScope: catalogScope.nullish(),
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
  catalogScope: catalogScope.nullish(),
  commissionPct: z.number().min(0).max(100).optional(),
  features: z.record(z.string(), z.unknown()).nullish(),
});

// ── Partner API ──────────────────────────────────────────────────────────────
export const partnerCatalogueQuery = z.object({
  q: z.string().trim().optional(),
  category: z.string().trim().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
});

export const acceptOrderBody = z.object({
  externalRef: z.string().trim().min(1).max(120),
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
export type AcceptOrderInput = z.infer<typeof acceptOrderBody>;
