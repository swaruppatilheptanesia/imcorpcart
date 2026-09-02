import { Prisma, OrgStatus, ProductStatus, PartnerPriceBasis, OrderSource } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { slugify } from '../utils/slug';
import { parsePagination, pageMeta } from '../utils/pagination';
import { encryptSecret, generateApiKey, generateSecret } from '../utils/secretbox';
import { toStoreProduct, shopProductInclude, pickBuyBox } from './shop.service';
import type {
  CreatePartnerInput,
  UpdatePartnerInput,
  PartnerCatalogueQuery,
  AddCatalogueInput,
  UpdateCatalogueEntryInput,
  CatalogueCandidatesQuery,
  PartnerOrdersQuery,
} from '../validators/partner.schema';
import type { PartnerPrincipal } from '../types/express';

const D = (n: number) => new Prisma.Decimal(n);

// ── Partner price resolution ─────────────────────────────────────────────────

type ProductWithOffers = Prisma.ProductGetPayload<{ include: typeof shopProductInclude }>;

// The DB base price for a chosen basis (falls back to MRP when a source is absent).
export function resolveBasePrice(product: ProductWithOffers, basis: PartnerPriceBasis): number {
  const mrp = toNumber(product.mrp);
  if (basis === PartnerPriceBasis.MRP) return mrp;
  if (basis === PartnerPriceBasis.MOP) return product.mop != null ? toNumber(product.mop) : mrp;
  const winner = pickBuyBox(product.offers); // EPP
  return winner ? toNumber(winner.eppPrice) : mrp;
}

// Vendor price = base × (1 + commission%). Commission is added on top of the base.
export function vendorPrice(base: number, commissionPct: Prisma.Decimal | number | null): number {
  const pct = commissionPct != null ? toNumber(commissionPct) : 0;
  return Math.round(base * (1 + pct / 100));
}

// ── Registry CRUD (Super Admin) ──────────────────────────────────────────────

export async function listPartners() {
  const rows = await prisma.partner.findMany({
    where: notDeleted,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { orders: true } } },
  });
  return { data: serialize(rows) };
}

export async function getPartner(id: string) {
  const partner = await prisma.partner.findFirst({
    where: { id, ...notDeleted },
    include: { _count: { select: { orders: true } } },
  });
  if (!partner) throw AppError.notFound('Partner not found');
  return serialize(partner);
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'partner';
  let slug = base;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await prisma.partner.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

// Create a partner + generate its API key and secret. The raw secret is returned
// ONCE (never stored in the clear) for the admin to hand to the vendor.
export async function createPartner(input: CreatePartnerInput) {
  const apiKey = generateApiKey();
  const secret = generateSecret();
  const partner = await prisma.partner.create({
    data: {
      name: input.name,
      slug: await uniqueSlug(input.name),
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      status: (input.status as OrgStatus) ?? OrgStatus.ONBOARDING,
      active: input.active ?? true,
      apiKey,
      apiSecretEnc: encryptSecret(secret),
      secretLast4: secret.slice(-4),
      ipAllowlist: input.ipAllowlist ?? [],
      webhookUrl: input.webhookUrl ?? null,
      priceField: input.priceField ?? PartnerPriceBasis.MOP,
      commissionPct: input.commissionPct !== undefined ? D(input.commissionPct) : D(0),
      features: input.features ? (input.features as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
  return { partner: serialize(partner), apiKey, secret };
}

export async function updatePartner(id: string, input: UpdatePartnerInput) {
  const existing = await prisma.partner.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Partner not found');
  const partner = await prisma.partner.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
      ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
      ...(input.status !== undefined ? { status: input.status as OrgStatus } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.ipAllowlist !== undefined ? { ipAllowlist: input.ipAllowlist } : {}),
      ...(input.webhookUrl !== undefined ? { webhookUrl: input.webhookUrl } : {}),
      ...(input.priceField !== undefined ? { priceField: input.priceField } : {}),
      ...(input.commissionPct !== undefined ? { commissionPct: D(input.commissionPct) } : {}),
      ...(input.features !== undefined ? { features: input.features ? (input.features as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
    },
  });
  return serialize(partner);
}

export async function deletePartner(id: string) {
  const existing = await prisma.partner.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Partner not found');
  await prisma.partner.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  return { ok: true };
}

// Rotate the signing secret — invalidates the old one; returns the new raw secret once.
export async function rotateSecret(id: string) {
  const existing = await prisma.partner.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Partner not found');
  const secret = generateSecret();
  await prisma.partner.update({
    where: { id },
    data: { apiSecretEnc: encryptSecret(secret), secretLast4: secret.slice(-4) },
  });
  return { secret };
}

export async function listPartnerWebhooks(id: string) {
  const rows = await prisma.webhookDelivery.findMany({
    where: { partnerId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: serialize(rows) };
}

export async function listPartnerActivity(id: string) {
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'Partner', entityId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: serialize(rows) };
}

// ── Orders received from a partner ───────────────────────────────────────────

const partnerOrderSelect = {
  id: true,
  orderNo: true,
  externalRef: true,
  checkoutGroup: true,
  status: true,
  subtotal: true,
  total: true,
  createdAt: true,
  shipment: { select: { status: true, awbNumber: true, dispatchedAt: true, deliveredAt: true, courier: { select: { name: true } } } },
  items: {
    select: { quantity: true, unitPrice: true, lineTotal: true, product: { select: { name: true, sku: true, images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 } } } },
  },
} satisfies Prisma.OrderSelect;

type PartnerOrderPayload = Prisma.OrderGetPayload<{ select: typeof partnerOrderSelect }>;

function toPartnerOrderRow(o: PartnerOrderPayload) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    externalRef: o.externalRef,
    checkoutGroup: o.checkoutGroup,
    status: o.status,
    subtotal: o.subtotal,
    total: o.total,
    createdAt: o.createdAt,
    dispatchedAt: o.shipment?.dispatchedAt ?? null,
    awb: o.shipment?.awbNumber ?? null,
    courier: o.shipment?.courier?.name ?? null,
    itemCount: o.items.length,
    items: o.items.map((i) => ({
      name: i.product.name,
      sku: i.product.sku,
      image: i.product.images[0]?.url ?? null,
      qty: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
    })),
  };
}

export async function listPartnerOrders(partnerId: string, query: PartnerOrdersQuery) {
  const p = parsePagination(query);
  const where: Prisma.OrderWhereInput = { partnerId, source: OrderSource.PARTNER };
  const [rows, total] = await prisma.$transaction([
    prisma.order.findMany({ where, select: partnerOrderSelect, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.order.count({ where }),
  ]);
  return { data: serialize(rows.map(toPartnerOrderRow)), meta: pageMeta(total, p) };
}

// ── Partner-facing catalogue (MOP snapshot) ──────────────────────────────────

// Trim the storefront product shape to the partner contract (no EPP/vendor/rating fluff).
function toPartnerProduct(sp: ReturnType<typeof toStoreProduct>) {
  return {
    sku: sp.sku,
    name: sp.name,
    brand: sp.brand,
    category: sp.group,
    subCategory: sp.cat,
    price: sp.price, // MOP
    mrp: sp.mrp,
    gstPercent: sp.gstPercent,
    hsnCode: sp.hsnCode,
    stock: sp.stock,
    description: sp.desc,
    specs: sp.specs,
    images: sp.images,
    warrantyText: sp.warrantyText,
    termsText: sp.termsText,
    freebie: sp.freebie.enabled ? sp.freebie.description : null,
  };
}

// One catalogued product in the partner contract shape, priced at the entry's
// basis + commission.
type CatalogueEntryWithProduct = Prisma.PartnerCatalogueEntryGetPayload<{
  include: { product: { include: typeof shopProductInclude } };
}>;

function toPartnerCatalogueProduct(entry: CatalogueEntryWithProduct) {
  const sp = toStoreProduct(entry.product, { public: true });
  const base = resolveBasePrice(entry.product, entry.priceBasis);
  return {
    ...toPartnerProduct(sp),
    price: vendorPrice(base, entry.commissionPct),
    priceBasis: entry.priceBasis,
    commissionPct: entry.commissionPct != null ? toNumber(entry.commissionPct) : 0,
  };
}

const catalogueEntryInclude = { product: { include: shopProductInclude } } satisfies Prisma.PartnerCatalogueEntryInclude;

export async function partnerCatalogue(partner: PartnerPrincipal, query: PartnerCatalogueQuery) {
  const p = parsePagination(query);
  const where: Prisma.PartnerCatalogueEntryWhereInput = {
    partnerId: partner.id,
    product: {
      status: ProductStatus.ACTIVE,
      ...notDeleted,
      ...(query.category ? { category: { slug: query.category } } : {}),
    },
  };
  const [rows, total] = await prisma.$transaction([
    prisma.partnerCatalogueEntry.findMany({ where, include: catalogueEntryInclude, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.partnerCatalogueEntry.count({ where }),
  ]);
  return { data: rows.map(toPartnerCatalogueProduct), meta: pageMeta(total, p) };
}

export async function partnerCatalogueItem(partner: PartnerPrincipal, sku: string) {
  const entry = await prisma.partnerCatalogueEntry.findFirst({
    where: { partnerId: partner.id, product: { sku, status: ProductStatus.ACTIVE, ...notDeleted } },
    include: catalogueEntryInclude,
  });
  if (!entry) throw AppError.notFound('Product not found or not available to this partner');
  return toPartnerCatalogueProduct(entry);
}

// ── Admin catalogue management ───────────────────────────────────────────────

function basePrices(product: ProductWithOffers) {
  const winner = pickBuyBox(product.offers);
  return {
    mrp: toNumber(product.mrp),
    mop: product.mop != null ? toNumber(product.mop) : toNumber(product.mrp),
    epp: winner ? toNumber(winner.eppPrice) : null,
  };
}

// The admin's view of one catalogue entry: product summary + all base prices +
// the resolved vendor price.
function toAdminCatalogueRow(entry: CatalogueEntryWithProduct) {
  const prices = basePrices(entry.product);
  const base = resolveBasePrice(entry.product, entry.priceBasis);
  const commissionPct = entry.commissionPct != null ? toNumber(entry.commissionPct) : 0;
  return {
    id: entry.id,
    productId: entry.productId,
    sku: entry.product.sku,
    name: entry.product.name,
    brand: entry.product.brand ?? '',
    category: entry.product.category.name,
    categorySlug: entry.product.category.slug,
    subCategory: entry.product.subCategory ?? '',
    image: entry.product.images[0]?.url ?? null,
    ...prices,
    priceBasis: entry.priceBasis,
    commissionPct,
    vendorPrice: vendorPrice(base, entry.commissionPct),
  };
}

export async function listCatalogue(partnerId: string, query: CatalogueCandidatesQuery) {
  const p = parsePagination(query);
  const where: Prisma.PartnerCatalogueEntryWhereInput = {
    partnerId,
    product: {
      ...notDeleted,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.subCategory ? { subCategory: query.subCategory } : {}),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }] } : {}),
    },
  };
  const [rows, total] = await prisma.$transaction([
    prisma.partnerCatalogueEntry.findMany({ where, include: catalogueEntryInclude, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.partnerCatalogueEntry.count({ where }),
  ]);
  return { data: rows.map(toAdminCatalogueRow), meta: pageMeta(total, p) };
}

// Products available to add to a partner's catalogue (with an inCatalogue flag).
export async function listCandidates(partnerId: string, query: CatalogueCandidatesQuery) {
  const p = parsePagination(query);
  const where: Prisma.ProductWhereInput = {
    ...notDeleted,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.subCategory ? { subCategory: query.subCategory } : {}),
    ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { sku: { contains: query.q, mode: 'insensitive' } }] } : {}),
  };
  const [rows, total, existing] = await prisma.$transaction([
    prisma.product.findMany({ where, include: shopProductInclude, orderBy: { name: 'asc' }, skip: p.skip, take: p.take }),
    prisma.product.count({ where }),
    prisma.partnerCatalogueEntry.findMany({ where: { partnerId }, select: { productId: true } }),
  ]);
  const inSet = new Set(existing.map((e) => e.productId));
  const data = rows.map((product) => ({
    productId: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category.name,
    subCategory: product.subCategory ?? '',
    image: product.images[0]?.url ?? null,
    ...basePrices(product),
    inCatalogue: inSet.has(product.id),
  }));
  return { data, meta: pageMeta(total, p) };
}

// Add products to a partner's catalogue — explicit ids, or all products in a
// category / category+subcategory. Existing entries are left untouched (add-only).
export async function addCatalogue(partnerId: string, input: AddCatalogueInput) {
  const partner = await prisma.partner.findFirst({ where: { id: partnerId, ...notDeleted }, select: { priceField: true, commissionPct: true } });
  if (!partner) throw AppError.notFound('Partner not found');

  let productIds: string[];
  if (input.productIds?.length) {
    productIds = input.productIds;
  } else if (input.categoryId) {
    const where: Prisma.ProductWhereInput = {
      ...notDeleted,
      categoryId: input.categoryId,
      ...(input.subCategory ? { subCategory: input.subCategory } : {}),
    };
    productIds = (await prisma.product.findMany({ where, select: { id: true } })).map((r) => r.id);
  } else {
    throw AppError.badRequest('Provide productIds, or a categoryId (optionally with subCategory)');
  }
  if (!productIds.length) return { added: 0 };

  const priceBasis = (input.priceBasis as PartnerPriceBasis) ?? (partner.priceField as PartnerPriceBasis) ?? PartnerPriceBasis.MOP;
  const commissionPct = input.commissionPct !== undefined ? D(input.commissionPct) : partner.commissionPct ?? D(0);
  const { count } = await prisma.partnerCatalogueEntry.createMany({
    data: productIds.map((productId) => ({ partnerId, productId, priceBasis, commissionPct })),
    skipDuplicates: true,
  });
  return { added: count };
}

export async function updateCatalogueEntry(partnerId: string, entryId: string, input: UpdateCatalogueEntryInput) {
  const existing = await prisma.partnerCatalogueEntry.findFirst({ where: { id: entryId, partnerId } });
  if (!existing) throw AppError.notFound('Catalogue entry not found');
  const entry = await prisma.partnerCatalogueEntry.update({
    where: { id: entryId },
    data: {
      ...(input.priceBasis !== undefined ? { priceBasis: input.priceBasis as PartnerPriceBasis } : {}),
      ...(input.commissionPct !== undefined ? { commissionPct: D(input.commissionPct) } : {}),
    },
    include: catalogueEntryInclude,
  });
  return toAdminCatalogueRow(entry);
}

export async function removeCatalogueEntry(partnerId: string, entryId: string) {
  const existing = await prisma.partnerCatalogueEntry.findFirst({ where: { id: entryId, partnerId } });
  if (!existing) throw AppError.notFound('Catalogue entry not found');
  await prisma.partnerCatalogueEntry.delete({ where: { id: entryId } });
  return { ok: true };
}
