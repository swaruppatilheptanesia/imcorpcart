/** Domain types for the Super Admin portal — modeled from the prototype's sample data.
 *  These mirror the mock fixtures and are the contract a real API would later fulfill. */

export type ProductGroup = 'phones' | 'accessories' | 'bags';
export type ProductStatus = 'active' | 'draft' | 'inactive';
export type Vendor =
  | 'imcorpcart'
  | 'TechnoReseller'
  | 'MobileHub'
  | 'GadgetPro'
  | 'UrbanCarry';

export interface Product {
  id: string;
  name: string;
  brand: string;
  vendor: Vendor;
  sku: string;
  group: ProductGroup;
  cat: string; // subcategory: flagship/mid/budget · audio/power/cases · backpacks/briefcases/sleeves
  price: number; // EPP price in ₹
  stock: number;
  status: ProductStatus;
  dateAdded: string; // formatted createdAt (e.g. "31 Dec 2026")
  g1: string; // gradient placeholder colors (stand in for real imagery)
  g2: string;
  vendorTag?: string | null; // inbound vendor source name (null for internal/bulk)
  sourceId?: string | null;
  hidden?: boolean; // admin show/hide on the storefront
}

export type CouponType = 'pct' | 'flat';
export type CouponStatus = 'active' | 'scheduled' | 'expired';

export interface Coupon {
  code: string;
  type: CouponType;
  val: number; // percent (pct) or ₹ (flat)
  cap: number; // max discount for pct (0 = none)
  min: number; // minimum order value (0 = none)
  scope: string; // "All products" | "Phones" | ...
  status: CouponStatus;
  used: number;
  limit: number;
  ends: string;
}

export type OrderStatus = 'Processing' | 'In transit' | 'Delivered' | 'Cancelled';

export interface OrderItem {
  itemId?: string; // OrderItem cuid — needed to retry a stuck voucher line
  name: string;
  shade: string;
  g1: string;
  g2: string;
  qty: number;
  price: number;
  vendorTag?: string | null; // inbound import vendor (source name), null for house/first-party
  denomination?: number | null; // gift-card face value (voucher lines only)
  fulfilmentStatus?: string | null; // PENDING | PROCESSING | DELIVERED | FAILED (voucher lines only)
  deliveredAt?: string | null; // when the voucher code was issued + emailed
}

export interface Order {
  id: string; // #IMC-#####
  company: string;
  buyer: string;
  buyerEmail?: string | null; // buyer's email (order detail only; for voucher "emailed to" line)
  date: string; // order (created) date
  dispatchDate: string; // shipment dispatch date, or "—"
  vendor: string; // reseller name, or "imcorpcart" (first-party)
  productName: string; // first item's product name (for the list column)
  itemCount: number; // number of line items
  status: OrderStatus;
  courier: string;
  awb: string;
  total: number;
  items: OrderItem[];
}

/* ── Dashboard ── */
export type DateRange = '7D' | '30D' | 'QTD' | 'YTD';

export interface RangeStats {
  label: string;
  full: string;
  gmv: string;
  gmvDelta: string;
  orders: string;
  ordersDelta: string;
  margin: string;
  marginVal: string;
  marginDelta: string;
}

export interface TopCompany {
  name: string;
  spend: string;
  pct: string;
}
export interface TopProduct {
  name: string;
  units: string;
  value: string;
  g1: string;
  g2: string;
}
export interface Partner {
  name: string;
  type: string;
  gmv: string;
  onTime: string;
  otColor: string;
  dot: string;
}
export interface Wishlisted {
  name: string;
  saves: string;
  pct: string;
  trend: string;
  g1: string;
  g2: string;
}
export interface RecentOrder {
  id: string;
  company: string;
  product: string;
  value: string;
  status: string;
  tone: SemanticTone;
}

/* ── Users ── */
export type UserTab = 'companies' | 'employees' | 'resellers' | 'partners';
export type UserState = 'Active' | 'Suspended' | 'Invited' | 'Pending';

export interface UserRow {
  name: string;
  meta1: string;
  meta2: string;
  state: UserState;
  initials: string;
  avBg: string;
}
export interface UserDataset {
  headers: string[];
  rows: UserRow[];
}

/* ── Config screens ── */
export interface PayMethod {
  id: string;
  label: string;
  note: string;
  value: number; // surcharge %
}
export interface ReportDef {
  id: string;
  title: string;
  desc: string;
  range: string;
}

/* Shared semantic tone used by status pills. */
export type SemanticTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';
