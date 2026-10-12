import path from 'path';
import { DocumentType, OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PRIVATE_UPLOAD_DIR } from '../config/document-upload';
import { estimateDelivery } from './delivery.service';

// The one definition of what an order looks like to a partner.
//
// Both transports read from here: the pull endpoints (`GET /orders`,
// `/orders/:ref`, `/orders/:ref/epod`) and the outbound webhooks
// (`order.status`, `order.cancelled`, `order.epod`). Before this they each built
// their own object and disagreed — the pull returned the raw internal enum with
// no AWB, while the push sent a readable label with full shipment detail. A
// partner integrating against one and then the other found two different APIs.

// ── Status vocabulary ────────────────────────────────────────────────────────
// `code` is the stable machine value; `label` is the human string. Every order
// we hand a partner carries both, so a partner can switch on one and show the
// other without maintaining a mapping of its own.

export type PartnerStatusCode =
  | 'CONFIRMED'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'FAILED';

export interface PartnerStatus {
  code: PartnerStatusCode;
  label: string;
}

export const PARTNER_STATUS: Record<PartnerStatusCode, PartnerStatus> = {
  CONFIRMED: { code: 'CONFIRMED', label: 'Confirmed' },
  DISPATCHED: { code: 'DISPATCHED', label: 'Dispatched' },
  IN_TRANSIT: { code: 'IN_TRANSIT', label: 'In Transit' },
  OUT_FOR_DELIVERY: { code: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  DELIVERED: { code: 'DELIVERED', label: 'Delivered' },
  CANCELLED: { code: 'CANCELLED', label: 'Cancelled' },
  RETURNED: { code: 'RETURNED', label: 'Returned' },
  FAILED: { code: 'FAILED', label: 'Failed' },
};

// A partner has no notion of "placed vs confirmed" — both mean we have the order
// and nothing has shipped.
const FROM_ORDER: Record<OrderStatus, PartnerStatusCode> = {
  PLACED: 'CONFIRMED',
  CONFIRMED: 'CONFIRMED',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
};

const FROM_SHIPMENT: Record<ShipmentStatus, PartnerStatusCode> = {
  PENDING: 'CONFIRMED',
  DISPATCHED: 'DISPATCHED',
  IN_TRANSIT: 'IN_TRANSIT',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
};

export const partnerStatusFromOrder = (s: OrderStatus): PartnerStatus => PARTNER_STATUS[FROM_ORDER[s]];
export const partnerStatusFromShipment = (s: ShipmentStatus): PartnerStatus => PARTNER_STATUS[FROM_SHIPMENT[s]];

/**
 * The status we report for an order.
 *
 * The shipment wins when there is one: `Order.status` collapses `IN_TRANSIT` and
 * `OUT_FOR_DELIVERY` into a single `DISPATCHED`, so reading the order alone
 * cannot tell a partner whether the parcel is on a truck or at their door. A
 * cancelled or returned order short-circuits — that outcome is recorded on the
 * order and a stale shipment row must not override it.
 */
export function effectiveStatus(order: {
  status: OrderStatus;
  shipment?: { status: ShipmentStatus } | null;
}): PartnerStatus {
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.RETURNED) {
    return partnerStatusFromOrder(order.status);
  }
  return order.shipment ? partnerStatusFromShipment(order.shipment.status) : partnerStatusFromOrder(order.status);
}

// ── Selection ────────────────────────────────────────────────────────────────

/** Everything the view needs, and nothing a partner must not see. */
export const partnerOrderViewSelect = {
  id: true,
  // Scope fields — read by callers to confirm this really is the partner's
  // order. Deliberately not emitted by the view below.
  source: true,
  partnerId: true,
  orderNo: true,
  externalRef: true,
  checkoutGroup: true,
  status: true,
  dealerCode: true,
  dealerName: true,
  dealerMobile: true,
  deliveryInstructions: true,
  cancelReason: true,
  subtotal: true,
  total: true,
  createdAt: true,
  updatedAt: true,
  address: { select: { pincode: true, city: true, state: true } },
  shipment: {
    select: {
      id: true,
      status: true,
      awbNumber: true,
      dispatchedAt: true,
      deliveredAt: true,
      updatedAt: true,
      courier: { select: { name: true, code: true } },
    },
  },
  documents: {
    where: { docType: DocumentType.POD },
    select: { id: true, fileUrl: true, generatedAt: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  statusHistory: { select: { status: true, note: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
  items: {
    select: {
      quantity: true,
      unitPrice: true,
      lineTotal: true,
      shade: true,
      product: { select: { sku: true, name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

export type PartnerOrderPayload = Prisma.OrderGetPayload<{ select: typeof partnerOrderViewSelect }>;

export interface TimelineEntry {
  status: string;
  statusCode: PartnerStatusCode;
  at: string;
  note: string | null;
}

// ── The view ─────────────────────────────────────────────────────────────────

/**
 * Build the partner-facing view of one order.
 *
 * `etaCache` memoises the delivery estimate per pincode: a page of 25 orders to
 * the same city would otherwise run 25 identical lookups.
 */
export async function toPartnerOrderView(
  o: PartnerOrderPayload,
  opts: { etaCache?: Map<string, string | null>; timeline?: TimelineEntry[] } = {},
) {
  const status = effectiveStatus(o);
  const pod = o.documents[0] ?? null;
  const podMeta = (pod?.metadata ?? {}) as Record<string, unknown>;

  // No point quoting an ETA for something already delivered or closed.
  const terminal = status.code === 'DELIVERED' || status.code === 'CANCELLED' || status.code === 'RETURNED';
  let eta: string | null = null;
  const pincode = o.address?.pincode ?? null;
  if (!terminal && pincode) {
    if (opts.etaCache?.has(pincode)) {
      eta = opts.etaCache.get(pincode) ?? null;
    } else {
      const d = await estimateDelivery(pincode);
      eta = d.etaDate ? new Date(d.etaDate).toISOString() : null;
      opts.etaCache?.set(pincode, eta);
    }
  }

  // When the status last moved. The shipment is the finer-grained clock, and for
  // an order that never shipped the last status-history row is.
  const lastHistory = o.statusHistory[0]?.createdAt ?? null;
  const statusAt = o.shipment?.updatedAt ?? lastHistory ?? o.updatedAt;

  return {
    orderNo: o.orderNo,
    externalRef: o.externalRef,
    checkoutGroup: o.checkoutGroup,
    status: status.label,
    statusCode: status.code,
    statusAt: statusAt.toISOString(),
    dealerCode: o.dealerCode,
    dealerName: o.dealerName,
    dealerMobile: o.dealerMobile,
    deliveryInstructions: o.deliveryInstructions,
    remarks: o.cancelReason,
    pincode,
    city: o.address?.city ?? null,
    state: o.address?.state ?? null,
    awb: o.shipment?.awbNumber ?? null,
    courier: o.shipment?.courier?.name ?? null,
    courierCode: o.shipment?.courier?.code ?? null,
    tentativeDeliveryDate: eta,
    dispatchedAt: o.shipment?.dispatchedAt?.toISOString() ?? null,
    deliveredAt: o.shipment?.deliveredAt?.toISOString() ?? null,
    // Metadata only — the document itself is a separate call, so a list of 25
    // orders doesn't carry 25 base64 blobs.
    epod: pod
      ? {
          available: true,
          capturedAt: pod.generatedAt?.toISOString() ?? null,
          fileName: typeof podMeta.fileName === 'string' ? podMeta.fileName : null,
          mimeType: typeof podMeta.mimeType === 'string' ? podMeta.mimeType : null,
          url: `/orders/${encodeURIComponent(o.externalRef ?? o.orderNo)}/epod`,
        }
      : null,
    subtotal: Number(o.subtotal),
    total: Number(o.total),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: o.items.map((it) => ({
      sku: it.product.sku,
      name: it.product.name,
      colour: it.shade,
      quantity: it.quantity,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    })),
    ...(opts.timeline ? { timeline: opts.timeline } : {}),
  };
}

export type PartnerOrderView = Awaited<ReturnType<typeof toPartnerOrderView>>;

// ── Proof of delivery ────────────────────────────────────────────────────────

export interface PodFile {
  filePath: string;
  fileName: string;
  mimeType: string;
}

/**
 * Resolve a stored POD to a file on disk.
 *
 * Refuses anything that resolves outside the private upload directory, so a
 * tampered `fileUrl` can never be used to read an arbitrary file off the server.
 * Returns null rather than throwing — callers decide whether a missing document
 * is a 404 or just an absent field.
 */
export function resolvePodFile(doc: { fileUrl: string | null; metadata: Prisma.JsonValue } | null): PodFile | null {
  if (!doc?.fileUrl) return null;
  const resolved = path.resolve(doc.fileUrl);
  if (!resolved.startsWith(PRIVATE_UPLOAD_DIR + path.sep)) return null;
  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  return {
    filePath: resolved,
    fileName: typeof meta.fileName === 'string' ? meta.fileName : path.basename(resolved),
    mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'application/octet-stream',
  };
}

/**
 * The ePOD envelope, minus the document itself.
 *
 * The webhook adds `document: <base64>` at send time (via `materialisePayload`,
 * so a multi-MB blob isn't stored in the delivery log and replayed through six
 * retries); the pull endpoint adds it immediately. Same fields either way.
 */
export function buildEpodEnvelope(o: PartnerOrderPayload) {
  const pod = o.documents[0] ?? null;
  if (!pod?.fileUrl) return null;
  const meta = (pod.metadata ?? {}) as Record<string, unknown>;
  return {
    orderNo: o.orderNo,
    externalRef: o.externalRef,
    dealerCode: o.dealerCode,
    itemCodes: o.items.map((i) => i.product.sku),
    awb: o.shipment?.awbNumber ?? null,
    courier: o.shipment?.courier?.name ?? null,
    documentFileName: typeof meta.fileName === 'string' ? meta.fileName : null,
    documentMimeType: typeof meta.mimeType === 'string' ? meta.mimeType : null,
    capturedAt: pod.generatedAt?.toISOString() ?? null,
    deliveredAt: o.shipment?.deliveredAt?.toISOString() ?? null,
    checkoutGroup: o.checkoutGroup,
    fileUrl: pod.fileUrl,
  };
}
