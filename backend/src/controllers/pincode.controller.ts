import type { Request, Response } from 'express';
import * as service from '../services/pincode.service';
import { getParam, getQuery } from '../middleware/validate';
import type { PincodeListQuery } from '../validators/pincode.schema';

export async function list(req: Request, res: Response) {
  res.json(await service.listPincodes(getQuery<PincodeListQuery>(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await service.createPincode(req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updatePincode(getParam(req, 'id'), req.body));
}

export async function remove(req: Request, res: Response) {
  res.json(await service.deletePincode(getParam(req, 'id')));
}

export async function importRows(req: Request, res: Response) {
  res.json(await service.importPincodes(req.body));
}

export async function exportAll(req: Request, res: Response) {
  res.json({ data: await service.listPincodesForExport(getQuery<PincodeListQuery>(req)) });
}

export async function settings(_req: Request, res: Response) {
  res.json(await service.listDeliverySettings());
}

export async function updateSetting(req: Request, res: Response) {
  res.json(await service.setDeliverySetting(req.body.key, req.body.enabled));
}
