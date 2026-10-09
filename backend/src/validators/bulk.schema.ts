import { z } from 'zod';
import { CourierCode } from '@prisma/client';

// ─── Blank-cell semantics ────────────────────────────────────────────────────
// The sheet's COLUMNS are a product's full truth:
//   • a column PRESENT with an empty cell  → clears that field
//   • a column ABSENT from the sheet       → never reaches the row object, stays
//                                            `undefined`, and Prisma leaves the
//                                            column alone
// That is what makes a partial update sheet safe: uploading only
// `sku,name,category,mrp,epp_price,stock_quantity` cannot wipe the rest.
const isBlank = (v: unknown): boolean => typeof v === 'string' && v.trim() === '';

/** Nullable column: empty cell → null (clear). Absent → undefined (preserve). */
const clearable = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (isBlank(v) ? null : v), inner.nullable()).optional();

/** Required column: an empty cell must read as MISSING so zod still raises
 *  "Required". Without this `z.coerce.number()` would turn '' into 0 (because
 *  `Number('') === 0`) and silently price a product at zero. */
const required = <T extends z.ZodTypeAny>(inner: T) =>
  z.preprocess((v) => (isBlank(v) ? undefined : v), inner);

// Required money columns: a blank cell must read as an error, not as 0.
const MONEY_ERR = 'Required — must be an amount in rupees (this column cannot be blank)';

/** Point-wise cell: pipe-separated, matching `spec_rows`. A pipe rather than a
 *  newline because the CSV parser splits on newlines before honouring quotes, so
 *  a multi-line cell is not representable. */
const bullets = (max = 10) =>
  z
    .preprocess(
      (v) => {
        if (typeof v !== 'string') return v;
        return v.split('|').map((b) => b.trim()).filter(Boolean);
      },
      z.array(z.string().max(300)).max(max),
    )
    .optional();

/** A cell the client writes as a percentage ("18%", "18 %", "18"). */
const percentCell = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/[%\s,]/g, '') : v),
    z.coerce
      .number({ error: 'Must be a percentage between 0 and 100 (e.g. 18 or 18%)' })
      .min(0)
      .max(100)
      .nullable(),
  );

// How people actually write courier names, mapped onto the CourierCode enum.
const COURIER_ALIASES: Record<string, CourierCode> = {
  BLUE_DART: CourierCode.BLUEDART,
  BLUEDART: CourierCode.BLUEDART,
  DELHIVERY: CourierCode.DELHIVERY,
  DTDC: CourierCode.DTDC,
  EKART: CourierCode.EKART,
  INDIA_POST: CourierCode.INDIA_POST,
  INDIAPOST: CourierCode.INDIA_POST,
  SPEED_POST: CourierCode.INDIA_POST,
};

/** "Blue Dart" / "blue-dart" / "BLUEDART" → BLUEDART. */
const courierCell = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const key = v.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return COURIER_ALIASES[key] ?? v; // unknown falls through to a readable enum error
};

/** "Applicable" / "Not Applicable", plus the Y/N forms the rest of the sheet uses. */
const applicable = () =>
  z
    .preprocess((v) => {
      if (typeof v !== 'string') return v;
      const t = v.trim().toLowerCase();
      if (!t) return false;
      if (['applicable', 'y', 'yes', 'true', '1'].includes(t)) return true;
      if (['not applicable', 'na', 'n/a', 'n', 'no', 'false', '0'].includes(t)) return false;
      return v; // fall through to the boolean parse → a readable row error
    }, z.boolean())
    .optional();

// One product row from the client XLSX/CSV upload. Mirrors the columns of the
// bulk-import template (products + product_prices + inventory + product_images).
// Exported so the importer can validate each row individually (per-field errors).
export const importRow = z
  .object({
    sku: required(z.string().trim().min(1)),
    name: required(z.string().trim().min(1)),
    brand: clearable(z.string().trim()),
    description: clearable(z.string()),
    category: required(z.string().trim().min(1)), // free-text; created on import
    sub_category: clearable(z.string().trim()),
    color_options: clearable(z.string()),
    variant_options: clearable(z.string()),
    // Variant family: sibling SKUs sharing family_key collapse to one storefront
    // card with colour/storage selectors. Each row = one SKU (own colour + images
    // + price + stock). family_key is slug-normalised on import.
    family_key: clearable(z.string().trim()),
    option_color: clearable(z.string().trim()),
    option_variant: clearable(z.string().trim()),
    freebie_text: clearable(z.string().trim()),
    spec_rows: clearable(z.string()), // "Label: Value | Label: Value" → specs.rows[]
    status: clearable(z.enum(['DRAFT', 'ACTIVE', 'INACTIVE'])),
    // Smart EPP eligibility — a Y/N cell parsed to a boolean (Y/Yes/True/1 = true).
    smart_epp: z
      .preprocess(
        (v) => (typeof v === 'string' ? ['y', 'yes', 'true', '1'].includes(v.trim().toLowerCase()) : v),
        z.boolean(),
      )
      .optional(),
    // Coerce numbers — CSV cells arrive as strings; coercion accepts both strings
    // and numbers so the import is robust regardless of how the client parses.
    mrp: required(z.coerce.number({ error: MONEY_ERR }).nonnegative()),
    mop_price: clearable(z.coerce.number().nonnegative()),
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
    cashback_value: clearable(z.coerce.number().nonnegative()),
    // Tax + policy attributes (master-level).
    // HSN/SAC is 4, 6 or 8 digits under GST — the required length depends on
    // turnover, so all three are accepted and anything else is a row error.
    hsn_code: clearable(
      z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN must be 4, 6 or 8 digits'),
    ),
    gst_percent: z.preprocess((v) => (isBlank(v) ? null : v), percentCell()).optional(),
    terms_text: clearable(z.string().max(4000)),
    warranty_text: clearable(z.string().max(2000)),
    country_of_origin: clearable(z.string().trim().max(60)),
    // Point-wise copy shown on the product page, pipe-separated.
    about_item: bullets(),
    in_the_box: bullets(),
    // 3–4 sibling SKUs for the "Frequently bought together" shelf. Stored as text
    // and resolved on read, so a SKU further down the same sheet still works.
    frequently_bought_skus: clearable(
      z
        .string()
        .trim()
        .refine(
          (v) => v.split(/[,|]/).map((x) => x.trim()).filter(Boolean).length <= 4,
          'At most 4 SKUs',
        ),
    ),
    // ADLD & theft protection plan: offered or not, and its rate as a % of the
    // EPP price. Display-only — see the Product model comment.
    protection_plan: applicable(),
    protection_plan_pct: z.preprocess((v) => (isBlank(v) ? null : v), percentCell()).optional(),
    // Preferred courier for dispatch — pre-selected, never enforced.
    courier_partner: clearable(z.preprocess(courierCell, z.nativeEnum(CourierCode))),
    epp_price: required(z.coerce.number({ error: MONEY_ERR }).nonnegative()),
    smart_epp_price: clearable(z.coerce.number().nonnegative()),
    stock_quantity: required(z.coerce.number({ error: 'Must be a whole number of units' }).int().nonnegative()).default(0),
    image_urls: clearable(z.string()), // comma/pipe separated
  })
  // A rate with no plan to attach it to is a data error, not something to
  // silently store — the product page would price a plan it never offers.
  .refine((r) => !(r.protection_plan_pct != null && r.protection_plan === false), {
    message: 'protection_plan_pct is set but protection_plan is Not Applicable',
    path: ['protection_plan_pct'],
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
