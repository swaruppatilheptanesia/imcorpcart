import type { Request, Response } from 'express';
import * as service from '../services/leasing.service';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import type { LeasingRequestListQuery } from '../validators/leasing.schema';

function userId(req: Request): string {
  if (!req.user) throw AppError.unauthorized();
  return req.user.id;
}

export async function profile(req: Request, res: Response) {
  res.json(await service.getProfile(userId(req)));
}

export async function getParams(req: Request, res: Response) {
  res.json(await service.getParams(userId(req)));
}

export async function updateParams(req: Request, res: Response) {
  res.json(await service.updateParams(userId(req), req.body));
}

export async function previewParams(req: Request, res: Response) {
  res.json(await service.previewParams(userId(req), req.body));
}

export async function listCompanies(req: Request, res: Response) {
  res.json(await service.listCompanies(userId(req)));
}

export async function listRequests(req: Request, res: Response) {
  res.json(await service.listRequests(userId(req), getQuery<LeasingRequestListQuery>(req)));
}

export async function getRequest(req: Request, res: Response) {
  res.json(await service.getRequest(userId(req), getParam(req, 'id')));
}

export async function decideRequest(req: Request, res: Response) {
  res.json(await service.decideRequest(userId(req), getParam(req, 'id'), req.body));
}
