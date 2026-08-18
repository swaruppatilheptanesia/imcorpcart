import { z } from 'zod';

// cuid path param, e.g. /products/:id
export const idParam = z.object({ id: z.string().min(1) });

export const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

// A money amount as a JSON number (services convert to Prisma.Decimal).
export const money = z.number().nonnegative();
