import { SlidersHorizontal, Search as SearchIcon, PackageSearch } from 'lucide-react';
import { EmptyState } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { sortOptions } from '@/data/fixtures/storefront';
import type { StoreProduct } from '@/data/store-types';
import { useStore } from '../store-context';
import { useShopShell } from '../shop-context';
import { getCatalog } from '../data';
import { ProductGrid, GridSkeleton } from '../components/ProductGrid';
import { FilterSidebar } from '../components/FilterSidebar';
import s from './store-screen.module.css';
import styles from './Search.module.css';

export function Search() {
  const { openFilter } = useShopShell();
  const { filters, sortBy, setSortBy, activeFilterCount, search, setSearch, clearFilters } = useStore();

  const { data, state } = useAsync(
    () => getCatalog({ filters, search, sort: sortBy }),
    [filters, search, sortBy],
    (d) => d.length === 0,
  );
  const items: StoreProduct[] = data ?? [];

  return (
    <div>
      <div className={styles.searchBar}>
        <SearchIcon size={18} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Search phones, brands…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>

      <div className={s.catalogLayout}>
        <FilterSidebar />

        <div className={s.catalogResults}>
          <div className={s.sectionHead}>
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
            </div>
          </div>

          {state === 'loading' && <GridSkeleton count={6} />}
          {state === 'empty' && (
            <EmptyState
              icon={<PackageSearch size={24} />}
              title="No products match"
              body="Try a different search term or clear the active filters."
              action={{ label: 'Clear filters', onClick: clearFilters }}
            />
          )}
          {state === 'live' && <ProductGrid items={items} />}
        </div>
      </div>
    </div>
  );
}
