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

export type UpdateSourceInput = z.infer<typeof updateSourceBody>;
export type RunsQuery = z.infer<typeof runsQuery>;
