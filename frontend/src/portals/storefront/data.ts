/** Storefront catalog accessors + pure helpers — now LIVE. The catalog is
 *  fetched once from /shop/products and cached in-module so the (unchanged)
 *  synchronous facet helpers keep working. loadCatalog() is idempotent. */

import * as shop from '@/data/shop-api';
import type { StoreProduct, StoreCoupon, FilterState, SortKey, StoreCategory, Review } from '@/data/store-types';
import { PRICE_CEIL } from '@/data/store-types';

// The detail page needs the approved review list alongside the product.
export type ProductDetail = StoreProduct & { reviewList: Review[] };

let CATALOG: StoreProduct[] = [];
let COUPONS: StoreCoupon[] = [];
let loadPromise: Promise<void> | null = null;
let loadedMode: 'public' | 'authed' | null = null;

// Fetch the catalog once per auth mode. Public mode uses the MOP-priced
// unauthenticated endpoint (no coupons); authed mode uses EPP prices + coupons.
// When the auth mode flips (login/logout) the cache is dropped and refetched so
// prices refresh.
export function loadCatalog(authed?: boolean): Promise<void> {
  // An explicit flag (set by StoreProvider on load/auth change) selects the mode;
  // no-arg callers (getCatalog/getProductById) keep whatever mode is loaded.
  if (authed !== undefined) {
    const mode = authed ? 'authed' : 'public';
    if (loadedMode !== mode) {
      loadPromise = null;
      loadedMode = mode;
    }
  }
  if (!loadPromise) {
    if (loadedMode === null) loadedMode = 'public';
    const work =
      loadedMode === 'authed'
        ? Promise.all([shop.getProducts(), shop.getCoupons()])
        : Promise.all([shop.getPublicProducts(), Promise.resolve([] as StoreCoupon[])]);
    loadPromise = work
      .then(([products, coupons]) => {
        CATALOG = products;
        COUPONS = coupons;
      })
      .catch((e) => {
        loadPromise = null; // allow retry
        loadedMode = null;
        throw e;
      });
  }
  return loadPromise;
}

export function catalog(): StoreProduct[] {
  return CATALOG;
}
export function coupons(): StoreCoupon[] {
  return COUPONS;
}
export function findProduct(id: string): StoreProduct | undefined {
  return CATALOG.find((p) => p.id === id);
}

// The price-filter ceiling, auto-fitted to the catalog's highest price (rounded
// up to the next ₹10k for headroom) so no product is ever hidden by the cap.
// Falls back to the static PRICE_CEIL before the catalog has loaded.
export function priceCeil(): number {
  if (!CATALOG.length) return PRICE_CEIL;
  const max = Math.max(...CATALOG.map((p) => p.price));
  return Math.max(10000, Math.ceil(max / 10000) * 10000);
}

// ─── Filtering ───────────────────────────────────────────────────────────────

function inCategory(p: StoreProduct, cat: StoreCategory): boolean {
  return cat === 'all' || p.group === cat;
}

export function matchesFilters(p: StoreProduct, f: FilterState, search: string): boolean {
  if (!inCategory(p, f.category)) return false;
  if (f.sub && p.cat !== f.sub) return false;
  if (f.brands.length && !f.brands.includes(p.brand)) return false;
  if (f.minRating && p.rating < f.minRating) return false;
  if (f.inStock && p.stock === 0) return false;
  if (p.price < f.priceMin || p.price > f.priceMax) return false;
  if (search) {
    // Vendor intentionally excluded — employees don't search by reseller.
    const t = `${p.name} ${p.brand}`.toLowerCase();
    if (!t.includes(search.toLowerCase())) return false;
  }
  return true;
}

export function sortProducts(list: StoreProduct[], sort: SortKey): StoreProduct[] {
  const out = [...list];
  switch (sort) {
    case 'priceAsc':
      return out.sort((a, b) => a.price - b.price);
    case 'priceDesc':
      return out.sort((a, b) => b.price - a.price);
    case 'rating':
      return out.sort((a, b) => b.rating - a.rating);
    case 'newest':
      return out.sort((a, b) => b.newness - a.newness);
    default:
      return out;
  }
}

export interface CatalogQuery {
  filters: FilterState;
  search: string;
  sort: SortKey;
}

export async function getCatalog(q: CatalogQuery): Promise<StoreProduct[]> {
  await loadCatalog();
  return sortProducts(CATALOG.filter((p) => matchesFilters(p, q.filters, q.search)), q.sort);
}

export async function getProductById(id: string): Promise<ProductDetail | undefined> {
  await loadCatalog();
  // Fetch the exact SKU (a family sibling may not be the cached representative)
  // + its variant-family members + approved reviews, in the current auth mode.
  try {
    const res = loadedMode === 'authed' ? await shop.getProduct(id) : await shop.getPublicProduct(id);
    return { ...res.product, family: res.family, reviewList: res.reviews };
  } catch {
    const p = findProduct(id); // fall back to the cached collapsed catalog
    return p ? { ...p, reviewList: [] } : undefined;
  }
}

export function getRelated(p: StoreProduct): StoreProduct[] {
  return CATALOG.filter((x) => x.id !== p.id && x.group === p.group)
    .sort((a, b) => Number(b.brand === p.brand) - Number(a.brand === p.brand))
    .slice(0, 5);
}

// ─── Departments (top-level categories, derived from the catalog) ────────────

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// Nice labels for the seeded departments; any other category falls back to a
// title-cased slug so admin-created categories get a sensible name.
const CAT_LABEL_OVERRIDE: Record<string, string> = {
  phones: 'Phones',
  accessories: 'Phone accessories',
  bags: 'Bags',
};
export const catLabel = (slug: string) => CAT_LABEL_OVERRIDE[slug] ?? titleCase(slug);

// Preferred order: the established departments first, then any new category
// alphabetically — so the nav stays stable as categories are added.
const CAT_ORDER = ['phones', 'accessories', 'bags'];

// Distinct top-level category slugs (p.group) present in the loaded catalog —
// a category appears only once it has at least one product.
export function topGroups(): string[] {
  const seen = new Set<string>();
  for (const p of CATALOG) if (p.group) seen.add(p.group);
  return [...seen].sort((a, b) => {
    const ia = CAT_ORDER.indexOf(a);
    const ib = CAT_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return catLabel(a).localeCompare(catLabel(b));
  });
}

// The department facet list for the filter sidebar: "All products" + each group.
export function departments(): { key: StoreCategory; label: string; count: number }[] {
  return [
    { key: 'all', label: 'All products', count: CATALOG.length },
    ...topGroups().map((g) => ({ key: g, label: catLabel(g), count: CATALOG.filter((p) => p.group === g).length })),
  ];
}

// ─── Facet counts ────────────────────────────────────────────────────────────

export function categoryCounts(): Record<StoreCategory, number> {
  const out: Record<StoreCategory, number> = { all: CATALOG.length };
  for (const g of topGroups()) out[g] = CATALOG.filter((p) => p.group === g).length;
  return out;
}

export function brandCounts(cat: StoreCategory): { name: string; count: number }[] {
  const scope = CATALOG.filter((p) => inCategory(p, cat));
  const map = new Map<string, number>();
  for (const p of scope) map.set(p.brand, (map.get(p.brand) ?? 0) + 1);
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

export function countMatching(f: FilterState, search: string): number {
  return CATALOG.filter((p) => matchesFilters(p, f, search)).length;
}

// ─── Category → subcategory tree (derived from the catalog) ──────────────────

export interface SubFacet {
  key: string; // the raw p.cat value used as the filter
  label: string; // title-cased for display
  count: number;
}
export interface CategoryNode {
  key: StoreCategory;
  label: string;
  subs: SubFacet[];
}

// Distinct subcategories (p.cat) within a top category, counted, sorted.
function subsFor(cat: StoreCategory): SubFacet[] {
  const map = new Map<string, number>();
  for (const p of CATALOG) {
    if (p.group !== cat) continue;
    const key = (p.cat ?? '').trim();
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, label: titleCase(key), count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The full mega-menu tree: each department (a category with products) + its subs.
export function categoryTree(): CategoryNode[] {
  return topGroups().map((key) => ({ key, label: catLabel(key), subs: subsFor(key) }));
}

// Subcategory facets for the filter sidebar (empty for the "all" department).
export function subCategoryFacets(cat: StoreCategory): SubFacet[] {
  if (cat === 'all') return [];
  return subsFor(cat);
}

// ─── Grouped sections ────────────────────────────────────────────────────────

export interface Group {
  key: StoreCategory;
  label: string;
  items: StoreProduct[];
}

// ─── Delivery estimate (client-side heuristic) ───────────────────────────────

// Metro pincode prefixes (first two digits) → faster delivery. Everything else
// falls to a 4-5 day window. Deterministic from the pincode so it's stable.
const METRO_PREFIXES = new Set(['11', '40', '56', '60', '70', '50', '38', '41', '20', '30']);

export function deliveryEstimate(pincode: string): { days: number; label: string } {
  const metro = METRO_PREFIXES.has(pincode.slice(0, 2));
  // Vary non-metro by 4 or 5 days using the last digit, so it feels real.
  const days = metro ? 2 : 4 + (Number(pincode[5]) % 2);
  const target = new Date();
  target.setDate(target.getDate() + days);
  const label = target.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return { days, label };
}

export function groupByCategory(list: StoreProduct[]): Group[] {
  return topGroups()
    .map((key) => ({ key, label: catLabel(key), items: list.filter((p) => p.group === key) }))
    .filter((g) => g.items.length > 0);
}
