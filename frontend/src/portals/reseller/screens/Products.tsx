import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Pencil, PackageSearch, AlertTriangle } from 'lucide-react';
import {
  Segmented,
  Input,
  DataTable,
  Row,
  StatusPill,
  ProductThumb,
  EmptyState,
  Skeleton,
} from '@/components';
import { catLabels } from '@/data/api';
import type { ProductStatus, SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { getResellerOffers, type ResellerOfferRow } from '../data';
import s from './screen.module.css';
import styles from './Products.module.css';

const COLS = '2.4fr 1fr 1.1fr 0.9fr 1fr 0.9fr 40px';

type StockFilter = 'all' | 'in' | 'low' | 'out';
type Sort = 'newest' | 'priceAsc' | 'priceDesc';

function stockTone(stock: number): { tone: SemanticTone; label: string } {
  if (stock === 0) return { tone: 'error', label: 'Out of stock' };
  if (stock < 20) return { tone: 'warning', label: `${stock} in stock` };
  return { tone: 'success', label: `${stock} in stock` };
}

export function Products() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [group, setGroup] = useState<'all' | 'phones' | 'accessories' | 'bags'>('all');
  const [status, setStatus] = useState<'all' | ProductStatus>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sort, setSort] = useState<Sort>('newest');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, state, error, reload } = useAsync(
    () => getResellerOffers({ q: debouncedQ, group, status }),
    [debouncedQ, group, status],
    (d) => d.length === 0,
  );
  const fetched: ResellerOfferRow[] = data ?? [];

  // Stock + sort are refined client-side over the fetched set.
  let rows = fetched;
  if (stockFilter === 'in') rows = rows.filter((p) => p.quantity >= 20);
  else if (stockFilter === 'low') rows = rows.filter((p) => p.quantity > 0 && p.quantity < 20);
  else if (stockFilter === 'out') rows = rows.filter((p) => p.quantity === 0);
  if (sort === 'priceAsc') rows = [...rows].sort((a, b) => a.eppPrice - b.eppPrice);
  else if (sort === 'priceDesc') rows = [...rows].sort((a, b) => b.eppPrice - a.eppPrice);

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={16} className={s.searchIcon} />
          <Input
            className={s.searchInput}
            placeholder="Search your products or SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className={s.spacer} />
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'phones', label: 'Phones' },
            { value: 'accessories', label: 'Accessories' },
            { value: 'bags', label: 'Bags' },
          ]}
          value={group}
          onChange={setGroup}
        />
      </div>

      <div className={styles.statusRow}>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'draft', label: 'Draft' },
            { value: 'inactive', label: 'Inactive' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <Segmented
          options={[
            { value: 'all', label: 'Any stock' },
            { value: 'in', label: 'In stock' },
            { value: 'low', label: 'Low' },
            { value: 'out', label: 'Out' },
          ]}
          value={stockFilter}
          onChange={setStockFilter}
        />
        <div className={s.spacer} />
        <select className={styles.sortSelect} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="newest">Newest</option>
          <option value="priceAsc">Price · low to high</option>
          <option value="priceDesc">Price · high to low</option>
        </select>
      </div>

      {state === 'loading' && (
        <div className={styles.skeletons}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load products"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState icon={<PackageSearch size={24} />} title="No products match" body="Try a different search term or filter." />
      )}

      {state === 'live' && rows.length === 0 && (
        <EmptyState
          icon={<PackageSearch size={24} />}
          title="No products match"
          body="No products match the stock filter."
          action={{ label: 'Clear', onClick: () => { setStockFilter('all'); setSort('newest'); } }}
        />
      )}

      {state === 'live' && rows.length > 0 && (
        <DataTable
          cols={COLS}
          headers={['Product', 'SKU', 'Category', 'MRP', 'My EPP price', 'Stock', '']}
          footer={<span>Showing {rows.length} of {fetched.length} listings</span>}
        >
          {rows.map((p) => {
            const st = stockTone(p.quantity);
            return (
              <Row key={p.offerId} cols={COLS} onClick={() => navigate(`/reseller/productEdit?id=${p.offerId}`)}>
                <div className={s.cellMain}>
                  <ProductThumb g1={p.image ?? p.g1} g2={p.g2} />
                  <div style={{ minWidth: 0 }}>
                    <div className={s.cellName}>{p.name}</div>
                    <div className={s.muted} style={{ fontSize: 12 }}>{p.brand}</div>
                  </div>
                </div>
                <div className={s.mono}>{p.sku}</div>
                <div className={s.muted}>{catLabels[p.cat] ?? p.categoryName}</div>
                <div className={s.muted}>{p.mrp > p.eppPrice ? inr(p.mrp) : '—'}</div>
                <div className={s.price}>{inr(p.eppPrice)}</div>
                <div>
                  <StatusPill label={st.label} tone={st.tone} />
                </div>
                <button
                  className={s.iconBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/reseller/productEdit?id=${p.offerId}`);
                  }}
                  aria-label="Edit"
                >
                  <Pencil size={16} />
                </button>
              </Row>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
