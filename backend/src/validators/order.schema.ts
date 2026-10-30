import { z } from 'zod';
import { OrderStatus } from '@prisma/client';

// Frontend filters orders by a coarse bucket, not the raw status enum.
export const orderListQuery = z.object({
  bucket: z.enum(['all', 'active', 'delivered', 'cancelled']).optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const overrideStatusBody = z.object({
  status: z.nativeEnum(OrderStatus),
  note: z.string().max(500).optional(),
});

export const cancelOrderBody = z.object({
  note: z.string().max(500).optional(),
});

// Any per-line order action: /orders/:id/items/:itemId/<verb>
export const orderItemParams = z.object({
  id: z.string().min(1),
  itemId: z.string().min(1),
});

// Change a placed line's colour, because the ordered colour cannot be shipped.
// Exactly one of `shade` (a swatch on the same product) or `productId` (a
// variant-family sibling SKU) — the two ways this catalogue expresses colour.
// `reason` is mandatory: the buyer is confirmed off-platform, so this note is the
// only record of how that confirmation happened.
export const colourSwapBody = z
  .object({
    shade: z.string().trim().min(1).max(60).optional(),
    productId: z.string().min(1).optional(),
    reason: z.string().trim().min(4).max(500),
  })
  .refine((b) => Boolean(b.shade) !== Boolean(b.productId), {
    message: 'Choose exactly one of shade or productId',
  });

export type OrderListQuery = z.infer<typeof orderListQuery>;
export type OverrideStatusInput = z.infer<typeof overrideStatusBody>;
export type ColourSwapInput = z.infer<typeof colourSwapBody>;

// ePOD upload. The file itself arrives as multipart; `capturedAt` is when the
// courier captured the proof (not when we uploaded it), so it is operator-set
// and defaults server-side to the delivery time.
export const epodBody = z.object({
  capturedAt: z.coerce.date().optional(),
  // Why the proof is disputed or incomplete. Surfaced in the Orders report as
  // "POD note"; previously accepted here but never sent by any UI.
  note: z.string().trim().max(500).optional(),
});
export type EpodInput = z.infer<typeof epodBody>;

// Admin-entered invoice number. null clears it.
export const invoiceNumberBody = z.object({
  invoiceNumber: z
    .string()
    .trim()
    .min(1, 'Invoice number is required (send null to clear it)')
    .max(60, 'Invoice number is too long (max 60 characters)')
    .regex(/^[A-Za-z0-9/_.\-]+$/, 'Use letters, digits and / - _ . only')
    .nullable(),
});
export type InvoiceNumberInput = z.infer<typeof invoiceNumberBody>;
