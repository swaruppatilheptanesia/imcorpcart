import { useStore } from '../store-context';
import { FilterFacets } from './FilterFacets';
import styles from './FilterSidebar.module.css';

/**
 * Persistent left filter rail for the catalog pages (Home / Search).
 * Desktop-only — hidden below the 768px breakpoint via CSS, where the
 * `FilterPanel` bottom-sheet takes over instead.
 */
export function FilterSidebar() {
  const { clearFilters, activeFilterCount } = useStore();
  return (
    <aside className={styles.sidebar} aria-label="Filters">
      <div className={styles.head}>
        <span className={styles.title}>Filters</span>
        {activeFilterCount > 0 && (
          <button className={styles.clear} onClick={clearFilters}>
            Clear all
          </button>
        )}
      </div>
      <FilterFacets />
    </aside>
  );
}
