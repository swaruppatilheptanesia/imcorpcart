import type { Request, Response } from 'express';
import * as service from '../services/product.service';
import { getQuery, getParam } from '../middleware/validate';
import type { ProductListQuery } from '../validators/product.schema';

export async function list(req: Request, res: Response) {
  const result = await service.listProducts(getQuery<ProductListQuery>(req));
  res.json(result);
}

export async function get(req: Request, res: Response) {
  const product = await service.getProduct(getParam(req, 'id'));
  res.json(product);
}

export async function create(req: Request, res: Response) {
  const product = await service.createProduct(req.body);
  res.status(201).json(product);
}

export async function update(req: Request, res: Response) {
  const product = await service.updateProduct(getParam(req, 'id'), req.body);
  res.json(product);
}

export async function bulk(req: Request, res: Response) {
  const result = await service.bulkProducts(req.body);
  res.json(result);
}

export async function remove(req: Request, res: Response) {
  const result = await service.softDeleteProduct(getParam(req, 'id'));
  res.json(result);
}

// ─── Marketplace offers ───────────────────────────────────────────────────────

export async function listResellers(_req: Request, res: Response) {
  res.json(await service.listResellersForOffers());
}

export async function resellerGifts(req: Request, res: Response) {
  res.json(await service.listGiftsForReseller(getParam(req, 'resellerId')));
}

export async function families(_req: Request, res: Response) {
  res.json(await service.listFamilies());
}

export async function listOffers(req: Request, res: Response) {
  res.json(await service.listOffers(getParam(req, 'id')));
}

// All offers across products — the "Reseller pricing" report.
export async function listAllOffers(_req: Request, res: Response) {
  res.json(await service.listAllOffers());
}

export async function attachOffer(req: Request, res: Response) {
  res.status(201).json(await service.attachOffer(getParam(req, 'id'), req.body));
}

export async function updateOffer(req: Request, res: Response) {
  res.json(await service.updateOffer(getParam(req, 'id'), getParam(req, 'offerId'), req.body));
}

export async function removeOffer(req: Request, res: Response) {
  res.json(await service.removeOffer(getParam(req, 'id'), getParam(req, 'offerId')));
}
