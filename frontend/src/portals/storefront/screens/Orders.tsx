import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, AlertTriangle, ShoppingBag } from 'lucide-react';
import { Chip, StatusPill, EmptyState, Skeleton } from '@/components';
import type { SemanticTone } from '@/data/types';
import type { StoreOrderStatus } from '@/data/store-types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import { getOrders } from '@/data/shop-api';
import styles from './Orders.module.css';

const tone: Record<StoreOrderStatus, SemanticTone> = {
  Processing: 'warning',
  'In transit': 'info',
  Delivered: 'success',
  Cancelled: 'error',
};

const STATUS_IN: Record<string, StoreOrderStatus> = {
  PLACED: 'Processing',
  CONFIRMED: 'Processing',
  DISPATCHED: 'In transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  RETURNED: 'Cancelled',
};

type Filter = 'all' | 'active' | 'delivered' | 'cancelled';

function bucket(s: StoreOrderStatus): Filter {
  if (s === 'Delivered') return 'delivered';
  if (s === 'Cancelled') return 'cancelled';
  return 'active';
}

export function Orders() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const { data, state, error, reload } = useAsync(() => getOrders(), [], (d) => d.length === 0);

  // A single checkout can split into several orders (one per seller); count the
  // siblings so we can flag split orders.
  const groupSize = new Map<string, number>();
  for (const o of data ?? []) {
    if (o.checkoutGroup) groupSize.set(o.checkoutGroup, (groupSize.get(o.checkoutGroup) ?? 0) + 1);
  }

  const rows = (data ?? [])
    .map((o) => ({
      orderNo: o.orderNo,
      status: STATUS_IN[o.status] ?? 'Processing',
      total: o.total,
      date: fmtDate(o.createdAt),
      summary: o.items.map((i) => i.product.name).join(', ') || '—',
      // Reseller name intentionally omitted — employees don't see the vendor.
      vendorNote: ['imcorpcart', o.shipment?.courier?.name].filter(Boolean).join(' · '),
      splitOf: o.checkoutGroup ? groupSize.get(o.checkoutGroup) ?? 1 : 1,
    }))
    .filter((o) => filter === 'all' || bucket(o.status) === filter);

  return (
    <div>
      <div className={styles.title}>Your orders</div>
      <div className={styles.filters}>
        {(['all', 'active', 'delivered', 'cancelled'] as Filter[]).map((f) => (
          <Chip key={f} label={f[0].toUpperCase() + f.slice(1)} active={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} h={90} />
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
        <EmptyState
          icon={<ShoppingBag size={24} />}
          title="No orders yet"
          body="When you place an order it'll show up here."
          action={{ label: 'Go to store', onClick: () => navigate('/shop/home') }}
        />
      )}

      {state === 'live' && (
        <div className={styles.list}>
          {rows.map((o) => (
            <button key={o.orderNo} className={styles.order} onClick={() => navigate(`/shop/orderDetail/${o.orderNo}`)}>
              <div className={styles.orderMain}>
                <div className={styles.orderTop}>
                  <span className={styles.orderId}>{o.orderNo}</span>
                  <span className={styles.orderDate}>{o.date}</span>
                </div>
                <div className={styles.orderSummary}>{o.summary}</div>
                <div className={styles.orderVendor}>
                  {o.vendorNote}
                  {o.splitOf > 1 ? ` · 1 of ${o.splitOf} in this checkout` : ''}
                </div>
              </div>
              <div className={styles.orderRight}>
                <StatusPill label={o.status} tone={tone[o.status]} />
                <span className={styles.orderTotal}>{inr(o.total)}</span>
                <ChevronRight size={18} className={styles.chevron} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
