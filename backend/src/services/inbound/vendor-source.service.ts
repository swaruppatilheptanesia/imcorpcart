import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { serialize } from '../../models/serializers';
import { notDeleted } from '../../models/selectors';
import { parsePagination, pageMeta } from '../../utils/pagination';
import { encryptSecret, decryptSecret } from '../../utils/secretbox';
import { D, upsertCategoryBySlug } from '../catalog-write';
import { getAdapter, allAdapters } from './adapter-registry';
import type { NormalizedRow } from './types';
import type { VendorSourceContext } from './types';
import type { UpdateSourceInput, RunsQuery } from '../../validators/vendor-source.schema';

export { listAdapters } from './adapter-registry';

const sourceInclude = {
  _count: { select: { products: true, runs: true } },
} satisfies Prisma.VendorSourceInclude;

// ─── Auto-provisioning ──────────────────────────────────────────────────────
// Integrated vendors are dev-configured adapters, not admin-created. Reconcile
// one VendorSource per registered adapter (slug == adapter.key, permanent since
// imported SKUs embed the slug). Only creates missing rows — admin edits
// (discount / active / config / baseUrl) are never overwritten.
export async function ensureAdapterSources() {
  const adapters = allAdapters();
  const existing = await prisma.vendorSource.findMany({ select: { slug: true } });
  const known = new Set(existing.map((s) => s.slug));
  const missing = adapters.filter((a) => !known.has(a.key));
  for (const a of missing) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await prisma.vendorSource.create({
        data: {
          name: a.label,
          slug: a.key,
          adapter: a.key,
          active: true,
          baseUrl: a.defaults?.baseUrl ?? null,
          discountPct: D(a.defaults?.discountPct ?? 0),
          config: (a.defaults?.config ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (e) {
      // Swallow a concurrent-create race (P2002 on the unique slug); the row now exists.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSources() {
  await ensureAdapterSources(); // integrated vendors appear automatically
  const rows = await prisma.vendorSource.findMany({
    where: notDeleted,
    include: sourceInclude,
    orderBy: { createdAt: 'desc' },
  });
  return { data: serialize(rows) };
}

export async function getSource(id: string) {
  const source = await prisma.vendorSource.findFirst({ where: { id, ...notDeleted }, include: sourceInclude });
  if (!source) throw AppError.notFound('Vendor source not found');
  return serialize(source);
}

export async function updateSource(id: string, input: UpdateSourceInput) {
  const existing = await prisma.vendorSource.findFirst({ where: { id, ...notDeleted }, select: { id: true } });
  if (!existing) throw AppError.notFound('Vendor source not found');
  const source = await prisma.vendorSource.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.apiKey !== undefined
        ? input.apiKey === null
          ? { apiKeyEnc: null, apiKeyLast4: null }
          : { apiKeyEnc: encryptSecret(input.apiKey), apiKeyLast4: input.apiKey.slice(-4) }
        : {}),
      ...(input.discountPct !== undefined ? { discountPct: D(input.discountPct) } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.config !== undefined ? { config: (input.config ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
    },
    include: sourceInclude,
  });
  return serialize(source);
}

export async function listRuns(sourceId: string, query: RunsQuery) {
  const p = parsePagination(query);
  const where = { sourceId };
  const [rows, total] = await prisma.$transaction([
    prisma.vendorImportRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip: p.skip, take: p.take }),
    prisma.vendorImportRun.count({ where }),
  ]);
  return { data: serialize(rows), meta: pageMeta(total, p) };
}

// ─── Sync (run the adapter → import) ───────────────────────────────────────────

const round = (n: number) => Math.round(n);

// Map a vendor category name through the optional config.categoryMap.
function mappedCategory(vendorCat: string, config: Prisma.JsonValue | null): string {
  const map = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, unknown>).categoryMap : null;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    const mapped = (map as Record<string, unknown>)[vendorCat];
    if (typeof mapped === 'string' && mapped.trim()) return mapped;
  }
  return vendorCat;
}

type VendorSourceRow = Prisma.VendorSourceGetPayload<{}>;

// Upsert one imported product as a FIRST-PARTY (house) product, auto-live.
// Field-ownership split (decision: preserve admin edits on re-sync):
//   • CREATE  → all fields, status ACTIVE, hidden false, house offer priced by discount.
//   • UPDATE  → refresh VENDOR-OWNED only (name/desc/brand/mrp/images/specs/tax + stock);
//               NEVER touch eppPrice, categoryId, subCategory, hidden, status, isActive.
async function upsertVendorProduct(
  source: VendorSourceRow,
  row: NormalizedRow,
  discountPct: number,
  catCache: Map<string, string>,
): Promise<'created' | 'updated'> {
  const sku = `${source.slug}-${row.externalRef}`;
  const existing = await prisma.product.findUnique({ where: { sku }, select: { id: true } });
  const specRows = row.specRows ?? [];
  const images = row.images ?? [];

  // Vendor-owned scalars — always refreshed from the feed.
  const vendorScalars = {
    name: row.name,
    brand: row.brand ?? null,
    description: row.description ?? null,
    mrp: D(row.mrp),
    hsnCode: row.hsnCode ?? null,
    gstPercent: row.gstPercent != null ? D(row.gstPercent) : null,
    termsText: row.termsText ?? null,
    warrantyText: row.warrantyText ?? null,
    familyKey: row.familyKey ?? null,
    optionColor: row.optionColor ?? null,
    optionVariant: row.optionVariant ?? null,
  };

  if (!existing) {
    const catId = await upsertCategoryBySlug(mappedCategory(row.category, source.config), catCache);
    const eppPrice = D(round(row.mrp * (1 - discountPct / 100)));
    await prisma.product.create({
      data: {
        sku,
        ...vendorScalars,
        categoryId: catId,
        subCategory: row.subCategory ?? null,
        status: ProductStatus.ACTIVE, // auto-live
        hidden: false,
        sourceId: source.id,
        externalRef: row.externalRef,
        ...(specRows.length ? { specs: { rows: specRows } } : {}),
        offers: {
          create: [{ resellerId: null, eppPrice, quantity: row.stock ?? 0, status: ProductStatus.ACTIVE, isActive: true }],
        },
        ...(images.length ? { images: { create: images.map((url, i) => ({ url, position: i })) } } : {}),
      },
    });
    return 'created';
  }

  // Re-sync: refresh vendor-owned fields + stock only; preserve admin overrides.
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: existing.id },
      data: {
        ...vendorScalars,
        ...(specRows.length ? { specs: { rows: specRows } } : {}),
        ...(images.length
          ? { images: { deleteMany: {}, create: images.map((url, i) => ({ url, position: i })) } }
          : {}),
      },
    });
    // House offer: refresh stock only (eppPrice + isActive/status are admin-owned).
    const house = await tx.productOffer.findFirst({ where: { productId: existing.id, resellerId: null } });
    if (house) {
      await tx.productOffer.update({ where: { id: house.id }, data: { quantity: row.stock ?? house.quantity } });
    } else {
      const eppPrice = D(round(row.mrp * (1 - discountPct / 100)));
      await tx.productOffer.create({
        data: { productId: existing.id, resellerId: null, eppPrice, quantity: row.stock ?? 0, status: ProductStatus.ACTIVE, isActive: true },
      });
    }
  });
  return 'updated';
}

export async function runImport(sourceId: string, actorId?: string) {
  const source = await prisma.vendorSource.findFirst({ where: { id: sourceId, ...notDeleted } });
  if (!source) throw AppError.notFound('Vendor source not found');
  if (!source.active) throw AppError.badRequest('This vendor source is disabled — enable it before syncing');
  const adapter = getAdapter(source.adapter);

  const run = await prisma.vendorImportRun.create({
    data: { sourceId, status: 'RUNNING', startedById: actorId ?? null },
  });

  const ctx: VendorSourceContext = {
    id: source.id,
    slug: source.slug,
    baseUrl: source.baseUrl,
    apiKey: source.apiKeyEnc ? decryptSecret(source.apiKeyEnc) : null,
    config: (source.config as Record<string, unknown> | null) ?? null,
  };

  const discountPct = Number(source.discountPct);
  const catCache = new Map<string, string>();
  const errors: { ref: string; field: string; message: string }[] = [];
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;

  try {
    for await (const row of adapter.fetchRows(ctx)) {
      fetched += 1;
      const ref = row.externalRef || `(row ${fetched})`;
      try {
        if (!row.externalRef) throw new Error('missing externalRef');
        if (!row.name) throw new Error('missing name');
        if (!row.category) throw new Error('missing category');
        if (!(row.mrp > 0)) throw new Error('mrp must be greater than 0');

        const outcome = await upsertVendorProduct(source, row, discountPct, catCache);
        if (outcome === 'created') created += 1;
        else updated += 1;
      } catch (e) {
        failed += 1;
        errors.push({ ref, field: '—', message: e instanceof Error ? e.message : 'unknown' });
      }
    }
  } catch (e) {
    // Adapter-level failure (e.g. the vendor API is down): close the run FAILED.
    const finished = await prisma.vendorImportRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        fetched,
        created,
        updated,
        failed,
        errors: [...errors, { ref: '(adapter)', field: '—', message: e instanceof Error ? e.message : 'unknown' }],
        finishedAt: new Date(),
      },
    });
    await prisma.vendorSource.update({ where: { id: source.id }, data: { lastSyncedAt: new Date() } });
    return serialize(finished);
  }

  const finalStatus = failed === 0 ? 'SUCCESS' : created + updated > 0 ? 'PARTIAL' : 'FAILED';
  const finished = await prisma.vendorImportRun.update({
    where: { id: run.id },
    data: { status: finalStatus, fetched, created, updated, failed, errors, finishedAt: new Date() },
  });
  await prisma.vendorSource.update({ where: { id: source.id }, data: { lastSyncedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      actorId: actorId ?? null,
      action: 'catalog.vendor_import',
      entityType: 'VendorSource',
      entityId: source.id,
      after: { runId: run.id, created, updated, failed },
    },
  });
  return serialize(finished);
}

// Imported products for a source (admin review), paginated. Imports are auto-live
// (ACTIVE); the admin hides exceptions via `hidden`.
export async function listSourceProducts(sourceId: string, query: RunsQuery) {
  const p = parsePagination(query);
  const where = { sourceId, ...notDeleted };
  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        sku: true,
        name: true,
        status: true,
        hidden: true,
        externalRef: true,
        offers: { where: { resellerId: null }, select: { eppPrice: true, quantity: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: p.skip,
      take: p.take,
    }),
    prisma.product.count({ where }),
  ]);
  return { data: serialize(rows), meta: pageMeta(total, p) };
}
