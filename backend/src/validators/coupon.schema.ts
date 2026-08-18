import { z } from 'zod';
import { CouponType, CouponStatus } from '@prisma/client';
import { money } from './common.schema';

export const couponListQuery = z.object({
  q: z.string().trim().optional(),
  status: z.nativeEnum(CouponStatus).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const createCouponBody = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .transform((s) => s.toUpperCase()),
  type: z.nativeEnum(CouponType),
  value: money,
  maxDiscount: money.optional(), // cap for PERCENT
  minOrderValue: money.default(0),
  usageLimit: z.number().int().positive(),
  status: z.nativeEnum(CouponStatus).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  resellerId: z.string().min(1).optional(), // null = platform-wide
  categoryId: z.string().min(1).optional(), // null = all products
});

export const updateCouponBody = createCouponBody.partial();

export type CreateCouponInput = z.infer<typeof createCouponBody>;
export type UpdateCouponInput = z.infer<typeof updateCouponBody>;
export type CouponListQuery = z.infer<typeof couponListQuery>;
