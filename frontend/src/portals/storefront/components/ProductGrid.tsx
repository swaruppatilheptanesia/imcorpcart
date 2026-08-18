import { cn } from '@/lib/cn';
import type { StoreProduct } from '@/data/store-types';
import { ProductCard } from './ProductCard';
import styles from './ProductGrid.module.css';

export function ProductGrid({ items, list = false }: { items: StoreProduct[]; list?: boolean }) {
  return (
    <div className={cn(list ? styles.list : styles.grid)}>
      {items.map((p) => (
        <ProductCard key={p.id} p={p} list={list} />
      ))}
    </div>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.skel}>
          <div className={styles.skelWell} />
          <div className={styles.skelLine} style={{ width: '40%' }} />
          <div className={styles.skelLine} style={{ width: '80%' }} />
          <div className={styles.skelLine} style={{ width: '50%' }} />
        </div>
      ))}
    </div>
  );
}
