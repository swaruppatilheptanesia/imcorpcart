import { CourierCode, ShipmentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { applyTransit } from '../reseller.service';
import {
  generateAwb,
  hkdsConfigured,
  isTrackableCourier,
  mapTrackingStatus,
  trackAwb,
  type HkdsFailure,
} from './hkds';

// Courier automation layered on top of the existing fulfilment engine.
//
// The important design rule: this module never writes Order.status or the
// shipment itself. Anything it learns from the carrier is fed through
// `applyTransit` — the same function the manual admin and reseller transit forms
// call — so the automatic and manual paths produce identical side effects
// (shipment upsert, status sync, tracking event, cashback, partner webhook).
// That is what makes "fall back to manual" true rather than aspirational.

const POLL_INTERVAL_MINUTES = 30;
const POLL_BATCH = 20;

/** Human-readable reason, shown to staff beside the manual form. */
export const FAILURE_MESSAGE: Record<HkdsFailure, string> = {
  DISABLED: 'Courier tracking is not configured — update fulfilment manually.',
  NO_DATA: 'The courier has no update for this AWB yet.',
  UNSUPPORTED_COURIER: 'This courier is not covered by the tracking service — update manually.',
  UNSUPPORTED_OPERATION: 'AWB generation is available for DTDC only — enter the AWB manually.',
  AUTH: 'The courier API rejected our credentials — check HKDS_API_KEY.',
  BAD_RESPONSE: 'The courier API returned something we could not read.',
  TRANSPORT: 'Could not reach the courier API — try again or update manually.',
};

const dueAt = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function loadOrder(id: string) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNo: id }] },
    include: { shipment: { include: { courier: true } }, address: true },
  });
  if (!order) throw AppError.notFound('Order not found');
  return order;
}

export interface TrackingRefreshResult {
  ok: boolean;
  reason?: HkdsFailure;
  message?: string;
  status?: string;
  mapped?: ShipmentStatus | null;
  applied: boolean;
  lastTrackedAt?: Date;
}

/**
 * Pull the carrier's view of one shipment and, when it maps to a status we
 * understand and it has actually moved, push it through `applyTransit`.
 *
 * An unmapped status is recorded but never applied — see `mapTrackingStatus`.
 */
export async function refreshTracking(orderId: string, actorId: string | null): Promise<TrackingRefreshResult> {
  const order = await loadOrder(orderId);
  const shipment = order.shipment;
  if (!shipment?.awbNumber) {
    throw AppError.badRequest('This order has no AWB yet — generate or enter one first.');
  }

  const courier = shipment.courier?.code ?? null;
  const res = await trackAwb(shipment.awbNumber, courier);

  if (!res.ok) {
    // NO_DATA is the normal "nothing yet" answer and must not be recorded as an
    // error, or every un-scanned parcel would look broken to staff.
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        lastTrackedAt: new Date(),
        nextPollAt: dueAt(POLL_INTERVAL_MINUTES),
        trackingError: res.reason === 'NO_DATA' ? null : `${res.reason}: ${res.detail ?? ''}`.trim(),
      },
    });
    return { ok: false, reason: res.reason, message: FAILURE_MESSAGE[res.reason], applied: false };
  }

  const mapped = mapTrackingStatus(res.data.status);
  const now = new Date();

  // Record the raw carrier row even when unmapped — this is how the status
  // vocabulary gets discovered, since the vendor documented only one value.
  await prisma.shipmentTrackingEvent.create({
    data: {
      shipmentId: shipment.id,
      status: mapped ?? shipment.status,
      description: res.data.status,
      occurredAt: now,
      raw: res.data.raw as object,
    },
  });

  const changed = mapped !== null && mapped !== shipment.status;
  if (changed) {
    // Hand the whole order to the shared fulfilment engine, exactly as the
    // manual admin form does — so status sync, cashback and the partner webhook
    // all happen identically whether a human or the courier drove it.
    const { shipment: _s, address: _a, ...rest } = order;
    await applyTransit({ ...rest, shipment }, { status: mapped }, actorId);
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      lastTrackedAt: now,
      trackingError: null,
      // Stop scheduling once the carrier says it is done; applyTransit already
      // clears trackingActive on delivery.
      nextPollAt: mapped === ShipmentStatus.DELIVERED ? null : dueAt(POLL_INTERVAL_MINUTES),
    },
  });

  return {
    ok: true,
    status: res.data.status,
    mapped,
    applied: changed,
    lastTrackedAt: now,
  };
}

export interface GenerateAwbResult {
  ok: boolean;
  reason?: HkdsFailure;
  message?: string;
  awbNo?: string;
  labelUrl?: string | null;
}

/**
 * Book an AWB with the carrier for this order.
 *
 * Deliberately admin-triggered and never retried: the POST creates a real
 * courier booking and the aggregator offers no lookup-by-reference to recover a
 * timed-out call, so a silent retry could book the same parcel twice. We send
 * our `orderNo` as `CustomerRefNo` for their own dedup, refuse outright once an
 * AWB exists, and on a transport failure tell the admin to confirm with the
 * courier rather than trying again.
 */
export async function generateOrderAwb(orderId: string, actorId: string): Promise<GenerateAwbResult> {
  const order = await loadOrder(orderId);

  if (order.shipment?.awbNumber) {
    throw AppError.badRequest(`This order already has AWB ${order.shipment.awbNumber}.`);
  }
  const addr = order.address;
  if (!addr) throw AppError.badRequest('This order has no shipping address.');
  if (!hkdsConfigured()) {
    return { ok: false, reason: 'DISABLED', message: FAILURE_MESSAGE.DISABLED };
  }

  const res = await generateAwb(CourierCode.DTDC, {
    customerRefNo: order.orderNo,
    customerName: addr.contactName,
    address1: addr.line1,
    address2: addr.line2,
    mobileNo: addr.contactPhone,
    pincode: addr.pincode,
    city: addr.city,
    state: addr.state,
  });

  if (!res.ok) {
    return { ok: false, reason: res.reason, message: res.detail ?? FAILURE_MESSAGE[res.reason] };
  }

  const courier = await prisma.courier.findUnique({ where: { code: CourierCode.DTDC }, select: { id: true } });
  const data = {
    awbNumber: res.data.awbNo,
    labelUrl: res.data.labelUrl,
    ...(courier ? { courierId: courier.id } : {}),
    nextPollAt: dueAt(POLL_INTERVAL_MINUTES),
    trackingError: null,
  };
  if (order.shipment) {
    await prisma.shipment.update({ where: { id: order.shipment.id }, data });
  } else {
    await prisma.shipment.create({ data: { orderId: order.id, ...data } });
  }

  await prisma.auditLog
    .create({
      data: {
        actorId,
        action: 'order.awb_generated',
        entityType: 'Order',
        entityId: order.id,
        after: { awbNo: res.data.awbNo, courier: 'DTDC', labelUrl: res.data.labelUrl },
      },
    })
    .catch(() => undefined);

  return { ok: true, awbNo: res.data.awbNo, labelUrl: res.data.labelUrl };
}

/**
 * One poller tick: refresh the shipments that are due.
 *
 * Exported separately from the loop so it can be driven once in a test.
 */
export async function pollDueShipments(): Promise<{ checked: number; applied: number }> {
  if (!hkdsConfigured()) return { checked: 0, applied: 0 };

  const due = await prisma.shipment.findMany({
    where: {
      trackingActive: true,
      awbNumber: { not: null },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }],
    },
    take: POLL_BATCH,
    orderBy: { nextPollAt: { sort: 'asc', nulls: 'first' } },
    include: { courier: true, order: { select: { id: true } } },
  });

  let applied = 0;
  for (const s of due) {
    // Skip carriers the aggregator does not serve rather than burning a request
    // that would answer `200 []` forever.
    if (!isTrackableCourier(s.courier?.code)) {
      await prisma.shipment.update({
        where: { id: s.id },
        data: { nextPollAt: null, trackingError: FAILURE_MESSAGE.UNSUPPORTED_COURIER },
      });
      continue;
    }
    try {
      const r = await refreshTracking(s.order.id, null);
      if (r.applied) applied += 1;
    } catch (e) {
      // One bad shipment must not stop the batch.
      console.error(`[courier] tracking poll failed for shipment ${s.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return { checked: due.length, applied };
}

/**
 * Periodic tracking poll. Mirrors `startWebhookRetryLoop`: bounded batch, errors
 * swallowed per tick, `unref()` so it never holds the process open at shutdown.
 */
export function startCourierTrackingLoop() {
  const timer = setInterval(
    () => {
      void pollDueShipments().catch(() => undefined);
    },
    POLL_INTERVAL_MINUTES * 60_000,
  );
  timer.unref();
  return timer;
}
