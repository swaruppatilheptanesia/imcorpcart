import { z } from 'zod';
import { ReportFormat } from '@prisma/client';

export const REPORT_TYPES = [
  'PROFITABILITY',
  'VOLUME_VALUE',
  'PARTNER_PERFORMANCE',
  'COMPANY_SPEND',
] as const;

export const exportReportParams = z.object({
  type: z.enum(REPORT_TYPES),
});

export const exportReportQuery = z.object({
  format: z.nativeEnum(ReportFormat).default('CSV'),
});

export const exportReportBody = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .optional();

export type ReportType = (typeof REPORT_TYPES)[number];
