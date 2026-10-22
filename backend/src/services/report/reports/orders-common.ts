import { Prisma, DocumentType } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { MODE_LABELS } from '../../pincode.service';
import { dateWhere, resolvePeriod, type ReportPeriod } from '../../../utils/date-range';
import { pageAll, keyset } from '../chunk';

/**
 * Shared row-building for both Orders reports.
 *
 * ONE ROW PER ORDER LINE ITEM. The client's column lists are line-level —
 * `Product` is singular and sits beside `Buyer Name` — and a joined
 * "iPhone | AirPods | Case" cell cannot be filtered, pivoted or counted, which
 * is the first thing anyone does with an orders extract. Order-level fields
 * (Order ID, Address, AWB) repeat down the lines, as in any denormalised
 * extract.
 *
 * We page over ORDERS and flat-map their items: keysetting `order_items`
 * directly would mean ordering by a relation field, which breaks Prisma's
 * cursor. The pre-flight count therefore counts order_items, which is the
 * number of rows actually emitted.
 */

export const orderReportInclude = {
  company: { select: { name: true } },
  reseller: { select: { name: true } },
  employee: { select: { user: { select: { fullName: true, phone: true } } } },
  address: {
    select: { contactName: true, contactPhone: true, line1: true, line2: true, city: true, state: true, pincode: true },
  },
  shipment: {
    select: {
      awbNumber: true,
      dispatchedAt: true,
      deliveredAt: true,
      deliveryMode: true,
      courier: { select: { name: true } },
      fulfillmentPartner: { select: { name: true } },
    },
  },
  // Bounded: we only need to know whether a POD exists and why it was flagged.
  documents: {
    where: { docType: DocumentType.POD },
    select: { issueNote: true, metadata: true },
    take: 1,
  },
  items: {
    select: {
      id: true,
      quantity: true,
      product: { select: { name: true, sku: true, deliveryMode: true } },
    },
  },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderReportInclude }>;

/** The superset both Orders descriptors pick their columns from. */
export interface OrderLineRow {
  id: string;
  orderNo: string;
  createdAt: Date;
  product: string;
  quantity: number;
  vendor: string;
  company: string;
  buyerName: string;
  buyerPhone: string;
  status: string;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  courier: string;
  deliveryMode: string;
  address: string;
  pincode: string;
  awb: string;
  hasPod: boolean;
  podNote: string;
}

export interface OrderFilters {
  period: ReportPeriod;
  from?: Date;
  to?: Date;
  status?: string;
  resellerId?: string;
}

export function orderWhere(f: OrderFilters): Prisma.OrderWhereInput {
  const created = dateWhere(resolvePeriod(f.period, { from: f.from, to: f.to }));
  return {
    ...(created ? { createdAt: created } : {}),
    ...(f.status && f.status !== 'all' ? { status: f.status as Prisma.OrderWhereInput['status'] } : {}),
    ...(f.resellerId && f.resellerId !== 'all' ? { resellerId: f.resellerId } : {}),
  };
}

/** Rows emitted = order lines, not orders. */
export function countOrderLines(f: OrderFilters): Promise<number> {
  return prisma.orderItem.count({ where: { order: orderWhere(f) } });
}

function flattenAddress(a: OrderRow['address']): string {
  if (!a) return '';
  return [a.line1, a.line2, a.city, a.state].filter((x) => x && String(x).trim()).join(', ');
}

function toLines(o: OrderRow): OrderLineRow[] {
  const pod = o.documents[0] ?? null;
  // The old path wrote an operator note into metadata JSON; `issueNote` is the
  // real column. Read both so rows predating the column still report.
  const podNote =
    pod?.issueNote ??
    (pod?.metadata && typeof pod.metadata === 'object' && !Array.isArray(pod.metadata)
      ? ((pod.metadata as { note?: string }).note ?? '')
      : '') ??
    '';

  // A partner-sourced order has no internal employee, so the dealer who placed
  // it is the buyer of record.
  const buyerName = o.employee?.user.fullName ?? o.address?.contactName ?? o.dealerName ?? '';
  const buyerPhone = o.address?.contactPhone ?? o.employee?.user.phone ?? o.dealerMobile ?? '';

  return o.items.map((it) => ({
    id: it.id,
    orderNo: o.orderNo,
    createdAt: o.createdAt,
    product: it.product?.name ?? '',
    quantity: it.quantity,
    vendor: o.reseller?.name ?? 'First-party (house)',
    company: o.company?.name ?? o.dealerName ?? '',
    buyerName,
    buyerPhone,
    status: o.status,
    dispatchedAt: o.shipment?.dispatchedAt ?? null,
    deliveredAt: o.shipment?.deliveredAt ?? null,
    courier: o.shipment?.courier?.name ?? o.shipment?.fulfillmentPartner?.name ?? '',
    // What actually shipped, falling back to the product's preferred mode when
    // the parcel predates that field being captured at dispatch.
    deliveryMode: modeLabel(o.shipment?.deliveryMode ?? it.product?.deliveryMode ?? null),
    address: flattenAddress(o.address),
    pincode: o.address?.pincode ?? '',
    awb: o.shipment?.awbNumber ?? '',
    hasPod: !!pod,
    podNote,
  }));
}

const modeLabel = (m: keyof typeof MODE_LABELS | null): string => (m ? MODE_LABELS[m] : '');

/** Pages of order lines for the given filters. */
export async function* fetchOrderLines(f: OrderFilters): AsyncGenerator<OrderLineRow[], void, void> {
  for await (const page of pageAll((cursor) =>
    prisma.order.findMany({
      where: orderWhere(f),
      include: orderReportInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...keyset(cursor),
    }),
  )) {
    yield page.flatMap(toLines);
  }
}
