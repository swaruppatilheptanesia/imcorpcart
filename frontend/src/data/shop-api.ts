/** Storefront (employee) data layer — live API via a shopper-scoped http client
 *  (token key imc_shopper_jwt). Returns StoreProduct/StoreCoupon-shaped data so
 *  the screens render unchanged. */

import { createAuthStore } from './auth-store';
import { createHttpClient, createAuthApi } from './http';
import type { StoreProduct, StoreCoupon, Shade, Freebie, Spec, ShopAddress, FamilyMember, Review, VoucherSpec } from './store-types';

export const shopStore = createAuthStore('shopper');
const client = createHttpClient(shopStore);
const authApi = createAuthApi(client, shopStore);

export const login = authApi.login;
export const register = authApi.register;
export const verifyOtp = authApi.verifyOtp;
export const me = authApi.me;
export const logout = authApi.logout;

// ─── Catalog ─────────────────────────────────────────────────────────────────

export async function getProducts(): Promise<StoreProduct[]> {
  const r = await client.apiFetch<{ data: StoreProduct[] }>('/shop/products');
  return r.data;
}

export function getProduct(id: string): Promise<{ product: StoreProduct; related: StoreProduct[]; family: FamilyMember[]; reviews: Review[] }> {
  return client.apiFetch(`/shop/products/${id}`);
}

// Submit (or overwrite) the shopper's review for a product. Returns the saved
// review, which starts PENDING until a Super Admin approves it.
export interface ReviewInput {
  rating: number;
  title?: string;
  body: string;
}
export function submitReview(productId: string, body: ReviewInput): Promise<{ status: string }> {
  return client.apiFetch(`/shop/products/${productId}/reviews`, { method: 'POST', body });
}

// Public (no-auth) catalog — MOP-priced. Used before login.
export async function getPublicProducts(): Promise<StoreProduct[]> {
  const r = await client.apiFetch<{ data: StoreProduct[] }>('/catalog/products', { auth: false });
  return r.data;
}

export function getPublicProduct(id: string): Promise<{ product: StoreProduct; related: StoreProduct[]; family: FamilyMember[]; reviews: Review[] }> {
  return client.apiFetch(`/catalog/products/${id}`, { auth: false });
}

export async function getPublicBanners(): Promise<ShopBanner[]> {
  const r = await client.apiFetch<{ data: ShopBanner[] }>('/catalog/banners', { auth: false });
  return r.data;
}

// Delivery estimate for a destination pincode (fastest courier TAT). Public.
export interface DeliveryEstimate {
  pincode: string;
  courier: string; // winning courier label ('' when not serviceable)
  mode: string | null; // winning mode label
  serviceable: boolean;
  tatDays: number | null;
  edl: boolean;
  etaDate: string | null; // ISO date
}
export function getDeliveryEstimate(pincode: string): Promise<DeliveryEstimate> {
  return client.apiFetch(`/catalog/delivery?pincode=${encodeURIComponent(pincode)}`, { auth: false });
}

export async function getCoupons(): Promise<StoreCoupon[]> {
  const r = await client.apiFetch<{ data: StoreCoupon[] }>('/shop/coupons');
  return r.data;
}

// ─── Cart ────────────────────────────────────────────────────────────────────

export interface CartLineView {
  itemId: string;
  productId: string;
  shade: string;
  denomination?: number | null; // gift-card face value (null for normal products)
  voucher?: VoucherSpec | null; // gift-card denomination options
  qty: number;
  name: string;
  brand: string;
  vendor: string;
  price: number;
  mrp: number;
  image?: string | null; // first product photo (null → gradient fallback)
  images?: string[];
  g1: string;
  g2: string;
  shades: Shade[];
  freebie: Freebie;
  stock: number;
  group: string; // category slug — for category-scoped discount preview
  desc: string;
  specs: Spec[];
}

export interface CartState {
  id: string | null;
  lines: CartLineView[];
  subtotal: number;
}

export function getCart(): Promise<CartState> {
  return client.apiFetch('/shop/cart');
}
export function addCart(productId: string, shade: string, qty: number): Promise<CartState> {
  return client.apiFetch('/shop/cart', { method: 'POST', body: { productId, shade: shade || undefined, qty } });
}
export function updateCart(itemId: string, qty: number): Promise<CartState> {
  return client.apiFetch(`/shop/cart/${itemId}`, { method: 'PATCH', body: { qty } });
}
export function removeCart(itemId: string): Promise<CartState> {
  return client.apiFetch(`/shop/cart/${itemId}`, { method: 'DELETE' });
}

// ─── Coupon + checkout ───────────────────────────────────────────────────────

export interface CouponValidation {
  ok: boolean;
  error?: string;
  coupon?: StoreCoupon;
  discount?: number;
}
export function validateCouponApi(code: string): Promise<CouponValidation> {
  return client.apiFetch('/shop/coupon/validate', { method: 'POST', body: { code } });
}

export interface PlacedOrder {
  orderNo: string;
  status: string;
  subtotal: number;
  couponDiscount: number;
  surcharge: number;
  gst: number;
  total: number;
}

// Step 1 of an online checkout: the server prices the cart and opens a Razorpay
// order for the total; the returned id feeds the Razorpay Checkout modal.
export interface PaymentOrder {
  keyId: string;
  rzpOrderId: string;
  amount: number; // paise
  currency: string;
  surcharge: number;
  gst: number;
  walletApplied: number;
  total: number; // rupees, incl. surcharge + GST, net of wallet
}
export function createPaymentOrder(couponCode?: string, method?: string, useWallet?: boolean): Promise<PaymentOrder> {
  return client.apiFetch('/shop/payments/order', { method: 'POST', body: { couponCode, method, useWallet } });
}

// The signed Razorpay result, passed back so the server can verify it before
// creating the orders. Absent only for the smartepp (display-only EMI) path.
export interface RazorpayHandoff {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}
export function placeOrder(
  couponCode?: string,
  addressId?: string,
  billingAddressId?: string,
  payment?: RazorpayHandoff,
  method?: string,
  useWallet?: boolean,
): Promise<PlacedOrder> {
  return client.apiFetch('/shop/orders', {
    method: 'POST',
    body: { couponCode, addressId, billingAddressId, method, useWallet, ...payment },
  });
}

// ─── Orders / tracking ───────────────────────────────────────────────────────

export interface ShopOrderRow {
  orderNo: string;
  status: string;
  total: number;
  createdAt: string;
  checkoutGroup: string | null;
  reseller: { name: string } | null;
  shipment: { status: string; courier: { name: string } | null } | null;
  items: { quantity: number; product: { name: string } }[];
}
export async function getOrders(): Promise<ShopOrderRow[]> {
  const r = await client.apiFetch<{ data: ShopOrderRow[] }>('/shop/orders');
  return r.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOrder(id: string): Promise<any> {
  return client.apiFetch(`/shop/orders/${id}`);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTracking(id: string): Promise<any> {
  return client.apiFetch(`/shop/orders/${id}/tracking`);
}

// ─── Promo banners ───────────────────────────────────────────────────────────

export interface ShopBanner {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string | null;
}
export async function getBanners(): Promise<ShopBanner[]> {
  const r = await client.apiFetch<{ data: ShopBanner[] }>('/shop/banners');
  return r.data;
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export interface ShopNotificationApi {
  id: string;
  type: 'delivery' | 'payment' | 'pricedrop' | 'order';
  title: string;
  body: string;
  at: string; // ISO timestamp
}
export async function getNotifications(): Promise<ShopNotificationApi[]> {
  const r = await client.apiFetch<{ data: ShopNotificationApi[] }>('/shop/notifications');
  return r.data;
}

// ─── Wishlist ────────────────────────────────────────────────────────────────

export async function getWishlist(): Promise<StoreProduct[]> {
  const r = await client.apiFetch<{ data: StoreProduct[] }>('/shop/wishlist');
  return r.data;
}
export async function addWishlist(productId: string): Promise<StoreProduct[]> {
  const r = await client.apiFetch<{ data: StoreProduct[] }>('/shop/wishlist', { method: 'POST', body: { productId } });
  return r.data;
}
export async function removeWishlist(productId: string): Promise<StoreProduct[]> {
  const r = await client.apiFetch<{ data: StoreProduct[] }>(`/shop/wishlist/${productId}`, { method: 'DELETE' });
  return r.data;
}

// ─── Profile ─────────────────────────────────────────────────────────────────

export interface ShopProfileApi {
  name: string;
  email: string;
  phone: string | null;
  company: string;
  companyStatus: string;
  smartEppEnabled: boolean; // company has Smart EPP enabled by the Super Admin
  checkoutEnabled: boolean; // master switch — false hides all pay/checkout entry points
  viewOnly: boolean; // demo account — purchase/checkout permanently disabled
  program: string;
  creditLimit: number | null;
  creditUsed: number;
  walletBalance: number; // spendable cashback balance
  addresses: ShopAddress[];
  // Active payment methods + their surcharge, for the Checkout method picker.
  paymentMethods: PaymentMethodOption[];
  // Exhibition (QR campaign) discount currently applicable to this shopper.
  qrDiscount: { percent: number; campaignName: string; categorySlug: string | null; categoryName: string | null } | null;
}
export interface PaymentMethodOption {
  method: string;
  label: string;
  surchargePercent: number;
  gstOnSurchargePercent: number;
}
export function getProfile(): Promise<ShopProfileApi> {
  return client.apiFetch('/shop/profile');
}

// ─── Wallet (balance + transaction history) ──────────────────────────────────

export interface WalletEntry {
  id: string;
  type: 'EARN' | 'SPEND' | 'ADJUST';
  amount: number;
  balanceAfter: number;
  note: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}
export interface WalletState {
  balance: number;
  entries: WalletEntry[];
}
export function getWallet(): Promise<WalletState> {
  return client.apiFetch('/shop/wallet');
}

// ─── Addresses (shipping list + one billing) ─────────────────────────────────

export type AddressInput = {
  contactName: string;
  contactPhone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  type?: ShopAddress['type'];
  label?: string;
  isBilling?: boolean;
  isDefault?: boolean;
};

export async function getAddresses(): Promise<ShopAddress[]> {
  const r = await client.apiFetch<{ data: ShopAddress[] }>('/shop/addresses');
  return r.data;
}
export function createAddress(body: AddressInput): Promise<ShopAddress> {
  return client.apiFetch('/shop/addresses', { method: 'POST', body });
}
export function updateAddress(id: string, body: Partial<AddressInput>): Promise<ShopAddress> {
  return client.apiFetch(`/shop/addresses/${id}`, { method: 'PATCH', body });
}
export function deleteAddress(id: string): Promise<{ ok: boolean }> {
  return client.apiFetch(`/shop/addresses/${id}`, { method: 'DELETE' });
}
