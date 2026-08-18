import type { Request, Response } from 'express';
import * as service from '../services/dashboard.service';
import { getQuery } from '../middleware/validate';
import type { DashboardRange } from '../validators/dashboard.schema';

export async function get(req: Request, res: Response) {
  const { range } = getQuery<{ range: DashboardRange }>(req);
  res.json(await service.getDashboard(range));
}
