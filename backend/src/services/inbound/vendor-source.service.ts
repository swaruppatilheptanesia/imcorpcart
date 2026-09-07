import { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { serialize } from '../../models/serializers';
import { notDeleted } from '../../models/selectors';
import { parsePagination, pageMeta } from '../../utils/pagination';
import { encryptSecret, decryptSecret } from '../../utils/secretbox';
import { hubbleConfigured, hubbleWalletBalance, HUBBLE_ADAPTER } from '../../config/hubble';
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
  // specs = { rows, ...specsExtra } (e.g. voucher denominations). Written whenever
  // there are rows or extra structured fields; specs is vendor-owned (refreshed on re-sync).
  const specsExtra = row.specsExtra ?? {};
  const hasSpecs = specRows.length > 0 || Object.keys(specsExtra).length > 0;
  const specsData = { rows: specRows, ...specsExtra };

  // Vendor-owned scalars — always refreshed from the feed.
  const vendorScalars = {
    name: row.name,
    brand: row.brand ?? null,
    description: row.description ?? null,
    mrp: D(row.mrp),
    mop: row.mop != null ? D(row.mop) : null,
    hsnCode: row.hsnCode ?? null,
    gstPercent: row.gstPercent != null ? D(row.gstPercent) : null,
    termsText: row.termsText ?? null,
    warrantyText: row.warrantyText ?? null,
    familyKey: row.familyKey ?? null,
    optionColor: row.optionColor ?? null,
    optionVariant: row.optionVariant ?? null,
  };

  // EPP is derived from the vendor's selling price (mop) when present, else the list mrp —
  // so employees never pay above what the vendor itself charges.
  const eppBasis = row.mop ?? row.mrp;

  if (!existing) {
    const catId = await upsertCategoryBySlug(mappedCategory(row.category, source.config), catCache);
    const eppPrice = D(round(eppBasis * (1 - discountPct / 100)));
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
        ...(hasSpecs ? { specs: specsData } : {}),
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
        ...(hasSpecs ? { specs: specsData } : {}),
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
      const eppPrice = D(round(eppBasis * (1 - discountPct / 100)));
      await tx.productOffer.create({
        data: { productId: existing.id, resellerId: null, eppPrice, quantity: row.stock ?? 0, status: ProductStatus.ACTIVE, isActive: true },
      });
    }
  });
  return 'updated';
}

type VendorSourceFull = Prisma.VendorSourceGetPayload<{}>;

const STALE_RUN_MS = 30 * 60 * 1000; // a RUNNING run older than this is treated as dead (process restart)

// Kick off a sync in the BACKGROUND and return the RUNNING run immediately, so
// the admin UI can poll `getRun` for live progress instead of holding a
// multi-minute request open. One sync per source at a time (409 otherwise).
export async function startImport(sourceId: string, actorId?: string) {
  const source = await prisma.vendorSource.findFirst({ where: { id: sourceId, ...notDeleted } });
  if (!source) throw AppError.notFound('Vendor source not found');
  if (!source.active) throw AppError.badRequest('This vendor source is disabled — enable it before syncing');
  getAdapter(source.adapter); // validate the adapter key up front

  // Concurrency guard: refuse a second concurrent sync; recover a stale RUNNING run.
  const running = await prisma.vendorImportRun.findFirst({
    where: { sourceId, status: 'RUNNING' },
    orderBy: { startedAt: 'desc' },
  });
  if (running) {
    if (Date.now() - running.startedAt.getTime() < STALE_RUN_MS) {
      throw AppError.conflict('A sync is already running for this vendor');
    }
    await prisma.vendorImportRun.update({
      where: { id: running.id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errors: [{ ref: '(system)', field: '—', message: 'Interrupted (process restart) — superseded by a new sync' }],
      },
    });
  }

  const run = await prisma.vendorImportRun.create({
    data: { sourceId, status: 'RUNNING', startedById: actorId ?? null },
  });

  // Fire-and-forget. The job always finalizes the run; the .catch is a last-resort net.
  void runImportJob(run.id, source, actorId).catch(async (e) => {
    await prisma.vendorImportRun
      .update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errors: [{ ref: '(system)', field: '—', message: e instanceof Error ? e.message : 'unexpected error' }],
        },
      })
      .catch(() => {});
  });

  return serialize(run);
}

// The actual import loop (background). Persists progress periodically and always
// finalizes the run (never leaves it RUNNING).
async function runImportJob(runId: string, source: VendorSourceFull, actorId?: string) {
  const adapter = getAdapter(source.adapter);
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

  // Throttled progress persistence (≤ every 1.5s) so polling sees counts climb.
  let lastFlush = 0;
  const flush = async () => {
    const now = Date.now();
    if (now - lastFlush < 1500) return;
    lastFlush = now;
    await prisma.vendorImportRun.update({ where: { id: runId }, data: { fetched, created, updated, failed } });
  };

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
      await flush();
    }
  } catch (e) {
    // Adapter-level failure (e.g. the vendor API is down): close the run FAILED.
    await prisma.vendorImportRun.update({
      where: { id: runId },
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
    return;
  }

  const finalStatus = failed === 0 ? 'SUCCESS' : created + updated > 0 ? 'PARTIAL' : 'FAILED';
  await prisma.vendorImportRun.update({
    where: { id: runId },
    data: { status: finalStatus, fetched, created, updated, failed, errors, finishedAt: new Date() },
  });
  await prisma.vendorSource.update({ where: { id: source.id }, data: { lastSyncedAt: new Date() } });
  await prisma.auditLog.create({
    data: {
      actorId: actorId ?? null,
      action: 'catalog.vendor_import',
      entityType: 'VendorSource',
      entityId: source.id,
      after: { runId, created, updated, failed },
    },
  });
}

// Hubble client wallet balance (ops aid on the vendor-source page — the client
// tops it up offline). Only meaningful for the Hubble source; others return
// unsupported. Never throws — a Hubble/network error surfaces as balance null.
export async function getWalletBalance(sourceId: string) {
  const source = await prisma.vendorSource.findFirst({
    where: { id: sourceId, ...notDeleted },
    select: { adapter: true },
  });
  if (!source) throw AppError.notFound('Vendor source not found');
  if (source.adapter !== HUBBLE_ADAPTER) return { supported: false, configured: false, balance: null };
  if (!hubbleConfigured()) return { supported: true, configured: false, balance: null };
  try {
    const { balance } = await hubbleWalletBalance();
    return { supported: true, configured: true, balance };
  } catch (e) {
    return { supported: true, configured: true, balance: null, error: e instanceof Error ? e.message : 'unavailable' };
  }
}

// One import run (for polling live progress). Scoped to the source.
export async function getRun(sourceId: string, runId: string) {
  const run = await prisma.vendorImportRun.findFirst({ where: { id: runId, sourceId } });
  if (!run) throw AppError.notFound('Import run not found');
  return serialize(run);
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
