import { Prisma, OrgStatus, ProductStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { slugify } from '../utils/slug';
import { parsePagination, pageMeta } from '../utils/pagination';
import { encryptSecret, generateApiKey, generateSecret } from '../utils/secretbox';
import { toStoreProduct, shopProductInclude, HAS_LIVE_OFFER } from './shop.service';
import type { CreatePartnerInput, UpdatePartnerInput, PartnerCatalogueQuery } from '../validators/partner.schema';
import type { PartnerPrincipal } from '../types/express';

const D = (n: number) => new Prisma.Decimal(n);

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
      catalogScope: input.catalogScope ? (input.catalogScope as Prisma.InputJsonValue) : Prisma.DbNull,
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
      ...(input.catalogScope !== undefined ? { catalogScope: input.catalogScope ? (input.catalogScope as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
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

function scopeWhere(partner: PartnerPrincipal): Prisma.ProductWhereInput {
  const slugs = partner.catalogScope?.categorySlugs;
  return slugs && slugs.length ? { category: { slug: { in: slugs } } } : {};
}

export async function partnerCatalogue(partner: PartnerPrincipal, query: PartnerCatalogueQuery) {
  const p = parsePagination(query);
  const where: Prisma.ProductWhereInput = {
    status: ProductStatus.ACTIVE,
    ...notDeleted,
    ...HAS_LIVE_OFFER,
    ...scopeWhere(partner),
    ...(query.category ? { category: { slug: query.category } } : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({ where, include: shopProductInclude, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.product.count({ where }),
  ]);
  return { data: rows.map((r) => toPartnerProduct(toStoreProduct(r, { public: true }))), meta: pageMeta(total, p) };
}

export async function partnerCatalogueItem(partner: PartnerPrincipal, sku: string) {
  const product = await prisma.product.findFirst({
    where: { sku, status: ProductStatus.ACTIVE, ...notDeleted, ...HAS_LIVE_OFFER, ...scopeWhere(partner) },
    include: shopProductInclude,
  });
  if (!product) throw AppError.notFound('Product not found or not available to this partner');
  return toPartnerProduct(toStoreProduct(product, { public: true }));
}
