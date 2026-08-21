import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { parsePagination, pageMeta } from '../utils/pagination';
import { productListSelect, productFullInclude, offerSelect, notDeleted } from '../models/selectors';
import { serialize } from '../models/serializers';
import { D, buildSpecs, colorOptionsFrom, ensureOwnedGift, slugishFamily, type Presentation } from './product-write';
import type {
  CreateProductInput,
  UpdateProductInput,
  AttachOfferInput,
  UpdateOfferInput,
  BulkProductInput,
  ProductListQuery,
} from '../validators/product.schema';

// Distinct family keys in use — powers the admin form's family datalist.
export async function listFamilies() {
  const rows = await prisma.product.findMany({
    where: { familyKey: { not: null }, ...notDeleted },
    distinct: ['familyKey'],
    select: { familyKey: true },
    orderBy: { familyKey: 'asc' },
  });
  return { data: rows.map((r) => r.familyKey).filter(Boolean) };
}

// Map the frontend "group" filter (a category slug/name) to a where clause.
function groupWhere(group?: string): Prisma.ProductWhereInput {
  if (!group || group === 'all') return {};
  return {
    category: {
      OR: [{ slug: group }, { slug: { equals: group, mode: 'insensitive' } }],
    },
  };
}

export async function listProducts(query: ProductListQuery) {
  const p = parsePagination(query);
  const where: Prisma.ProductWhereInput = {
    ...notDeleted,
    ...groupWhere(query.group),
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { sku: { contains: query.q, mode: 'insensitive' } },
            { brand: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      select: productListSelect,
      orderBy: { createdAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.product.count({ where }),
  ]);

  return { data: serialize(rows), meta: pageMeta(total, p) };
}

export async function getProduct(id: string) {
  const product = await prisma.product.findFirst({
    where: { id, ...notDeleted },
    include: productFullInclude,
  });
  if (!product) throw AppError.notFound('Product not found');
  return serialize(product);
}

// ─── Master authoring (descriptive fields + list MRP; no price/stock) ─────────

export async function createProduct(input: CreateProductInput) {
  const { images, ...rest } = input;
  const product = await prisma.product.create({
    data: {
      sku: rest.sku,
      name: rest.name,
      brand: rest.brand,
      description: rest.description,
      categoryId: rest.categoryId,
      subCategory: rest.subCategory,
      status: rest.status ?? 'DRAFT',
      smartEpp: rest.smartEpp ?? false,
      mrp: rest.mrp !== undefined ? D(rest.mrp) : null,
      mop: rest.mop !== undefined ? D(rest.mop) : null,
      cashbackType: rest.cashbackType ?? 'NONE',
      cashbackValue: rest.cashbackValue !== undefined ? D(rest.cashbackValue) : null,
      familyKey: rest.familyKey ? slugishFamily(rest.familyKey) : null,
      optionColor: rest.optionColor ?? null,
      optionVariant: rest.optionVariant ?? null,
      colorOptions: colorOptionsFrom(rest.shades),
      variantOptions: rest.variantOptions,
      freebieText: rest.freebieText ?? null,
      specs: buildSpecs(rest) as unknown as Prisma.InputJsonValue,
      ...(images && images.length
        ? { images: { create: images.map((img, i) => ({ url: img.url, alt: img.alt, position: img.position ?? i })) } }
        : {}),
    },
    include: productFullInclude,
  });
  return serialize(product);
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  const existing = await prisma.product.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Product not found');

  const { images, ...rest } = input;
  const existingSpecs = (existing.specs as Partial<Presentation> | null) ?? undefined;

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: {
        sku: rest.sku,
        name: rest.name,
        brand: rest.brand,
        description: rest.description,
        categoryId: rest.categoryId,
        subCategory: rest.subCategory,
        status: rest.status,
        variantOptions: rest.variantOptions,
        ...(rest.smartEpp !== undefined ? { smartEpp: rest.smartEpp } : {}),
        ...(rest.freebieText !== undefined ? { freebieText: rest.freebieText } : {}),
        ...(rest.mrp !== undefined ? { mrp: D(rest.mrp) } : {}),
        ...(rest.mop !== undefined ? { mop: D(rest.mop) } : {}),
        ...(rest.cashbackType !== undefined ? { cashbackType: rest.cashbackType } : {}),
        ...(rest.cashbackValue !== undefined ? { cashbackValue: D(rest.cashbackValue) } : {}),
        ...(rest.familyKey !== undefined ? { familyKey: rest.familyKey ? slugishFamily(rest.familyKey) : null } : {}),
        ...(rest.optionColor !== undefined ? { optionColor: rest.optionColor } : {}),
        ...(rest.optionVariant !== undefined ? { optionVariant: rest.optionVariant } : {}),
        ...(rest.shades !== undefined ? { colorOptions: colorOptionsFrom(rest.shades) } : {}),
        specs: buildSpecs(rest, existingSpecs) as unknown as Prisma.InputJsonValue,
      },
    });

    if (images) {
      await tx.productImage.deleteMany({ where: { productId: id } });
      if (images.length) {
        await tx.productImage.createMany({
          data: images.map((img, i) => ({ productId: id, url: img.url, alt: img.alt, position: img.position ?? i })),
        });
      }
    }
  });

  return getProduct(id);
}

export async function softDeleteProduct(id: string) {
  const existing = await prisma.product.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Product not found');
  await prisma.product.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id, deleted: true };
}

// ─── Marketplace offers (attach sellers, edit their price/stock) ──────────────

export async function listOffers(productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, ...notDeleted }, select: { id: true } });
  if (!product) throw AppError.notFound('Product not found');
  const offers = await prisma.productOffer.findMany({
    where: { productId, ...notDeleted },
    orderBy: { eppPrice: 'asc' },
    select: offerSelect,
  });
  return { data: serialize(offers) };
}

// Every offer across all products — the Super-Admin "Reseller pricing" report.
// Commission (eppPrice − resellerPrice) is computed on the frontend.
export async function listAllOffers() {
  const offers = await prisma.productOffer.findMany({
    where: { ...notDeleted, product: notDeleted },
    orderBy: [{ product: { name: 'asc' } }, { eppPrice: 'asc' }],
    select: {
      id: true,
      resellerId: true,
      reseller: { select: { id: true, name: true } },
      eppPrice: true,
      resellerPrice: true,
      quantity: true,
      status: true,
      isActive: true,
      product: { select: { id: true, name: true, sku: true } },
    },
  });
  return { data: serialize(offers) };
}

// Resellers available to attach (Super-Admin picks the seller for an offer).
export async function listResellersForOffers() {
  const rows = await prisma.reseller.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, status: true },
  });
  return { data: serialize(rows) };
}

// Free gifts belonging to a reseller — for the admin offer form's gift dropdown.
export async function listGiftsForReseller(resellerId: string) {
  const rows = await prisma.freeGift.findMany({
    where: { resellerId, deletedAt: null },
    orderBy: { title: 'asc' },
    select: { id: true, title: true, description: true, isActive: true },
  });
  return { data: serialize(rows) };
}

function offerWriteData(input: AttachOfferInput | UpdateOfferInput, freeGiftId: string | null | undefined) {
  return {
    ...(input.eppPrice !== undefined ? { eppPrice: D(input.eppPrice) } : {}),
    ...(input.resellerPrice !== undefined ? { resellerPrice: D(input.resellerPrice) } : {}),
    ...(input.smartEppPrice !== undefined ? { smartEppPrice: D(input.smartEppPrice) } : {}),
    ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
    ...(freeGiftId !== undefined ? { freeGiftId } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
}

export async function attachOffer(productId: string, input: AttachOfferInput) {
  const product = await prisma.product.findFirst({ where: { id: productId, ...notDeleted }, select: { id: true } });
  if (!product) throw AppError.notFound('Product not found');
  const resellerId = input.resellerId ?? null;

  if (resellerId) {
    const reseller = await prisma.reseller.findUnique({ where: { id: resellerId }, select: { id: true } });
    if (!reseller) throw AppError.badRequest('Reseller not found');
  }

  // One live offer per (product, reseller). Revive a soft-deleted one if present.
  const existing = await prisma.productOffer.findFirst({ where: { productId, resellerId } });
  const freeGiftId = await ensureOwnedGift(resellerId, input.freeGiftId ?? null);
  const write = offerWriteData(input, input.freeGiftId === undefined ? undefined : freeGiftId);

  if (existing) {
    if (!existing.deletedAt) throw AppError.conflict('This seller already has an offer on the product');
    const revived = await prisma.productOffer.update({
      where: { id: existing.id },
      data: { deletedAt: null, eppPrice: D(input.eppPrice ?? 0), ...write },
      select: offerSelect,
    });
    return serialize(revived);
  }

  const created = await prisma.productOffer.create({
    data: {
      productId,
      resellerId,
      eppPrice: D(input.eppPrice ?? 0),
      smartEppPrice: input.smartEppPrice !== undefined ? D(input.smartEppPrice) : null,
      quantity: input.quantity ?? 0,
      freeGiftId,
      // Unpriced offers stay DRAFT until the seller (or admin) prices them.
      status: input.status ?? (input.eppPrice ? 'ACTIVE' : 'DRAFT'),
      isActive: input.isActive ?? true,
    },
    select: offerSelect,
  });
  return serialize(created);
}

export async function updateOffer(productId: string, offerId: string, input: UpdateOfferInput) {
  const offer = await prisma.productOffer.findFirst({ where: { id: offerId, productId, ...notDeleted } });
  if (!offer) throw AppError.notFound('Offer not found');
  const freeGiftId =
    input.freeGiftId === undefined ? undefined : await ensureOwnedGift(offer.resellerId, input.freeGiftId);
  const updated = await prisma.productOffer.update({
    where: { id: offerId },
    data: offerWriteData(input, freeGiftId),
    select: offerSelect,
  });
  return serialize(updated);
}

export async function removeOffer(productId: string, offerId: string) {
  const offer = await prisma.productOffer.findFirst({ where: { id: offerId, productId, ...notDeleted } });
  if (!offer) throw AppError.notFound('Offer not found');
  await prisma.productOffer.update({ where: { id: offerId }, data: { deletedAt: new Date() } });
  return { id: offerId, deleted: true };
}

// ─── Bulk ─────────────────────────────────────────────────────────────────────

export async function bulkProducts(input: BulkProductInput) {
  const ids = input.ids;
  const products = await prisma.product.findMany({ where: { id: { in: ids }, ...notDeleted } });
  if (products.length === 0) throw AppError.notFound('No matching products');

  if (input.action === 'deactivate') {
    const res = await prisma.product.updateMany({
      where: { id: { in: ids }, ...notDeleted },
      data: { status: ProductStatus.INACTIVE },
    });
    return { action: 'deactivate', affected: res.count };
  }

  // priceUpdate — adjust the EPP price of each product's live offers.
  const adjustment = input.adjustment!;
  const value = input.value!;
  let affected = 0;

  await prisma.$transaction(async (tx) => {
    const offers = await tx.productOffer.findMany({
      where: { productId: { in: ids }, ...notDeleted },
    });
    for (const offer of offers) {
      const current = offer.eppPrice.toNumber();
      let next = current;
      if (adjustment === 'increasePct') next = current * (1 + value / 100);
      else if (adjustment === 'decreasePct') next = current * (1 - value / 100);
      else if (adjustment === 'setAmount') next = value;
      next = Math.max(0, Math.round(next * 100) / 100);
      await tx.productOffer.update({ where: { id: offer.id }, data: { eppPrice: D(next) } });
      affected += 1;
    }
  });

  return { action: 'priceUpdate', affected };
}
