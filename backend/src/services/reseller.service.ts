import { Prisma, OrderStatus, ShipmentStatus, ProductStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { parsePagination, pageMeta } from '../utils/pagination';
import {
  notDeleted,
  offerSelect,
  orderListSelect,
  orderFullInclude,
  couponInclude,
} from '../models/selectors';
import { serialize, toNumber } from '../models/serializers';
import { resolveResellerId } from '../utils/scope';
import { ensureOwnedGift } from './product-write';
import { creditWallet } from './shop.service';
import type {
  ResellerListQuery,
  TransitUpdateInput,
  ResellerOfferUpdateInput,
  ResellerBulkOffersInput,
  ResellerFreeGiftInput,
  ResellerFreeGiftUpdateInput,
} from '../validators/reseller.schema';

const D = (n: number) => new Prisma.Decimal(n);

const REALISED: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.DISPATCHED,
  OrderStatus.DELIVERED,
];

const BUCKET_STATUSES: Record<string, OrderStatus[]> = {
  active: [OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED],
  delivered: [OrderStatus.DELIVERED],
  cancelled: [OrderStatus.CANCELLED, OrderStatus.RETURNED],
};

// Map a shipment status onto the coarser order status vocabulary.
const ORDER_FOR_SHIPMENT: Partial<Record<ShipmentStatus, OrderStatus>> = {
  PENDING: OrderStatus.CONFIRMED,
  DISPATCHED: OrderStatus.DISPATCHED,
  IN_TRANSIT: OrderStatus.DISPATCHED,
  OUT_FOR_DELIVERY: OrderStatus.DISPATCHED,
  DELIVERED: OrderStatus.DELIVERED,
  RETURNED: OrderStatus.RETURNED,
};

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  const resellerId = await resolveResellerId(userId);
  const reseller = await prisma.reseller.findUnique({
    where: { id: resellerId },
    include: { _count: { select: { offers: true, orders: true, coupons: true } } },
  });
  if (!reseller) throw AppError.notFound('Reseller not found');
  return serialize({
    id: reseller.id,
    name: reseller.name,
    gstin: reseller.gstin,
    contactEmail: reseller.contactEmail,
    contactPhone: reseller.contactPhone,
    status: reseller.status,
    productCount: reseller._count.offers,
    orderCount: reseller._count.orders,
    couponCount: reseller._count.coupons,
  });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export async function getDashboard(userId: string) {
  const resellerId = await resolveResellerId(userId);
  const orderWhere = { resellerId, status: { in: REALISED } };

  const [agg, orderVolume, deliveredCount, productCount, bestSellersRaw, topCustomersRaw, wishlistRaw, recentForSpark] =
    await Promise.all([
      prisma.order.aggregate({ where: orderWhere, _sum: { total: true } }),
      prisma.order.count({ where: orderWhere }),
      prisma.order.count({ where: { resellerId, status: OrderStatus.DELIVERED } }),
      // Products this reseller sells = the count of its live offers.
      prisma.productOffer.count({ where: { resellerId, ...notDeleted } }),
      prisma.orderItem.groupBy({
        by: ['productId'],
        where: { order: orderWhere },
        _sum: { quantity: true, lineTotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      prisma.order.groupBy({
        by: ['companyId'],
        where: orderWhere,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      prisma.wishlistItem.groupBy({
        by: ['productId'],
        where: { product: { offers: { some: { resellerId, ...notDeleted } } } },
        _count: { _all: true },
        orderBy: { _count: { productId: 'desc' } },
        take: 5,
      }),
      prisma.order.findMany({
        where: orderWhere,
        orderBy: { createdAt: 'asc' },
        take: 12,
        select: { total: true },
      }),
    ]);

  const [products, companies, wishProducts] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: bestSellersRaw.map((b) => b.productId) } },
      select: { id: true, name: true },
    }),
    prisma.company.findMany({
      where: { id: { in: topCustomersRaw.map((c) => c.companyId) } },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { id: { in: wishlistRaw.map((w) => w.productId) } },
      select: { id: true, name: true },
    }),
  ]);
  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? 'Unknown';

  return serialize({
    stats: {
      salesValue: toNumber(agg._sum.total),
      orderVolume,
      deliveredPct: orderVolume ? Math.round((deliveredCount / orderVolume) * 100) : 0,
      productCount,
    },
    spark: recentForSpark.map((o) => toNumber(o.total)),
    bestSellers: bestSellersRaw.map((b) => ({
      productId: b.productId,
      name: nameOf(products, b.productId),
      units: b._sum.quantity ?? 0,
      value: toNumber(b._sum.lineTotal),
    })),
    topCustomers: topCustomersRaw.map((c) => ({
      companyId: c.companyId,
      name: nameOf(companies, c.companyId),
      spend: toNumber(c._sum.total),
    })),
    mostWishlisted: wishlistRaw.map((w) => ({
      productId: w.productId,
      name: nameOf(wishProducts, w.productId),
      saves: w._count._all,
    })),
  });
}

// ─── Offers / coupons ────────────────────────────────────────────────────────

// The reseller's own marketplace offers, each with the (read-only) product
// master it sells. The product itself is authored by the Super Admin.
const myOfferSelect = {
  id: true,
  eppPrice: true,
  resellerPrice: true,
  smartEppPrice: true,
  quantity: true,
  freeGiftId: true,
  status: true,
  isActive: true,
  createdAt: true,
  product: {
    select: {
      id: true,
      sku: true,
      name: true,
      brand: true,
      mrp: true,
      mop: true,
      subCategory: true,
      status: true,
      category: { select: { id: true, name: true, slug: true } },
      images: { orderBy: { position: 'asc' }, take: 1, select: { url: true } },
    },
  },
} satisfies Prisma.ProductOfferSelect;

type MyOfferRow = Prisma.ProductOfferGetPayload<{ select: typeof myOfferSelect }>;

function toResellerOffer(o: MyOfferRow) {
  return {
    offerId: o.id,
    productId: o.product.id,
    sku: o.product.sku,
    name: o.product.name,
    brand: o.product.brand ?? '',
    category: o.product.category.slug,
    categoryName: o.product.category.name,
    subCategory: o.product.subCategory ?? '',
    productStatus: o.product.status,
    mrp: o.product.mrp,
    mop: o.product.mop, // read-only (admin-set public price)
    eppPrice: o.eppPrice, // customer price (shopper pays)
    resellerPrice: o.resellerPrice, // reseller's own price; commission = eppPrice − resellerPrice
    smartEppPrice: o.smartEppPrice,
    quantity: o.quantity,
    freeGiftId: o.freeGiftId,
    status: o.status,
    isActive: o.isActive,
    image: o.product.images[0]?.url ?? null,
  };
}

export async function listMyOffers(userId: string, query: ResellerListQuery) {
  const resellerId = await resolveResellerId(userId);
  const p = parsePagination(query);
  const q = query.q?.trim();

  const where: Prisma.ProductOfferWhereInput = {
    resellerId,
    ...notDeleted,
    ...(query.status ? { status: query.status } : {}),
    product: {
      ...notDeleted,
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] }
        : {}),
    },
  };

  const [rows, total] = await prisma.$transaction([
    prisma.productOffer.findMany({
      where,
      select: myOfferSelect,
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.productOffer.count({ where }),
  ]);
  return { data: serialize(rows.map(toResellerOffer)), meta: pageMeta(total, p) };
}

export async function getMyOffer(userId: string, offerId: string) {
  const resellerId = await resolveResellerId(userId);
  const offer = await prisma.productOffer.findFirst({
    where: { id: offerId, resellerId, ...notDeleted },
    select: myOfferSelect,
  });
  if (!offer) throw AppError.notFound('Offer not found');
  return serialize(toResellerOffer(offer));
}

export async function updateMyOffer(userId: string, offerId: string, input: ResellerOfferUpdateInput) {
  const resellerId = await resolveResellerId(userId);
  const existing = await prisma.productOffer.findFirst({ where: { id: offerId, resellerId, ...notDeleted } });
  if (!existing) throw AppError.notFound('Offer not found');

  const freeGiftId =
    input.freeGiftId === undefined ? undefined : await ensureOwnedGift(resellerId, input.freeGiftId);

  // Pricing an offer for the first time promotes it out of DRAFT.
  const nextEpp = input.eppPrice ?? toNumber(existing.eppPrice);
  const nextResellerPrice =
    input.resellerPrice ?? (existing.resellerPrice != null ? toNumber(existing.resellerPrice) : 0);
  // Customer price must cover the reseller's price (commission can't be negative).
  if (nextResellerPrice > 0 && nextEpp < nextResellerPrice) {
    throw new AppError(422, 'PRICE_INVALID', 'Customer price must be at least your price');
  }
  const status =
    existing.status === ProductStatus.DRAFT && nextEpp > 0 ? ProductStatus.ACTIVE : existing.status;

  const updated = await prisma.productOffer.update({
    where: { id: offerId },
    data: {
      ...(input.eppPrice !== undefined ? { eppPrice: D(input.eppPrice) } : {}),
      ...(input.resellerPrice !== undefined ? { resellerPrice: D(input.resellerPrice) } : {}),
      ...(input.smartEppPrice !== undefined ? { smartEppPrice: D(input.smartEppPrice) } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(freeGiftId !== undefined ? { freeGiftId } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      status,
    },
    select: myOfferSelect,
  });
  return serialize(toResellerOffer(updated));
}

// Every offer for this reseller, unpaginated — powers the bulk-update CSV export.
export async function listAllMyOffers(userId: string) {
  const resellerId = await resolveResellerId(userId);
  const rows = await prisma.productOffer.findMany({
    where: { resellerId, ...notDeleted, product: notDeleted },
    select: myOfferSelect,
    orderBy: { product: { name: 'asc' } },
  });
  return { data: serialize(rows.map(toResellerOffer)) };
}

// Bulk stock & price update from an uploaded CSV — each row is matched to this
// reseller's own offer by product SKU; only provided fields change. Same guards
// as updateMyOffer (customer ≥ reseller price; pricing a DRAFT > 0 → ACTIVE).
export async function bulkUpdateMyOffers(userId: string, rows: ResellerBulkOffersInput['rows']) {
  const resellerId = await resolveResellerId(userId);
  const offers = await prisma.productOffer.findMany({
    where: { resellerId, ...notDeleted, product: notDeleted },
    select: { id: true, eppPrice: true, resellerPrice: true, quantity: true, status: true, product: { select: { sku: true } } },
  });
  const bySku = new Map(offers.map((o) => [o.product.sku.trim().toLowerCase(), o]));

  const errors: { sku: string; reason: string }[] = [];
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let skipped = 0;

  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  for (const row of rows) {
    const offer = bySku.get(row.sku.trim().toLowerCase());
    if (!offer) {
      errors.push({ sku: row.sku, reason: `SKU "${row.sku}" is not in your listings` });
      skipped += 1;
      continue;
    }
    // Nothing to change on this row.
    if (row.reseller_price === undefined && row.customer_price === undefined && row.stock_quantity === undefined) {
      errors.push({ sku: row.sku, reason: 'No reseller_price, customer_price or stock_quantity provided' });
      skipped += 1;
      continue;
    }
    const nextEpp = row.customer_price ?? toNumber(offer.eppPrice);
    const nextResellerPrice =
      row.reseller_price ?? (offer.resellerPrice != null ? toNumber(offer.resellerPrice) : 0);
    if (nextResellerPrice > 0 && nextEpp < nextResellerPrice) {
      errors.push({
        sku: row.sku,
        reason: `Customer price ${inr(nextEpp)} is below your reseller price ${inr(nextResellerPrice)}`,
      });
      skipped += 1;
      continue;
    }
    const status =
      offer.status === ProductStatus.DRAFT && nextEpp > 0 ? ProductStatus.ACTIVE : offer.status;
    writes.push(
      prisma.productOffer.update({
        where: { id: offer.id },
        data: {
          ...(row.customer_price !== undefined ? { eppPrice: D(row.customer_price) } : {}),
          ...(row.reseller_price !== undefined ? { resellerPrice: D(row.reseller_price) } : {}),
          ...(row.stock_quantity !== undefined ? { quantity: row.stock_quantity } : {}),
          status,
        },
      }),
    );
  }

  if (writes.length) await prisma.$transaction(writes);
  return { total: rows.length, updated: writes.length, skipped, errors };
}

export async function listCoupons(userId: string) {
  const resellerId = await resolveResellerId(userId);
  const rows = await prisma.coupon.findMany({
    where: { resellerId },
    orderBy: { createdAt: 'desc' },
    include: couponInclude,
  });
  return { data: serialize(rows) };
}

// ─── Free gifts (reseller-managed complimentary items) ───────────────────────

export async function listFreeGifts(userId: string) {
  const resellerId = await resolveResellerId(userId);
  const rows = await prisma.freeGift.findMany({
    where: { resellerId, ...notDeleted },
    orderBy: { createdAt: 'desc' },
  });
  return { data: serialize(rows) };
}

export async function createFreeGift(userId: string, input: ResellerFreeGiftInput) {
  const resellerId = await resolveResellerId(userId);
  const gift = await prisma.freeGift.create({
    data: {
      resellerId,
      title: input.title,
      description: input.description ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return serialize(gift);
}

export async function updateFreeGift(userId: string, id: string, input: ResellerFreeGiftUpdateInput) {
  const resellerId = await resolveResellerId(userId);
  const existing = await prisma.freeGift.findFirst({ where: { id, resellerId, ...notDeleted } });
  if (!existing) throw AppError.notFound('Free gift not found');
  const gift = await prisma.freeGift.update({
    where: { id },
    data: { title: input.title, description: input.description, isActive: input.isActive },
  });
  return serialize(gift);
}

// ─── Orders + transit ────────────────────────────────────────────────────────

export async function listOrders(userId: string, query: ResellerListQuery) {
  const resellerId = await resolveResellerId(userId);
  const p = parsePagination(query);

  const where: Prisma.OrderWhereInput = { resellerId };
  if (query.bucket && query.bucket !== 'all') where.status = { in: BUCKET_STATUSES[query.bucket] };

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

export async function getOrder(userId: string, id: string) {
  const resellerId = await resolveResellerId(userId);
  const order = await prisma.order.findFirst({
    where: { resellerId, OR: [{ id }, { orderNo: id }] },
    include: orderFullInclude,
  });
  if (!order) throw AppError.notFound('Order not found');
  return serialize(order);
}

export async function updateTransit(userId: string, id: string, input: TransitUpdateInput) {
  const resellerId = await resolveResellerId(userId);

  const order = await prisma.order.findFirst({
    where: { resellerId, OR: [{ id }, { orderNo: id }] },
    include: { shipment: true },
  });
  if (!order) throw AppError.notFound('Order not found');
  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.RETURNED) {
    throw AppError.badRequest(`Cannot update transit on a ${order.status} order`);
  }

  // Resolve an optional courier by code.
  let courierId: string | undefined;
  if (input.courierCode) {
    const courier = await prisma.courier.findUnique({ where: { code: input.courierCode }, select: { id: true } });
    courierId = courier?.id;
  }

  const now = new Date();
  const isDelivered = input.status === ShipmentStatus.DELIVERED;
  const isDispatch =
    input.status === ShipmentStatus.DISPATCHED ||
    input.status === ShipmentStatus.IN_TRANSIT ||
    input.status === ShipmentStatus.OUT_FOR_DELIVERY;

  const nextOrderStatus = ORDER_FOR_SHIPMENT[input.status];

  await prisma.$transaction(async (tx) => {
    // Upsert the shipment (partner optional — reseller self-fulfils).
    const shipmentData = {
      status: input.status,
      ...(input.awbNumber ? { awbNumber: input.awbNumber } : {}),
      ...(courierId ? { courierId } : {}),
      ...(isDispatch && !order.shipment?.dispatchedAt ? { dispatchedAt: now } : {}),
      ...(isDelivered ? { deliveredAt: now, trackingActive: false } : {}),
    };
    const shipment = order.shipment
      ? await tx.shipment.update({ where: { id: order.shipment.id }, data: shipmentData })
      : await tx.shipment.create({ data: { orderId: order.id, ...shipmentData } });

    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: shipment.id,
        status: input.status,
        description: input.description ?? defaultTransitNote(input.status),
        occurredAt: now,
      },
    });

    // Sync the order status + history when it advances.
    if (nextOrderStatus && nextOrderStatus !== order.status) {
      await tx.order.update({ where: { id: order.id }, data: { status: nextOrderStatus } });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: nextOrderStatus,
          changedById: userId,
          note: input.description ?? `Transit: ${input.status}`,
        },
      });
    }

    // On delivery, credit the order's cashback to the shopper's wallet — once
    // (idempotent: skip if an EARN entry already references this order).
    const cashback = toNumber(order.cashbackEarned);
    if (isDelivered && cashback > 0) {
      const already = await tx.walletLedgerEntry.findFirst({
        where: { type: 'EARN', referenceType: 'ORDER', referenceId: order.id },
        select: { id: true },
      });
      if (!already) {
        await creditWallet(tx, order.employeeId, cashback, {
          referenceType: 'ORDER',
          referenceId: order.id,
          note: `Cashback for delivered order ${order.orderNo}`,
        });
      }
    }
  });

  return getOrder(userId, order.id);
}

function defaultTransitNote(status: ShipmentStatus): string {
  switch (status) {
    case ShipmentStatus.PENDING:
      return 'Order packed';
    case ShipmentStatus.DISPATCHED:
      return 'Shipment dispatched';
    case ShipmentStatus.IN_TRANSIT:
      return 'In transit';
    case ShipmentStatus.OUT_FOR_DELIVERY:
      return 'Out for delivery';
    case ShipmentStatus.DELIVERED:
      return 'Delivered';
    case ShipmentStatus.FAILED:
      return 'Delivery failed';
    case ShipmentStatus.RETURNED:
      return 'Returned to origin';
  }
}
