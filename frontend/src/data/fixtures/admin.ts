import type { PayMethod, UserDataset, UserTab } from '../types';

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
  leasing: {
    headers: ['Leasing company', 'Operator', 'Companies', 'Status', ''],
    rows: [
      { name: 'LeaseFin Capital', meta1: 'ops@leasefin.com', meta2: '1 company', state: 'Active', initials: 'LC', avBg: '#7A5AF0' },
    ],
  },
};

export const userTabLabels: Record<UserTab, string> = {
  companies: 'Companies',
  employees: 'Employees',
  resellers: 'Resellers',
  partners: 'Fulfillment',
  leasing: 'Leasing',
};

export const addUserLabel: Record<UserTab, string> = {
  companies: 'Add company',
  employees: 'Add employee',
  resellers: 'Add reseller',
  partners: 'Add partner',
  leasing: 'Add leasing company',
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

/** Bulk import column mapping, shown to the client on the Bulk operations screen.
 *  MIRRORS the COLUMNS array in scripts/generate-product-template.mjs, which is
 *  the source of truth — keep the same order and update both on every column
 *  change. (This list had drifted to 23 of 27 columns before being regenerated.) */
export const mappingRows: { csv: string; field: string; required?: boolean }[] = [
  { csv: 'sku', field: 'products.sku (unique)', required: true },
  { csv: 'name', field: 'products.name', required: true },
  { csv: 'brand', field: 'products.brand' },
  { csv: 'description', field: 'products.description' },
  { csv: 'category', field: 'products.categoryId (matched/created by name)', required: true },
  { csv: 'sub_category', field: 'products.sub_category' },
  { csv: 'color_options', field: 'products.color_options' },
  { csv: 'variant_options', field: 'products.variant_options' },
  { csv: 'family_key', field: 'products.family_key (variant-family group)' },
  { csv: 'option_color', field: "products.option_color (this SKU's colour)" },
  { csv: 'option_variant', field: "products.option_variant (this SKU's storage/size)" },
  { csv: 'spec_rows', field: 'products.specs → rows[] (spec table on the product page)' },
  { csv: 'about_item', field: 'products.about_item → the About-this-item bullets' },
  { csv: 'in_the_box', field: 'products.in_the_box → the box-contents list' },
  { csv: 'freebie_text', field: 'products.freebie_text (free-gift note)' },
  { csv: 'status', field: 'products.status (default DRAFT)' },
  { csv: 'smart_epp', field: 'products.smart_epp · comes under Smart EPP (SAPP)' },
  { csv: 'mrp', field: 'products.mrp · list price (₹)', required: true },
  { csv: 'mop_price', field: 'products.mop · public/pre-login price (₹, defaults to mrp)' },
  { csv: 'cashback_type', field: 'products.cashback_type' },
  { csv: 'cashback_value', field: 'products.cashback_value' },
  { csv: 'hsn_code', field: 'products.hsn_code' },
  { csv: 'gst_percent', field: 'products.gst_percent' },
  { csv: 'terms_text', field: 'products.terms_text' },
  { csv: 'warranty_text', field: 'products.warranty_text' },
  { csv: 'country_of_origin', field: 'products.country_of_origin' },
  { csv: 'adld', field: 'products.protection_plan_available (ADLD & theft cover)' },
  { csv: 'adld_pct', field: 'products.protection_plan_pct (% of the EPP price)' },
  { csv: 'frequently_bought_skus', field: 'products.frequently_bought_skus → Frequently bought together' },
  { csv: 'courier_partner', field: 'products.courier_code (dispatch default)' },
  { csv: 'transport_mode', field: 'products.delivery_mode (dispatch default)' },
  { csv: 'epp_price', field: 'house offer eppPrice · EPP price (₹)', required: true },
  { csv: 'smart_epp_price', field: 'house offer smartEppPrice · Smart-EPP price (₹)' },
  { csv: 'stock_quantity', field: 'house offer quantity (stock)', required: true },
  { csv: 'image_urls', field: 'product_images.url + position (first = primary)' },
];

/** Login demo accounts — the seeded Super Admin (see backend/prisma/seed.ts). */
export const demoAccounts = [
  { label: 'Platform Super Admin', sub: 'Super Admin', fill: 'admin@imcorpcart.local' },
];

export const DEMO_PASSWORD = 'imcorp@2026';
