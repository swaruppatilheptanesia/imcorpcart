import { Prisma, ProductStatus, type CashbackType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { slugify } from '../utils/slug';

// Shared catalog-write helpers used by BOTH the CSV bulk importer
// (services/bulk.service.ts) and the inbound vendor importer
// (services/inbound/import.service.ts). A product is upserted by its (unique)
// SKU: master scalars on `Product`, price + stock on a single `ProductOffer`
// keyed by (productId, resellerId) — resellerId null = the first-party house
// offer (bulk), a reseller id = a vendor's offer (inbound).

export const D = (n: number) => new Prisma.Decimal(n);

/** "a | b, c" → ["a","b","c"] (pipe/comma separated, trimmed, non-empty). */
export function parseImageUrls(raw?: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[|,]/)
    .map((u) => u.trim())
    .filter(Boolean);
}

// "Display: 6.1-inch OLED | RAM: 8GB" → [{k:'Display', v:'6.1-inch OLED'}, …].
// Rows are pipe- or newline-separated; the first colon splits label from value.
export function parseSpecRows(raw?: string | null): { k: string; v: string }[] {
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

/** Upsert a category by slug (created on demand). Pass a Map to cache within a run. */
export async function upsertCategoryBySlug(name: string, cache?: Map<string, string>): Promise<string> {
  const slug = slugify(name);
  const cached = cache?.get(slug);
  if (cached) return cached;
  const cat = await prisma.category.upsert({ where: { slug }, create: { name, slug }, update: {} });
  cache?.set(slug, cat.id);
  return cat.id;
}

// The master scalars written on create + update (kept in one shape so both paths
// stay in sync). Optional keys left undefined are simply not written.
export interface ImportedScalars {
  name: string;
  brand?: string | null;
  description?: string | null;
  categoryId: string;
  subCategory?: string | null;
  status: ProductStatus;
  smartEpp?: boolean;
  mrp: Prisma.Decimal | null;
  mop?: Prisma.Decimal | null;
  cashbackType?: CashbackType;
  cashbackValue?: Prisma.Decimal | null;
  hsnCode?: string | null;
  gstPercent?: Prisma.Decimal | null;
  termsText?: string | null;
  warrantyText?: string | null;
  colorOptions?: string | null;
  variantOptions?: string | null;
  familyKey?: string | null;
  optionColor?: string | null;
  optionVariant?: string | null;
  freebieText?: string | null;
  sourceId?: string | null;
  externalRef?: string | null;
}

export interface ImportedOffer {
  resellerId: string | null; // null = house / first-party
  eppPrice: Prisma.Decimal;
  smartEppPrice?: Prisma.Decimal | null;
  quantity: number;
  status: ProductStatus;
  isActive: boolean;
}

export interface ImportedProductInput {
  sku: string;
  scalars: ImportedScalars;
  specRows?: { k: string; v: string }[];
  images?: string[];
  offer: ImportedOffer;
}

// Upsert a product + its single seller offer by SKU. Specs/images are replaced
// only when provided (so a partial re-sync doesn't wipe them). Returns whether a
// new product was created or an existing one updated.
export async function upsertImportedProduct(input: ImportedProductInput): Promise<'created' | 'updated'> {
  const { sku, scalars, specRows = [], images = [], offer } = input;
  const existing = await prisma.product.findUnique({ where: { sku }, select: { id: true } });

  if (!existing) {
    await prisma.product.create({
      data: {
        sku,
        ...scalars,
        ...(specRows.length ? { specs: { rows: specRows } } : {}),
        offers: { create: [offer] },
        ...(images.length ? { images: { create: images.map((url, i) => ({ url, position: i })) } } : {}),
      },
    });
    return 'created';
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: existing.id },
      data: {
        ...scalars,
        ...(specRows.length ? { specs: { rows: specRows } } : {}),
        ...(images.length
          ? { images: { deleteMany: {}, create: images.map((url, i) => ({ url, position: i })) } }
          : {}),
      },
    });
    // One offer per (product, seller). resellerId null → the house offer.
    const seller = await tx.productOffer.findFirst({ where: { productId: existing.id, resellerId: offer.resellerId } });
    if (seller) {
      await tx.productOffer.update({ where: { id: seller.id }, data: offer });
    } else {
      await tx.productOffer.create({ data: { productId: existing.id, ...offer } });
    }
  });
  return 'updated';
}
