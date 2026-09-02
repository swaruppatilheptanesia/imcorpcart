/** Storefront + reseller domain types (dummy-data build). StoreProduct EXTENDS the
 *  admin Product so shared components (ProductThumb, VendorTag, inr) work unchanged. */

import type { Product, Vendor } from './types';

// ─── Catalog enrichment ──────────────────────────────────────────────────────

export interface Shade {
  name: string;
  g1: string;
  g2: string;
  stock: number;
}

export interface Spec {
  k: string;
  v: string;
}

export interface Freebie {
  enabled: boolean;
  description: string;
}

// An approved customer review shown on the product detail page.
export interface Review {
  id: string;
  author: string;
  rating: number; // 1..5
  title: string | null;
  body: string;
  createdAt: string;
}

// A sibling SKU in a variant family (Amazon-style colour/storage selectors).
export interface FamilyMember {
  id: string;
  sku: string;
  optionColor: string | null;
  optionVariant: string | null;
  price: number;
  mop: number;
  image: string | null;
  g1: string;
  g2: string;
  inStock: boolean;
}

export interface StoreProduct extends Product {
  mrp: number; // struck-through list price; savings = mrp - price
  mop: number; // market operating (public/pre-login) price
  cashback: number; // ₹ earned per unit on purchase (credited to wallet on delivery); 0 = none
  // Tax + policy attributes (shown Amazon-style on the product page).
  hsnCode?: string | null;
  gstPercent?: number | null;
  termsText?: string;
  warrantyText?: string;
  rating: number; // 0..5
  reviews: number;
  desc: string;
  freebie: Freebie;
  shades: Shade[]; // colour variants (phones); [] for others
  variants: string[]; // configuration options (e.g. 128GB / 256GB); [] if none
  specs: Spec[];
  newness: number; // sort key for "Newest arrivals" (higher = newer)
  image?: string | null; // first uploaded photo; falls back to the g1/g2 gradient
  images: string[]; // full ordered gallery; [] when the product has no photos
  // Amazon-style variant family (separate sibling SKUs).
  familyKey?: string | null;
  optionColor?: string | null; // this SKU's colour label
  optionVariant?: string | null; // this SKU's config label
  familyColors?: number; // distinct colours in the family (card badge)
  family?: FamilyMember[]; // sibling SKUs (detail page only)
}

// ─── Storefront view state ───────────────────────────────────────────────────

// Any active category slug from the master, plus the 'all' sentinel. Departments
// are derived from the catalog (categories that have products), not a fixed list.
export type StoreCategory = string;

export type SortKey = 'featured' | 'priceAsc' | 'priceDesc' | 'rating' | 'newest';

export interface FilterState {
  category: StoreCategory;
  sub: string | null; // subcategory key within the selected category (p.cat); null = all
  brands: string[];
  minRating: 0 | 2 | 3 | 4;
  inStock: boolean;
  priceMin: number;
  priceMax: number;
}

export const PRICE_FLOOR = 0;
export const PRICE_CEIL = 130000;

export const DEFAULT_FILTERS: FilterState = {
  category: 'all',
  sub: null,
  brands: [],
  minRating: 0,
  inStock: false,
  priceMin: PRICE_FLOOR,
  priceMax: PRICE_CEIL,
};

// ─── Cart / coupons / checkout ───────────────────────────────────────────────

export interface CartLine {
  id: string; // product id
  shade: string; // shade name, or '' when the product has no shades
  qty: number;
}

export type CouponType = 'pct' | 'flat';

export interface StoreCoupon {
  code: string;
  type: CouponType;
  val: number; // percent (pct) or ₹ (flat)
  cap?: number; // max discount for pct
  min?: number; // minimum order value to qualify
  scope: StoreCategory; // 'all' or a specific category
  label: string; // human hint, e.g. "10% off · up to ₹10,000"
}

export type PayMethodId = 'upi' | 'netbanking' | 'credit' | 'debit' | 'smartepp';

export interface PayMethod {
  id: PayMethodId;
  label: string;
  note: string;
  pct: number; // surcharge % (0 for UPI / Smart EPP)
}

// EMI plan (beyond-handoff Smart EPP surface).
export interface EmiPlan {
  months: number;
  rate: number; // flat interest fraction applied to payable
}

// ─── Orders / tracking / notifications ───────────────────────────────────────

export type StoreOrderStatus = 'Processing' | 'In transit' | 'Delivered' | 'Cancelled';

export interface StoreOrderLine {
  id: string;
  name: string;
  brand: string;
  vendor: Vendor;
  shade: string;
  qty: number;
  price: number;
  g1: string;
  g2: string;
}

export interface StoreOrder {
  id: string; // #IMC-#####
  date: string; // pre-formatted, e.g. "28 Jun 2026"
  status: StoreOrderStatus;
  total: number;
  courier: string;
  vendorNote: string; // e.g. "imcorpcart · BlueDart"
  lines: StoreOrderLine[];
  step: number; // 0..4 tracking progress
}

export interface TrackingStep {
  label: string;
  time: string;
}

export type NotifType = 'delivery' | 'payment' | 'pricedrop' | 'order';

export interface ShopNotification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

export type ShopAddressType = 'OFFICE' | 'HOME' | 'COMPANY_DEFINED';

export interface ShopAddress {
  id: string;
  label: string | null;
  type: ShopAddressType;
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isBilling: boolean;
  isDefault: boolean;
}

export interface ShopProfile {
  name: string;
  initials: string;
  email: string;
  company: string;
  program: string; // "EPP"
  creditLimit: number;
  creditUsed: number;
  addresses: { label: string; line: string }[];
}

export interface DemoShopper {
  name: string;
  company: string;
  email: string;
}

// ─── Reseller ────────────────────────────────────────────────────────────────

export interface RankedProduct {
  name: string;
  g1: string;
  g2: string;
  metric: string; // e.g. "96 sold" / "▲ 16%"
}

export interface ResellerDashboard {
  salesValue: string; // "₹4.82Cr"
  salesDelta: string; // "▲ 12.4% vs previous"
  orderVolume: string; // "1,284"
  orderDelta: string; // "▲ 6.1%"
  spark: number[];
  deliveryPct: string; // "94%"
  deliveryNote: string; // "18 delayed · avg 3.2 days"
  bestSellers: RankedProduct[];
  worstSellers: RankedProduct[];
  topCustomers: { name: string; spend: string }[];
  mostWishlisted: RankedProduct[];
}

export interface ResellerCoupon {
  code: string;
  type: CouponType;
  val: number;
  cap?: number;
  min?: number;
  scope: string; // "All my products" | "Phones" | "Accessories"
  status: 'active' | 'scheduled' | 'expired';
  used: number;
  limit: number;
  ends: string;
}

export interface ResellerOrder {
  id: string;
  customer: string;
  company: string;
  status: StoreOrderStatus;
  total: number;
  date: string;
}
