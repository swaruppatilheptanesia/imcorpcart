import type { Request, Response } from 'express';
import * as service from '../services/bulk.service';
import { AppError } from '../utils/AppError';

export async function importProducts(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await service.importProducts(req.body, req.user.id));
}

export async function priceUpdate(req: Request, res: Response) {
  res.json(await service.bulkPriceUpdate(req.body));
}

export async function cashbackUpdate(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await service.bulkCashbackUpdate(req.body, req.user.id));
}
