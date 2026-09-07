import type { Request, Response } from 'express';
import * as service from '../services/order.service';
import { getQuery, getParam } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import type { OrderListQuery } from '../validators/order.schema';

export async function list(req: Request, res: Response) {
  const result = await service.listOrders(getQuery<OrderListQuery>(req));
  res.json(result);
}

export async function get(req: Request, res: Response) {
  res.json(await service.getOrder(getParam(req, 'id')));
}

export async function overrideStatus(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await service.overrideStatus(getParam(req, 'id'), req.body, req.user.id));
}

export async function updateTransit(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await service.updateTransit(getParam(req, 'id'), req.body, req.user.id));
}

export async function cancel(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await service.cancelOrder(getParam(req, 'id'), req.body?.note, req.user.id));
}

export async function retryVoucher(req: Request, res: Response) {
  res.json(await service.retryVoucher(getParam(req, 'id'), getParam(req, 'itemId')));
}

export async function resendVoucher(req: Request, res: Response) {
  res.json(await service.resendVoucher(getParam(req, 'id'), getParam(req, 'itemId')));
}
