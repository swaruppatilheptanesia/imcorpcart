import type { Request, Response } from 'express';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import * as catalogue from '../services/partner.service';
import {
  acceptOrder,
  cancelPartnerOrder,
  getPartnerOrder,
  getPartnerOrderEpod,
  listPartnerOrders,
} from '../services/partner-order.service';
import type { PartnerCatalogueQuery, DeliveryQuery, EpodQuery, PartnerOrderListQuery } from '../validators/partner.schema';
import { normalizeIp } from '../middleware/partnerAuth';

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
  const result = await acceptOrder(partner(req), req.body, normalizeIp(req.ip));
  res.status(result.statusCode).json(result.body);
}

export async function listOrders(req: Request, res: Response) {
  res.json(await listPartnerOrders(partner(req), getQuery<PartnerOrderListQuery>(req)));
}

export async function getOrder(req: Request, res: Response) {
  res.json({ data: await getPartnerOrder(partner(req), getParam(req, 'ref')) });
}

export async function orderEpod(req: Request, res: Response) {
  const result = await getPartnerOrderEpod(partner(req), getParam(req, 'ref'), getQuery<EpodQuery>(req));
  if (result.kind === 'json') {
    res.json({ data: result.data });
    return;
  }
  // Streamed straight from the private store — these files are never served
  // statically (they carry a recipient's name and signature).
  res.type(result.file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.file.fileName.replace(/"/g, '')}"`);
  res.sendFile(result.file.filePath);
}

export async function cancelOrder(req: Request, res: Response) {
  const result = await cancelPartnerOrder(partner(req), getParam(req, 'ref'), req.body?.reason);
  res.status(result.statusCode).json(result.body);
}
