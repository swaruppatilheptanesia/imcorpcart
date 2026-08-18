import { SlidersHorizontal, LayoutGrid, List } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAsync } from '@/lib/useAsync';
import { categoryChips, sortOptions } from '@/data/fixtures/storefront';
import type { StoreProduct } from '@/data/store-types';
import { useStore } from '../store-context';
import { useShopShell } from '../shop-context';
import { getCatalog, groupByCategory } from '../data';
import { ProductGrid, GridSkeleton } from '../components/ProductGrid';
import { FilterSidebar } from '../components/FilterSidebar';
import { PromoCarousel } from '../components/PromoCarousel';
import s from './store-screen.module.css';

export function Home() {
  const { openFilter } = useShopShell();
  const { filters, setFilters, sortBy, setSortBy, grid, setGrid, activeFilterCount, search } = useStore();

  const { data, state } = useAsync(
    () => getCatalog({ filters, search, sort: sortBy }),
    [filters, search, sortBy],
  );
  const items: StoreProduct[] = data ?? [];

  // Grouped sections only when browsing "all" with no narrowing facet.
  const grouped = filters.category === 'all' && activeFilterCount === 0 && !search;
  const groups = grouped ? groupByCategory(items) : [];

  return (
    <div>
      <PromoCarousel />

      <div className={s.chips}>
        {categoryChips.map((c) => (
          <button
            key={c.key}
            className={cn(s.chip, filters.category === c.key && s.chipActive)}
            onClick={() => setFilters({ category: c.key, brands: [] })}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className={s.catalogLayout}>
        <FilterSidebar />

        <div className={s.catalogResults}>
          <div className={s.sectionHead}>
            <span className={s.sectionTitle}>Featured this month</span>
            <span className={s.count}>{items.length} products</span>
            <div className={s.controls}>
              <button className={s.filterBtn} onClick={openFilter}>
                <SlidersHorizontal size={16} /> Filters
                {activeFilterCount > 0 && <span className={s.filterBadge}>{activeFilterCount}</span>}
              </button>
              <span className={s.sortWrap}>
                Sort
                <select className={s.sortSelect} value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                  {sortOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </span>
              <div className={s.viewToggle}>
                <button className={cn(s.viewBtn, grid && s.viewBtnActive)} onClick={() => setGrid(true)} aria-label="Grid">
                  <LayoutGrid size={16} />
                </button>
                <button className={cn(s.viewBtn, !grid && s.viewBtnActive)} onClick={() => setGrid(false)} aria-label="List">
                  <List size={16} />
                </button>
              </div>
            </div>
          </div>

          {state === 'loading' && <GridSkeleton count={6} />}

          {state !== 'loading' && grouped && (
            <>
              {groups.map((g) => (
                <section key={g.key} className={s.groupSection}>
                  <div className={s.groupHead}>
                    <span className={s.groupTitle}>{g.label}</span>
                    <span className={s.count}>{g.items.length} items</span>
                  </div>
                  <ProductGrid items={g.items} list={!grid} />
                </section>
              ))}
            </>
          )}

          {state !== 'loading' && !grouped && <ProductGrid items={items} list={!grid} />}
        </div>
      </div>
    </div>
  );
}
