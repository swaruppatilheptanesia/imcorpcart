import type { Request, Response } from 'express';
import * as service from '../services/campaign.service';
import { getParam } from '../middleware/validate';

export async function list(_req: Request, res: Response) {
  res.json(await service.listCampaigns());
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createCampaign(req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updateCampaign(getParam(req, 'id'), req.body));
}
