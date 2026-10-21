import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, Search } from 'lucide-react';
import { Radio, Checkbox, Toggle } from '@/components';
import { cn } from '@/lib/cn';
import type { FilterState } from '@/data/store-types';
import { useStore } from '../store-context';
import { rankedDepartments, catLabel, brandCounts, subCategoryFacets } from '../data';
import { PriceSlider } from './PriceSlider';
import styles from './FilterFacets.module.css';

// How many departments stay visible before the "show all" expander. The catalog
// carries ~37 top-level groups because the vendor import creates one per
// accessory type, so the full list ran well past a screen on its own.
const VISIBLE_CATEGORIES = 8;

/**
 * The catalog filter facets — Category, Price, Brand, In-stock.
 * Layout-agnostic: reads/writes only through `useStore()` + the `data.ts` count
 * helpers, so it renders identically in the persistent desktop sidebar
 * (`FilterSidebar`) and the mobile bottom-sheet (`FilterPanel`).
 * (Reseller/vendor is intentionally not a facet — employees don't see vendors.)
 *
 * Brand and Category are capped rather than listed in full. Unbounded, this
 * component rendered 503 brand rows and 37 category rows — a ~60,000px rail,
 * built twice over, since the mobile panel stays mounted behind the desktop one.
 * Brands are especially lopsided: 492 of the 503 have a single product, because
 * every gift card sets its brand to its own name.
 */
export function FilterFacets() {
  const { filters, setFilters, setScope, priceCeil } = useStore();
  const cats = rankedDepartments();
  const subs = subCategoryFacets(filters.category);

  const [allCats, setAllCats] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brandQuery, setBrandQuery] = useState('');

  // Computed on render rather than memoised: brandCounts() reads the
  // module-level CATALOG, which is filled in asynchronously, so a memo keyed on
  // the category alone would freeze the empty pre-load result forever. Skipped
  // entirely while the section is collapsed, which is the default.
  // Busiest brands first — brandCounts() sorts alphabetically, which would put
  // "109F" and "AJIO" above iCare (102) and Samsung.
  const brands = brandOpen
    ? [...brandCounts(filters.category)].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    : [];

  // A checked brand always stays on screen, even when the search text excludes
  // it — otherwise typing could hide a ticked box while the grid stays filtered.
  const q = brandQuery.trim().toLowerCase();
  const shownBrands = q
    ? brands.filter((b) => filters.brands.includes(b.name) || b.name.toLowerCase().includes(q))
    : brands;

  // Keep the selected department visible when the list is collapsed, so picking
  // one from the expanded tail doesn't hide the active filter on collapse.
  const visibleCats = (() => {
    if (allCats) return cats;
    const head = cats.slice(0, VISIBLE_CATEGORIES + 1); // +1 for "All products"
    const selected = cats.find((c) => c.key === filters.category);
    return selected && !head.includes(selected) ? [...head, selected] : head;
  })();

  const hiddenCatCount = cats.length - Math.min(cats.length, VISIBLE_CATEGORIES + 1);

  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Changing department, subcategory or brand is a scope change, so setScope
  // clears the search term. The query has then gone, and staying on the search
  // screen would leave the shopper looking at an empty search box — so send
  // them to the catalog, exactly as the department bar does. Price and
  // in-stock below stay on setFilters: those refine what was found.
  const scopeTo = (patch: Partial<FilterState>) => {
    setScope(patch);
    if (pathname.startsWith('/shop/search')) navigate('/shop/home');
  };

  const toggleBrand = (b: string) =>
    scopeTo({
      brands: filters.brands.includes(b) ? filters.brands.filter((x) => x !== b) : [...filters.brands, b],
    });

  return (
    <div className={styles.facets}>
      <section className={styles.section}>
        <div className={styles.overline}>Category</div>
        {visibleCats.map((c) => (
          <button
            key={c.key}
            className={styles.facetRow}
            onClick={() => scopeTo({ category: c.key, sub: null, brands: [] })}
          >
            <Radio checked={filters.category === c.key} />
            <span className={styles.facetLabel}>{c.label}</span>
            <span className={styles.count}>{c.count}</span>
          </button>
        ))}
        {hiddenCatCount > 0 && (
          <button className={styles.moreLink} onClick={() => setAllCats((v) => !v)} aria-expanded={allCats}>
            {allCats ? 'Show fewer categories' : `Show all categories (${hiddenCatCount})`}
            <ChevronDown size={13} className={cn(styles.chev, allCats && styles.chevOpen)} />
          </button>
        )}
      </section>

      {subs.length > 0 && (
        <section className={styles.section}>
          <div className={styles.overline}>Subcategory</div>
          <button className={styles.facetRow} onClick={() => scopeTo({ sub: null })}>
            <Radio checked={filters.sub === null} />
            <span className={styles.facetLabel}>All {catLabel(filters.category)}</span>
          </button>
          {subs.map((sf) => (
            <button key={sf.key} className={styles.facetRow} onClick={() => scopeTo({ sub: sf.key })}>
              <Radio checked={filters.sub === sf.key} />
              <span className={styles.facetLabel}>{sf.label}</span>
              <span className={styles.count}>{sf.count}</span>
            </button>
          ))}
        </section>
      )}

      <section className={styles.section}>
        <div className={styles.overline}>Price range</div>
        <PriceSlider
          min={filters.priceMin}
          max={filters.priceMax}
          ceil={priceCeil}
          onChange={(min, max) => setFilters({ priceMin: min, priceMax: max })}
        />
      </section>

      <section className={styles.section}>
        {/* Collapsed by default, and expands inline rather than floating: the
            sidebar is itself an overflow:auto box, which would clip a popover. */}
        <button
          className={styles.sectionHead}
          onClick={() => setBrandOpen((v) => !v)}
          aria-expanded={brandOpen}
        >
          <span className={styles.overline}>Brand</span>
          {/* Surfaced on the header so a collapsed section never hides an active filter. */}
          {filters.brands.length > 0 && <span className={styles.badge}>{filters.brands.length}</span>}
          <ChevronDown size={14} className={cn(styles.chev, brandOpen && styles.chevOpen)} />
        </button>

        {brandOpen && (
          <>
            {brands.length > 8 && (
              <div className={styles.searchWrap}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  className={styles.searchInput}
                  placeholder={`Search ${brands.length} brands`}
                  value={brandQuery}
                  onChange={(e) => setBrandQuery(e.target.value)}
                  aria-label="Search brands"
                />
              </div>
            )}
            <div className={styles.scrollList}>
              {shownBrands.map((b) => (
                <button key={b.name} className={styles.facetRow} onClick={() => toggleBrand(b.name)}>
                  <Checkbox checked={filters.brands.includes(b.name)} />
                  <span className={styles.facetLabel}>{b.name}</span>
                  <span className={styles.count}>{b.count}</span>
                </button>
              ))}
              {shownBrands.length === 0 && <div className={styles.noMatch}>No brand matches that.</div>}
            </div>
          </>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.toggleRow}>
          <span className={styles.facetLabel}>In stock only</span>
          <Toggle on={filters.inStock} onClick={() => setFilters({ inStock: !filters.inStock })} />
        </div>
      </section>
    </div>
  );
}
