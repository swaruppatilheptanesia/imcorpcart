import type { Request, Response } from 'express';
import * as service from '../services/banner.service';
import { getParam } from '../middleware/validate';

export async function list(_req: Request, res: Response) {
  res.json(await service.listBanners());
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createBanner(req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updateBanner(getParam(req, 'id'), req.body));
}

export async function remove(req: Request, res: Response) {
  res.json(await service.deleteBanner(getParam(req, 'id')));
}
