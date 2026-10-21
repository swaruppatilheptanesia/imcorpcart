import { z } from 'zod';

// Inbound vendor-source (supplier) admin validators. Sources are auto-provisioned
// per dev-registered adapter (no admin create) — only update/sync/read remain.

export const updateSourceBody = z
  .object({
    name: z.string().trim().min(1).optional(),
    baseUrl: z.string().trim().url().nullable().optional(),
    apiKey: z.string().trim().min(1).nullable().optional(), // null clears the stored key
    discountPct: z.coerce.number().min(0).max(100).optional(),
    active: z.boolean().optional(), // doubles as vendor suspend/resume
    config: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();

export const runsQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});

export const runParams = z.object({
  id: z.string().trim().min(1),
  runId: z.string().trim().min(1),
});

// Per-product discount, set from the admin table (one row) or a CSV (many).
// `null` clears the override so the product inherits its source's rate again —
// distinct from `0`, which pins it to no discount. The cell is accepted as "8"
// or "8%", the way the client writes percentages everywhere else in the console.
export const productDiscountsBody = z.object({
  rows: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        discountPct: z
          .preprocess(
            (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.replace(/[%\s,]/g, '')) : v),
            z.coerce.number({ error: 'Discount must be a percentage between 0 and 100' }).min(0).max(100).nullable(),
          )
          .nullable(),
      }),
    )
    .min(1)
    .max(5000),
});

export type UpdateSourceInput = z.infer<typeof updateSourceBody>;
export type RunsQuery = z.infer<typeof runsQuery>;
export type ProductDiscountsInput = z.infer<typeof productDiscountsBody>;
