import { ReportFormat } from '@prisma/client';
import { prisma } from '../config/prisma';
import { serialize } from '../models/serializers';
import type { ReportType } from '../validators/report.schema';

// Static catalogue of available reports (matches the Reports screen cards).
const REPORT_DEFS = [
  { type: 'PROFITABILITY', title: 'Profitability', description: 'Margin by product / category / reseller' },
  { type: 'VOLUME_VALUE', title: 'Order volume & value', description: 'GMV and order counts over time' },
  { type: 'PARTNER_PERFORMANCE', title: 'Partner performance', description: 'Fulfillment on-time & GMV by partner' },
  { type: 'COMPANY_SPEND', title: 'Company spend', description: 'Spend by enrolled company' },
] as const;

export function listReports() {
  return REPORT_DEFS;
}

// Records an export request. Real file generation/storage is out of scope this
// pass — we persist a ReportExport row and return a stub file reference.
export async function exportReport(
  type: ReportType,
  format: ReportFormat,
  filters: unknown,
  generatedById: string,
) {
  const record = await prisma.reportExport.create({
    data: {
      reportType: type,
      format,
      filters: (filters as object) ?? undefined,
      // Stub: a real implementation would upload to object storage and set this URL.
      fileUrl: `/exports/${type.toLowerCase()}-${Date.now()}.${format.toLowerCase()}`,
      generatedById,
    },
  });
  return serialize(record);
}
