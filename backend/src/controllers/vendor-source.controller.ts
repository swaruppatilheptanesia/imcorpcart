import type { Request, Response } from 'express';
import { getParam, getQuery } from '../middleware/validate';
import * as service from '../services/inbound/vendor-source.service';
import type { RunsQuery } from '../validators/vendor-source.schema';

export async function list(_req: Request, res: Response) {
  res.json(await service.listSources());
}

export async function adapters(_req: Request, res: Response) {
  res.json({ data: service.listAdapters() });
}

export async function get(req: Request, res: Response) {
  res.json(await service.getSource(getParam(req, 'id')));
}

export async function update(req: Request, res: Response) {
  res.json(await service.updateSource(getParam(req, 'id'), req.body));
}

export async function sync(req: Request, res: Response) {
  // Kicks the import off in the background; returns the RUNNING run to poll.
  res.status(202).json(await service.startImport(getParam(req, 'id'), req.user?.id));
}

export async function runs(req: Request, res: Response) {
  res.json(await service.listRuns(getParam(req, 'id'), getQuery<RunsQuery>(req)));
}

export async function run(req: Request, res: Response) {
  res.json(await service.getRun(getParam(req, 'id'), getParam(req, 'runId')));
}

export async function products(req: Request, res: Response) {
  res.json(await service.listSourceProducts(getParam(req, 'id'), getQuery<RunsQuery>(req)));
}

export async function wallet(req: Request, res: Response) {
  res.json(await service.getWalletBalance(getParam(req, 'id')));
}
