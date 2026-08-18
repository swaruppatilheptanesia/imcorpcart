import type { Request, Response } from 'express';
import * as service from '../services/user.service';
import { getQuery, getParam } from '../middleware/validate';
import type { UserListQuery } from '../validators/user.schema';

export async function list(req: Request, res: Response) {
  const result = await service.listUsers(getQuery<UserListQuery>(req));
  res.json(result);
}

export async function invite(req: Request, res: Response) {
  res.status(201).json(await service.inviteUser(req.body));
}

export async function createCompany(req: Request, res: Response) {
  res.status(201).json(await service.createCompany(req.body));
}

export async function assignAdmin(req: Request, res: Response) {
  res.json(await service.assignCompanyAdmin(getParam(req, 'companyId'), req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updateUser(getParam(req, 'id'), req.body));
}

export async function updateReseller(req: Request, res: Response) {
  res.json(await service.updateReseller(getParam(req, 'id'), req.body));
}

export async function updateCompany(req: Request, res: Response) {
  res.json(await service.updateCompany(getParam(req, 'id'), req.body));
}

export async function importUsers(req: Request, res: Response) {
  res.json(await service.importUsers(req.body));
}
