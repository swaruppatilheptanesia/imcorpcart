import fs from 'fs/promises';
import path from 'path';
import { CourierCode, DocumentSource, DocumentType, OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { PRIVATE_UPLOAD_DIR } from '../../config/document-upload';
import { applyTransit } from '../reseller.service';
import { recordPod } from '../order.service';
import { COURIER_LABELS } from '../pincode.service';
import {
  fetchLrCopy,
  fetchPod,
  generateAwb,
  hkdsConfigured,
  isTrackableCourier,
  lrCopySupported,
  courierFingerprint,
  mapTrackingStatus,
  podSupported,
  trackAwb,
  type HkdsFailure,
  type HkdsFile,
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
  /** False when the courier repeated its last answer — nothing was written. */
  recorded?: boolean;
  lastTrackedAt?: Date;
}

/**
 * Pull the carrier's view of one shipment and record what is NEW.
 *
 * Each courier answer is fingerprinted (status text + the courier's timestamp)
 * and compared with the last answer we recorded:
 *   • same answer  → nothing is written and no status moves, so the timeline
 *     keeps one entry per real scan and a stale answer can't undo a manual
 *     update staff made since;
 *   • new answer, new status → `applyTransit` writes the single event, carrying
 *     the courier's text, time and payload;
 *   • new answer, same or unmapped status → one event, status unchanged — the
 *     history still shows the scan ("Shipment Arrived at Facility").
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

  const mapped = mapTrackingStatus(res.data.status, courier);
  const now = new Date();
  // The carrier's own timestamp when we can read it; else when we asked.
  const occurredAt = res.data.occurredAt ?? now;
  const raw = res.data.raw as Prisma.InputJsonValue;

  const last = await prisma.shipmentTrackingEvent.findFirst({
    where: { shipmentId: shipment.id, raw: { not: Prisma.AnyNull } },
    orderBy: { createdAt: 'desc' },
    select: { raw: true },
  });
  const lastRaw = (last?.raw ?? null) as Record<string, unknown> | null;
  const isNew =
    !lastRaw ||
    courierFingerprint(lastRaw.status, lastRaw.statusUpdateDate) !==
      courierFingerprint(res.data.status, res.data.statusUpdateDate);

  const changed = isNew && mapped !== null && mapped !== shipment.status;
  if (isNew && !changed) {
    // A real scan that doesn't move the status (or one we can't map yet —
    // stored so the status sheet can be extended from real traffic).
    await prisma.shipmentTrackingEvent.create({
      data: { shipmentId: shipment.id, status: shipment.status, description: res.data.status, occurredAt, raw },
    });
  }
  if (changed) {
    // Hand the whole order to the shared fulfilment engine, exactly as the
    // manual admin form does — so status sync, cashback and the partner webhook
    // all happen identically whether a human or the courier drove it.
    const { shipment: _s, address: _a, ...rest } = order;
    // The carrier's own words ("Consignee Not Available") become the timeline
    // note, so staff see why — not just which bucket it fell into.
    await applyTransit({ ...rest, shipment }, { status: mapped, description: res.data.status }, actorId, {
      occurredAt,
      raw,
    });
    // Try for the proof of delivery straight away; if the carrier hasn't
    // published it yet, the POD poller keeps trying on its own schedule.
    if (mapped === ShipmentStatus.DELIVERED && podSupported(courier)) {
      void fetchCourierPod(order.id, null).catch(() => undefined);
    }
  }

  const settled = changed ? mapped : shipment.status;
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      lastTrackedAt: now,
      trackingError: null,
      // Stop scheduling once the carrier says it is done — delivered, or back
      // with the shipper (a RETURNED order refuses further transit anyway).
      // applyTransit already clears trackingActive on delivery.
      // Judged on where the shipment now stands, not on a repeated answer.
      ...(settled === ShipmentStatus.DELIVERED || settled === ShipmentStatus.RETURNED
        ? { nextPollAt: null, trackingActive: false }
        : { nextPollAt: dueAt(POLL_INTERVAL_MINUTES) }),
    },
  });

  return {
    ok: true,
    status: res.data.status,
    mapped,
    applied: changed,
    recorded: isNew,
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

// ─── Proof of delivery from the courier ──────────────────────────────────────
// DTDC and BlueDart publish the delivery proof some time after delivery. It is
// filed through the same `recordPod` as a staff upload, so the partner push and
// the order views behave identically; a POD that already exists (uploaded by
// staff, or fetched earlier) is never replaced.

const POD_MAX_ATTEMPTS = 8;
// Delay before the NEXT attempt, indexed by attempts made so far.
const POD_BACKOFF_MINUTES = [30, 60, 120, 240, 480, 720, 1440, 1440];
const POD_WINDOW_DAYS = 14; // carriers stop serving old proofs; don't ask forever
const POD_BATCH = 20;

const POD_MESSAGE: Partial<Record<HkdsFailure, string>> = {
  NO_DATA: 'The courier hasn\u2019t published the proof of delivery yet.',
  UNSUPPORTED_COURIER: 'This courier does not provide a proof of delivery through the courier service — upload it manually.',
  BAD_RESPONSE: 'The courier returned something that is not a PDF or image.',
};
const podMessage = (r: HkdsFailure) => POD_MESSAGE[r] ?? FAILURE_MESSAGE[r];

export interface PodFetchResult {
  ok: boolean;
  reason?: HkdsFailure;
  message?: string;
  fileName?: string;
  pushedToPartner?: boolean;
}

/**
 * Fetch the carrier's proof of delivery for a delivered order and file it.
 * `actorId` null = the background poller.
 */
export async function fetchCourierPod(orderId: string, actorId: string | null): Promise<PodFetchResult> {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id: orderId }, { orderNo: orderId }] },
    include: {
      shipment: { include: { courier: true } },
      documents: { where: { docType: DocumentType.POD }, select: { id: true }, take: 1 },
    },
  });
  if (!order) throw AppError.notFound('Order not found');
  const shipment = order.shipment;
  if (order.status !== OrderStatus.DELIVERED || !shipment) {
    throw AppError.badRequest('The proof of delivery is available once the order is delivered.');
  }
  if (!shipment.awbNumber) throw AppError.badRequest('This order has no AWB.');
  if (order.documents.length) throw AppError.badRequest('This order already has a proof of delivery.');
  const courier = shipment.courier?.code ?? null;
  if (!podSupported(courier)) {
    return { ok: false, reason: 'UNSUPPORTED_COURIER', message: podMessage('UNSUPPORTED_COURIER') };
  }

  const res = await fetchPod(shipment.awbNumber, courier);
  if (!res.ok) {
    const attempts = shipment.podFetchAttempts + 1;
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        podFetchAttempts: attempts,
        podNextFetchAt: attempts >= POD_MAX_ATTEMPTS ? null : dueAt(POD_BACKOFF_MINUTES[attempts - 1] ?? 1440),
        podFetchError: podMessage(res.reason),
      },
    });
    return { ok: false, reason: res.reason, message: podMessage(res.reason) };
  }

  const fileName = `${order.orderNo}-${shipment.awbNumber}-pod.${res.data.ext}`.replace(/[^A-Za-z0-9._-]/g, '_');
  const filePath = await writePrivate(fileName, res.data);
  const filed = await recordPod(order, {
    filePath,
    fileName,
    mimeType: res.data.mimeType,
    size: res.data.buffer.length,
    capturedAt: shipment.deliveredAt ?? new Date(),
    source: DocumentSource.COURIER,
    actorId,
    meta: { fetchedFrom: COURIER_LABELS[courier!] },
  });
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { podFetchError: null, podNextFetchAt: null },
  });
  await prisma.auditLog
    .create({
      data: {
        actorId,
        action: 'order.epod_fetched',
        entityType: 'Order',
        entityId: order.id,
        after: { awbNo: shipment.awbNumber, courier, fileName, documentId: filed.document.id },
      },
    })
    .catch(() => undefined);

  return { ok: true, fileName, pushedToPartner: filed.pushedToPartner };
}

/** Unique name under the private (non-static) document directory. */
async function writePrivate(fileName: string, file: HkdsFile): Promise<string> {
  const target = path.join(PRIVATE_UPLOAD_DIR, `${Date.now()}-${fileName}`);
  await fs.writeFile(target, file.buffer);
  return target;
}

/**
 * One POD-poller tick: delivered DTDC / BlueDart shipments with no proof yet,
 * delivered within the window, still under the attempt cap and due.
 */
export async function pollDuePods(): Promise<{ checked: number; filed: number }> {
  if (!hkdsConfigured()) return { checked: 0, filed: 0 };

  const due = await prisma.shipment.findMany({
    where: {
      status: ShipmentStatus.DELIVERED,
      awbNumber: { not: null },
      courier: { code: { in: [CourierCode.DTDC, CourierCode.BLUEDART] } },
      deliveredAt: { gte: new Date(Date.now() - POD_WINDOW_DAYS * 86_400_000) },
      podFetchAttempts: { lt: POD_MAX_ATTEMPTS },
      OR: [{ podNextFetchAt: null }, { podNextFetchAt: { lte: new Date() } }],
      order: { status: OrderStatus.DELIVERED, documents: { none: { docType: DocumentType.POD } } },
    },
    take: POD_BATCH,
    orderBy: { deliveredAt: 'desc' },
    select: { orderId: true },
  });

  let filed = 0;
  for (const s of due) {
    try {
      const r = await fetchCourierPod(s.orderId, null);
      if (r.ok) filed += 1;
    } catch (e) {
      console.error(`[courier] POD fetch failed for order ${s.orderId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { checked: due.length, filed };
}

/** Delhivery B2B LR copy, streamed through for staff. Never stored. */
export async function fetchOrderLrCopy(orderId: string): Promise<{ file: HkdsFile; fileName: string }> {
  const order = await loadOrder(orderId);
  const shipment = order.shipment;
  if (!shipment?.awbNumber) throw AppError.badRequest('This order has no LR number yet.');
  if (!lrCopySupported(shipment.courier?.code)) throw AppError.badRequest('An LR copy is only available for Delhivery B2B shipments.');
  const res = await fetchLrCopy(shipment.awbNumber);
  if (!res.ok) {
    if (res.reason === 'NO_DATA') throw AppError.notFound('Delhivery has no LR copy for this LR number yet.');
    throw AppError.badRequest(FAILURE_MESSAGE[res.reason]);
  }
  return { file: res.data, fileName: `${order.orderNo}-${shipment.awbNumber}-lr.${res.data.ext}` };
}

/**
 * Periodic tracking poll. Mirrors `startWebhookRetryLoop`: bounded batch, errors
 * swallowed per tick, `unref()` so it never holds the process open at shutdown.
 */
export function startCourierTrackingLoop() {
  const timer = setInterval(
    () => {
      // Status first, so a shipment that turns DELIVERED this tick is already
      // a POD candidate when the second pass runs.
      void pollDueShipments()
        .catch(() => undefined)
        .then(() => pollDuePods())
        .catch(() => undefined);
    },
    POLL_INTERVAL_MINUTES * 60_000,
  );
  timer.unref();
  return timer;
}
