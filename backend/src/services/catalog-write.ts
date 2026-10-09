import { Prisma, ProductStatus, type CashbackType, type CourierCode } from '@prisma/client';
import { prisma } from '../config/prisma';
import { slugify } from '../utils/slug';
import { buildSpecs, type Presentation } from './product-write';

// Shared catalog-write helpers used by BOTH the CSV bulk importer
// (services/bulk.service.ts) and the inbound vendor importer
// (services/inbound/import.service.ts). A product is upserted by its (unique)
// SKU: master scalars on `Product`, price + stock on a single `ProductOffer`
// keyed by (productId, resellerId) — resellerId null = the first-party house
// offer (bulk), a reseller id = a vendor's offer (inbound).

export const D = (n: number) => new Prisma.Decimal(n);

/** Decimal for a nullable sheet cell, preserving the three-way distinction the
 *  importer relies on: `undefined` = column absent (Prisma skips the field),
 *  `null` = cell present but empty (Prisma clears it), a number = set it. */
export const DN = (n: number | null | undefined): Prisma.Decimal | null | undefined =>
  n === undefined || n === null ? n : D(n);

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
  // Optional: an absent `status` column leaves the product's status alone (and on
  // create Prisma applies the DRAFT default).
  status?: ProductStatus;
  smartEpp?: boolean;
  mrp: Prisma.Decimal | null;
  mop?: Prisma.Decimal | null;
  cashbackType?: CashbackType;
  countryOfOrigin?: string | null;
  aboutItem?: string[];
  inTheBox?: string[];
  frequentlyBoughtSkus?: string | null;
  protectionPlanAvailable?: boolean;
  protectionPlanPct?: Prisma.Decimal | null;
  courierCode?: CourierCode | null;
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
  status?: ProductStatus;
  isActive?: boolean;
}

export interface ImportedProductInput {
  sku: string;
  scalars: ImportedScalars;
  // Three-state, like every other sheet column: `undefined` = the column was not
  // in the sheet (leave alone), `[]` = the column was present but blank (clear),
  // a list = replace.
  specRows?: { k: string; v: string }[];
  images?: string[];
  offer: ImportedOffer;
}

// Upsert a product + its single seller offer by SKU. Specs/images are replaced
// only when provided (so a partial re-sync doesn't wipe them). Returns whether a
// new product was created or an existing one updated.
export async function upsertImportedProduct(input: ImportedProductInput): Promise<'created' | 'updated'> {
  const { sku, scalars, specRows, images, offer } = input;
  // `status` and the current `specs` are both needed: the house offer mirrors the
  // product's status, and spec rows must be merged into the existing blob rather
  // than replacing it.
  const existing = await prisma.product.findUnique({
    where: { sku },
    select: { id: true, status: true, specs: true },
  });

  // The offer's status/isActive follow the product's. An absent status column
  // keeps whatever the product already has (DRAFT for a brand-new one).
  const status = scalars.status ?? existing?.status ?? ProductStatus.DRAFT;
  const resolvedOffer = { ...offer, status, isActive: status === ProductStatus.ACTIVE };

  // Spec rows live inside `specs` alongside the admin-authored gradients and
  // per-colour shades/stock, so writing a bare `{ rows }` would destroy those.
  // buildSpecs folds the rows into the current blob instead.
  const specsPatch = (current?: Prisma.JsonValue | null) =>
    specRows === undefined
      ? {}
      : {
          specs: buildSpecs(
            { specRows },
            (current ?? undefined) as Partial<Presentation> | undefined,
          ) as unknown as Prisma.InputJsonValue,
        };

  if (!existing) {
    await prisma.product.create({
      data: {
        sku,
        ...scalars,
        status,
        ...specsPatch(null),
        offers: { create: [resolvedOffer] },
        ...(images?.length ? { images: { create: images.map((url, i) => ({ url, position: i })) } } : {}),
      },
    });
    return 'created';
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: existing.id },
      data: {
        ...scalars,
        status,
        ...specsPatch(existing.specs),
        // A present-but-blank image_urls column clears the gallery; an absent
        // column leaves it alone.
        ...(images === undefined
          ? {}
          : { images: { deleteMany: {}, create: images.map((url, i) => ({ url, position: i })) } }),
      },
    });
    // One offer per (product, seller). resellerId null → the house offer.
    const seller = await tx.productOffer.findFirst({
      where: { productId: existing.id, resellerId: resolvedOffer.resellerId },
    });
    if (seller) {
      await tx.productOffer.update({ where: { id: seller.id }, data: resolvedOffer });
    } else {
      await tx.productOffer.create({ data: { productId: existing.id, ...resolvedOffer } });
    }
  });
  return 'updated';
}
