import { Prisma, OrderStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { parsePagination, pageMeta } from '../utils/pagination';
import { orderListSelect, orderFullInclude } from '../models/selectors';
import { serialize } from '../models/serializers';
import { applyTransit } from './reseller.service';
import type { OrderListQuery, OverrideStatusInput } from '../validators/order.schema';
import type { TransitUpdateInput } from '../validators/reseller.schema';

// The coarse buckets the Orders screen filters by.
const BUCKET_STATUSES: Record<string, OrderStatus[]> = {
  active: [OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED],
  delivered: [OrderStatus.DELIVERED],
  cancelled: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
};

export async function listOrders(query: OrderListQuery) {
  const p = parsePagination(query);
  const where: Prisma.OrderWhereInput = {};

  if (query.status) {
    where.status = query.status;
  } else if (query.bucket && query.bucket !== 'all') {
    where.status = { in: BUCKET_STATUSES[query.bucket] };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      select: orderListSelect,
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.order.count({ where }),
  ]);

  return { data: serialize(rows), meta: pageMeta(total, p) };
}

export async function getOrder(id: string) {
  // Accept either the cuid `id` or the human `orderNo` (frontend routes by number).
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNo: id }] },
    include: orderFullInclude,
  });
  if (!order) throw AppError.notFound('Order not found');
  return serialize(order);
}

// Guard against nonsensical status jumps (e.g. re-opening a delivered order).
const TERMINAL: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.RETURNED];

export async function overrideStatus(id: string, input: OverrideStatusInput, actorId: string) {
  const order = await prisma.order.findFirst({ where: { OR: [{ id }, { orderNo: id }] } });
  if (!order) throw AppError.notFound('Order not found');
  if (order.status === input.status) {
    throw AppError.badRequest(`Order is already ${input.status}`);
  }
  if (TERMINAL.includes(order.status)) {
    throw AppError.badRequest(`Cannot change status of a ${order.status} order`);
  }

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { status: input.status } }),
    prisma.orderStatusHistory.create({
      data: { orderId: order.id, status: input.status, changedById: actorId, note: input.note },
    }),
  ]);

  return getOrder(order.id);
}

// Admin-driven fulfilment: update the real shipment/transit status for ANY order
// (in particular house/first-party vendor orders, which have no reseller to do
// it). Reuses the reseller portal's transit engine (shipment upsert + Order.status
// sync + tracking events + cashback + partner webhook), unscoped.
export async function updateTransit(id: string, input: TransitUpdateInput, actorId: string) {
  const order = await prisma.order.findFirst({
    where: { OR: [{ id }, { orderNo: id }] },
    include: { shipment: true },
  });
  if (!order) throw AppError.notFound('Order not found');
  await applyTransit(order, input, actorId);
  return getOrder(order.id);
}

export async function cancelOrder(id: string, note: string | undefined, actorId: string) {
  const order = await prisma.order.findFirst({ where: { OR: [{ id }, { orderNo: id }] } });
  if (!order) throw AppError.notFound('Order not found');
  if (order.status === OrderStatus.CANCELLED) throw AppError.badRequest('Order is already cancelled');
  if (order.status === OrderStatus.DELIVERED) throw AppError.badRequest('Delivered orders cannot be cancelled');

  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.CANCELLED } }),
    prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: OrderStatus.CANCELLED,
        changedById: actorId,
        note: note ?? 'Cancelled by admin',
      },
    }),
  ]);

  return getOrder(order.id);
}
