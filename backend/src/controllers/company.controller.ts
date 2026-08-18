import type { Request, Response } from 'express';
import * as service from '../services/company.service';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import type { CompanyEmployeeListQuery } from '../validators/company.schema';

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

export async function listEmployees(req: Request, res: Response) {
  res.json(await service.listEmployees(userId(req), getQuery<CompanyEmployeeListQuery>(req)));
}

export async function listOrders(req: Request, res: Response) {
  const bucket = getQuery<{ bucket?: string }>(req).bucket;
  res.json(await service.listOrders(userId(req), bucket));
}

export async function createEmployee(req: Request, res: Response) {
  res.status(201).json(await service.createEmployee(userId(req), req.body));
}

export async function updateEmployee(req: Request, res: Response) {
  res.json(await service.updateEmployee(userId(req), getParam(req, 'id'), req.body));
}
