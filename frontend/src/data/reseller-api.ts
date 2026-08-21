/** Reseller portal data layer — live API via a reseller-scoped http client
 *  (token key imc_reseller_jwt). Raw responses; the portal's data.ts adapts them
 *  to the fixture-shaped types the screens already render. */

import { createAuthStore } from './auth-store';
import { createHttpClient, createAuthApi } from './http';

export const resellerStore = createAuthStore('reseller');
const client = createHttpClient(resellerStore);
const authApi = createAuthApi(client, resellerStore);

export const login = authApi.login;
export const verifyOtp = authApi.verifyOtp;
export const me = authApi.me;
export const logout = authApi.logout;

// ─── Raw API shapes ──────────────────────────────────────────────────────────

export interface ResellerDashboardApi {
  stats: { salesValue: number; orderVolume: number; deliveredPct: number; productCount: number };
  spark: number[];
  bestSellers: { productId: string; name: string; units: number; value: number }[];
  topCustomers: { companyId: string; name: string; spend: number }[];
  mostWishlisted: { productId: string; name: string; saves: number }[];
}

export interface ResellerOrderApi {
  id: string;
  orderNo: string;
  status: string;
  total: number;
  createdAt: string;
  company: { name: string } | null;
  employee: { employeeCode: string; user: { fullName: string } } | null;
  shipment: { status: string; awbNumber: string | null; dispatchedAt: string | null } | null;
  items: { quantity: number; product: { name: string } }[];
}

export interface ResellerOrderFullApi extends ResellerOrderApi {
  subtotal: number;
  address: { line1: string; line2: string | null; city: string; state: string; pincode: string } | null;
  items: { quantity: number; unitPrice: number; product: { id: string; name: string; sku: string } }[];
  shipment: {
    status: string;
    awbNumber: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    courier: { name: string } | null;
  } | null;
}

// ─── Marketplace offers (reseller edits only its own price + stock) ──────────

// The reseller's offer on a Super-Admin-authored product. The product master
// (name/brand/category/MRP) is read-only; only the offer fields are editable.
export interface ResellerOfferApi {
  offerId: string;
  productId: string;
  sku: string;
  name: string;
  brand: string;
  category: string; // slug
  categoryName: string;
  subCategory: string;
  productStatus: string;
  mrp: number | null;
  mop: number | null; // read-only — the Super Admin sets the public price
  eppPrice: number; // customer price (shopper pays)
  resellerPrice: number | null; // reseller's own price; commission = eppPrice − resellerPrice
  smartEppPrice: number | null;
  quantity: number;
  freeGiftId: string | null;
  status: string;
  isActive: boolean;
  image: string | null;
}

// Editable fields only (selling price + stock + gift + active). MOP is admin-owned.
export interface ResellerOfferWrite {
  eppPrice?: number;
  resellerPrice?: number;
  smartEppPrice?: number | null;
  quantity?: number;
  freeGiftId?: string | null;
  isActive?: boolean;
}

export interface TransitUpdateInput {
  status: 'PENDING' | 'DISPATCHED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED';
  awbNumber?: string;
  courierCode?: 'BLUEDART' | 'DELHIVERY' | 'DTDC' | 'EKART' | 'INDIA_POST';
  description?: string;
}

export function getDashboard(): Promise<ResellerDashboardApi> {
  return client.apiFetch('/reseller/dashboard');
}

export function getOffers(query: { q?: string; category?: string; status?: string } = {}): Promise<{ data: ResellerOfferApi[] }> {
  return client.apiFetch('/reseller/offers', { query });
}

export function getOffer(id: string): Promise<ResellerOfferApi> {
  return client.apiFetch(`/reseller/offers/${id}`);
}

export function updateOffer(id: string, body: ResellerOfferWrite): Promise<ResellerOfferApi> {
  return client.apiFetch(`/reseller/offers/${id}`, { method: 'PATCH', body });
}

// ─── Bulk stock & price update (CSV round-trip, matched by SKU) ───────────────

export async function getAllOffers(): Promise<ResellerOfferApi[]> {
  const r = await client.apiFetch<{ data: ResellerOfferApi[] }>('/reseller/offers/export');
  return r.data;
}

export interface ResellerBulkRow {
  sku: string;
  reseller_price?: number;
  customer_price?: number;
  stock_quantity?: number;
}
export interface ResellerBulkResult {
  total: number;
  updated: number;
  skipped: number;
  errors: { sku: string; reason: string }[];
}
export function bulkUpdateOffers(rows: ResellerBulkRow[]): Promise<ResellerBulkResult> {
  return client.apiFetch('/reseller/bulk/offers', { method: 'POST', body: { rows } });
}

export function getCoupons(): Promise<{ data: unknown[] }> {
  return client.apiFetch('/reseller/coupons');
}

// ─── Free gifts ───────────────────────────────────────────────────────────────

export interface ResellerFreeGiftApi {
  id: string;
  title: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}
export interface ResellerFreeGiftWrite {
  title: string;
  description?: string;
  isActive?: boolean;
}
export async function getFreeGifts(): Promise<ResellerFreeGiftApi[]> {
  const r = await client.apiFetch<{ data: ResellerFreeGiftApi[] }>('/reseller/free-gifts');
  return r.data;
}
export function createFreeGift(body: ResellerFreeGiftWrite): Promise<ResellerFreeGiftApi> {
  return client.apiFetch('/reseller/free-gifts', { method: 'POST', body });
}
export function updateFreeGift(id: string, body: Partial<ResellerFreeGiftWrite>): Promise<ResellerFreeGiftApi> {
  return client.apiFetch(`/reseller/free-gifts/${id}`, { method: 'PUT', body });
}

export function getOrders(bucket?: string): Promise<{ data: ResellerOrderApi[] }> {
  return client.apiFetch('/reseller/orders', { query: { bucket } });
}

export function getOrder(id: string): Promise<ResellerOrderFullApi> {
  return client.apiFetch(`/reseller/orders/${id}`);
}

export function updateTransit(orderNo: string, input: TransitUpdateInput): Promise<unknown> {
  return client.apiFetch(`/reseller/orders/${orderNo}/transit`, { method: 'PATCH', body: input });
}

// Demo login chips.
export const demoAccounts = [
  { label: 'TechnoReseller', sub: 'sales@technoreseller.com', fill: 'sales@technoreseller.com' },
  { label: 'MobileHub', sub: 'ops@mobilehub.com', fill: 'ops@mobilehub.com' },
];
export const DEMO_PASSWORD = 'imcorp@2026';
