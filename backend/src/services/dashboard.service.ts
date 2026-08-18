import { OrderStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { toNumber } from '../models/serializers';
import type { DashboardRange } from '../validators/dashboard.schema';

// Resolve a range label to a [from, now] window. QTD/YTD are approximated from
// the current time without Date.now-in-workflow constraints (this is app code).
function rangeWindow(range: DashboardRange): { from: Date; now: Date } {
  const now = new Date();
  const from = new Date(now);
  switch (range) {
    case '7D':
      from.setDate(now.getDate() - 7);
      break;
    case '30D':
      from.setDate(now.getDate() - 30);
      break;
    case 'QTD': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      from.setMonth(q, 1);
      from.setHours(0, 0, 0, 0);
      break;
    }
    case 'YTD':
      from.setMonth(0, 1);
      from.setHours(0, 0, 0, 0);
      break;
  }
  return { from, now };
}

// Statuses that count toward realised GMV (exclude cancelled/returned).
const REALISED: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
];

export async function getDashboard(range: DashboardRange) {
  const { from, now } = rangeWindow(range);
  const windowWhere = { createdAt: { gte: from, lte: now }, status: { in: REALISED } };

  const [
    agg,
    orderCount,
    topCompaniesRaw,
    topProductsRaw,
    partnersRaw,
    wishlistRaw,
    recentOrders,
    deliveryBuckets,
  ] = await Promise.all([
    prisma.order.aggregate({ where: windowWhere, _sum: { total: true, subtotal: true } }),
    prisma.order.count({ where: windowWhere }),

    // Top companies by realised spend.
    prisma.order.groupBy({
      by: ['companyId'],
      where: windowWhere,
      _sum: { total: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    }),

    // Top products by units ordered (join items to in-window orders).
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: windowWhere },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 6,
    }),

    // Fulfillment partners by shipment count.
    prisma.shipment.groupBy({
      by: ['fulfillmentPartnerId'],
      _count: { _all: true },
      orderBy: { _count: { fulfillmentPartnerId: 'desc' } },
      take: 6,
    }),

    // Most-wishlisted products.
    prisma.wishlistItem.groupBy({
      by: ['productId'],
      _count: { _all: true },
      orderBy: { _count: { productId: 'desc' } },
      take: 5,
    }),

    prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        orderNo: true,
        status: true,
        total: true,
        company: { select: { name: true } },
        items: { take: 1, select: { product: { select: { name: true } } } },
      },
    }),

    prisma.shipment.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  // Resolve names for the grouped ids.
  const [companies, products, partners] = await Promise.all([
    prisma.company.findMany({
      where: { id: { in: topCompaniesRaw.map((c) => c.companyId) } },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { id: { in: topProductsRaw.map((p) => p.productId) } },
      select: { id: true, name: true },
    }),
    prisma.fulfillmentPartner.findMany({
      where: {
        id: { in: partnersRaw.map((p) => p.fulfillmentPartnerId).filter((x): x is string => x !== null) },
      },
      select: { id: true, name: true },
    }),
  ]);
  const wishProducts = await prisma.product.findMany({
    where: { id: { in: wishlistRaw.map((w) => w.productId) } },
    select: { id: true, name: true },
  });

  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? 'Unknown';

  const gmv = toNumber(agg._sum.total);
  const subtotal = toNumber(agg._sum.subtotal);
  const grandTotal = topCompaniesRaw.reduce((s, c) => s + toNumber(c._sum.total), 0);

  return {
    range,
    window: { from: from.toISOString(), to: now.toISOString() },
    stats: {
      gmv,
      orders: orderCount,
      avgOrderValue: orderCount ? Math.round((gmv / orderCount) * 100) / 100 : 0,
      // Margin proxy: total - subtotal (surcharge/gst); real margin needs cost basis.
      grossMargin: Math.round((gmv - subtotal) * 100) / 100,
    },
    topCompanies: topCompaniesRaw.map((c) => {
      const spend = toNumber(c._sum.total);
      return {
        companyId: c.companyId,
        name: nameOf(companies, c.companyId),
        spend,
        pct: grandTotal ? Math.round((spend / grandTotal) * 100) : 0,
      };
    }),
    topProducts: topProductsRaw.map((p) => ({
      productId: p.productId,
      name: nameOf(products, p.productId),
      units: p._sum.quantity ?? 0,
      value: toNumber(p._sum.lineTotal),
    })),
    partners: partnersRaw
      .filter((p): p is typeof p & { fulfillmentPartnerId: string } => p.fulfillmentPartnerId !== null)
      .map((p) => ({
        partnerId: p.fulfillmentPartnerId,
        name: nameOf(partners, p.fulfillmentPartnerId),
        shipments: p._count._all,
      })),
    topWishlisted: wishlistRaw.map((w) => ({
      productId: w.productId,
      name: nameOf(wishProducts, w.productId),
      saves: w._count._all,
    })),
    recentOrders: recentOrders.map((o) => ({
      id: o.orderNo,
      company: o.company.name,
      product: o.items[0]?.product.name ?? '—',
      value: toNumber(o.total),
      status: o.status,
    })),
    deliveryDonut: deliveryBuckets.map((b) => ({ status: b.status, count: b._count._all })),
  };
}
