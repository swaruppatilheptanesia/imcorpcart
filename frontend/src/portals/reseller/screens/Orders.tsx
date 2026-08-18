import { useState } from 'react';
import { ShoppingBag, AlertTriangle, Truck, Eye, Search } from 'lucide-react';
import { Chip, Input, DataTable, Row, StatusPill, EmptyState, Skeleton } from '@/components';
import type { SemanticTone } from '@/data/types';
import type { StoreOrderStatus } from '@/data/store-types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { getResellerOrders, type ResellerOrderRow } from '../data';
import { TransitDrawer } from '../overlays/TransitDrawer';
import { OrderDetailDrawer } from '../overlays/OrderDetailDrawer';
import s from './screen.module.css';
import styles from './Orders.module.css';

const COLS = '0.9fr 1.3fr 1.1fr 1.1fr 0.8fr 0.95fr 0.85fr 88px';

const tone: Record<StoreOrderStatus, SemanticTone> = {
  Processing: 'warning',
  'In transit': 'info',
  Delivered: 'success',
  Cancelled: 'error',
};

type StatusFilter = 'all' | StoreOrderStatus;
const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'Processing', label: 'Processing' },
  { value: 'In transit', label: 'In transit' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Cancelled', label: 'Cancelled' },
];

export function Orders() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [transit, setTransit] = useState<ResellerOrderRow | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Fetch the full set once; status + search are refined client-side.
  const { data, state, error, reload } = useAsync(
    () => getResellerOrders('all'),
    [],
    (d) => d.length === 0,
  );
  const rows = data ?? [];

  const query = q.trim().toLowerCase();
  const shown = rows.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (query) {
      const hay = `${o.id} ${o.productName} ${o.customer} ${o.company}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={16} className={s.searchIcon} />
          <Input
            className={s.searchInput}
            placeholder="Search order no, product, or customer"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.filters}>
        {STATUS_FILTERS.map((f) => (
          <Chip key={f.value} label={f.label} active={statusFilter === f.value} onClick={() => setStatusFilter(f.value)} />
        ))}
      </div>

      {state === 'loading' && (
        <div className={styles.skeletons}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} h={52} />
          ))}
        </div>
      )}
      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load orders"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}
      {state === 'empty' && (
        <EmptyState icon={<ShoppingBag size={24} />} title="No orders" body="You have no orders yet." />
      )}
      {state === 'live' && shown.length === 0 && (
        <EmptyState
          icon={<ShoppingBag size={24} />}
          title="No matching orders"
          body="No orders match the search or status filter."
          action={{ label: 'Clear', onClick: () => { setQ(''); setStatusFilter('all'); } }}
        />
      )}
      {state === 'live' && shown.length > 0 && (
        <DataTable
          cols={COLS}
          headers={['Order', 'Product', 'Customer', 'Company', 'Date', 'Status', 'Total', '']}
        >
          {shown.map((o) => {
            const canUpdate = o.status !== 'Cancelled' && o.status !== 'Delivered';
            return (
              <Row key={o.id} cols={COLS} onClick={() => setDetailId(o.id)}>
                <div className={styles.orderId}>{o.id}</div>
                <div className={s.cellName}>
                  {o.productName}
                  {o.itemCount > 1 && <span className={s.cellSub}> +{o.itemCount - 1}</span>}
                </div>
                <div className={s.muted}>{o.customer}</div>
                <div className={s.muted}>{o.company}</div>
                <div className={s.muted}>{o.date}</div>
                <div>
                  <StatusPill label={o.status} tone={tone[o.status]} />
                </div>
                <div className={s.price}>{inr(o.total)}</div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button
                    className={s.iconBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailId(o.id);
                    }}
                    aria-label="View details"
                  >
                    <Eye size={16} />
                  </button>
                  {canUpdate && (
                    <button
                      className={s.iconBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTransit(o);
                      }}
                      aria-label="Update transit"
                    >
                      <Truck size={16} />
                    </button>
                  )}
                </div>
              </Row>
            );
          })}
        </DataTable>
      )}

      <OrderDetailDrawer open={Boolean(detailId)} orderId={detailId} onClose={() => setDetailId(null)} />

      <TransitDrawer
        open={Boolean(transit)}
        order={transit}
        onClose={() => setTransit(null)}
        onSaved={() => {
          setTransit(null);
          reload();
        }}
      />
    </div>
  );
}
