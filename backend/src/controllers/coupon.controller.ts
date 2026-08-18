import type { Request, Response } from 'express';
import * as service from '../services/coupon.service';
import { getQuery, getParam } from '../middleware/validate';
import type { CouponListQuery } from '../validators/coupon.schema';

export async function list(req: Request, res: Response) {
  const result = await service.listCoupons(getQuery<CouponListQuery>(req));
  res.json(result);
}

export async function stats(_req: Request, res: Response) {
  res.json(await service.couponStats());
}

export async function get(req: Request, res: Response) {
  res.json(await service.getCoupon(getParam(req, 'id')));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createCoupon(req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updateCoupon(getParam(req, 'id'), req.body));
}
