import { z } from 'zod';

// Lease parameters the leasing company tunes in its portal. They feed the
// Smart-EPP calculator for every company attached to this leasing company.
export const leasingParamsBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  contactPhone: z.string().trim().max(20).nullish(),
  ptpm: z.number().min(0).max(1000).optional(), // rental per ₹1000 of asset per month (incl. GST)
  defaultTenureMonths: z.number().int().min(1).max(60).optional(),
  repurchasePct: z.number().min(0).max(100).optional(),
  pvDiscountLeasePct: z.number().min(0).max(100).optional(),
  pvDiscountRepurchasePct: z.number().min(0).max(100).optional(),
  advanceFeeType: z.enum(['FIXED', 'PERCENT']).optional(),
  advanceFeeValue: z.number().min(0).optional(),
});

// Live preview for the Settings form: unsaved params → quote for a sample asset.
export const leasingPreviewBody = leasingParamsBody.extend({
  assetCost: z.number().positive().max(10_000_000).optional(),
  gstPct: z.number().min(0).max(100).optional(),
  incomeTaxPct: z.number().min(0).max(100).optional(),
  adldPct: z.number().min(0).max(100).optional(),
});

export const leasingRequestListQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'all']).optional(),
});

// Stage-2 decision. Approval may override the tenure / EMI from the stored
// quote (the leasing company has the final word on terms).
export const leasingDecisionBody = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comments: z.string().trim().max(500).optional(),
  tenureMonths: z.number().int().min(1).max(60).optional(),
  emiAmount: z.number().positive().optional(),
});

export type LeasingParamsInput = z.infer<typeof leasingParamsBody>;
export type LeasingPreviewInput = z.infer<typeof leasingPreviewBody>;
export type LeasingRequestListQuery = z.infer<typeof leasingRequestListQuery>;
export type LeasingDecisionInput = z.infer<typeof leasingDecisionBody>;
