import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, IndianRupee, Search } from 'lucide-react';
import { Button, DataTable, EmptyState, Input, Row, Select, Skeleton, StatusPill } from '@/components';
import { getAllOffers, type AllOfferRow } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import s from './screen.module.css';
import styles from './ResellerPricing.module.css';

const COLS = 'minmax(0, 2fr) minmax(0, 1.4fr) 120px 120px 120px 80px 96px';

const PAGE_SIZES = [25, 50, 100, 200];

type SellerFilter = 'all' | 'house' | 'reseller' | string; // a reseller id
type StatusFilter = 'all' | 'live' | 'off';
type StockFilter = 'all' | 'in' | 'out';

function sellerName(o: AllOfferRow): string {
  return o.reseller?.name ?? 'First-party (house)';
}

function commissionOf(o: AllOfferRow): number | null {
  if (o.resellerPrice == null || o.resellerPrice <= 0) return null;
  return o.eppPrice >= o.resellerPrice ? o.eppPrice - o.resellerPrice : null;
}

function isLive(o: AllOfferRow): boolean {
  return o.isActive && o.status === 'ACTIVE' && o.quantity > 0;
}

export function ResellerPricing() {
  const [q, setQ] = useState('');
  const [seller, setSeller] = useState<SellerFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [stock, setStock] = useState<StockFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const { data, state, error, reload } = useAsync(getAllOffers, [], (d) => d.length === 0);
  const offers = useMemo(() => data ?? [], [data]);

  // Seller options come from the data itself, so the list always matches what is
  // actually on offer rather than a hardcoded vendor list.
  const sellerOptions = useMemo(() => {
    const byId = new Map<string, string>();
    offers.forEach((o) => {
      if (o.reseller) byId.set(o.reseller.id, o.reseller.name);
    });
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [offers]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return offers.filter((o) => {
      if (needle) {
        const hit =
          o.product.name.toLowerCase().includes(needle) ||
          o.product.sku.toLowerCase().includes(needle) ||
          sellerName(o).toLowerCase().includes(needle);
        if (!hit) return false;
      }
      if (seller === 'house' && o.resellerId !== null) return false;
      if (seller === 'reseller' && o.resellerId === null) return false;
      if (seller !== 'all' && seller !== 'house' && seller !== 'reseller' && o.resellerId !== seller) return false;
      if (status === 'live' && !isLive(o)) return false;
      if (status === 'off' && isLive(o)) return false;
      if (stock === 'in' && o.quantity <= 0) return false;
      if (stock === 'out' && o.quantity > 0) return false;
      return true;
    });
  }, [offers, q, seller, status, stock]);

  // Any filter change invalidates the current page number.
  useEffect(() => {
    setPage(1);
  }, [q, seller, status, stock, pageSize]);

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);

  const filtered = q.trim() !== '' || seller !== 'all' || status !== 'all' || stock !== 'all';
  const clearAll = () => {
    setQ('');
    setSeller('all');
    setStatus('all');
    setStock('all');
  };

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Input
            icon={<Search size={16} />}
            placeholder="Search product or reseller…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <Select
          value={seller}
          onChange={(e) => setSeller(e.target.value as SellerFilter)}
          aria-label="Filter by seller"
        >
          <option value="all">All sellers</option>
          <option value="house">First-party (house)</option>
          <option value="reseller">Any reseller</option>
          {sellerOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </Select>

        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">Any status</option>
          <option value="live">Live only</option>
          <option value="off">Off only</option>
        </Select>

        <Select
          value={stock}
          onChange={(e) => setStock(e.target.value as StockFilter)}
          aria-label="Filter by stock"
        >
          <option value="all">Any stock</option>
          <option value="in">In stock</option>
          <option value="out">Out of stock</option>
        </Select>

        {filtered && (
          <Button variant="secondary" onClick={clearAll}>
            Clear
          </Button>
        )}

        <div className={s.toolbarNote}>
          {total.toLocaleString('en-IN')} listing{total === 1 ? '' : 's'}
          {filtered && offers.length !== total && (
            <span className={s.muted}> of {offers.length.toLocaleString('en-IN')}</span>
          )}
        </div>
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load reseller pricing"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<IndianRupee size={24} />}
          title="No offers yet"
          body="Attach sellers to products, then they set their prices here."
        />
      )}

      {state === 'live' && total === 0 && (
        <EmptyState
          icon={<Search size={24} />}
          title="No matches"
          body="No listing matches these filters."
          action={{ label: 'Clear filters', onClick: clearAll }}
        />
      )}

      {state === 'live' && total > 0 && (
        <>
          <DataTable
            cols={COLS}
            headers={['Product', 'Reseller', 'Reseller price', 'Customer price', 'Commission', 'Stock', 'Status']}
          >
            {pageRows.map((o) => {
              const outOfStock = o.quantity <= 0;
              const live = isLive(o);
              const commission = commissionOf(o);
              return (
                <Row key={o.id} cols={COLS}>
                  {/* Two stacked block lines, each truncating on its own. The name and
                      SKU used to be inline spans in one cell, so a long title had
                      nothing to clip against and painted over the next columns. */}
                  <div className={styles.productCell}>
                    <span className={`${s.cellName} ${s.truncate}`} title={o.product.name}>
                      {o.product.name}
                    </span>
                    <span className={`${s.cellSub} ${s.truncate}`}>{o.product.sku}</span>
                  </div>
                  <div className={`${s.muted} ${s.truncate}`} title={sellerName(o)}>
                    {sellerName(o)}
                  </div>
                  <div className={styles.num}>{o.resellerPrice != null ? inr(o.resellerPrice) : '—'}</div>
                  <div className={styles.num}>{o.eppPrice ? inr(o.eppPrice) : '—'}</div>
                  <div className={`${styles.num} ${commission != null ? styles.commission : ''}`}>
                    {commission != null ? inr(commission) : '—'}
                  </div>
                  <div className={styles.num}>{outOfStock ? '—' : o.quantity.toLocaleString('en-IN')}</div>
                  <div>
                    <StatusPill label={live ? 'Live' : 'Off'} tone={live ? 'success' : 'neutral'} />
                  </div>
                </Row>
              );
            })}
          </DataTable>

          <div className={s.pager}>
            <div className={s.pagerInfo}>
              Showing {(start + 1).toLocaleString('en-IN')}–
              {Math.min(start + pageSize, total).toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
            </div>
            <div className={s.pagerControls}>
              <Select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                aria-label="Rows per page"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n} per page
                  </option>
                ))}
              </Select>
              <button
                className={s.pageBtn}
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <span className={s.pageNum}>
                Page {safePage} of {pageCount}
              </span>
              <button
                className={s.pageBtn}
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= pageCount}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
