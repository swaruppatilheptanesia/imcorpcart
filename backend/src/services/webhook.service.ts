import fs from 'fs/promises';
import { WebhookStatus, OrderStatus, ShipmentStatus, DocumentType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { decryptSecret } from '../utils/secretbox';
import {
  buildEpodEnvelope,
  partnerOrderViewSelect,
  partnerStatusFromShipment,
  toPartnerOrderView,
} from './partner-order-view';

// Lightweight, in-process outbound webhook delivery. Each event is logged to
// `webhook_deliveries` and POSTed to the partner's URL (authenticated with the
// partner's bearer secret); failures retry with backoff via a 60s reprocess
// loop. No external queue.

const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 30, 120, 360]; // delay after attempt 1..5 (attempt 6 = final)
const TIMEOUT_MS = 10_000;

// Create a delivery row and fire the first attempt (non-blocking). No-op when the
// partner has no webhook URL configured.
export async function enqueueWebhook(partnerId: string, event: string, payload: unknown) {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  if (!partner?.webhookUrl) return null;
  const delivery = await prisma.webhookDelivery.create({
    data: {
      partnerId,
      event,
      payload: payload as object,
      url: partner.webhookUrl,
      status: WebhookStatus.PENDING,
      nextAttemptAt: new Date(),
    },
  });
  void attemptDelivery(delivery.id);
  return delivery;
}

export async function attemptDelivery(id: string): Promise<void> {
  const d = await prisma.webhookDelivery.findUnique({ where: { id }, include: { partner: true } });
  if (!d || d.status === WebhookStatus.DELIVERED) return;
  const attempts = d.attempts + 1;
  let body: string;
  try {
    body = JSON.stringify(await materialisePayload(d.payload));
  } catch (e) {
    await markFailure(id, attempts, null, e instanceof Error ? e.message : 'could not build payload');
    return;
  }
  try {
    if (!d.partner.webhookSecretEnc) {
      await markFailure(id, attempts, null, 'partner has no webhook secret');
      return;
    }
    const secret = decryptSecret(d.partner.webhookSecretEnc);
    const res = await fetch(d.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event': d.event,
        Authorization: `Bearer ${secret}`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      await prisma.webhookDelivery.update({
        where: { id },
        data: { status: WebhookStatus.DELIVERED, attempts, lastAttemptAt: new Date(), responseStatus: res.status, nextAttemptAt: null, lastError: null },
      });
      return;
    }
    await markFailure(id, attempts, res.status, `HTTP ${res.status}`);
  } catch (e) {
    await markFailure(id, attempts, null, e instanceof Error ? e.message : 'request failed');
  }
}

async function markFailure(id: string, attempts: number, responseStatus: number | null, error: string) {
  const exhausted = attempts >= MAX_ATTEMPTS;
  const delayMin = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
  await prisma.webhookDelivery.update({
    where: { id },
    data: {
      status: exhausted ? WebhookStatus.FAILED : WebhookStatus.PENDING,
      attempts,
      lastAttemptAt: new Date(),
      responseStatus,
      lastError: error,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + delayMin * 60_000),
    },
  });
}

// Periodic reprocessor for due PENDING deliveries. Started once from server.ts.
export function startWebhookRetryLoop() {
  const timer = setInterval(() => {
    void (async () => {
      const due = await prisma.webhookDelivery.findMany({
        where: { status: WebhookStatus.PENDING, nextAttemptAt: { lte: new Date() } },
        take: 20,
        orderBy: { nextAttemptAt: 'asc' },
      });
      for (const d of due) await attemptDelivery(d.id);
    })().catch(() => undefined);
  }, 60_000);
  timer.unref();
  return timer;
}

// Push an order status change to the origin partner's webhook (no-op for internal
// orders). Loads the order and builds the rich payload GenieMart expects. Pass a
// `shipmentStatus` for transit updates (so In Transit / Out for Delivery are
// emitted), or an `event` (e.g. 'order.cancelled') to override the event name.
export async function notifyPartnerOrderStatus(orderId: string, opts: { event?: string; shipmentStatus?: ShipmentStatus } = {}) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: partnerOrderViewSelect });
  if (!order || order.source !== 'PARTNER' || !order.partnerId) return;

  const view = await toPartnerOrderView(order);
  // `shipmentStatus` is the transition that just happened, passed by applyTransit
  // so the push names it exactly even if the row is read back mid-flight.
  const status = opts.shipmentStatus ? partnerStatusFromShipment(opts.shipmentStatus) : null;

  await enqueueWebhook(order.partnerId, opts.event ?? 'order.status', {
    orderNo: view.orderNo,
    externalRef: view.externalRef,
    dealerCode: view.dealerCode,
    itemCodes: view.items.map((i) => i.sku),
    pincode: view.pincode,
    status: status?.label ?? view.status,
    statusCode: status?.code ?? view.statusCode,
    statusAt: new Date().toISOString(),
    shipmentId: order.shipment?.id ?? null,
    awb: view.awb,
    courier: view.courier,
    tentativeDeliveryDate: view.tentativeDeliveryDate,
    dispatchedAt: view.dispatchedAt,
    deliveredAt: view.deliveredAt,
    remarks: view.remarks,
    checkoutGroup: view.checkoutGroup,
  });
}

/**
 * Expand a stored payload into the body we actually send.
 *
 * `order.epod` carries the proof-of-delivery document as base64, but storing
 * that in `webhook_deliveries.payload` would put a multi-megabyte blob in the
 * log and carry it through all six retries. So the row holds `documentRef` (a
 * path on disk) and the file is read here, at send time, into `document`.
 * A missing file fails this delivery loudly rather than shipping a body with no
 * document in it.
 */
async function materialisePayload(payload: unknown): Promise<unknown> {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;
  const ref = p.documentRef;
  if (typeof ref !== 'string' || !ref) return payload;

  const buf = await fs.readFile(ref).catch(() => null);
  if (!buf) throw new Error(`ePOD document is missing on disk (${ref})`);

  const { documentRef: _omit, ...rest } = p;
  return { ...rest, document: buf.toString('base64') };
}

// Push the proof-of-delivery document to the origin partner (no-op for internal
// orders). Carries the partner's own order reference, the AWB, the document as
// base64 and when the proof was captured.
export async function notifyPartnerEpod(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: partnerOrderViewSelect });
  if (!order || order.source !== 'PARTNER' || !order.partnerId) return null;

  const envelope = buildEpodEnvelope(order);
  if (!envelope) return null;
  const { fileUrl, ...rest } = envelope;

  return enqueueWebhook(order.partnerId, 'order.epod', {
    ...rest,
    // Swapped for `document: <base64>` by materialisePayload at send time.
    documentRef: fileUrl,
  });
}

// Admin: re-attempt a specific delivery now.
export async function resendDelivery(id: string) {
  await prisma.webhookDelivery.update({
    where: { id },
    data: { status: WebhookStatus.PENDING, nextAttemptAt: new Date() },
  });
  void attemptDelivery(id);
  return prisma.webhookDelivery.findUnique({ where: { id } });
}

// Admin: send a test `ping` event to the partner's webhook.
export async function sendTestWebhook(partnerId: string) {
  const d = await enqueueWebhook(partnerId, 'ping', { message: 'Test webhook from imcorpcart', at: new Date().toISOString() });
  if (!d) throw new Error('This partner has no webhook URL configured');
  return d;
}
