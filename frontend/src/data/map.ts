/** Adapter layer: translate live API JSON (uppercase enums, dual price rows,
 *  numeric money, ISO dates, image URLs) into the fixture-shaped types the
 *  screens already render. Keeps screens stable while data goes live. */

import type {
  Coupon,
  CouponStatus,
  CouponType,
  Order,
  OrderItem,
  OrderStatus,
  Product,
  ProductGroup,
  ProductStatus,
  UserDataset,
  UserRow,
  UserState,
  UserTab,
  Vendor,
} from './types';

// ─── Shared helpers ──────────────────────────────────────────────────────────

const GRADIENTS: [string, string][] = [
  ['#4a7fc0', '#123a72'],
  ['#1f6f52', '#0a2f22'],
  ['#2b2f36', '#0b0d10'],
  ['#7a8fae', '#3a465c'],
  ['#c8a24a', '#7a5f1e'],
  ['#6a5240', '#332417'],
  ['#3a2f5a', '#171029'],
  ['#5a3d2b', '#2a1a10'],
];

// Deterministic gradient from an id so a product without a real image still
// gets a stable placeholder (same id → same colors across renders).
export function gradientFor(id: string): [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

const AVATAR_COLORS = ['#2B7BE4', '#1E9E6A', '#7A5AF0', '#E0921A', '#C0562B', '#5B6270'];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ISO → "31 Dec 2026"
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Compact ₹ like "₹1.42Cr" / "₹58.2L" / "₹4,999".
export function compactInr(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

// ─── Products ────────────────────────────────────────────────────────────────

const PRODUCT_STATUS_IN: Record<string, ProductStatus> = {
  ACTIVE: 'active',
  DRAFT: 'draft',
  INACTIVE: 'inactive',
};
export const PRODUCT_STATUS_OUT: Record<ProductStatus, string> = {
  active: 'ACTIVE',
  draft: 'DRAFT',
  inactive: 'INACTIVE',
};

// Frontend "group" is a category slug; API category.slug can be phones/accessories/bags
// or a free-text imported category. Fall back to 'accessories' for unknowns.
function groupOf(slug: string | undefined): ProductGroup {
  if (slug === 'phones' || slug === 'accessories' || slug === 'bags') return slug;
  return 'accessories';
}

// Reseller name → the fixture Vendor union; first-party (null reseller) = imcorpcart.
function vendorOf(resellerName: string | null | undefined): Vendor {
  const known: Vendor[] = ['TechnoReseller', 'MobileHub', 'GadgetPro', 'UrbanCarry'];
  if (resellerName && known.includes(resellerName as Vendor)) return resellerName as Vendor;
  return 'imcorpcart';
}

export interface ApiOffer {
  id?: string;
  resellerId: string | null;
  reseller: { id: string; name: string } | null;
  eppPrice: number;
  smartEppPrice: number | null;
  mop: number | null;
  quantity: number;
  freeGiftId?: string | null;
  freeGift?: { id: string; title: string; description: string | null } | null;
  status: string;
  isActive: boolean;
}
interface ApiProductRow {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  status: string;
  subCategory: string | null;
  categoryId: string;
  mrp?: number | null;
  category: { id: string; name: string; slug: string } | null;
  offers?: ApiOffer[];
  images?: { url: string }[];
  createdAt?: string;
}

// Buy-box helpers — the storefront/admin views surface the cheapest active,
// in-stock offer across a product's sellers.
export function liveOffers(offers: ApiOffer[]): ApiOffer[] {
  return offers.filter((o) => o.isActive && o.status === 'ACTIVE' && o.quantity > 0 && o.eppPrice > 0);
}
export function buyBoxOffer(offers: ApiOffer[] | undefined): ApiOffer | null {
  const live = liveOffers(offers ?? []);
  if (!live.length) return null;
  return [...live].sort((a, b) => a.eppPrice - b.eppPrice)[0];
}

export function toProduct(r: ApiProductRow): Product {
  const [g1, g2] = gradientFor(r.id);
  const firstImage = r.images?.[0]?.url;
  const win = buyBoxOffer(r.offers);
  return {
    id: r.id,
    name: r.name,
    brand: r.brand ?? '',
    // The cheapest offer's seller (first-party/house = imcorpcart).
    vendor: vendorOf(win?.reseller?.name),
    sku: r.sku,
    group: groupOf(r.category?.slug),
    cat: r.subCategory ?? '',
    price: win ? win.eppPrice : r.mrp ?? 0,
    stock: win ? win.quantity : 0,
    status: PRODUCT_STATUS_IN[r.status] ?? 'draft',
    dateAdded: r.createdAt ? fmtDate(r.createdAt) : '—',
    // Real image if present, else a deterministic gradient placeholder.
    g1: firstImage ?? g1,
    g2: firstImage ?? g2,
  };
}

// ─── Coupons ─────────────────────────────────────────────────────────────────

const COUPON_TYPE_IN: Record<string, CouponType> = { PERCENT: 'pct', FLAT: 'flat' };
export const COUPON_TYPE_OUT: Record<CouponType, string> = { pct: 'PERCENT', flat: 'FLAT' };
const COUPON_STATUS_IN: Record<string, CouponStatus> = {
  ACTIVE: 'active',
  SCHEDULED: 'scheduled',
  EXPIRED: 'expired',
};
export const COUPON_STATUS_OUT: Record<CouponStatus, string> = {
  active: 'ACTIVE',
  scheduled: 'SCHEDULED',
  expired: 'EXPIRED',
};

// category.slug → the human scope label the UI shows.
function scopeLabel(cat: { slug: string; name: string } | null): string {
  if (!cat) return 'All products';
  if (cat.slug === 'phones') return 'Phones';
  if (cat.slug === 'accessories') return 'Accessories';
  if (cat.slug === 'bags') return 'Bags';
  return cat.name;
}

interface ApiCoupon {
  id: string;
  code: string;
  type: string;
  value: number;
  maxDiscount: number | null;
  minOrderValue: number;
  status: string;
  usedCount: number;
  usageLimit: number;
  endsAt: string | null;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
}

// Coupon keeps an extra `id` for API calls (screens key by `code`, unaffected).
export function toCoupon(c: ApiCoupon): Coupon & { id: string } {
  return {
    id: c.id,
    code: c.code,
    type: COUPON_TYPE_IN[c.type] ?? 'pct',
    val: c.value,
    cap: c.maxDiscount ?? 0,
    min: c.minOrderValue,
    scope: scopeLabel(c.category),
    status: COUPON_STATUS_IN[c.status] ?? 'active',
    used: c.usedCount,
    limit: c.usageLimit,
    ends: fmtDate(c.endsAt),
  };
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export const ORDER_STATUS_IN: Record<string, OrderStatus> = {
  PLACED: 'Processing',
  CONFIRMED: 'Processing',
  DISPATCHED: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Cancelled',
};
// Fixture status → the canonical API status used for override.
export const ORDER_STATUS_OUT: Record<OrderStatus, string> = {
  Processing: 'CONFIRMED',
  'In transit': 'DISPATCHED',
  Delivered: 'DELIVERED',
  Cancelled: 'CANCELLED',
};

interface ApiOrderListRow {
  orderNo: string;
  status: string;
  total: number;
  createdAt: string;
  company: { name: string };
  employee: { user: { fullName: string } };
  reseller: { name: string } | null;
  shipment: { awbNumber: string | null; dispatchedAt: string | null; courier: { name: string } | null } | null;
  items: { quantity: number; product: { name: string; reseller?: { name: string } | null } }[];
}

// Vendor: the seller of the first line item's product, else the order-level
// reseller, else the first-party house catalog.
function orderVendor(o: ApiOrderListRow): string {
  return o.items?.[0]?.product?.reseller?.name ?? o.reseller?.name ?? 'imcorpcart';
}

export function toOrderListRow(o: ApiOrderListRow): Order {
  return {
    id: `#${o.orderNo}`,
    company: o.company.name,
    buyer: o.employee?.user?.fullName ?? '—',
    date: fmtDate(o.createdAt),
    dispatchDate: o.shipment?.dispatchedAt ? fmtDate(o.shipment.dispatchedAt) : '—',
    vendor: orderVendor(o),
    productName: o.items?.[0]?.product?.name ?? '—',
    itemCount: o.items?.length ?? 0,
    status: ORDER_STATUS_IN[o.status] ?? 'Processing',
    courier: o.shipment?.courier?.name ?? 'Awaiting dispatch',
    awb: o.shipment?.awbNumber ?? '—',
    total: o.total,
    items: [], // list rows don't carry full item detail; detail fetch fills them
  };
}

interface ApiOrderItem {
  quantity: number;
  unitPrice: number;
  product: { id: string; name: string };
}
interface ApiOrderFull extends ApiOrderListRow {
  id: string;
  couponCode: string | null;
  subtotal: number;
  items: ApiOrderItem[];
}

export function toOrderFull(o: ApiOrderFull): Order & { cuid: string } {
  const items: OrderItem[] = o.items.map((it) => {
    const [g1, g2] = gradientFor(it.product.id);
    return { name: it.product.name, shade: '', g1, g2, qty: it.quantity, price: it.unitPrice };
  });
  return {
    cuid: o.id,
    id: `#${o.orderNo}`,
    company: o.company.name,
    buyer: o.employee?.user?.fullName ?? '—',
    date: fmtDate(o.createdAt),
    dispatchDate: o.shipment?.dispatchedAt ? fmtDate(o.shipment.dispatchedAt) : '—',
    vendor: o.reseller?.name ?? 'imcorpcart',
    productName: o.items?.[0]?.product?.name ?? '—',
    itemCount: o.items?.length ?? 0,
    status: ORDER_STATUS_IN[o.status] ?? 'Processing',
    courier: o.shipment?.courier?.name ?? 'Awaiting dispatch',
    awb: o.shipment?.awbNumber ?? '—',
    total: o.total,
    items,
  };
}

// ─── Users ───────────────────────────────────────────────────────────────────

const USER_HEADERS: Record<UserTab, string[]> = {
  companies: ['Company', 'Employees', 'GSTIN', 'Status', ''],
  employees: ['Employee', 'Company', 'Email', 'Status', ''],
  resellers: ['Reseller', 'Products', 'Commission', 'Status', ''],
  partners: ['Fulfillment partner', 'Region', 'On-time', 'Status', ''],
};

function stateOf(status: string): UserState {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'SUSPENDED':
    case 'DISABLED':
      return 'Suspended';
    case 'INVITED':
      return 'Invited';
    case 'PENDING':
    case 'ONBOARDING':
      return 'Pending';
    default:
      return 'Pending';
  }
}

// Each tab has its own row fields; project into the generic UserRow the table renders.
// Keeps a hidden `id` alongside for row actions (the table ignores extra keys).
export interface UserRowWithId extends UserRow {
  id: string;
  userId?: string;
  commissionPct?: number;
  smartEppEnabled?: boolean;
}

export function toUserDataset(tab: UserTab, rows: Record<string, unknown>[]): UserDataset {
  const mapped: UserRowWithId[] = rows.map((r) => {
    const name = String(r.name ?? '');
    const base = {
      name,
      initials: initialsOf(name),
      avBg: avatarColor(name),
      id: String(r.id ?? ''),
      userId: r.userId ? String(r.userId) : undefined,
    };
    switch (tab) {
      case 'companies':
        return {
          ...base,
          meta1: `${Number(r.employeeCount ?? 0)} employees`,
          meta2: r.gstin ? String(r.gstin) : '—',
          state: stateOf(String(r.status ?? '')),
          smartEppEnabled: Boolean(r.smartEppEnabled),
        };
      case 'employees':
        return {
          ...base,
          meta1: String(r.company ?? '—'),
          meta2: String(r.email ?? '—'),
          state: stateOf(String(r.status ?? '')),
        };
      case 'resellers':
        return {
          ...base,
          meta1: `${Number(r.productCount ?? 0)} products`,
          meta2: `${Number(r.commissionPct ?? 0)}% commission`,
          commissionPct: Number(r.commissionPct ?? 0),
          state: stateOf(String(r.status ?? '')),
        };
      case 'partners':
        return {
          ...base,
          meta1: String(r.contactEmail ?? '—'),
          meta2: `${Number(r.shipmentCount ?? 0)} shipments`,
          state: stateOf(String(r.status ?? '')),
        };
    }
  });
  return { headers: USER_HEADERS[tab], rows: mapped };
}

// Fixture UserTab → API `type` (identical values, but keep an explicit seam).
export const USER_TAB_TO_TYPE: Record<UserTab, string> = {
  companies: 'companies',
  employees: 'employees',
  resellers: 'resellers',
  partners: 'partners',
};
