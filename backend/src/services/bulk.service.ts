import { Prisma, PriceType, ProductStatus, CashbackType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { slugishFamily } from './product-write';
import {
  D,
  DN,
  parseImageUrls,
  parseSpecRows,
  upsertCategoryBySlug,
  upsertImportedProduct,
} from './catalog-write';
import { importRow } from '../validators/bulk.schema';
import type {
  BulkImportInput,
  BulkPriceUpdateInput,
  BulkCashbackUpdateInput,
  BulkImportRow,
} from '../validators/bulk.schema';

// Import product rows from the client spreadsheet. Each raw row is validated
// individually (per-field errors, one bad row never fails the whole file), then
// UPSERTED — a new SKU is created, an existing SKU is updated. Categories are
// free-text and created on demand. Bulk-imported products are first-party
// (the house offer, resellerId null, carries the selling price + stock).
export async function importProducts(input: BulkImportInput, actorId: string) {
  const result = {
    total: input.rows.length,
    created: 0,
    updated: 0,
    errors: [] as { sku: string; field: string; message: string }[],
  };

  // Resolve/create categories once, up front (cached per run).
  const categoryCache = new Map<string, string>(); // slug -> id

  for (let i = 0; i < input.rows.length; i++) {
    const raw = input.rows[i];
    const rawSku = typeof raw.sku === 'string' ? raw.sku.trim() : String(raw.sku ?? '');
    const label = rawSku || `(row ${i + 2})`; // +2 = header row + 1-based

    // Per-row validation → per-field errors.
    const parsed = importRow.safeParse(applyHeaderAliases(raw));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.errors.push({ sku: label, field: String(issue.path[0] ?? '—'), message: issue.message });
      }
      continue;
    }
    const row = parsed.data;

    try {
      const catId = await upsertCategoryBySlug(row.category, categoryCache);
      const scal = productScalars(row, catId);
      const outcome = await upsertImportedProduct({
        sku: row.sku,
        scalars: scal,
        // `undefined` = the sheet isn't managing these (a blank or absent cell) →
        // leave them alone. `null` = the cell said CLEAR → parse to `[]`, which is
        // what the update path reads as "empty these".
        specRows: row.spec_rows === undefined ? undefined : parseSpecRows(row.spec_rows),
        images: row.image_urls === undefined ? undefined : parseImageUrls(row.image_urls),
        offer: { resellerId: null, ...houseOfferData(row, scal.status) },
      });
      if (outcome === 'created') result.created += 1;
      else result.updated += 1;
    } catch (e) {
      result.errors.push({ sku: label, field: '—', message: e instanceof Error ? e.message : 'unknown' });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'catalog.bulk_import',
      entityType: 'Product',
      after: { created: result.created, updated: result.updated, errors: result.errors.length },
    },
  });

  return result;
}

// Header aliases the importer accepts alongside the canonical column names.
//
// The client knows this field as ADLD; the database column, the Prisma field and
// the API have always called it the protection plan. Accepting both keeps every
// sheet already in circulation working after the template was relabelled.
//
// Aliasing happens HERE rather than in the admin screen's CSV parser because the
// endpoint takes loose rows (`bulkImportBody` is a record of unknown), so a sheet
// posted by anything other than that screen has to be aliased too.
const HEADER_ALIASES: Record<string, string> = {
  adld: 'protection_plan',
  adld_pct: 'protection_plan_pct',
};

/**
 * Copy aliased columns onto their canonical keys.
 *
 * The canonical name wins when a sheet somehow carries both, and an alias only
 * fills a key that is *absent* — so aliasing can never silently override a
 * column the sheet stated outright. An absent key stays absent, which is what
 * preserves the field (see the blank-cell semantics in validators/bulk.schema).
 */
function applyHeaderAliases(raw: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const [alias, canonical] of Object.entries(HEADER_ALIASES)) {
    if (alias in raw && !(canonical in raw)) {
      out ??= { ...raw };
      out[canonical] = raw[alias];
    }
  }
  return out ?? raw;
}

// Shared master-scalar mapping so create + update stay in sync.
// Row → Product scalars.
//
// Values are passed through UNTOUCHED on purpose. The row schema has already
// mapped a blank or absent cell to `undefined` (preserve) and a `CLEAR` cell to
// `null`, and Prisma honours exactly that distinction: it skips `undefined` and
// writes `null`. The old `?? null` coercions here collapsed the two, which is
// why a price-only update sheet used to wipe unrelated fields.
function productScalars(row: BulkImportRow, categoryId: string) {
  return {
    name: row.name,
    brand: row.brand,
    description: row.description,
    categoryId,
    subCategory: row.sub_category,
    status: row.status ?? undefined,
    smartEpp: row.smart_epp,
    mrp: D(row.mrp),
    mop: DN(row.mop_price),
    cashbackType: row.cashback_type,
    cashbackValue: DN(row.cashback_value),
    hsnCode: row.hsn_code,
    gstPercent: DN(row.gst_percent),
    termsText: row.terms_text,
    warrantyText: row.warranty_text,
    countryOfOrigin: row.country_of_origin,
    aboutItem: row.about_item,
    inTheBox: row.in_the_box,
    frequentlyBoughtSkus: normaliseSkuList(row.frequently_bought_skus),
    protectionPlanAvailable: row.protection_plan,
    protectionPlanPct: DN(row.protection_plan_pct),
    courierCode: row.courier_partner,
    colorOptions: row.color_options,
    variantOptions: row.variant_options,
    familyKey: row.family_key ? slugishFamily(row.family_key) : row.family_key,
    optionColor: row.option_color,
    optionVariant: row.option_variant,
    freebieText: row.freebie_text,
  };
}

// "RM-C100X-G64, AC-CASE-01 | AC-GLASS-02" → "RM-C100X-G64,AC-CASE-01,AC-GLASS-02".
// Stored canonically so the read side can split on a single separator.
function normaliseSkuList(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const skus = raw.split(/[,|]/).map((x) => x.trim()).filter(Boolean);
  return skus.length ? skus.join(',') : null;
}

// The house offer mirrors the product's status, so the sheet can activate a
// product and its listing in one cell. An ABSENT status column leaves both
// alone (and on create Prisma applies the schema defaults).
function houseOfferData(row: BulkImportRow, status: ProductStatus | undefined) {
  return {
    eppPrice: D(row.epp_price),
    smartEppPrice: DN(row.smart_epp_price),
    quantity: row.stock_quantity,
    ...(status ? { status, isActive: status === ProductStatus.ACTIVE } : {}),
  };
}

// Apply a price adjustment across a scope (category group) of products.
export async function bulkPriceUpdate(input: BulkPriceUpdateInput) {
  const where: Prisma.ProductWhereInput = { ...notDeleted };
  if (input.scope !== 'all') {
    where.category = { slug: input.scope };
  }

  const products = await prisma.product.findMany({ where, select: { id: true } });
  const ids = products.map((p) => p.id);
  const priceType = input.priceType as PriceType;
  const isSmart = priceType === PriceType.SMART_EPP;

  const adjust = (current: number) => {
    let next = current;
    if (input.adjustment === 'increasePct') next = current * (1 + input.value / 100);
    else if (input.adjustment === 'decreasePct') next = current * (1 - input.value / 100);
    else next = input.value;
    return Math.max(0, Math.round(next * 100) / 100);
  };

  let affected = 0;
  await prisma.$transaction(async (tx) => {
    // Apply across every live offer's selling price for the chosen price type.
    const offers = await tx.productOffer.findMany({ where: { productId: { in: ids }, ...notDeleted } });
    for (const offer of offers) {
      const current = isSmart ? offer.smartEppPrice?.toNumber() : offer.eppPrice.toNumber();
      if (current === undefined || current === null) continue; // no Smart-EPP price on this offer
      const next = adjust(current);
      await tx.productOffer.update({
        where: { id: offer.id },
        data: isSmart ? { smartEppPrice: D(next) } : { eppPrice: D(next) },
      });
      affected += 1;
    }
  });

  return serialize({ scope: input.scope, priceType, matchedProducts: ids.length, affectedPrices: affected });
}

// Set cashback (type + value) on every product in a scope. Mirrors bulkPriceUpdate's
// scope resolution; NONE clears the value.
export async function bulkCashbackUpdate(input: BulkCashbackUpdateInput, actorId: string) {
  const where: Prisma.ProductWhereInput = { ...notDeleted };
  if (input.scope !== 'all') {
    where.category = { slug: input.scope };
  }

  const isNone = input.cashbackType === 'NONE';
  if (!isNone && (input.cashbackValue === undefined || input.cashbackValue <= 0)) {
    throw AppError.badRequest('A cashback value greater than 0 is required for PERCENT or FIXED.');
  }

  const data: Prisma.ProductUpdateManyMutationInput = isNone
    ? { cashbackType: CashbackType.NONE, cashbackValue: null }
    : { cashbackType: input.cashbackType as CashbackType, cashbackValue: D(input.cashbackValue!) };

  const { count } = await prisma.product.updateMany({ where, data });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'catalog.bulk_cashback',
      entityType: 'Product',
      after: { scope: input.scope, cashbackType: input.cashbackType, cashbackValue: input.cashbackValue ?? null, matched: count },
    },
  });

  return serialize({ scope: input.scope, cashbackType: input.cashbackType, matchedProducts: count });
}
