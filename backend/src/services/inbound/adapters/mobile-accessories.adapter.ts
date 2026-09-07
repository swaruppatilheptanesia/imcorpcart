import type { VendorAdapter, VendorSourceContext, NormalizedRow } from '../types';
import { resolveMaxPages } from '../paging';

// Adapter for the MobileAccessories public mobile-app API (read-only, no keys).
// Base: https://www.mobileaccessories.in (non-www 301-redirects). POST only.
//   /app-api/v1/products/search        → paged listing (data.products[])
//   /app-api/v1/products/view/{id}     → detail (data.data[] content blocks)
//   /app-api/v1/products/getOptions/{id} → variant options (often empty)
// Mapped against the LIVE payloads (all values arrive as strings). See
// docs/VENDOR_INTEGRATION_PLAN.md §2.
//
// Pricing: selprod_price = list MRP (→ Product.mrp, struck), theprice = actual
// selling price (→ Product.mop + the EPP basis). EPP = theprice − admin discount%.
//
// GAPS (documented): no sub_category (only prodcat), no spec sheet, no HSN/GST/
// warranty/terms, and variant option labels (option_color/option_variant) aren't
// reliably exposed (getOptions is usually empty; colour is only in the title) —
// left null, so the detail-page cross-SKU selector stays hidden (each variant
// still shows as its own card). Enrichment is one detail call per product. We
// sell first-party and fulfil ourselves — the vendor's cart/deep-link is not used.
//
// PAGE CAP is environment-driven: dev is capped (trial), production is unlimited
// (pulls the whole catalog — the loop self-terminates at the API's real last
// page). Override either with VENDOR_IMPORT_MAX_PAGES.

const DEFAULT_BASE = process.env.MOBILE_ACCESSORIES_BASE_URL ?? 'https://www.mobileaccessories.in';
const LANGUAGE = 1;

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
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Trimmed non-empty string, else null (with whitespace collapsed). */
function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

function clamp(n: number, lo: number, hi: number, dflt: number): number {
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

// The API reads POST params as x-www-form-urlencoded (a JSON body is accepted but
// its page/pageSize are ignored — pagination only works form-encoded). pageSize is
// fixed server-side at 12, so we page via `page`.
async function postForm(url: string, params: Record<string, string | number>): Promise<any> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

// Pull description + ordered image gallery + SKU from the detail endpoint.
async function enrichFromDetail(
  base: string,
  selprodId: string,
): Promise<{ description: string | null; images: string[] }> {
  const view = await postForm(`${base}/app-api/v1/products/view/${selprodId}`, { language: LANGUAGE });
  const blocks: any[] = Array.isArray(view?.data?.data) ? view.data.data : [];

  const imageBlock = blocks.find((b) => Array.isArray(b?.content) && /image/i.test(String(b?.title ?? '')));
  const images: string[] = Array.isArray(imageBlock?.content)
    ? imageBlock.content
        .slice()
        .sort((a: any, b: any) => Number(a?.afile_display_order ?? 0) - Number(b?.afile_display_order ?? 0))
        .map((im: any) => str(im?.product_image_url))
        .filter((u: string | null): u is string => !!u)
    : [];

  const detailBlock = blocks.find((b) => b?.content && !Array.isArray(b.content) && typeof b.content === 'object');
  const c = (detailBlock?.content ?? {}) as Record<string, unknown>;
  const description = str(c.product_short_description) ?? (stripHtml(c.product_description) || null);

  return { description, images };
}

export const mobileAccessoriesAdapter: VendorAdapter = {
  key: 'mobile-accessories',
  label: 'MobileAccessories (public API)',
  // Dev-configured integration: self-contained base URL (admins no longer set these).
  // Overridable via MOBILE_ACCESSORIES_BASE_URL; page cap is env-driven (see resolveMaxPages).
  defaults: { baseUrl: DEFAULT_BASE, config: { pageSize: 12, enrich: true } },
  async *fetchRows(ctx: VendorSourceContext): AsyncIterable<NormalizedRow> {
    const base = (ctx.baseUrl?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
    const cfg = ctx.config ?? {};
    const pageSize = clamp(Number(cfg.pageSize), 1, 24, 12);
    const maxPages = resolveMaxPages(); // dev-limited / production-unlimited (env-driven)
    const enrich = cfg.enrich !== false; // rich by default
    const categoryFilter = str(cfg.categoryFilter);

    for (let page = 1; page <= maxPages; page++) {
      const resp = await postForm(`${base}/app-api/v1/products/search`, {
        page,
        pageSize, // note: server fixes the page at 12 regardless; page drives paging
        language: LANGUAGE,
        ...(categoryFilter ? { category: categoryFilter } : {}),
      });
      if (String(resp?.status) !== '1') break; // "0"/"-1" → no more results / error
      const items: any[] = Array.isArray(resp?.data?.products) ? resp.data.products : [];
      if (items.length === 0) break;

      for (const it of items) {
        const selprodId = String(it?.selprod_id ?? '').trim();
        if (!selprodId) continue;
        const productId = String(it?.product_id ?? '').trim();

        const mrp = parseMoney(it.selprod_price) || parseMoney(it.theprice);
        const mop = parseMoney(it.theprice) || mrp;
        const listImage = str(it.product_image_url);

        let description: string | null = null;
        let images: string[] = listImage ? [listImage] : [];
        if (enrich) {
          try {
            const d = await enrichFromDetail(base, selprodId);
            description = d.description;
            if (d.images.length) images = d.images;
          } catch {
            /* fall back to the listing row */
          }
        }

        const inStock = String(it.in_stock ?? '') === '1';

        yield {
          externalRef: selprodId, // importer namespaces sku = mobile-accessories-<selprod_id>
          name: str(it.selprod_title) ?? str(it.product_name) ?? `Product ${selprodId}`,
          brand: str(it.brand_name),
          category: str(it.prodcat_name) ?? 'Uncategorised',
          subCategory: null, // GAP: API has only prodcat
          mrp,
          mop,
          description,
          images,
          specRows: [], // GAP: no spec sheet in the API
          familyKey: productId ? `ma-${productId}` : null,
          optionColor: null, // GAP: variant labels not reliably exposed
          optionVariant: null,
          hsnCode: null, // GAP: not provided by the API
          gstPercent: null,
          warrantyText: null,
          termsText: null,
          stock: inStock ? Number(it.selprod_stock) || 0 : 0,
        };
      }

      const pageCount = Number(resp?.data?.pageCount);
      if (Number.isFinite(pageCount) && pageCount > 0 && page >= pageCount) break;
      if (items.length < pageSize) break; // last page
    }
  },
};
