import type { Request, Response } from 'express';
import * as service from '../services/reseller.service';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import type { ResellerListQuery } from '../validators/reseller.schema';

function userId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export async function profile(req: Request, res: Response) {
  res.json(await service.getProfile(userId(req)));
}

export async function dashboard(req: Request, res: Response) {
  res.json(await service.getDashboard(userId(req)));
}

// Marketplace offers — the reseller edits only its own price/stock listings.
export async function listOffers(req: Request, res: Response) {
  res.json(await service.listMyOffers(userId(req), getQuery<ResellerListQuery>(req)));
}

export async function getOffer(req: Request, res: Response) {
  res.json(await service.getMyOffer(userId(req), getParam(req, 'id')));
}

export async function updateOffer(req: Request, res: Response) {
  res.json(await service.updateMyOffer(userId(req), getParam(req, 'id'), req.body));
}

// Bulk stock & price update: download all my offers (export), edit, re-upload.
export async function exportOffers(req: Request, res: Response) {
  res.json(await service.listAllMyOffers(userId(req)));
}

export async function bulkUpdateOffers(req: Request, res: Response) {
  res.json(await service.bulkUpdateMyOffers(userId(req), req.body.rows));
}

export async function listCoupons(req: Request, res: Response) {
  res.json(await service.listCoupons(userId(req)));
}

export async function listFreeGifts(req: Request, res: Response) {
  res.json(await service.listFreeGifts(userId(req)));
}

export async function createFreeGift(req: Request, res: Response) {
  res.status(201).json(await service.createFreeGift(userId(req), req.body));
}

export async function updateFreeGift(req: Request, res: Response) {
  res.json(await service.updateFreeGift(userId(req), getParam(req, 'id'), req.body));
}

export async function listOrders(req: Request, res: Response) {
  res.json(await service.listOrders(userId(req), getQuery<ResellerListQuery>(req)));
}

export async function getOrder(req: Request, res: Response) {
  res.json(await service.getOrder(userId(req), getParam(req, 'id')));
}

export async function updateTransit(req: Request, res: Response) {
  res.json(await service.updateTransit(userId(req), getParam(req, 'id'), req.body));
}
