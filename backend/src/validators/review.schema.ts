import { z } from 'zod';
import { ReviewStatus } from '@prisma/client';

// Shopper-submitted review (POST /shop/products/:id/reviews).
export const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(1).max(2000),
});

// Super-Admin moderation list (GET /reviews).
export const reviewListQuery = z.object({
  status: z.nativeEnum(ReviewStatus).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// Super-Admin approve/reject (PATCH /reviews/:id/status).
export const reviewStatusBody = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});

export type ReviewInput = z.infer<typeof reviewBody>;
export type ReviewListQuery = z.infer<typeof reviewListQuery>;
export type ReviewStatusInput = z.infer<typeof reviewStatusBody>;
