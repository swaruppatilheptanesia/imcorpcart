import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { getParam } from '../middleware/validate';
import { catalogue, getReport } from '../services/report/registry';
import { previewReport, streamReport, type DownloadFormat } from '../services/report/runner';

/**
 * Filters are parsed HERE, by the descriptor's own schema, because the schema
 * only becomes known once the report is resolved. `validate` cannot do it: it
 * runs before routing has told us which report this is.
 */
function parseFilters(req: Request, schema: Parameters<typeof getReport> extends never ? never : ReturnType<typeof getReport>['filterSchema']) {
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    throw AppError.validation('Invalid report filters', parsed.error.issues);
  }
  return parsed.data;
}

export async function list(_req: Request, res: Response) {
  res.json(await catalogue());
}

export async function preview(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const report = getReport(getParam(req, 'type'));
  const filters = parseFilters(req, report.filterSchema);
  res.json(await previewReport(report, filters, { actorId: req.user.id }));
}

export async function download(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const report = getReport(getParam(req, 'type'));
  const filters = parseFilters(req, report.filterSchema);

  const rawFormat = String(req.query.format ?? 'CSV').toUpperCase();
  if (rawFormat !== 'CSV' && rawFormat !== 'XLSX') {
    throw AppError.validation('format must be CSV or XLSX');
  }

  await streamReport(res, report, rawFormat as DownloadFormat, filters, { actorId: req.user.id });
}
