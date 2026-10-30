import type { Request, Response } from 'express';
import * as service from '../services/order.service';
import * as courier from '../services/courier/tracking.service';
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

export async function setInvoiceNumber(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await service.setInvoiceNumber(getParam(req, 'id'), req.body, req.user.id));
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

// The colours this line could be moved to, with live stock + any price gap.
export async function itemColourOptions(req: Request, res: Response) {
  res.json(await service.listColourOptions(getParam(req, 'id'), getParam(req, 'itemId')));
}

// Move the line to a colour the vendor can actually ship (buyer confirmed off-platform).
export async function swapItemColour(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(
    await service.swapItemColour(getParam(req, 'id'), getParam(req, 'itemId'), req.body, req.user.id),
  );
}

// ─── Courier automation ──────────────────────────────────────────────────────

export async function generateAwb(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await courier.generateOrderAwb(getParam(req, 'id'), req.user.id));
}

export async function refreshTracking(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await courier.refreshTracking(getParam(req, 'id'), req.user.id));
}

export async function fetchCourierEpod(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.json(await courier.fetchCourierPod(getParam(req, 'id'), req.user.id));
}

export async function downloadLrCopy(req: Request, res: Response) {
  const { file, fileName } = await courier.fetchOrderLrCopy(getParam(req, 'id'));
  res.type(file.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
  res.send(file.buffer);
}

// ─── Proof of delivery ───────────────────────────────────────────────────────

export async function uploadEpod(req: Request, res: Response) {
  if (!req.user) throw AppError.unauthorized();
  res.status(201).json(await service.attachOrderEpod(getParam(req, 'id'), req.file, req.body, req.user.id));
}

export async function resendEpod(req: Request, res: Response) {
  res.json(await service.resendOrderEpod(getParam(req, 'id')));
}

export async function downloadEpod(req: Request, res: Response) {
  const doc = await service.getOrderEpodFile(getParam(req, 'id'));
  res.type(doc.mimeType);
  // `inline` so the admin can preview a PDF rather than being forced to save it.
  res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/"/g, '')}"`);
  res.sendFile(doc.filePath);
}
