import type { Request, Response } from 'express';
import { getParam, getQuery } from '../middleware/validate';
import * as service from '../services/partner.service';
import { resendDelivery, sendTestWebhook } from '../services/webhook.service';
import type { CatalogueCandidatesQuery, PartnerOrdersQuery } from '../validators/partner.schema';

export async function list(_req: Request, res: Response) {
  res.json(await service.listPartners());
}

export async function get(req: Request, res: Response) {
  res.json(await service.getPartner(getParam(req, 'id')));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createPartner(req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updatePartner(getParam(req, 'id'), req.body));
}

export async function remove(req: Request, res: Response) {
  res.json(await service.deletePartner(getParam(req, 'id')));
}

export async function rotateApiToken(req: Request, res: Response) {
  res.json(await service.rotateApiToken(getParam(req, 'id')));
}

export async function rotateWebhookSecret(req: Request, res: Response) {
  res.json(await service.rotateWebhookSecret(getParam(req, 'id')));
}

export async function webhooks(req: Request, res: Response) {
  res.json(await service.listPartnerWebhooks(getParam(req, 'id')));
}

export async function activity(req: Request, res: Response) {
  res.json(await service.listPartnerActivity(getParam(req, 'id')));
}

export async function orders(req: Request, res: Response) {
  res.json(await service.listPartnerOrders(getParam(req, 'id'), getQuery<PartnerOrdersQuery>(req)));
}

export async function testWebhook(req: Request, res: Response) {
  res.status(201).json(await sendTestWebhook(getParam(req, 'id')));
}

export async function resendWebhook(req: Request, res: Response) {
  res.json(await resendDelivery(getParam(req, 'deliveryId')));
}

// ── Catalogue ────────────────────────────────────────────────────────────────

export async function catalogue(req: Request, res: Response) {
  res.json(await service.listCatalogue(getParam(req, 'id'), getQuery<CatalogueCandidatesQuery>(req)));
}

export async function candidates(req: Request, res: Response) {
  res.json(await service.listCandidates(getParam(req, 'id'), getQuery<CatalogueCandidatesQuery>(req)));
}

export async function addCatalogue(req: Request, res: Response) {
  res.status(201).json(await service.addCatalogue(getParam(req, 'id'), req.body));
}

export async function updateCatalogueEntry(req: Request, res: Response) {
  res.json(await service.updateCatalogueEntry(getParam(req, 'id'), getParam(req, 'entryId'), req.body));
}

export async function removeCatalogueEntry(req: Request, res: Response) {
  res.json(await service.removeCatalogueEntry(getParam(req, 'id'), getParam(req, 'entryId')));
}
