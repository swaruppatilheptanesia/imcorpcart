import { Prisma, OrgStatus, ProductStatus, PartnerPriceBasis, OrderSource, DocumentType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { serialize, toNumber } from '../models/serializers';
import { notDeleted } from '../models/selectors';
import { slugify } from '../utils/slug';
import { parsePagination, pageMeta } from '../utils/pagination';
import { encryptSecret, generateApiToken, generateWebhookSecret, hashToken } from '../utils/secretbox';
import { toStoreProduct, shopProductInclude, pickBuyBox } from './shop.service';
import { estimateDelivery } from './delivery.service';
import { BUCKET_STATUSES } from './order.service';
import { startOfDayIst } from '../utils/date-range';
import type {
  CreatePartnerInput,
  UpdatePartnerInput,
  PartnerCatalogueQuery,
  AddCatalogueInput,
  UpdateCatalogueEntryInput,
  CatalogueCandidatesQuery,
  PartnerOrdersQuery,
  PartnerActivityQuery,
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

// The base a catalogue entry is priced from: the admin's manual offer price when
// one is set, else the basis-derived figure. Commission applies on top either way.
type PricedEntry = { offerPrice: Prisma.Decimal | null; priceBasis: PartnerPriceBasis; commissionPct: Prisma.Decimal | null; product: ProductWithOffers };
export function entryBasePrice(entry: PricedEntry): number {
  return entry.offerPrice != null ? toNumber(entry.offerPrice) : resolveBasePrice(entry.product, entry.priceBasis);
}
// The single partner-facing price for an entry — what the catalogue advertises
// AND what order acceptance validates against, so the two can never disagree.
export function entryPrice(entry: PricedEntry): number {
  return vendorPrice(entryBasePrice(entry), entry.commissionPct);
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

// Create a partner + generate its API token and webhook secret. Both raw values
// are returned ONCE (the token is only stored hashed) for the admin to hand over.
export async function createPartner(input: CreatePartnerInput) {
  const token = generateApiToken();
  const webhookSecret = generateWebhookSecret();
  const partner = await prisma.partner.create({
    data: {
      name: input.name,
      slug: await uniqueSlug(input.name),
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      status: (input.status as OrgStatus) ?? OrgStatus.ONBOARDING,
      active: input.active ?? true,
      apiTokenHash: hashToken(token),
      apiTokenLast4: token.slice(-4),
      webhookSecretEnc: encryptSecret(webhookSecret),
      webhookSecretLast4: webhookSecret.slice(-4),
      ipAllowlist: input.ipAllowlist ?? [],
      webhookUrl: input.webhookUrl ?? null,
      priceField: input.priceField ?? PartnerPriceBasis.MOP,
      commissionPct: input.commissionPct !== undefined ? D(input.commissionPct) : D(0),
      features: input.features ? (input.features as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
  return { partner: serialize(partner), token, webhookSecret };
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

// Rotate the API token — invalidates the old one; returns the new raw token once.
export async function rotateApiToken(id: string) {
  const existing = await prisma.partner.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Partner not found');
  const token = generateApiToken();
  await prisma.partner.update({
    where: { id },
    data: { apiTokenHash: hashToken(token), apiTokenLast4: token.slice(-4) },
  });
  return { token };
}

// Rotate the webhook signing secret — returns the new raw secret once.
export async function rotateWebhookSecret(id: string) {
  const existing = await prisma.partner.findFirst({ where: { id, ...notDeleted } });
  if (!existing) throw AppError.notFound('Partner not found');
  const webhookSecret = generateWebhookSecret();
  await prisma.partner.update({
    where: { id },
    data: { webhookSecretEnc: encryptSecret(webhookSecret), webhookSecretLast4: webhookSecret.slice(-4) },
  });
  return { webhookSecret };
}

export async function listPartnerWebhooks(id: string) {
  const rows = await prisma.webhookDelivery.findMany({
    where: { partnerId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: serialize(rows) };
}

// The partner's activity log: the two audited partner-API events, paged and
// filterable, each order row enriched with the orders it created (one query per
// page). The row shape is flat so the admin UI never parses the audit `after` blob.
const ACTIVITY_ACTIONS = { order: 'partner.order.accept', auth_fail: 'partner.auth.fail' } as const;
const ACTIVITY_PERIOD_DAYS = { today: 0, '7d': 6, '30d': 29 } as const;

export async function listPartnerActivity(id: string, query: PartnerActivityQuery) {
  const p = parsePagination(query);
  const where: Prisma.AuditLogWhereInput = { entityType: 'Partner', entityId: id };
  if (query.event && query.event !== 'all') where.action = ACTIVITY_ACTIONS[query.event];
  if (query.period && query.period !== 'all') {
    // "Last 7 days" = today plus the six IST days before it.
    const days = ACTIVITY_PERIOD_DAYS[query.period];
    where.createdAt = { gte: startOfDayIst(new Date(Date.now() - days * 86_400_000)) };
  }
  const q = query.q?.trim();
  if (q) {
    // JSON string filters have no case-insensitive mode; partner refs and our
    // order numbers are upper-case, so matching both spellings covers real input.
    const variants = [...new Set([q, q.toUpperCase()])];
    where.OR = [
      ...variants.map((v) => ({ after: { path: ['externalRef'], string_contains: v } })),
      { after: { path: ['orderNos'], array_contains: [q.toUpperCase()] } },
      { ipAddress: { contains: q } },
    ];
  }

  const [rows, total] = await prisma.$transaction([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.auditLog.count({ where }),
  ]);

  const afterOf = (r: (typeof rows)[number]) => (r.after && typeof r.after === 'object' && !Array.isArray(r.after) ? (r.after as Record<string, unknown>) : {});
  const orderNosOf = (r: (typeof rows)[number]) => {
    const v = afterOf(r).orderNos;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  };
  const allNos = [...new Set(rows.flatMap(orderNosOf))];
  const orders = allNos.length
    ? await prisma.order.findMany({
        where: { orderNo: { in: allNos } },
        select: { id: true, orderNo: true, status: true, total: true, _count: { select: { items: true } } },
      })
    : [];
  const byNo = new Map(orders.map((o) => [o.orderNo, o]));

  const data = rows.map((r) => {
    const after = afterOf(r);
    return {
      id: r.id,
      event: r.action === ACTIVITY_ACTIONS.auth_fail ? 'auth_fail' : r.action === ACTIVITY_ACTIONS.order ? 'order' : r.action,
      createdAt: r.createdAt.toISOString(),
      ipAddress: r.ipAddress,
      externalRef: typeof after.externalRef === 'string' ? after.externalRef : null,
      checkoutGroup: typeof after.checkoutGroup === 'string' ? after.checkoutGroup : null,
      reason: typeof after.reason === 'string' ? after.reason : null,
      // An order number whose row has since been deleted still shows, with no detail.
      orders: orderNosOf(r).map((no) => {
        const o = byNo.get(no);
        return { orderNo: no, id: o?.id ?? null, status: o?.status ?? null, total: o ? toNumber(o.total) : null, items: o?._count.items ?? null };
      }),
    };
  });
  return { data, meta: pageMeta(total, p) };
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
  reseller: { select: { name: true } }, // null = first-party / house fulfilment
  // Courier + ePOD state is carried on the row itself: the Orders tab updates
  // fulfilment inline, and fetching the full order per row would be one request
  // per visible order.
  shipment: {
    select: {
      status: true,
      awbNumber: true,
      dispatchedAt: true,
      deliveredAt: true,
      labelUrl: true,
      lastTrackedAt: true,
      trackingError: true,
      courier: { select: { name: true, code: true } },
    },
  },
  documents: {
    where: { docType: DocumentType.POD },
    // docType is selected even though the `where` already pins it: the frontend
    // runs these rows through the same `toFulfilmentInfo` mapper as the full
    // order, and that filters on docType itself.
    select: { id: true, docType: true, generatedAt: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
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
    reseller: o.reseller?.name ?? 'First-party',
    subtotal: o.subtotal,
    total: o.total,
    createdAt: o.createdAt,
    dispatchedAt: o.shipment?.dispatchedAt ?? null,
    deliveredAt: o.shipment?.deliveredAt ?? null,
    awb: o.shipment?.awbNumber ?? null,
    courier: o.shipment?.courier?.name ?? null,
    // The enum code, not the display name: the transit form selects by code.
    courierCode: o.shipment?.courier?.code ?? null,
    // Order.status collapses IN_TRANSIT and OUT_FOR_DELIVERY into one label, so
    // the shipment's own status is the only place the difference shows.
    shipmentStatus: o.shipment?.status ?? null,
    labelUrl: o.shipment?.labelUrl ?? null,
    lastTrackedAt: o.shipment?.lastTrackedAt ?? null,
    trackingError: o.shipment?.trackingError ?? null,
    documents: o.documents,
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

  if (query.bucket && query.bucket !== 'all') {
    where.status = { in: BUCKET_STATUSES[query.bucket] };
  }
  // Our number, the partner's own reference, or anything in the box. partnerId
  // and source stay top-level, so they AND with this OR group.
  if (query.q) {
    const contains = { contains: query.q, mode: Prisma.QueryMode.insensitive };
    where.OR = [
      { orderNo: contains },
      { externalRef: contains },
      { items: { some: { product: { OR: [{ name: contains }, { sku: contains }] } } } },
    ];
  }

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
  const price = entryPrice(entry);
  const mrp = toNumber(entry.product.mrp);
  return {
    ...toPartnerProduct(sp),
    price,
    discountPercent: mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0,
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

// Default lead time before a dispatched shipment leaves the warehouse. A constant
// for now; can move to DeliverySetting (per-pincode/global) later.
const DEFAULT_DISPATCH_DAYS = 1;

// Delivery ETA for a pincode, optionally scoped to an item (availability from the
// partner's catalogue entry + buy-box stock). Mirrors GenieMart's "Tentative
// Delivery Days" data point (Item Code, Pin Code → Availability, Delivery Days).
export async function partnerDelivery(partner: PartnerPrincipal, pincode: string, sku?: string) {
  const eta = await estimateDelivery(pincode);
  let available: boolean | null = null;
  if (sku) {
    const entry = await prisma.partnerCatalogueEntry.findFirst({
      where: { partnerId: partner.id, product: { sku, status: ProductStatus.ACTIVE, ...notDeleted } },
      include: catalogueEntryInclude,
    });
    const winner = entry ? pickBuyBox(entry.product.offers) : null;
    available = !!winner && winner.quantity > 0; // not in catalogue → unavailable
  }
  return {
    pincode: eta.pincode,
    sku: sku ?? null,
    serviceable: eta.serviceable,
    available,
    tentativeDeliveryDays: eta.tatDays,
    dispatchDays: DEFAULT_DISPATCH_DAYS,
    courier: eta.courier || null,
    etaDate: eta.etaDate,
  };
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
// the manual offer price (if any) + the resolved vendor price.
function toAdminCatalogueRow(entry: CatalogueEntryWithProduct) {
  const prices = basePrices(entry.product);
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
    offerPrice: entry.offerPrice != null ? toNumber(entry.offerPrice) : null,
    vendorPrice: entryPrice(entry),
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
      // null clears the manual price (back to the basis); undefined leaves it alone.
      ...(input.offerPrice !== undefined ? { offerPrice: input.offerPrice === null ? null : D(input.offerPrice) } : {}),
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
