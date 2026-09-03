import type { Request, Response } from 'express';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import * as catalogue from '../services/partner.service';
import { acceptOrder, cancelPartnerOrder, getPartnerOrder } from '../services/partner-order.service';
import type { PartnerCatalogueQuery, DeliveryQuery } from '../validators/partner.schema';

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
  const q = getQuery<DeliveryQuery>(req);
  res.json(await catalogue.partnerDelivery(partner(req), q.pincode, q.sku));
}

export async function createOrder(req: Request, res: Response) {
  const result = await acceptOrder(partner(req), req.body);
  res.status(result.statusCode).json(result.body);
}

export async function getOrder(req: Request, res: Response) {
  res.json({ data: await getPartnerOrder(partner(req), getParam(req, 'ref')) });
}

export async function cancelOrder(req: Request, res: Response) {
  const result = await cancelPartnerOrder(partner(req), getParam(req, 'ref'), req.body?.reason);
  res.status(result.statusCode).json(result.body);
}
