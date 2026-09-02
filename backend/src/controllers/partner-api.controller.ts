import type { Request, Response } from 'express';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import * as catalogue from '../services/partner.service';
import { acceptOrder, getPartnerOrder } from '../services/partner-order.service';
import { estimateDelivery } from '../services/delivery.service';
import type { PartnerCatalogueQuery } from '../validators/partner.schema';

function partner(req: Request) {
  if (!req.partner) throw AppError.unauthorized();
  return req.partner;
}

export async function ping(req: Request, res: Response) {
  res.json({ ok: true, partner: partner(req).name });
}

export async function listCatalogue(req: Request, res: Response) {
  res.json(await catalogue.partnerCatalogue(partner(req), getQuery<PartnerCatalogueQuery>(req)));
}

export async function getCatalogueItem(req: Request, res: Response) {
  res.json(await catalogue.partnerCatalogueItem(partner(req), getParam(req, 'sku')));
}

export async function delivery(req: Request, res: Response) {
  res.json(await estimateDelivery(String(req.query.pincode ?? '')));
}

export async function createOrder(req: Request, res: Response) {
  const key = req.header('idempotency-key');
  if (!key) throw AppError.badRequest('Missing Idempotency-Key header');
  const result = await acceptOrder(partner(req), key, req.body);
  res.status(result.statusCode).json(result.body);
}

export async function getOrder(req: Request, res: Response) {
  res.json({ data: await getPartnerOrder(partner(req), getParam(req, 'ref')) });
}
