/** Data-access seam. These call the live Express API (via the Vite proxy at
 *  `/api`) and adapt responses into the fixture-shaped types the screens render
 *  (see ./map). Screens import from here, never from ./fixtures directly.
 *  Static label/config constants are still re-exported synchronously below. */

import { apiFetch, apiUpload, type PageMeta } from './http';
import { setToken, setUser, clearAuth, type AuthUser } from './auth-store';
import type { Coupon, DateRange, Order, Product, UserDataset, UserTab } from './types';
import {
  toProduct,
  toCoupon,
  toOrderListRow,
  toOrderFull,
  toUserDataset,
  PRODUCT_STATUS_OUT,
  COUPON_TYPE_OUT,
  COUPON_STATUS_OUT,
  ORDER_STATUS_OUT,
  USER_TAB_TO_TYPE,
} from './map';

type Envelope<T> = { data: T; meta: PageMeta };

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface LoginResult {
  challengeToken: string;
  devOtp?: string;
  message: string;
  // Present only when 2FA is disabled server-side (beta): signed in directly.
  accessToken?: string;
  user?: AuthUser;
}
export async function login(email: string, password: string): Promise<LoginResult> {
  const res = await apiFetch<LoginResult>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  // 2FA disabled (beta): persist the session so the caller can go straight in.
  if (res.accessToken && res.user) {
    setToken(res.accessToken);
    setUser(res.user);
  }
  return res;
}

export async function verifyOtp(challengeToken: string, code: string): Promise<AuthUser> {
  const res = await apiFetch<{ accessToken: string; user: AuthUser }>('/auth/verify-otp', {
    method: 'POST',
    body: { challengeToken, code },
    auth: false,
  });
  setToken(res.accessToken);
  setUser(res.user);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } finally {
    clearAuth();
  }
}

export async function me(): Promise<AuthUser> {
  const res = await apiFetch<{ user: AuthUser }>('/auth/me');
  return res.user;
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface ProductQuery {
  q?: string;
  group?: 'all' | 'phones' | 'accessories' | 'bags';
  status?: 'all' | 'active' | 'draft' | 'inactive';
  page?: number;
  pageSize?: number;
}
export interface ProductListResult {
  items: Product[];
  total: number;
  meta: PageMeta;
}

export async function getProducts(query: ProductQuery = {}): Promise<ProductListResult> {
  const res = await apiFetch<Envelope<Parameters<typeof toProduct>[0][]>>('/products', {
    query: {
      q: query.q,
      group: query.group && query.group !== 'all' ? query.group : undefined,
      status: query.status && query.status !== 'all' ? PRODUCT_STATUS_OUT[query.status] : undefined,
      page: query.page,
      pageSize: query.pageSize,
    },
  });
  return { items: res.data.map(toProduct), total: res.meta.total, meta: res.meta };
}

// Marketplace offer shapes (a product is sold by 1..N resellers, each with a
// price + stock listing). resellerId null = first-party / house offer.
export interface ApiOfferRow {
  id: string;
  resellerId: string | null;
  reseller: { id: string; name: string } | null;
  eppPrice: number;
  smartEppPrice: number | null;
  mop: number | null;
  quantity: number;
  freeGiftId: string | null;
  freeGift: { id: string; title: string; description: string | null } | null;
  status: string;
  isActive: boolean;
}

export interface ProductShade { name: string; g1: string; g2: string; stock: number }
export interface ProductSpecRow { k: string; v: string }

// Full product master detail (raw API shape) — no per-reseller price/stock (those
// live on offers, fetched separately).
export interface ProductDetail {
  product: Product;
  raw: RawProductDetail;
}
export interface RawProductDetail {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  description: string | null;
  categoryId: string;
  subCategory: string | null;
  status: string;
  mrp: number | null;
  mop: number | null;
  familyKey: string | null;
  optionColor: string | null;
  optionVariant: string | null;
  colorOptions: string | null;
  variantOptions: string | null;
  freebieText: string | null;
  category: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; alt: string | null; position: number }[];
  offers: ApiOfferRow[];
  specs: { g1?: string; g2?: string; shades?: ProductShade[]; rows?: ProductSpecRow[] } | null;
  createdAt?: string;
}

export async function getProduct(id: string): Promise<ProductDetail> {
  const raw = await apiFetch<RawProductDetail>(`/products/${id}`);
  return { product: toProduct(raw), raw };
}

// Super-Admin authors the product MASTER (descriptive fields + list MRP). Prices
// and stock are per-reseller offers (see the offer helpers below).
export interface ProductInput {
  sku: string;
  name: string;
  brand?: string;
  description?: string;
  categoryId: string;
  subCategory?: string;
  status?: 'active' | 'draft' | 'inactive';
  mrp?: number;
  mop?: number;
  familyKey?: string | null;
  optionColor?: string | null;
  optionVariant?: string | null;
  variantOptions?: string;
  freebieText?: string;
  shades?: ProductShade[];
  specRows?: ProductSpecRow[];
  images?: { url: string; alt?: string; position?: number }[];
  g1?: string;
  g2?: string;
}

function toProductBody(input: ProductInput) {
  return {
    sku: input.sku,
    name: input.name,
    brand: input.brand,
    description: input.description,
    categoryId: input.categoryId,
    subCategory: input.subCategory,
    status: input.status ? PRODUCT_STATUS_OUT[input.status] : undefined,
    mrp: input.mrp,
    mop: input.mop,
    familyKey: input.familyKey,
    optionColor: input.optionColor,
    optionVariant: input.optionVariant,
    variantOptions: input.variantOptions,
    freebieText: input.freebieText,
    shades: input.shades,
    specRows: input.specRows,
    images: input.images,
    g1: input.g1,
    g2: input.g2,
  };
}

export async function createProduct(input: ProductInput): Promise<RawProductDetail> {
  return apiFetch<RawProductDetail>('/products', { method: 'POST', body: toProductBody(input) });
}

export async function updateProduct(id: string, input: ProductInput): Promise<RawProductDetail> {
  return apiFetch<RawProductDetail>(`/products/${id}`, { method: 'PUT', body: toProductBody(input) });
}

export function deleteProduct(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch(`/products/${id}`, { method: 'DELETE' });
}

// Distinct variant-family keys in use — for the product form's datalist.
export async function getFamilies(): Promise<string[]> {
  const r = await apiFetch<{ data: string[] }>('/products/families');
  return r.data;
}

// ─── Marketplace offers (attach sellers, edit their price/stock) ──────────────

export interface OfferInput {
  resellerId?: string | null; // null/omit = first-party house offer
  eppPrice?: number;
  smartEppPrice?: number | null;
  quantity?: number;
  freeGiftId?: string | null;
  status?: 'active' | 'draft' | 'inactive';
  isActive?: boolean;
}
function toOfferBody(input: OfferInput) {
  return {
    ...(input.resellerId !== undefined ? { resellerId: input.resellerId } : {}),
    ...(input.eppPrice !== undefined ? { eppPrice: input.eppPrice } : {}),
    ...(input.smartEppPrice !== undefined ? { smartEppPrice: input.smartEppPrice } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(input.freeGiftId !== undefined ? { freeGiftId: input.freeGiftId } : {}),
    ...(input.status !== undefined ? { status: PRODUCT_STATUS_OUT[input.status] } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
}
export async function getOffers(productId: string): Promise<ApiOfferRow[]> {
  const r = await apiFetch<Envelope<ApiOfferRow[]>>(`/products/${productId}/offers`);
  return r.data;
}
export function attachOffer(productId: string, input: OfferInput): Promise<ApiOfferRow> {
  return apiFetch(`/products/${productId}/offers`, { method: 'POST', body: toOfferBody(input) });
}
export function updateOffer(productId: string, offerId: string, input: OfferInput): Promise<ApiOfferRow> {
  return apiFetch(`/products/${productId}/offers/${offerId}`, { method: 'PATCH', body: toOfferBody(input) });
}
export function removeOffer(productId: string, offerId: string): Promise<{ id: string; deleted: boolean }> {
  return apiFetch(`/products/${productId}/offers/${offerId}`, { method: 'DELETE' });
}

// Reseller directory + a reseller's gifts, for the offer form dropdowns.
export interface OfferReseller { id: string; name: string; status: string }
export async function getOfferResellers(): Promise<OfferReseller[]> {
  const r = await apiFetch<Envelope<OfferReseller[]>>('/products/resellers');
  return r.data;
}
export interface OfferGift { id: string; title: string; description: string | null; isActive: boolean }
export async function getResellerGifts(resellerId: string): Promise<OfferGift[]> {
  const r = await apiFetch<Envelope<OfferGift[]>>(`/products/resellers/${resellerId}/gifts`);
  return r.data;
}

export function bulkProducts(
  ids: string[],
  action: 'deactivate' | 'priceUpdate',
  opts?: { adjustment?: 'increasePct' | 'decreasePct' | 'setAmount'; value?: number },
): Promise<{ action: string; affected: number }> {
  return apiFetch('/products/bulk', {
    method: 'PATCH',
    body: { ids, action, adjustment: opts?.adjustment, value: opts?.value },
  });
}

// Image upload → returns the public /uploads/... URL.
export async function uploadImage(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const res = await apiUpload<{ url: string }>('/uploads', file, onProgress);
  return res.url;
}

// ─── Coupons ─────────────────────────────────────────────────────────────────

export interface CouponQuery {
  q?: string;
  status?: 'all' | 'active' | 'scheduled' | 'expired';
  page?: number;
  pageSize?: number;
}
export type CouponWithId = Coupon & { id: string };

export async function getCoupons(query: CouponQuery = {}): Promise<{ items: CouponWithId[]; meta: PageMeta }> {
  const res = await apiFetch<Envelope<Parameters<typeof toCoupon>[0][]>>('/coupons', {
    query: {
      q: query.q,
      status: query.status && query.status !== 'all' ? COUPON_STATUS_OUT[query.status] : undefined,
      page: query.page,
      pageSize: query.pageSize,
    },
  });
  return { items: res.data.map(toCoupon), meta: res.meta };
}

export function getCouponStats(): Promise<{
  active: number;
  scheduled: number;
  expired: number;
  totalRedemptions: number;
}> {
  return apiFetch('/coupons/stats');
}

export interface CouponInput {
  code: string;
  type: 'pct' | 'flat';
  val: number;
  cap?: number;
  min?: number;
  usageLimit: number;
  status?: 'active' | 'scheduled' | 'expired';
  categoryId?: string;
}
function toCouponBody(input: CouponInput) {
  return {
    code: input.code,
    type: COUPON_TYPE_OUT[input.type],
    value: input.val,
    maxDiscount: input.type === 'pct' && input.cap ? input.cap : undefined,
    minOrderValue: input.min ?? 0,
    usageLimit: input.usageLimit,
    status: input.status ? COUPON_STATUS_OUT[input.status] : undefined,
    categoryId: input.categoryId,
  };
}
export async function createCoupon(input: CouponInput): Promise<CouponWithId> {
  const raw = await apiFetch<Parameters<typeof toCoupon>[0]>('/coupons', { method: 'POST', body: toCouponBody(input) });
  return toCoupon(raw);
}
export async function updateCoupon(id: string, input: Partial<CouponInput>): Promise<CouponWithId> {
  const body: Record<string, unknown> = {};
  if (input.code !== undefined) body.code = input.code;
  if (input.type !== undefined) body.type = COUPON_TYPE_OUT[input.type];
  if (input.val !== undefined) body.value = input.val;
  if (input.cap !== undefined) body.maxDiscount = input.cap;
  if (input.min !== undefined) body.minOrderValue = input.min;
  if (input.usageLimit !== undefined) body.usageLimit = input.usageLimit;
  if (input.status !== undefined) body.status = COUPON_STATUS_OUT[input.status];
  if (input.categoryId !== undefined) body.categoryId = input.categoryId;
  const raw = await apiFetch<Parameters<typeof toCoupon>[0]>(`/coupons/${id}`, { method: 'PUT', body });
  return toCoupon(raw);
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export interface OrderQuery {
  bucket?: 'all' | 'active' | 'delivered' | 'cancelled';
  page?: number;
  pageSize?: number;
}
export async function getOrders(query: OrderQuery = {}): Promise<{ items: Order[]; meta: PageMeta }> {
  const res = await apiFetch<Envelope<Parameters<typeof toOrderListRow>[0][]>>('/orders', {
    query: { bucket: query.bucket && query.bucket !== 'all' ? query.bucket : undefined, page: query.page, pageSize: query.pageSize },
  });
  return { items: res.data.map(toOrderListRow), meta: res.meta };
}

export type OrderWithCuid = Order & { cuid: string };
export async function getOrder(orderNo: string): Promise<OrderWithCuid> {
  // The API accepts either the cuid or the orderNo (with or without '#').
  const clean = orderNo.replace(/^#/, '');
  const raw = await apiFetch<Parameters<typeof toOrderFull>[0]>(`/orders/${clean}`);
  return toOrderFull(raw);
}

export function overrideOrderStatus(
  idOrNo: string,
  status: 'Processing' | 'In transit' | 'Delivered' | 'Cancelled',
  note?: string,
): Promise<unknown> {
  return apiFetch(`/orders/${idOrNo.replace(/^#/, '')}/status`, {
    method: 'PATCH',
    body: { status: ORDER_STATUS_OUT[status], note },
  });
}
export function cancelOrder(idOrNo: string, note?: string): Promise<unknown> {
  return apiFetch(`/orders/${idOrNo.replace(/^#/, '')}/cancel`, { method: 'POST', body: { note } });
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getUsers(tab: UserTab, opts: { q?: string; page?: number } = {}): Promise<UserDataset> {
  const res = await apiFetch<Envelope<Record<string, unknown>[]>>('/users', {
    query: { type: USER_TAB_TO_TYPE[tab], q: opts.q, page: opts.page },
  });
  return toUserDataset(tab, res.data);
}

export interface InviteUserInput {
  type: UserTab;
  name: string;
  email: string;
  phone?: string;
  gstin?: string;
  // reseller-specific (PAN + registered address)
  pan?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  commissionPct?: number;
  companyId?: string;
  employeeCode?: string;
  department?: string;
  monthlySalary?: number;
}
export function inviteUser(input: InviteUserInput): Promise<unknown> {
  return apiFetch('/users', { method: 'POST', body: input });
}
export function updateUser(userId: string, data: { fullName?: string; phone?: string; status?: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'DISABLED' | 'INVITED' }): Promise<unknown> {
  return apiFetch(`/users/${userId}`, { method: 'PATCH', body: data });
}

export interface UpdateResellerInput {
  name?: string;
  gstin?: string;
  pan?: string;
  contactPhone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  commissionPct?: number;
  status?: 'ACTIVE' | 'ONBOARDING' | 'SUSPENDED';
}
export function updateReseller(id: string, data: UpdateResellerInput): Promise<unknown> {
  return apiFetch(`/users/resellers/${id}`, { method: 'PATCH', body: data });
}

// ─── Category master ──────────────────────────────────────────────────────────

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  _count?: { products: number; children?: number };
  children: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    _count?: { products: number };
  }[];
}
export async function getCategories(): Promise<AdminCategory[]> {
  const r = await apiFetch<Envelope<AdminCategory[]>>('/categories');
  return r.data;
}
export function createCategory(body: { name: string; parentId?: string; isActive?: boolean }): Promise<AdminCategory> {
  return apiFetch('/categories', { method: 'POST', body });
}
export function updateCategory(id: string, body: { name?: string; isActive?: boolean }): Promise<AdminCategory> {
  return apiFetch(`/categories/${id}`, { method: 'PATCH', body });
}
export function deleteCategory(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/categories/${id}`, { method: 'DELETE' });
}

// ─── QR exhibition campaigns ─────────────────────────────────────────────────

export type CampaignDiscountMode = 'FIRST_ORDER' | 'WHILE_ACTIVE' | 'FOREVER';
export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export interface AdminCampaign {
  id: string;
  name: string;
  qrToken: string;
  discountPercent: number;
  discountMode: CampaignDiscountMode;
  status: CampaignStatus;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  categoryId?: string | null;
  category?: { id: string; name: string; slug: string } | null;
  _count?: { users: number; orders: number };
}

export interface CampaignWrite {
  name: string;
  discountPercent: number;
  discountMode?: CampaignDiscountMode;
  status?: CampaignStatus;
  startsAt: string;
  endsAt: string;
  categoryId?: string | null; // null/absent = all categories
}

export async function getCampaigns(): Promise<AdminCampaign[]> {
  const r = await apiFetch<{ data: AdminCampaign[] }>('/qr-campaigns');
  return r.data;
}
export function createCampaign(body: CampaignWrite): Promise<AdminCampaign> {
  return apiFetch('/qr-campaigns', { method: 'POST', body });
}
export function updateCampaign(id: string, body: Partial<CampaignWrite>): Promise<AdminCampaign> {
  return apiFetch(`/qr-campaigns/${id}`, { method: 'PATCH', body });
}

// ─── Promotional banners ─────────────────────────────────────────────────────

export interface AdminBanner {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

export interface BannerWrite {
  title: string;
  imageUrl: string;
  linkUrl?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function getBanners(): Promise<AdminBanner[]> {
  const r = await apiFetch<{ data: AdminBanner[] }>('/banners');
  return r.data;
}
export function createBanner(body: BannerWrite): Promise<AdminBanner> {
  return apiFetch('/banners', { method: 'POST', body });
}
export function updateBanner(id: string, body: Partial<BannerWrite>): Promise<AdminBanner> {
  return apiFetch(`/banners/${id}`, { method: 'PATCH', body });
}
export function deleteBanner(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/banners/${id}`, { method: 'DELETE' });
}

export interface CreateCompanyInput {
  companyName: string;
  gstin?: string;
  emailDomain?: string;
  adminName: string;
  adminEmail: string;
  adminPassword?: string;
  smartEppEnabled?: boolean;
}
export function createCompany(input: CreateCompanyInput): Promise<{ name: string; emailDomain: string | null; adminEmail: string; tempPassword?: string }> {
  return apiFetch('/users/companies', { method: 'POST', body: input });
}
export function updateCompany(
  id: string,
  input: { name?: string; smartEppEnabled?: boolean; status?: 'ACTIVE' | 'ONBOARDING' | 'SUSPENDED' },
): Promise<{ id: string; name: string; status: string; smartEppEnabled: boolean }> {
  return apiFetch(`/users/companies/${id}`, { method: 'PATCH', body: input });
}

export interface AssignAdminInput {
  userId?: string;
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
}
export function assignCompanyAdmin(companyId: string, input: AssignAdminInput): Promise<{ adminName: string | null; adminEmail: string | null; tempPassword?: string }> {
  return apiFetch(`/users/companies/${companyId}/assign-admin`, { method: 'POST', body: input });
}
export function importUsers(type: UserTab, rows: Record<string, unknown>[]): Promise<{ created: number; skipped: number; errors: { email: string; reason: string }[] }> {
  return apiFetch('/users/import', { method: 'POST', body: { type, rows } });
}

// ─── Payments ────────────────────────────────────────────────────────────────

export interface PaymentConfig {
  methods: { id: string; method: string; surchargePercent: number; gstOnSurchargePercent: number; active: boolean }[];
  gateways: { id: string; provider: string; merchantId: string | null; active: boolean; hasKey: boolean; hasWebhook: boolean }[];
}
export function getPaymentConfig(): Promise<PaymentConfig> {
  return apiFetch('/payments/config');
}
export function updatePaymentConfig(body: {
  methods?: { method: string; surchargePercent: number; gstOnSurchargePercent?: number; active?: boolean }[];
  gateways?: { provider: string; merchantId?: string; keyRef?: string; webhookRef?: string; active?: boolean }[];
}): Promise<PaymentConfig> {
  return apiFetch('/payments/config', { method: 'PUT', body });
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export function getReports(): Promise<{ type: string; title: string; description: string }[]> {
  return apiFetch('/reports');
}
export function exportReport(type: string, format: 'CSV' | 'PDF'): Promise<{ id: string; reportType: string; format: string; fileUrl: string | null }> {
  return apiFetch(`/reports/${type}/export`, { method: 'POST', query: { format }, body: {} });
}

// ─── Bulk ────────────────────────────────────────────────────────────────────

export function bulkImport(rows: Record<string, unknown>[]): Promise<{ total: number; created: number; skipped: number; errors: { sku: string; reason: string }[] }> {
  return apiFetch('/bulk/import', { method: 'POST', body: { rows } });
}
export function bulkPriceUpdate(body: { scope: 'all' | 'phones' | 'accessories' | 'bags'; adjustment: 'increasePct' | 'decreasePct' | 'setAmount'; value: number; priceType?: 'EPP' | 'SMART_EPP' }): Promise<{ scope: string; matchedProducts: number; affectedPrices: number }> {
  return apiFetch('/bulk/price-update', { method: 'POST', body });
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardData {
  range: DateRange;
  stats: { gmv: number; orders: number; avgOrderValue: number; grossMargin: number };
  topCompanies: { companyId: string; name: string; spend: number; pct: number }[];
  topProducts: { productId: string; name: string; units: number; value: number }[];
  partners: { partnerId: string; name: string; shipments: number }[];
  topWishlisted: { productId: string; name: string; saves: number }[];
  recentOrders: { id: string; company: string; product: string; value: number; status: string }[];
  deliveryDonut: { status: string; count: number }[];
}
export function getDashboard(range: DateRange): Promise<DashboardData> {
  return apiFetch('/dashboard', { query: { range } });
}

// ─── Reviews (moderation) ────────────────────────────────────────────────────

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export interface ReviewRow {
  id: string;
  author: string;
  authorEmail: string;
  productId: string;
  productName: string;
  productSku: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  createdAt: string;
}
export async function getReviews(
  status?: ReviewStatus,
  opts: { page?: number } = {},
): Promise<{ items: ReviewRow[]; meta: PageMeta }> {
  const res = await apiFetch<Envelope<ReviewRow[]>>('/reviews', {
    query: { status, page: opts.page },
  });
  return { items: res.data, meta: res.meta };
}
export function setReviewStatus(id: string, status: 'APPROVED' | 'REJECTED'): Promise<unknown> {
  return apiFetch(`/reviews/${id}/status`, { method: 'PATCH', body: { status } });
}

// ─── Static re-exports (labels/config the screens render synchronously) ───────
// Data arrays from these fixtures are NO LONGER re-exported — screens use the
// async accessors above. Only presentation constants remain.
export {
  catLabels,
  groupLabels,
  vendorColors,
  editShades,
  editVariants,
  editSpecs,
  visChips,
  freebiePresets,
} from './fixtures/catalog';
export { couponScopes } from './fixtures/coupons';
export { orderStatusTone, timelineSteps, statusToStep, bucketOf } from './fixtures/orders';
export {
  userTabLabels,
  addUserLabel,
  payConfig,
  gateways,
  reportDefs,
  mappingRows,
  demoAccounts,
  DEMO_PASSWORD,
} from './fixtures/admin';
