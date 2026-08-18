import type {
  StoreCoupon,
  StoreOrder,
  StoreOrderLine,
  ShopProfile,
  PayMethod,
  EmiPlan,
  DemoShopper,
} from '../store-types';

// ─── Coupons (storefront quick-picks) ────────────────────────────────────────
export const storeCoupons: StoreCoupon[] = [
  { code: 'CORP10', type: 'pct', val: 10, cap: 10000, scope: 'all', label: '10% off · up to ₹10,000' },
  { code: 'WELCOME1000', type: 'flat', val: 1000, min: 50000, scope: 'all', label: '₹1,000 off over ₹50,000' },
  { code: 'EPP15', type: 'pct', val: 15, cap: 8000, min: 40000, scope: 'phones', label: '15% off phones over ₹40,000' },
  { code: 'FLAT500', type: 'flat', val: 500, scope: 'all', label: '₹500 off any order' },
];

// ─── Payment methods (+ Smart EPP EMI) ───────────────────────────────────────
export const payMethods: PayMethod[] = [
  { id: 'upi', label: 'UPI', note: 'Google Pay, PhonePe, Paytm', pct: 0 },
  { id: 'netbanking', label: 'Net Banking', note: 'All major banks', pct: 1 },
  { id: 'credit', label: 'Credit Card', note: 'Visa, Mastercard, Amex, RuPay', pct: 2 },
  { id: 'debit', label: 'Debit Card', note: 'Visa, Mastercard, RuPay', pct: 0.5 },
  { id: 'smartepp', label: 'Smart EPP (EMI)', note: 'Pay monthly · corporate financing', pct: 0 },
];

// EMI tenures for the Smart EPP option (beyond-handoff, flat demo rates).
export const emiPlans: EmiPlan[] = [
  { months: 3, rate: 0.02 },
  { months: 6, rate: 0.045 },
  { months: 9, rate: 0.07 },
  { months: 12, rate: 0.095 },
];

// ─── Demo shoppers (login autofill) ──────────────────────────────────────────
export const demoShoppers: DemoShopper[] = [
  { name: 'Rohan Mehta', company: 'Acme Corp', email: 'rohan.m@acme.com' },
  { name: 'Sara Iyer', company: 'Nexus Systems', email: 'sara.i@nexus.com' },
];
export const DEMO_PASSWORD = 'imcorp@2026';

// ─── Profile ─────────────────────────────────────────────────────────────────
export const storeProfile: ShopProfile = {
  name: 'Rohan Mehta',
  initials: 'RM',
  email: 'rohan.m@acme.com',
  company: 'Acme Corp',
  program: 'EPP',
  creditLimit: 360000,
  creditUsed: 189900,
  addresses: [
    { label: 'Office', line: 'Acme Corp, 1 Corporate Park, Bengaluru 560001' },
    { label: 'Home', line: '42 Residency Rd, Bengaluru 560025' },
  ],
};

// ─── Default wishlist ────────────────────────────────────────────────────────
export const defaultWishlist = ['p3', 'p5'];

// ─── Orders ──────────────────────────────────────────────────────────────────
const line = (
  id: string,
  name: string,
  brand: string,
  vendor: StoreOrderLine['vendor'],
  shade: string,
  qty: number,
  price: number,
  g1: string,
  g2: string,
): StoreOrderLine => ({ id, name, brand, vendor, shade, qty, price, g1, g2 });

export const storeOrders: StoreOrder[] = [
  {
    id: '#IMC-20492', date: '2 Jul 2026', status: 'Processing', total: 147382, courier: 'Awaiting dispatch',
    vendorNote: 'imcorpcart · BlueDart', step: 1,
    lines: [line('p1', 'iPhone 15 Pro · 256GB', 'Apple', 'imcorpcart', 'Blue Titanium', 1, 124900, '#4a7fc0', '#123a72')],
  },
  {
    id: '#IMC-20485', date: '1 Jul 2026', status: 'In transit', total: 76699, courier: 'Delhivery',
    vendorNote: 'MobileHub · Delhivery', step: 2,
    lines: [line('p3', 'OnePlus 12 · 256GB', 'OnePlus', 'imcorpcart', 'Flowy Emerald', 1, 64999, '#1f6f52', '#0a2f22')],
  },
  {
    id: '#IMC-20478', date: '30 Jun 2026', status: 'Delivered', total: 30089, courier: 'BlueDart',
    vendorNote: 'imcorpcart · BlueDart', step: 4,
    lines: [line('a1', 'AirPods Pro (2nd gen)', 'Apple', 'imcorpcart', 'White', 1, 24900, '#f2f3f5', '#c6cad2')],
  },
  {
    id: '#IMC-20465', date: '28 Jun 2026', status: 'Cancelled', total: 33038, courier: '—',
    vendorNote: 'MobileHub', step: 0,
    lines: [line('p6', 'Nothing Phone (2a)', 'Nothing', 'MobileHub', 'White', 1, 27999, '#e6e8ec', '#b6bcc6')],
  },
];

export const trackingSteps = [
  'Order placed',
  'Packed at warehouse',
  'In transit',
  'Out for delivery',
  'Delivered',
];

// ─── Filter facet reference lists ────────────────────────────────────────────
export const categoryChips: { key: import('../store-types').StoreCategory; label: string }[] = [
  { key: 'all', label: 'All products' },
  { key: 'phones', label: 'Phones' },
  { key: 'accessories', label: 'Phone accessories' },
  { key: 'bags', label: 'Bags' },
];

export const sortOptions: { key: import('../store-types').SortKey; label: string }[] = [
  { key: 'featured', label: 'Featured' },
  { key: 'priceAsc', label: 'Price: low to high' },
  { key: 'priceDesc', label: 'Price: high to low' },
  { key: 'newest', label: 'Newest arrivals' },
];
