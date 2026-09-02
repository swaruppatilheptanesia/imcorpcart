import { WebhookStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { decryptSecret } from '../utils/secretbox';

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
  const body = JSON.stringify(d.payload);
  try {
    const secret = decryptSecret(d.partner.apiSecretEnc);
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

// Push a status change for a partner-sourced order.
export async function notifyPartnerOrderStatus(order: {
  source: string;
  partnerId: string | null;
  orderNo: string;
  externalRef: string | null;
  status: string;
  checkoutGroup: string | null;
}) {
  if (order.source !== 'PARTNER' || !order.partnerId) return;
  await enqueueWebhook(order.partnerId, 'order.status', {
    orderNo: order.orderNo,
    externalRef: order.externalRef,
    status: order.status,
    checkoutGroup: order.checkoutGroup,
    at: new Date().toISOString(),
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
