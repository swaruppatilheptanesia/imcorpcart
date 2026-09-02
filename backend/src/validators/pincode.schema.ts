import { z } from 'zod';
import { CourierCode, DeliveryMode } from '@prisma/client';

// Parse loose CSV/JSON cells (Yes/No/1/0/true/false) into a boolean.
const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['y', 'yes', 'true', '1', 'active'].includes(s)) return true;
    if (['n', 'no', 'false', '0', 'inactive'].includes(s)) return false;
  }
  return v;
}, z.boolean());

const pincodeField = z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits');

// Create a pincode TAT row (one per pincode × courier × mode).
export const createPincodeBody = z.object({
  pincode: pincodeField,
  courier: z.nativeEnum(CourierCode).optional(),
  mode: z.nativeEnum(DeliveryMode),
  tatDays: z.coerce.number().int().min(0).max(60),
  serviceable: z.boolean().optional(),
  edl: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// Edit an existing row — pincode/courier/mode are the identity, so only the
// mutable attributes can change.
export const updatePincodeBody = z.object({
  tatDays: z.coerce.number().int().min(0).max(60).optional(),
  serviceable: z.boolean().optional(),
  edl: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const pincodeListQuery = z.object({
  q: z.string().trim().optional(),
  courier: z.nativeEnum(CourierCode).optional(),
  mode: z.nativeEnum(DeliveryMode).optional(),
  serviceable: boolish.optional(),
  isActive: boolish.optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(500).optional(),
});

// One import row (CSV). Exported so the importer can validate each row
// individually (per-field errors, one bad row never fails the whole file).
export const importPincodeRow = z.object({
  pincode: pincodeField,
  courier: z
    .preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.nativeEnum(CourierCode))
    .optional(),
  mode: z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.nativeEnum(DeliveryMode)),
  tat_days: z.coerce.number().int().min(0).max(60),
  serviceable: boolish.optional(),
  is_active: boolish.optional(),
  edl: boolish.optional(),
});

// The import endpoint accepts loose rows and validates each in the service.
export const importPincodesBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(80000),
});

// Global courier/mode kill-switch toggle.
export const updateSettingBody = z.object({
  key: z.string().trim().min(1),
  enabled: z.boolean(),
});

export type CreatePincodeInput = z.infer<typeof createPincodeBody>;
export type UpdatePincodeInput = z.infer<typeof updatePincodeBody>;
export type PincodeListQuery = z.infer<typeof pincodeListQuery>;
export type ImportPincodeRow = z.infer<typeof importPincodeRow>;
export type ImportPincodesInput = z.infer<typeof importPincodesBody>;
export type UpdateSettingInput = z.infer<typeof updateSettingBody>;
