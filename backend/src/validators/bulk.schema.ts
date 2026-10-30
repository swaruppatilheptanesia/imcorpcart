import { z } from 'zod';
import { CourierCode, DeliveryMode } from '@prisma/client';

// ─── Blank-cell semantics ────────────────────────────────────────────────────
// A BLANK cell means "I am not managing this field here" and PRESERVES whatever
// the product already has. To actually empty a field, write the literal `CLEAR`.
//
// This is the inverse of the original rule, which read a present-but-blank cell
// as "clear this field". That cost us every product image on 13 Oct 2026: the
// client authors details in the sheet but uploads images through the admin
// product-edit page, so `image_urls` is always blank in their sheets — and a
// pricing update deleted 3,658 gallery rows across 697 products (restored by
// migration 20261014120000_restore_product_images_blanked_by_bulk_import).
//
// The same trap applied to every field maintained in the admin UI rather than
// typed into the sheet: descriptions, spec rows, About-this-item and In-the-box
// bullets, and the variant-family columns. Nobody re-types an uploaded
// `/uploads/<nanoid>.jpg` path into a spreadsheet, so blank was never a
// deliberate erasure there — it was the normal state of the column.
//
// Three columns keep the take-as-given behaviour, because they are priced in the
// sheet and a blank is meaningful: `mop_price`, `cashback_type`/`cashback_value`
// and `stock_quantity`. The `required()` columns still error on a blank cell.
const isBlank = (v: unknown): boolean => typeof v === 'string' && v.trim() === '';

/** The one way to deliberately empty a field from the sheet. */
const CLEAR = 'CLEAR';
const isClear = (v: unknown): boolean => typeof v === 'string' && v.trim().toUpperCase() === CLEAR;

/**
 * Optional column: blank cell → `undefined` (preserve), `CLEAR` → `null` (empty
 * it), anything else → parsed by `inner`. An absent column is `undefined` too.
 *
 * The inner schema must accept both `null` and `undefined`, because this
 * preprocess hands it whichever the cell resolved to — `.optional()` on the
 * OUTER wrapper only short-circuits a key that was missing from the row.
 */
const preserving = <T extends z.ZodTypeAny>(inner: T) =>
  z
    .preprocess(
      (v) => (isBlank(v) ? undefined : isClear(v) ? null : v),
      inner.nullable().optional(),
    )
    .optional();

/** Take-as-given column: empty cell → null (clear). Absent → undefined. */
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
 *  a multi-line cell is not representable.
 *
 *  Blank preserves the existing bullets; `CLEAR` empties them. A bare `[]` from a
 *  blank cell used to reach Prisma and overwrite the column with an empty array. */
const bullets = (max = 10) =>
  z
    .preprocess(
      (v) => {
        if (typeof v !== 'string') return v;
        if (v.trim() === '') return undefined;
        if (isClear(v)) return [];
        return v.split('|').map((b) => b.trim()).filter(Boolean);
      },
      z.array(z.string().max(300)).max(max).optional(),
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
  GATI: CourierCode.GATI,
  CRITICALLOG: CourierCode.CRITICALLOG,
  CRITICAL_LOG: CourierCode.CRITICALLOG,
  JAYDEEP: CourierCode.JAYDEEP,
  MOVIN: CourierCode.MOVIN,
  DELHIVERY_B2B: CourierCode.DELHIVERY_B2B,
  DELHIVERYB2B: CourierCode.DELHIVERY_B2B,
};

/** "Blue Dart" / "blue-dart" / "BLUEDART" → BLUEDART. */
const courierCell = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const key = v.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return COURIER_ALIASES[key] ?? v; // unknown falls through to a readable enum error
};

// How people actually write transport modes, mapped onto the DeliveryMode enum
// (the courier TAT vocabulary: APEX = air/priority, DP = domestic priority,
// SURFACE = ground). A bare "Air" resolves to APEX, the faster of the two air
// services — DP has to be asked for by name.
const MODE_ALIASES: Record<string, DeliveryMode> = {
  APEX: DeliveryMode.APEX,
  AIR: DeliveryMode.APEX,
  PRIORITY: DeliveryMode.APEX,
  DP: DeliveryMode.DP,
  DOMESTIC_PRIORITY: DeliveryMode.DP,
  SURFACE: DeliveryMode.SURFACE,
  ROAD: DeliveryMode.SURFACE,
  GROUND: DeliveryMode.SURFACE,
};

/** "Air" / "surface" / "Domestic Priority" → APEX / SURFACE / DP. */
const modeCell = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const key = v.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return MODE_ALIASES[key] ?? v; // unknown falls through to a readable enum error
};

/** "Applicable" / "Not Applicable", plus the Y/N forms the rest of the sheet uses.
 *
 *  Blank preserves the current flag — it used to read as `false`, so a sheet that
 *  simply didn't fill the column switched the plan off. "Not Applicable" (or N)
 *  is how you turn it off, which is also the only reading a client would expect. */
const applicable = () =>
  z
    .preprocess((v) => {
      if (typeof v !== 'string') return v;
      const t = v.trim().toLowerCase();
      if (!t) return undefined;
      if (['applicable', 'y', 'yes', 'true', '1'].includes(t)) return true;
      if (['not applicable', 'na', 'n/a', 'n', 'no', 'false', '0'].includes(t)) return false;
      return v; // fall through to the boolean parse → a readable row error
    }, z.boolean().optional())
    .optional();

// One product row from the client XLSX/CSV upload. Mirrors the columns of the
// bulk-import template (products + product_prices + inventory + product_images).
// Exported so the importer can validate each row individually (per-field errors).
export const importRow = z
  .object({
    sku: required(z.string().trim().min(1)),
    name: required(z.string().trim().min(1)),
    brand: preserving(z.string().trim()),
    description: preserving(z.string()),
    category: required(z.string().trim().min(1)), // free-text; created on import
    sub_category: preserving(z.string().trim()),
    color_options: preserving(z.string()),
    variant_options: preserving(z.string()),
    // Variant family: sibling SKUs sharing family_key collapse to one storefront
    // card with colour/storage selectors. Each row = one SKU (own colour + images
    // + price + stock). family_key is slug-normalised on import.
    family_key: preserving(z.string().trim()),
    option_color: preserving(z.string().trim()),
    option_variant: preserving(z.string().trim()),
    freebie_text: preserving(z.string().trim()),
    spec_rows: preserving(z.string()), // "Label: Value | Label: Value" → specs.rows[]
    status: preserving(z.enum(['DRAFT', 'ACTIVE', 'INACTIVE'])),
    // Smart EPP eligibility — a Y/N cell parsed to a boolean (Y/Yes/True/1 = true).
    // Blank preserves: it used to fall through to `false`, so any sheet without
    // the column filled quietly took products out of Smart EPP.
    smart_epp: z
      .preprocess((v) => {
        if (typeof v !== 'string') return v;
        const t = v.trim().toLowerCase();
        return t === '' ? undefined : ['y', 'yes', 'true', '1'].includes(t);
      }, z.boolean().optional())
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
    hsn_code: preserving(
      z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})$/, 'HSN must be 4, 6 or 8 digits'),
    ),
    gst_percent: z
      .preprocess((v) => (isBlank(v) ? undefined : isClear(v) ? null : v), percentCell().optional())
      .optional(),
    terms_text: preserving(z.string().max(4000)),
    warranty_text: preserving(z.string().max(2000)),
    country_of_origin: preserving(z.string().trim().max(60)),
    // Point-wise copy shown on the product page, pipe-separated.
    about_item: bullets(),
    in_the_box: bullets(),
    // 3–4 sibling SKUs for the "Frequently bought together" shelf. Stored as text
    // and resolved on read, so a SKU further down the same sheet still works.
    frequently_bought_skus: preserving(
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
    protection_plan_pct: z
      .preprocess((v) => (isBlank(v) ? undefined : isClear(v) ? null : v), percentCell().optional())
      .optional(),
    // Preferred courier + transport mode for dispatch — pre-selected, never
    // enforced.
    courier_partner: preserving(z.preprocess(courierCell, z.nativeEnum(CourierCode))),
    transport_mode: preserving(z.preprocess(modeCell, z.nativeEnum(DeliveryMode))),
    epp_price: required(z.coerce.number({ error: MONEY_ERR }).nonnegative()),
    smart_epp_price: preserving(z.coerce.number().nonnegative()),
    stock_quantity: required(z.coerce.number({ error: 'Must be a whole number of units' }).int().nonnegative()).default(0),
    image_urls: preserving(z.string()), // comma/pipe separated
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
