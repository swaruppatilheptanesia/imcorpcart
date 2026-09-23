import { z } from 'zod';

// ── Storefront (employee) ────────────────────────────────────────────────────

// Submit a Smart-EPP request for the current cart. Delivery is to one of the
// company's office branches; the Razorpay handoff is required whenever the
// leasing company levies an advance (> ₹0).
export const submitSeppRequestBody = z.object({
  addressId: z.string().min(1),
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional(),
});

export const requestNoParam = z.object({ no: z.string().min(1) });

// ── Company (HR) ─────────────────────────────────────────────────────────────

export const seppRequestListQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'all']).optional(),
});

export const seppDecisionBody = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comments: z.string().trim().max(500).optional(),
});

// HR records a payroll-deducted installment as paid (restores the limit).
export const installmentParams = z.object({
  id: z.string().min(1),
  no: z.coerce.number().int().min(1).max(120),
});

// Company office branches (delivery points for Smart-EPP orders).
export const companyAddressBody = z.object({
  label: z.string().trim().min(1).max(60), // branch name, e.g. "Mumbai HQ"
  contactName: z.string().trim().min(1).max(120),
  contactPhone: z.string().trim().min(1).max(20),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(80),
  state: z.string().trim().min(1).max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit pincode'),
  isDefault: z.boolean().optional(),
});
export const updateCompanyAddressBody = companyAddressBody.partial();

export type SubmitSeppRequestInput = z.infer<typeof submitSeppRequestBody>;
export type SeppRequestListQuery = z.infer<typeof seppRequestListQuery>;
export type SeppDecisionInput = z.infer<typeof seppDecisionBody>;
export type CompanyAddressInput = z.infer<typeof companyAddressBody>;
export type UpdateCompanyAddressInput = z.infer<typeof updateCompanyAddressBody>;
