import { useMemo, useState } from 'react';
import { AlertTriangle, IndianRupee, Search } from 'lucide-react';
import { DataTable, Row, StatusPill, EmptyState, Skeleton } from '@/components';
import { getAllOffers, type AllOfferRow } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import s from './screen.module.css';
import styles from './ResellerPricing.module.css';

const COLS = 'minmax(0, 2fr) minmax(0, 1.4fr) 120px 120px 120px 80px 96px';

function sellerName(o: AllOfferRow): string {
  return o.reseller?.name ?? 'First-party (house)';
}

function commissionOf(o: AllOfferRow): number | null {
  if (o.resellerPrice == null || o.resellerPrice <= 0) return null;
  return o.eppPrice >= o.resellerPrice ? o.eppPrice - o.resellerPrice : null;
}

export function ResellerPricing() {
  const [q, setQ] = useState('');
  const { data, state, error, reload } = useAsync(getAllOffers, [], (d) => d.length === 0);
  const offers = useMemo(() => data ?? [], [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return offers;
    return offers.filter(
      (o) =>
        o.product.name.toLowerCase().includes(needle) ||
        o.product.sku.toLowerCase().includes(needle) ||
        sellerName(o).toLowerCase().includes(needle),
    );
  }, [offers, q]);

  return (
    <div>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={15} />
          <input
            className={styles.searchInput}
            placeholder="Search product or reseller…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className={s.muted}>{rows.length} listing{rows.length === 1 ? '' : 's'}</div>
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

      {state === 'live' && rows.length === 0 && (
        <EmptyState icon={<Search size={24} />} title="No matches" body={`Nothing matches “${q}”.`} />
      )}

      {state === 'live' && rows.length > 0 && (
        <DataTable
          cols={COLS}
          headers={['Product', 'Reseller', 'Reseller price', 'Customer price', 'Commission', 'Stock', 'Status']}
        >
          {rows.map((o) => {
            const outOfStock = o.quantity <= 0;
            const live = o.isActive && o.status === 'ACTIVE' && !outOfStock;
            const commission = commissionOf(o);
            return (
              <Row key={o.id} cols={COLS}>
                <div style={{ minWidth: 0 }}>
                  <span className={s.cellName}>{o.product.name}</span>
                  <span className={s.cellSub}> {o.product.sku}</span>
                </div>
                <div className={s.muted}>{sellerName(o)}</div>
                <div className={styles.num}>{o.resellerPrice != null ? inr(o.resellerPrice) : '—'}</div>
                <div className={styles.num}>{o.eppPrice ? inr(o.eppPrice) : '—'}</div>
                <div className={`${styles.num} ${commission != null ? styles.commission : ''}`}>
                  {commission != null ? inr(commission) : '—'}
                </div>
                <div className={styles.num}>{outOfStock ? '—' : o.quantity}</div>
                <div>
                  <StatusPill label={live ? 'Live' : 'Off'} tone={live ? 'success' : 'neutral'} />
                </div>
              </Row>
            );
          })}
        </DataTable>
      )}
    </div>
  );
}
