import type { VendorAdapter, VendorSourceContext, NormalizedRow } from '../types';

// A keyless demo adapter that yields a handful of canned products spanning
// mobiles, laptops, bags and accessories — so the whole inbound pipeline
// (source → sync → DRAFT → publish → storefront) is verifiable without a live
// vendor. Set config.demoErrors = true to also emit one invalid row (bad MRP)
// so the PARTIAL-run / error-log path can be exercised.
const ROWS: NormalizedRow[] = [
  {
    externalRef: 'SMP-PH-1001',
    name: 'Nimbus N5 5G',
    brand: 'Nimbus',
    category: 'Mobiles',
    subCategory: 'Smartphones',
    mrp: 18999,
    description: '6.5" AMOLED, 5000mAh, 50MP camera.',
    images: [],
    specRows: [
      { k: 'Display', v: '6.5" AMOLED 120Hz' },
      { k: 'Battery', v: '5000 mAh' },
      { k: 'RAM', v: '8 GB' },
    ],
    hsnCode: '8517',
    gstPercent: 18,
    warrantyText: '1 year manufacturer warranty',
    stock: 40,
  },
  {
    externalRef: 'SMP-LP-2001',
    name: 'Orbit Book 14 Laptop',
    brand: 'Orbit',
    category: 'Laptops',
    subCategory: 'Ultrabooks',
    mrp: 61999,
    description: '14" 2.2K, Core i5, 16GB RAM, 512GB SSD.',
    images: [],
    specRows: [
      { k: 'CPU', v: 'Intel Core i5' },
      { k: 'RAM', v: '16 GB' },
      { k: 'Storage', v: '512 GB SSD' },
    ],
    hsnCode: '8471',
    gstPercent: 18,
    warrantyText: '1 year onsite warranty',
    stock: 15,
  },
  {
    externalRef: 'SMP-BG-3001',
    name: 'TrailPeak 30L Backpack',
    brand: 'TrailPeak',
    category: 'Bags',
    subCategory: 'Backpacks',
    mrp: 3499,
    description: 'Water-resistant 30L daypack with laptop sleeve.',
    images: [],
    specRows: [
      { k: 'Capacity', v: '30 L' },
      { k: 'Material', v: 'Ripstop polyester' },
    ],
    hsnCode: '4202',
    gstPercent: 18,
    stock: 120,
  },
  {
    externalRef: 'SMP-AC-4001',
    name: 'Pulse ANC Wireless Earbuds',
    brand: 'Pulse',
    category: 'Accessories',
    subCategory: 'Audio',
    mrp: 4999,
    description: 'True-wireless earbuds with active noise cancellation.',
    images: [],
    specRows: [
      { k: 'Battery', v: '24 h with case' },
      { k: 'ANC', v: 'Yes' },
    ],
    hsnCode: '8518',
    gstPercent: 18,
    warrantyText: '6 months warranty',
    stock: 200,
  },
];

const BAD_ROW: NormalizedRow = {
  externalRef: 'SMP-BAD-9999',
  name: 'Broken Demo Item',
  brand: 'Demo',
  category: 'Accessories',
  mrp: 0, // invalid → lands in the run's errors, forces a PARTIAL run
  stock: 1,
};

export const sampleAdapter: VendorAdapter = {
  key: 'sample',
  label: 'Sample (demo data)',
  async *fetchRows(ctx: VendorSourceContext): AsyncIterable<NormalizedRow> {
    for (const row of ROWS) yield row;
    if (ctx.config?.demoErrors === true) yield BAD_ROW;
  },
};
