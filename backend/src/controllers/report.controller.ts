import type { Request, Response } from 'express';
import type { ReportFormat } from '@prisma/client';
import * as service from '../services/report.service';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import type { ReportType } from '../validators/report.schema';

export function list(_req: Request, res: Response) {
  res.json(service.listReports());
}

export async function exportReport(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  const { format } = getQuery<{ format: ReportFormat }>(req);
  const record = await service.exportReport(
    getParam(req, 'type') as ReportType,
    format,
    req.body,
    req.user.id,
  );
  res.status(201).json(record);
}
