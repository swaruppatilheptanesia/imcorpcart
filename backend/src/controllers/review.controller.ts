import type { Request, Response } from 'express';
import * as service from '../services/review.service';
import { getQuery, getParam } from '../middleware/validate';
import type { ReviewListQuery } from '../validators/review.schema';

export async function list(req: Request, res: Response) {
  res.json(await service.listReviews(getQuery<ReviewListQuery>(req)));
}

export async function setStatus(req: Request, res: Response) {
  res.json(await service.setReviewStatus(getParam(req, 'id'), req.body));
}
