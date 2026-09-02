import type { Request, Response } from 'express';
import { getParam } from '../middleware/validate';
import * as service from '../services/partner.service';
import { resendDelivery, sendTestWebhook } from '../services/webhook.service';

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

export async function rotateSecret(req: Request, res: Response) {
  res.json(await service.rotateSecret(getParam(req, 'id')));
}

export async function webhooks(req: Request, res: Response) {
  res.json(await service.listPartnerWebhooks(getParam(req, 'id')));
}

export async function activity(req: Request, res: Response) {
  res.json(await service.listPartnerActivity(getParam(req, 'id')));
}

export async function testWebhook(req: Request, res: Response) {
  res.status(201).json(await sendTestWebhook(getParam(req, 'id')));
}

export async function resendWebhook(req: Request, res: Response) {
  res.json(await resendDelivery(getParam(req, 'deliveryId')));
}
