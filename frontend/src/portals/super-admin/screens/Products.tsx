import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Eye, Pencil, Plus, PackageSearch, AlertTriangle } from 'lucide-react';
import {
  Segmented,
  Input,
  Button,
  DataTable,
  Row,
  StatusPill,
  ProductThumb,
  VendorTag,
  EmptyState,
  Skeleton,
} from '@/components';
import { getProducts, catLabels, vendorColors } from '@/data/api';
import type { Product, ProductStatus, SemanticTone, Vendor } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import s from './screen.module.css';
import styles from './Products.module.css';

const PAGE_SIZE = 20;

const COLS = '2.4fr 1fr 1.1fr 1fr 1fr 0.9fr 76px';

const VENDOR_OPTIONS = ['all', ...(Object.keys(vendorColors) as Vendor[])] as const;

const statusTone: Record<ProductStatus, SemanticTone> = {
  active: 'success',
  draft: 'warning',
  inactive: 'neutral',
};
const statusLabel: Record<ProductStatus, string> = {
  active: 'Active',
  draft: 'Draft',
  inactive: 'Inactive',
};

function stockTone(stock: number): { tone: SemanticTone; label: string } {
  if (stock === 0) return { tone: 'error', label: 'Out of stock' };
  if (stock < 20) return { tone: 'warning', label: `${stock} low` };
  return { tone: 'success', label: `${stock} in stock` };
}

export function Products() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [cat, setCat] = useState<'all' | 'phones' | 'accessories' | 'bags'>('all');
  const [status, setStatus] = useState<'all' | ProductStatus>('all');
  const [vendor, setVendor] = useState<'all' | Vendor>('all');
  const [page, setPage] = useState(1);

  // Debounce the search box so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to page 1 whenever a filter changes.
  useEffect(() => setPage(1), [debouncedQ, cat, status]);

  const { data, state, error, reload } = useAsync(
    () => getProducts({ q: debouncedQ, group: cat, status, page, pageSize: PAGE_SIZE }),
    [debouncedQ, cat, status, page],
    (d) => d.items.length === 0,
  );

  const fetched: Product[] = data?.items ?? [];
  // Vendor is a client-side refinement over the current page.
  const rows = vendor === 'all' ? fetched : fetched.filter((p) => p.vendor === vendor);
  const total = data?.total ?? 0;
  const pageCount = data?.meta.pageCount ?? 1;

  const clearFilters = () => {
    setQ('');
    setCat('all');
    setStatus('all');
    setVendor('all');
  };

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={16} className={s.searchIcon} />
          <Input
            className={s.searchInput}
            placeholder="Search name or SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Segmented
          options={[
            { value: 'all', label: 'All' },
            { value: 'phones', label: 'Phones' },
            { value: 'accessories', label: 'Accessories' },
            { value: 'bags', label: 'Bags' },
          ]}
          value={cat}
          onChange={setCat}
        />
        <select
          className={styles.vendorSelect}
          value={vendor}
          onChange={(e) => setVendor(e.target.value as 'all' | Vendor)}
          aria-label="Filter by vendor"
        >
          {VENDOR_OPTIONS.map((v) => (
            <option key={v} value={v}>
              {v === 'all' ? 'All vendors' : v}
            </option>
          ))}
        </select>
        <div className={s.spacer} />
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
        <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate('/super-admin/productEdit')}>
          Add product
        </Button>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={52} />
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
        <EmptyState
          icon={<PackageSearch size={24} />}
          title="No products match"
          body="Try a different search term or clear the active filters."
          action={{ label: 'Clear filters', onClick: clearFilters }}
        />
      )}

      {state === 'live' && rows.length === 0 && (
        <EmptyState
          icon={<PackageSearch size={24} />}
          title="No products match"
          body="No products from this vendor on the current page. Try a different vendor or clear the filters."
          action={{ label: 'Clear filters', onClick: clearFilters }}
        />
      )}

      {state === 'live' && rows.length > 0 && (
        <DataTable
          cols={COLS}
          headers={['Product', 'SKU', 'Category', 'EPP price', 'Date added', 'Stock', '']}
          footer={
            <>
              <span>
                Showing {rows.length}
                {vendor !== 'all' ? ` of ${fetched.length} on page` : ` of ${total} products`}
              </span>
              <div className={styles.pager}>
                <button
                  className={styles.pageBtn}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <button
                  className={styles.pageBtn}
                  disabled={page >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next
                </button>
              </div>
            </>
          }
        >
          {rows.map((p) => {
            const st = stockTone(p.stock);
            return (
              <Row
                key={p.id}
                cols={COLS}
                onClick={() => navigate(`/super-admin/productDetail/${p.id}`)}
              >
                <div className={s.cellMain}>
                  <ProductThumb g1={p.g1} g2={p.g2} />
                  <div style={{ minWidth: 0 }}>
                    <div className={s.cellName}>{p.name}</div>
                    <VendorTag name={p.brand} color={vendorColors[p.vendor]} />
                    {p.vendorTag && (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 3,
                          padding: '1px 7px',
                          borderRadius: 6,
                          fontSize: 11,
                          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                          color: 'var(--accent)',
                        }}
                        title="Imported from an external vendor"
                      >
                        {p.vendorTag}{p.hidden ? ' · hidden' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className={s.mono}>{p.sku}</div>
                <div className={s.muted}>{catLabels[p.cat] ?? p.cat}</div>
                <div className={s.price}>{inr(p.price)}</div>
                <div className={s.muted}>{p.dateAdded}</div>
                <div>
                  <StatusPill label={st.label} tone={st.tone} />
                </div>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                  <button
                    className={s.iconBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/super-admin/productDetail/${p.id}`);
                    }}
                    aria-label="View details"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    className={s.iconBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/super-admin/productEdit?id=${p.id}`);
                    }}
                    aria-label="Edit product"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              </Row>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}

export { statusTone, statusLabel };
