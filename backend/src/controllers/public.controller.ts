import type { Request, Response } from 'express';
import * as shop from '../services/shop.service';
import { listActiveBanners } from '../services/banner.service';
import { estimateDelivery } from '../services/delivery.service';
import { getParam } from '../middleware/validate';

// Unauthenticated storefront catalog. Prices are MOP (market operating price);
// EPP is never exposed here — it requires an employee session.

export async function listProducts(_req: Request, res: Response) {
  res.json(await shop.listPublicProducts());
}

export async function getProduct(req: Request, res: Response) {
  res.json(await shop.getPublicProduct(getParam(req, 'id')));
}

export async function listBanners(_req: Request, res: Response) {
  res.json(await listActiveBanners());
}

// Delivery estimate for a pincode (Blue Dart TAT). Public.
export async function deliveryEstimate(req: Request, res: Response) {
  res.json(await estimateDelivery(String(req.query.pincode ?? '')));
}
