import type { Request, Response } from 'express';
import * as service from '../services/category.service';
import { getParam } from '../middleware/validate';

export async function list(_req: Request, res: Response) {
  res.json(await service.listCategoryTree());
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createCategory(req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updateCategory(getParam(req, 'id'), req.body));
}

export async function remove(req: Request, res: Response) {
  res.json(await service.deleteCategory(getParam(req, 'id')));
}
