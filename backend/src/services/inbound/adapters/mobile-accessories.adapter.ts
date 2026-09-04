import type { VendorAdapter, VendorSourceContext, NormalizedRow } from '../types';

// Adapter for the MobileAccessories public mobile-app API (read-only, no keys).
// Endpoints (POST): /app-api/v1/products/search (paged listing),
// /products/view/{id} (detail), /products/getOptions/{id} (colour/variant).
// See docs/VENDOR_INTEGRATION_PLAN.md §2. NOTE: exact JSON field names come from
// the vendor's doc, not a live capture here — the accessors below are defensive
// (fall back gracefully) and may need tuning against the real payloads.

/** "₹2,999.00" / "2,999" / 2999 → 2999 (number) or 0 when unparseable. */
function parseMoney(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const n = Number(v.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Strip HTML tags + collapse whitespace from a description blob. */
function stripHtml(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// Build an absolute image URL from a possibly-relative path against imageBase.
function imageUrl(path: unknown, base: string | null): string | null {
  const p = str(path);
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

export const mobileAccessoriesAdapter: VendorAdapter = {
  key: 'mobile-accessories',
  label: 'MobileAccessories (public API)',
  // Dev-configured integration defaults. baseUrl is left for the real wiring
  // (set on the source, or read from env when the adapter goes live).
  defaults: { config: { pageSize: 12, maxPages: 50 } },
  async *fetchRows(ctx: VendorSourceContext): AsyncIterable<NormalizedRow> {
    const base = (ctx.baseUrl ?? '').replace(/\/+$/, '');
    if (!base) throw new Error('MobileAccessories source needs a baseUrl');
    const cfg = ctx.config ?? {};
    const pageSize = Number(cfg.pageSize) || 12;
    const maxPages = Number(cfg.maxPages) || 50; // safety cap
    const imageBase = str(cfg.imageBase) ?? base;
    const enrich = cfg.enrich === true; // opt-in N+1 detail/options calls

    for (let page = 1; page <= maxPages; page++) {
      const listing = await postJson(`${base}/app-api/v1/products/search`, {
        page,
        limit: pageSize,
        ...(str(cfg.categoryFilter) ? { category: cfg.categoryFilter } : {}),
      });
      const items: any[] = Array.isArray(listing?.data)
        ? listing.data
        : Array.isArray(listing?.products)
          ? listing.products
          : Array.isArray(listing)
            ? listing
            : [];
      if (items.length === 0) break;

      for (const it of items) {
        const id = String(it.selprod_id ?? it.id ?? it.product_id ?? '').trim();
        if (!id) continue;

        let detail: any = it;
        let images: string[] = [];
        if (enrich) {
          try {
            const view = await postJson(`${base}/app-api/v1/products/view/${id}`, {});
            detail = view?.data ?? view ?? it;
          } catch {
            /* fall back to the listing row */
          }
        }
        const rawImages: unknown[] = Array.isArray(detail.images)
          ? detail.images
          : Array.isArray(detail.gallery)
            ? detail.gallery
            : [detail.image, detail.thumbnail].filter(Boolean);
        images = rawImages
          .map((im) => {
            const anyIm = im as any;
            return imageUrl(typeof im === 'string' ? im : (anyIm?.url ?? anyIm?.path), imageBase);
          })
          .filter((u): u is string => !!u);

        const mrp = parseMoney(detail.mrp ?? detail.price ?? detail.selling_price);

        yield {
          externalRef: `MA-${id}`, // namespaced (their SKU isn't globally unique)
          name: str(detail.selprod_name ?? detail.name ?? detail.title) ?? `Product ${id}`,
          brand: str(detail.brand ?? detail.brand_name),
          category: str(detail.category ?? detail.category_name) ?? 'Uncategorised',
          subCategory: str(detail.subcategory ?? detail.sub_category),
          mrp,
          description: stripHtml(detail.description ?? detail.selprod_desc),
          images,
          specRows: Array.isArray(detail.specifications)
            ? detail.specifications
                .map((s: any) => ({ k: str(s?.label ?? s?.key) ?? '', v: str(s?.value) ?? '' }))
                .filter((r: { k: string; v: string }) => r.k && r.v)
            : [],
          stock: typeof detail.stock === 'number' ? detail.stock : null,
        };
      }

      if (items.length < pageSize) break; // last page
    }
  },
};
