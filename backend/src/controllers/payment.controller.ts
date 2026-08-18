import type { Request, Response } from 'express';
import * as service from '../services/payment.service';

export async function getConfig(_req: Request, res: Response) {
  res.json(await service.getPaymentConfig());
}

export async function updateConfig(req: Request, res: Response) {
  res.json(await service.updatePaymentConfig(req.body));
}
