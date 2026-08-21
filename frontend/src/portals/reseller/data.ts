/** Reseller portal accessors — now LIVE. Each fetches from the reseller-scoped
 *  API and adapts the DB shape to the fixture-shaped types the screens render,
 *  so the screens themselves barely changed. */

import * as api from '@/data/reseller-api';
import { gradientFor, compactInr, fmtDate } from '@/data/map';
import { group } from '@/lib/format';
import type {
  ResellerDashboard,
  ResellerCoupon,
  RankedProduct,
  StoreOrderStatus,
} from '@/data/store-types';

const rank = (id: string, name: string, metric: string): RankedProduct => {
  const [g1, g2] = gradientFor(id);
  return { name, g1, g2, metric };
};

export async function getResellerDashboard(): Promise<ResellerDashboard> {
  const d = await api.getDashboard();
  return {
    salesValue: compactInr(d.stats.salesValue),
    salesDelta: '',
    orderVolume: group(d.stats.orderVolume),
    orderDelta: `${group(d.stats.orderVolume)} orders`,
    spark: d.spark.length ? d.spark : [0, 0],
    deliveryPct: `${d.stats.deliveredPct}%`,
    deliveryNote: `${d.stats.productCount} products listed`,
    bestSellers: d.bestSellers.map((b) => rank(b.productId, b.name, `${b.units} sold`)),
    worstSellers: [],
    topCustomers: d.topCustomers.map((c) => ({ name: c.name, spend: compactInr(c.spend) })),
    mostWishlisted: d.mostWishlisted.map((w) => rank(w.productId, w.name, `${w.saves} saves`)),
  };
}

export interface ResellerOfferQuery {
  q?: string;
  group?: 'all' | 'phones' | 'accessories' | 'bags';
  status?: 'all' | 'active' | 'draft' | 'inactive';
}

// One row per reseller offer — the (read-only) product master + this reseller's
// editable price/stock listing.
export interface ResellerOfferRow {
  offerId: string;
  productId: string;
  name: string;
  sku: string;
  brand: string;
  cat: string; // category slug
  categoryName: string;
  subCategory: string;
  productStatus: string;
  mrp: number;
  eppPrice: number; // customer price (shopper pays)
  resellerPrice: number | null; // reseller's own price
  smartEppPrice: number | null;
  mop: number | null;
  quantity: number;
  freeGiftId: string | null;
  status: string;
  isActive: boolean;
  image: string | null;
  g1: string;
  g2: string;
}

function toOfferRow(o: api.ResellerOfferApi): ResellerOfferRow {
  const [g1, g2] = gradientFor(o.productId);
  return {
    offerId: o.offerId,
    productId: o.productId,
    name: o.name,
    sku: o.sku,
    brand: o.brand,
    cat: o.category,
    categoryName: o.categoryName,
    subCategory: o.subCategory,
    productStatus: o.productStatus,
    mrp: o.mrp ?? 0,
    eppPrice: o.eppPrice,
    resellerPrice: o.resellerPrice,
    smartEppPrice: o.smartEppPrice,
    mop: o.mop,
    quantity: o.quantity,
    freeGiftId: o.freeGiftId,
    status: o.status,
    isActive: o.isActive,
    image: o.image,
    g1,
    g2,
  };
}

export async function getResellerOffers(query: ResellerOfferQuery = {}): Promise<ResellerOfferRow[]> {
  const r = await api.getOffers({
    q: query.q,
    category: query.group && query.group !== 'all' ? query.group : undefined,
    status: query.status && query.status !== 'all' ? query.status.toUpperCase() : undefined,
  });
  return r.data.map(toOfferRow);
}

export async function getResellerOffer(id: string): Promise<ResellerOfferRow> {
  return toOfferRow(await api.getOffer(id));
}

export const updateResellerOffer = api.updateOffer;
export type ResellerOfferWrite = api.ResellerOfferWrite;

// ─── Free gifts ───────────────────────────────────────────────────────────────

export type ResellerFreeGift = api.ResellerFreeGiftApi;
export const getResellerFreeGifts = api.getFreeGifts;
export const createResellerFreeGift = api.createFreeGift;
export const updateResellerFreeGift = api.updateFreeGift;

function couponScope(cat: { slug?: string; name?: string } | null | undefined): string {
  if (!cat) return 'All my products';
  if (cat.slug === 'phones') return 'Phones';
  if (cat.slug === 'accessories') return 'Accessories';
  if (cat.slug === 'bags') return 'Bags';
  return cat.name ?? 'All my products';
}

export async function getResellerCoupons(): Promise<ResellerCoupon[]> {
  const r = await api.getCoupons();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (r.data as any[]).map((c) => ({
    code: c.code,
    type: c.type === 'PERCENT' ? 'pct' : 'flat',
    val: Number(c.value),
    cap: c.maxDiscount == null ? undefined : Number(c.maxDiscount),
    min: Number(c.minOrderValue) || undefined,
    scope: couponScope(c.category),
    status: String(c.status).toLowerCase() as ResellerCoupon['status'],
    used: c.usedCount ?? 0,
    limit: c.usageLimit ?? 0,
    ends: c.endsAt ? fmtDate(c.endsAt) : '—',
  }));
}

const ORDER_STATUS_IN: Record<string, StoreOrderStatus> = {
  PLACED: 'Processing',
  CONFIRMED: 'Processing',
  DISPATCHED: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Cancelled',
};

export interface ResellerOrderRow {
  id: string; // orderNo (drives transit + display)
  customer: string;
  company: string;
  status: StoreOrderStatus;
  total: number;
  date: string;
  dispatchDate: string;
  productName: string;
  itemCount: number;
  shipmentStatus: string | null;
  awb: string | null;
}

export async function getResellerOrders(bucket?: string): Promise<ResellerOrderRow[]> {
  const r = await api.getOrders(bucket);
  return r.data.map((o) => ({
    id: o.orderNo,
    customer: o.employee?.user.fullName ?? '—',
    company: o.company?.name ?? '—',
    status: ORDER_STATUS_IN[o.status] ?? 'Processing',
    total: o.total,
    date: fmtDate(o.createdAt),
    dispatchDate: o.shipment?.dispatchedAt ? fmtDate(o.shipment.dispatchedAt) : '—',
    productName: o.items?.[0]?.product?.name ?? '—',
    itemCount: o.items?.length ?? 0,
    shipmentStatus: o.shipment?.status ?? null,
    awb: o.shipment?.awbNumber ?? null,
  }));
}

export interface ResellerOrderDetail {
  id: string;
  customer: string;
  company: string;
  status: StoreOrderStatus;
  total: number;
  subtotal: number;
  date: string;
  dispatchDate: string;
  deliveredDate: string;
  courier: string;
  awb: string;
  address: string;
  items: { name: string; qty: number; price: number }[];
}

export async function getResellerOrderDetail(id: string): Promise<ResellerOrderDetail> {
  const o = await api.getOrder(id);
  const a = o.address;
  return {
    id: o.orderNo,
    customer: o.employee?.user.fullName ?? '—',
    company: o.company?.name ?? '—',
    status: ORDER_STATUS_IN[o.status] ?? 'Processing',
    total: o.total,
    subtotal: o.subtotal,
    date: fmtDate(o.createdAt),
    dispatchDate: o.shipment?.dispatchedAt ? fmtDate(o.shipment.dispatchedAt) : '—',
    deliveredDate: o.shipment?.deliveredAt ? fmtDate(o.shipment.deliveredAt) : '—',
    courier: o.shipment?.courier?.name ?? '—',
    awb: o.shipment?.awbNumber ?? '—',
    address: a ? [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', ') : '—',
    items: o.items.map((it) => ({ name: it.product.name, qty: it.quantity, price: it.unitPrice })),
  };
}

export const updateTransit = api.updateTransit;
