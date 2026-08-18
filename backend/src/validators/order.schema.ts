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

export type OrderListQuery = z.infer<typeof orderListQuery>;
export type OverrideStatusInput = z.infer<typeof overrideStatusBody>;
