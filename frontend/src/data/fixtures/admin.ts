import type { PayMethod, ReportDef, UserDataset, UserTab } from '../types';

/** Users tables by tab — from dataSets. */
export const userDatasets: Record<UserTab, UserDataset> = {
  companies: {
    headers: ['Company', 'Employees', 'GMV', 'Status', ''],
    rows: [
      { name: 'Nexus Systems', meta1: '480 employees', meta2: '₹1.42Cr', state: 'Active', initials: 'NS', avBg: '#2B7BE4' },
      { name: 'Acme Corp', meta1: '312 employees', meta2: '₹1.08Cr', state: 'Active', initials: 'AC', avBg: '#1E9E6A' },
      { name: 'Orbit Financial', meta1: '210 employees', meta2: '₹86.4L', state: 'Active', initials: 'OF', avBg: '#7A5AF0' },
      { name: 'Zenith Retail', meta1: '156 employees', meta2: '₹58.2L', state: 'Suspended', initials: 'ZR', avBg: '#E0921A' },
      { name: 'Vertex Health', meta1: '98 employees', meta2: '₹34.0L', state: 'Active', initials: 'VH', avBg: '#C0562B' },
      { name: 'Helios Media', meta1: '64 employees', meta2: '—', state: 'Invited', initials: 'HM', avBg: '#5B6270' },
    ],
  },
  employees: {
    headers: ['Employee', 'Company', 'Email', 'Status', ''],
    rows: [
      { name: 'Rohan Mehta', meta1: 'Acme Corp', meta2: 'rohan.m@acme.com', state: 'Active', initials: 'RM', avBg: '#2B7BE4' },
      { name: 'Sara Iyer', meta1: 'Nexus Systems', meta2: 'sara.i@nexus.io', state: 'Active', initials: 'SI', avBg: '#1E9E6A' },
      { name: 'Neha Kapoor', meta1: 'Orbit Financial', meta2: 'neha.k@orbit.com', state: 'Active', initials: 'NK', avBg: '#7A5AF0' },
      { name: 'Karan Shah', meta1: 'Zenith Retail', meta2: 'karan.s@zenith.in', state: 'Suspended', initials: 'KS', avBg: '#E0921A' },
      { name: 'Ananya Rao', meta1: 'Vertex Health', meta2: 'ananya.r@vertex.io', state: 'Active', initials: 'AR', avBg: '#C0562B' },
    ],
  },
  resellers: {
    headers: ['Reseller', 'Products', 'GMV', 'Status', ''],
    rows: [
      { name: 'TechnoReseller', meta1: '6 products', meta2: '₹2.4Cr', state: 'Active', initials: 'TR', avBg: '#1E9E6A' },
      { name: 'MobileHub', meta1: '9 products', meta2: '₹1.1Cr', state: 'Active', initials: 'MH', avBg: '#E0921A' },
      { name: 'GadgetPro', meta1: '12 products', meta2: '₹64.2L', state: 'Active', initials: 'GP', avBg: '#7A5AF0' },
      { name: 'UrbanCarry', meta1: '6 products', meta2: '₹41.8L', state: 'Pending', initials: 'UC', avBg: '#C0562B' },
    ],
  },
  partners: {
    headers: ['Fulfillment partner', 'Region', 'On-time', 'Status', ''],
    rows: [
      { name: 'SwiftShip Logistics', meta1: 'North + West', meta2: '97% on-time', state: 'Active', initials: 'SL', avBg: '#2B7BE4' },
      { name: 'MetroDispatch', meta1: 'South', meta2: '90% on-time', state: 'Active', initials: 'MD', avBg: '#1E9E6A' },
      { name: 'PrimeCarry', meta1: 'East', meta2: '—', state: 'Invited', initials: 'PC', avBg: '#5B6270' },
    ],
  },
};

export const userTabLabels: Record<UserTab, string> = {
  companies: 'Companies',
  employees: 'Employees',
  resellers: 'Resellers',
  partners: 'Fulfillment',
};

export const addUserLabel: Record<UserTab, string> = {
  companies: 'Add company',
  employees: 'Add employee',
  resellers: 'Add reseller',
  partners: 'Add partner',
};

/** Payments config — from payConfig. */
export const payConfig: PayMethod[] = [
  { id: 'upi', label: 'UPI', note: 'Google Pay, PhonePe, Paytm', value: 0 },
  { id: 'netbanking', label: 'Net Banking', note: 'All major banks', value: 1 },
  { id: 'credit', label: 'Credit Card', note: 'Visa, Mastercard, Amex, RuPay', value: 2 },
  { id: 'debit', label: 'Debit Card', note: 'Visa, Mastercard, RuPay', value: 0.5 },
];

export const gateways = [
  { id: 'razorpay', name: 'Razorpay', note: 'Primary · UPI, cards, net banking' },
  { id: 'payu', name: 'PayU', note: 'Backup gateway' },
];

/** Reports — from reportDefs. */
export const reportDefs: ReportDef[] = [
  { id: 'profit', title: 'Profitability report', desc: 'Margin by category, vendor, and company.', range: 'Last 30 days' },
  { id: 'volume', title: 'Volume & value', desc: 'Units and GMV across the catalog.', range: 'Last 30 days' },
  { id: 'perf', title: 'Product & partner performance', desc: 'Best/worst sellers and partner SLAs.', range: 'Quarter to date' },
  { id: 'company', title: 'Company intelligence', desc: 'Spend, headcount, and adoption per company.', range: 'Year to date' },
];

/** Bulk import column mapping — mirrors the downloadable product template. */
export const mappingRows = [
  { csv: 'sku', field: 'products.sku' },
  { csv: 'name', field: 'products.name' },
  { csv: 'category', field: 'products.categoryId' },
  { csv: 'sub_category', field: 'products.sub_category' },
  { csv: 'color_options', field: 'products.color_options' },
  { csv: 'variant_options', field: 'products.variant_options' },
  { csv: 'family_key', field: 'products.family_key (variant family)' },
  { csv: 'option_color', field: "products.option_color (this SKU's colour)" },
  { csv: 'option_variant', field: "products.option_variant (storage/size)" },
  { csv: 'freebie_text', field: 'products.freebie_text' },
  { csv: 'smart_epp', field: 'products.smart_epp (Y/N)' },
  { csv: 'mrp', field: 'products.mrp' },
  { csv: 'mop_price', field: 'products.mop' },
  { csv: 'cashback_type', field: 'products.cashback_type (NONE/PERCENT/FIXED)' },
  { csv: 'cashback_value', field: 'products.cashback_value (% or ₹/unit)' },
  { csv: 'epp_price', field: 'house offer eppPrice' },
  { csv: 'smart_epp_price', field: 'house offer smartEppPrice' },
  { csv: 'stock_quantity', field: 'house offer quantity' },
  { csv: 'image_urls', field: 'product_images.url' },
];

/** Login demo accounts — the seeded Super Admin (see backend/prisma/seed.ts). */
export const demoAccounts = [
  { label: 'Platform Super Admin', sub: 'Super Admin', fill: 'admin@imcorpcart.local' },
];

export const DEMO_PASSWORD = 'imcorp@2026';
