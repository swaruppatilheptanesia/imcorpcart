import { Prisma, PriceType, ProductStatus, CashbackType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { slugify } from '../utils/slug';
import { slugishFamily } from './product-write';
import type {
  BulkImportInput,
  BulkPriceUpdateInput,
  BulkCashbackUpdateInput,
  BulkImportRow,
} from '../validators/bulk.schema';

const D = (n: number) => new Prisma.Decimal(n);

function parseImageUrls(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[|,]/)
    .map((u) => u.trim())
    .filter(Boolean);
}

// "Display: 6.1-inch OLED | RAM: 8GB" → [{k:'Display', v:'6.1-inch OLED'}, …].
// Rows are pipe- or newline-separated; the first colon splits label from value.
function parseSpecRows(raw?: string): { k: string; v: string }[] {
  if (!raw) return [];
  return raw
    .split(/[|\n]/)
    .map((pair) => {
      const i = pair.indexOf(':');
      if (i === -1) return null;
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      return k && v ? { k, v } : null;
    })
    .filter((r): r is { k: string; v: string } => r !== null);
}

// Import product rows from the client spreadsheet. Categories are free-text and
// created on demand. Bulk-imported products are first-party (resellerId null).
export async function importProducts(input: BulkImportInput, actorId: string) {
  const result = {
    total: input.rows.length,
    created: 0,
    skipped: 0,
    errors: [] as { sku: string; reason: string }[],
  };

  // Resolve/create categories once, up front.
  const categoryCache = new Map<string, string>(); // slug -> id
  async function categoryId(name: string): Promise<string> {
    const slug = slugify(name);
    const cached = categoryCache.get(slug);
    if (cached) return cached;
    const cat = await prisma.category.upsert({
      where: { slug },
      create: { name, slug },
      update: {},
    });
    categoryCache.set(slug, cat.id);
    return cat.id;
  }

  for (const row of input.rows) {
    try {
      const exists = await prisma.product.findUnique({ where: { sku: row.sku } });
      if (exists) {
        result.skipped += 1;
        continue;
      }
      const catId = await categoryId(row.category);
      await createOneImportedProduct(row, catId);
      result.created += 1;
    } catch (e) {
      result.errors.push({ sku: row.sku, reason: e instanceof Error ? e.message : 'unknown' });
    }
  }

  // Audit the import.
  await prisma.auditLog.create({
    data: {
      actorId,
      action: 'catalog.bulk_import',
      entityType: 'Product',
      after: { created: result.created, skipped: result.skipped, errors: result.errors.length },
    },
  });

  return result;
}

async function createOneImportedProduct(row: BulkImportRow, categoryId: string) {
  const images = parseImageUrls(row.image_urls);
  const specRows = parseSpecRows(row.spec_rows);
  const status = (row.status as ProductStatus) ?? ProductStatus.DRAFT;
  await prisma.product.create({
    data: {
      sku: row.sku,
      name: row.name,
      brand: row.brand,
      description: row.description,
      categoryId,
      subCategory: row.sub_category,
      status,
      smartEpp: row.smart_epp ?? false, // Smart EPP (SEPP) eligibility (Y/N column)
      mrp: D(row.mrp), // product-level list price
      mop: row.mop_price !== undefined ? D(row.mop_price) : null, // public price (admin-set)
      cashbackType: row.cashback_type ?? 'NONE', // NONE | PERCENT | FIXED
      cashbackValue: row.cashback_value !== undefined ? D(row.cashback_value) : null,
      colorOptions: row.color_options,
      variantOptions: row.variant_options,
      // Variant family: siblings sharing family_key collapse to one storefront
      // card. family_key is slug-normalised (same as admin authoring) so bulk +
      // admin siblings group together. option_color/option_variant are this SKU's
      // colour + storage/size on the family selectors.
      familyKey: row.family_key ? slugishFamily(row.family_key) : null,
      optionColor: row.option_color ?? null,
      optionVariant: row.option_variant ?? null,
      freebieText: row.freebie_text ?? null,
      // Presentation blob the storefront reads (rows → spec table). Gradient/shades
      // are left default for bulk products; only the spec rows are authored here.
      ...(specRows.length ? { specs: { rows: specRows } } : {}),
      // Bulk products are first-party: one house offer (resellerId null) carries
      // the selling prices + stock.
      offers: {
        create: [
          {
            resellerId: null,
            eppPrice: D(row.epp_price),
            smartEppPrice: row.smart_epp_price !== undefined ? D(row.smart_epp_price) : null,
            quantity: row.stock_quantity ?? 0,
            status,
            isActive: status === ProductStatus.ACTIVE,
          },
        ],
      },
      ...(images.length
        ? { images: { create: images.map((url, i) => ({ url, position: i })) } }
        : {}),
    },
  });
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
