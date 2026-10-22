import type { Response } from 'express';
import { ReportFormat } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { REPORT } from '../../config/constants';
import { AppError } from '../../utils/AppError';
import type { AnyReport } from './registry';
import type { Cell, ReportContext } from './types';
import { writeCsv } from './writers/csv';
import { writeXlsx } from './writers/xlsx';

/**
 * Runs a report.
 *
 * DO NOT call `serialize()` on report rows. Every other service in this repo
 * ends with `return serialize(...)`, so the instinct is strong — but it deep-
 * copies the whole result set (doubling peak memory on a 50k-row export),
 * ISO-stringifies Dates (fighting the Excel number formats) and silently drops
 * any column whose name happens to match SECRET_KEYS. Descriptors resolve
 * Decimals with `toNumber()` and format Dates in their accessors instead.
 */

export type DownloadFormat = 'CSV' | 'XLSX';

const EXT: Record<DownloadFormat, string> = { CSV: 'csv', XLSX: 'xlsx' };
const MIME: Record<DownloadFormat, string> = {
  CSV: 'text/csv; charset=utf-8',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function capFor(report: AnyReport): number {
  return report.maxRows ?? REPORT.rowCap;
}

/**
 * Pre-flight. Everything that can fail must fail HERE, before a single byte is
 * written — once the response headers are out there is no JSON error channel
 * left, and a failure can only produce a truncated file plus a log line.
 */
async function preflight(report: AnyReport, filters: unknown, ctx: ReportContext): Promise<number> {
  const total = await report.count(filters, ctx);
  const cap = capFor(report);
  if (total > cap) {
    // Refuse rather than truncate. A half-file is worse than no file: someone
    // reconciles against it and the missing tail is invisible.
    throw AppError.validation(
      `This selection has ${total.toLocaleString('en-IN')} rows; the export limit is ${cap.toLocaleString('en-IN')}. Narrow the date range or add a filter.`,
      { total, cap },
    );
  }
  return total;
}

/** A capped slice for the on-screen preview — same generator, first page only. */
export async function previewReport(report: AnyReport, filters: unknown, ctx: ReportContext) {
  const cap = capFor(report);
  const total = await report.count(filters, ctx);

  const rows: Cell[][] = [];
  if (total > 0 && total <= cap) {
    for await (const page of report.fetch(filters, ctx)) {
      for (const row of page) {
        rows.push(report.columns.map((c) => c.accessor(row)));
        if (rows.length >= REPORT.previewLimit) break;
      }
      break; // first page is always at least previewLimit rows
    }
  }

  return {
    columns: report.columns.map((c) => ({ key: c.key, header: c.header })),
    rows,
    total,
    cap,
    overCap: total > cap,
  };
}

export async function streamReport(
  res: Response,
  report: AnyReport,
  format: DownloadFormat,
  filters: unknown,
  ctx: ReportContext,
): Promise<void> {
  const total = await preflight(report, filters, ctx);

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', MIME[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${report.fileStem}-${stamp}.${EXT[format]}"`);
  // These files carry customer addresses and phone numbers.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Report-Rows', String(total));

  const pages = report.fetch(filters, ctx);
  const written = format === 'CSV' ? await writeCsv(res, report, pages) : await writeXlsx(res, report, pages);
  res.end();

  // Audit AFTER the bytes are out, and never let a failed audit insert corrupt
  // a download that already succeeded. This row is the compliance answer to
  // "who pulled customer data, with what filters, and how much of it".
  prisma.reportExport
    .create({
      data: {
        reportType: report.id,
        format: format === 'CSV' ? ReportFormat.CSV : ReportFormat.XLSX,
        filters: (filters ?? {}) as object,
        fileUrl: null, // reports stream; nothing is persisted
        rowCount: written,
        generatedById: ctx.actorId,
      },
    })
    .catch((e) => console.error('[reports] audit write failed', e));
}
