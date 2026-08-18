import { Radio, Checkbox, Toggle } from '@/components';
import { useStore } from '../store-context';
import { departments, catLabel, brandCounts, subCategoryFacets } from '../data';
import { PriceSlider } from './PriceSlider';
import styles from './FilterFacets.module.css';

/**
 * The catalog filter facets — Category, Price, Brand, In-stock.
 * Layout-agnostic: reads/writes only through `useStore()` + the `data.ts` count
 * helpers, so it renders identically in the persistent desktop sidebar
 * (`FilterSidebar`) and the mobile bottom-sheet (`FilterPanel`).
 * (Reseller/vendor is intentionally not a facet — employees don't see vendors.)
 */
export function FilterFacets() {
  const { filters, setFilters, priceCeil } = useStore();
  const cats = departments();
  const brands = brandCounts(filters.category);
  const subs = subCategoryFacets(filters.category);

  const toggleBrand = (b: string) =>
    setFilters({
      brands: filters.brands.includes(b) ? filters.brands.filter((x) => x !== b) : [...filters.brands, b],
    });

  return (
    <div className={styles.facets}>
      <section className={styles.section}>
        <div className={styles.overline}>Category</div>
        {cats.map((c) => (
          <button
            key={c.key}
            className={styles.facetRow}
            onClick={() => setFilters({ category: c.key, sub: null, brands: [] })}
          >
            <Radio checked={filters.category === c.key} />
            <span className={styles.facetLabel}>{c.label}</span>
            <span className={styles.count}>{c.count}</span>
          </button>
        ))}
      </section>

      {subs.length > 0 && (
        <section className={styles.section}>
          <div className={styles.overline}>Subcategory</div>
          <button className={styles.facetRow} onClick={() => setFilters({ sub: null })}>
            <Radio checked={filters.sub === null} />
            <span className={styles.facetLabel}>All {catLabel(filters.category)}</span>
          </button>
          {subs.map((sf) => (
            <button key={sf.key} className={styles.facetRow} onClick={() => setFilters({ sub: sf.key })}>
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
        <div className={styles.overline}>Brand</div>
        {brands.map((b) => (
          <button key={b.name} className={styles.facetRow} onClick={() => toggleBrand(b.name)}>
            <Checkbox checked={filters.brands.includes(b.name)} />
            <span className={styles.facetLabel}>{b.name}</span>
            <span className={styles.count}>{b.count}</span>
          </button>
        ))}
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
