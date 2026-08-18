import { X } from 'lucide-react';
import { Button } from '@/components';
import { useStore } from '../store-context';
import { countMatching } from '../data';
import { FilterFacets } from '../components/FilterFacets';
import styles from './FilterPanel.module.css';

/**
 * Mobile-only filter fallback: a right drawer / bottom sheet holding the same
 * `FilterFacets` shown in the persistent desktop `FilterSidebar`. Opened by the
 * "Filters" button (via the shell outlet context) on viewports ≤768px.
 */
export function FilterPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { filters, clearFilters, activeFilterCount, search } = useStore();
  const showN = countMatching(filters, search);

  return (
    <>
      <div className={styles.scrim} data-open={open} onClick={onClose} />
      <aside className={styles.panel} data-open={open} role="dialog" aria-label="Filters">
        <div className={styles.head}>
          <div className={styles.title}>Filters</div>
          {activeFilterCount > 0 && (
            <button className={styles.clear} onClick={clearFilters}>
              Clear all
            </button>
          )}
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className={styles.body}>
          <FilterFacets />
        </div>

        <div className={styles.footer}>
          <Button block size="lg" onClick={onClose}>
            Show {showN} products
          </Button>
        </div>
      </aside>
    </>
  );
}
