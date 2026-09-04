import { Prisma, PriceType, ProductStatus, CashbackType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { slugishFamily } from './product-write';
import {
  D,
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
    const parsed = importRow.safeParse(raw);
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
        specRows: parseSpecRows(row.spec_rows),
        images: parseImageUrls(row.image_urls),
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

// Shared master-scalar mapping so create + update stay in sync.
function productScalars(row: BulkImportRow, categoryId: string) {
  const status = (row.status as ProductStatus) ?? ProductStatus.DRAFT;
  return {
    name: row.name,
    brand: row.brand,
    description: row.description,
    categoryId,
    subCategory: row.sub_category,
    status,
    smartEpp: row.smart_epp ?? false,
    mrp: D(row.mrp),
    mop: row.mop_price !== undefined ? D(row.mop_price) : null,
    cashbackType: row.cashback_type ?? 'NONE',
    cashbackValue: row.cashback_value !== undefined ? D(row.cashback_value) : null,
    hsnCode: row.hsn_code ?? null,
    gstPercent: row.gst_percent !== undefined ? D(row.gst_percent) : null,
    termsText: row.terms_text ?? null,
    warrantyText: row.warranty_text ?? null,
    colorOptions: row.color_options,
    variantOptions: row.variant_options,
    familyKey: row.family_key ? slugishFamily(row.family_key) : null,
    optionColor: row.option_color ?? null,
    optionVariant: row.option_variant ?? null,
    freebieText: row.freebie_text ?? null,
  };
}

function houseOfferData(row: BulkImportRow, status: ProductStatus) {
  return {
    eppPrice: D(row.epp_price),
    smartEppPrice: row.smart_epp_price !== undefined ? D(row.smart_epp_price) : null,
    quantity: row.stock_quantity ?? 0,
    status,
    isActive: status === ProductStatus.ACTIVE,
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
