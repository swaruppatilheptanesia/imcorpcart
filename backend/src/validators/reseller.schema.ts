import { z } from 'zod';
import { ShipmentStatus, CourierCode } from '@prisma/client';

export const resellerListQuery = z.object({
  q: z.string().trim().optional(),
  bucket: z.enum(['all', 'active', 'delivered', 'cancelled']).optional(),
  category: z.string().trim().optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'INACTIVE']).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// ─── Reseller offer editing (price + stock only; the Super Admin owns the
// product master) ────────────────────────────────────────────────────────────

export const resellerOfferUpdateBody = z.object({
  eppPrice: z.number().nonnegative().optional(),
  smartEppPrice: z.number().nonnegative().optional(),
  quantity: z.number().int().nonnegative().optional(),
  freeGiftId: z.string().trim().min(1).nullable().optional(), // one of the reseller's gifts
  isActive: z.boolean().optional(),
});

// ─── Reseller free gifts (managed complimentary items) ───────────────────────

export const resellerFreeGiftBody = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
});
export const resellerFreeGiftUpdateBody = resellerFreeGiftBody.partial();

// Reseller-driven transit update: advances the order's shipment and appends a
// tracking event. The order status is synced from the shipment status.
export const transitUpdateBody = z.object({
  status: z.nativeEnum(ShipmentStatus),
  awbNumber: z.string().trim().optional(),
  courierCode: z.nativeEnum(CourierCode).optional(),
  description: z.string().trim().optional(),
});

export type ResellerListQuery = z.infer<typeof resellerListQuery>;
export type TransitUpdateInput = z.infer<typeof transitUpdateBody>;
export type ResellerOfferUpdateInput = z.infer<typeof resellerOfferUpdateBody>;
export type ResellerFreeGiftInput = z.infer<typeof resellerFreeGiftBody>;
export type ResellerFreeGiftUpdateInput = z.infer<typeof resellerFreeGiftUpdateBody>;
