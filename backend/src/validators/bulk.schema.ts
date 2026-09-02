import { z } from 'zod';

// One product row from the client XLSX/CSV upload. Mirrors the columns of the
// bulk-import template (products + product_prices + inventory + product_images).
// Exported so the importer can validate each row individually (per-field errors).
export const importRow = z.object({
  sku: z.string().trim().min(1),
  name: z.string().trim().min(1),
  brand: z.string().trim().optional(),
  description: z.string().optional(),
  category: z.string().trim().min(1), // free-text; created on import
  sub_category: z.string().trim().optional(),
  color_options: z.string().optional(),
  variant_options: z.string().optional(),
  // Variant family: sibling SKUs sharing family_key collapse to one storefront
  // card with colour/storage selectors. Each row = one SKU (own colour + images
  // + price + stock). family_key is slug-normalised on import.
  family_key: z.string().trim().optional(),
  option_color: z.string().trim().optional(),
  option_variant: z.string().trim().optional(),
  freebie_text: z.string().trim().optional(),
  spec_rows: z.string().optional(), // "Label: Value | Label: Value" → specs.rows[]
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']).optional(),
  // Smart EPP eligibility — a Y/N cell parsed to a boolean (Y/Yes/True/1 = true).
  smart_epp: z
    .preprocess(
      (v) => (typeof v === 'string' ? ['y', 'yes', 'true', '1'].includes(v.trim().toLowerCase()) : v),
      z.boolean(),
    )
    .optional(),
  // Coerce numbers — CSV cells arrive as strings; coercion accepts both strings
  // and numbers so the import is robust regardless of how the client parses.
  mrp: z.coerce.number().nonnegative(),
  mop_price: z.coerce.number().nonnegative().optional(),
  // Cashback: type NONE/PERCENT/FIXED (blank = NONE) + its value (% or ₹/unit).
  cashback_type: z
    .preprocess((v) => {
      if (typeof v !== 'string') return v;
      const s = v.trim().toUpperCase();
      if (!s) return 'NONE';
      if (['P', 'PERCENT', '%'].includes(s)) return 'PERCENT';
      if (['F', 'FIXED', '₹', 'RS'].includes(s)) return 'FIXED';
      return s;
    }, z.enum(['NONE', 'PERCENT', 'FIXED']))
    .optional(),
  cashback_value: z.coerce.number().nonnegative().optional(),
  // Tax + policy attributes (master-level).
  hsn_code: z.string().trim().max(20).optional(),
  gst_percent: z.coerce.number().min(0).max(100).optional(),
  terms_text: z.string().max(4000).optional(),
  warranty_text: z.string().max(2000).optional(),
  epp_price: z.coerce.number().nonnegative(),
  smart_epp_price: z.coerce.number().nonnegative().optional(),
  stock_quantity: z.coerce.number().int().nonnegative().default(0),
  image_urls: z.string().optional(), // comma/pipe separated
});

// The import endpoint accepts loose rows (raw key/value cells) and validates each
// row individually in the service, so one bad row surfaces a per-field error
// instead of 422-ing the whole file.
export const bulkImportBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});

export const bulkPriceUpdateBody = z.object({
  scope: z.enum(['all', 'phones', 'accessories', 'bags']).default('all'),
  adjustment: z.enum(['increasePct', 'decreasePct', 'setAmount']),
  value: z.number(),
  priceType: z.enum(['EPP', 'SMART_EPP']).default('EPP'),
});

// Set cashback on every product in a scope (mirrors the price-update tool).
export const bulkCashbackUpdateBody = z.object({
  scope: z.enum(['all', 'phones', 'accessories', 'bags']).default('all'),
  cashbackType: z.enum(['NONE', 'PERCENT', 'FIXED']),
  cashbackValue: z.coerce.number().nonnegative().optional(),
});

export type BulkImportRow = z.infer<typeof importRow>;
export type BulkImportInput = z.infer<typeof bulkImportBody>;
export type BulkPriceUpdateInput = z.infer<typeof bulkPriceUpdateBody>;
export type BulkCashbackUpdateInput = z.infer<typeof bulkCashbackUpdateBody>;
