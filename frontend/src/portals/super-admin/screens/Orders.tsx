import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, AlertTriangle, Search, Eye } from 'lucide-react';
import { Chip, DataTable, EmptyState, Input, Row, Select, Skeleton, StatusPill } from '@/components';
import { getOrders, orderStatusTone } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { EpodCell } from './OrderFulfilment';
import s from './screen.module.css';
import styles from './Orders.module.css';

const COLS = '1fr 0.9fr 0.9fr 1.4fr 1fr 1.1fr 0.9fr 0.9fr 84px 44px';

type Filter = 'all' | 'active' | 'delivered' | 'cancelled';

export function Orders() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [vendor, setVendor] = useState('all');

  const { data, state, error, reload } = useAsync(
    () => getOrders({ bucket: filter, pageSize: 100 }),
    [filter],
    (d) => d.items.length === 0,
  );
  const rows = data?.items ?? [];

  // Distinct vendors present in the loaded rows drive the vendor filter.
  const vendors = useMemo(
    () => Array.from(new Set(rows.map((o) => o.vendor))).sort(),
    [rows],
  );

  // Search (order no / product / company) + vendor are refined client-side.
  const query = q.trim().toLowerCase();
  const shown = rows.filter((o) => {
    if (vendor !== 'all' && o.vendor !== vendor) return false;
    if (query) {
      const hay = `${o.id} ${o.productName} ${o.company}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const filters: { value: Filter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div>
      <div className={s.toolbar}>
        <div className={s.search}>
          <Input icon={<Search size={16} />}
            placeholder="Search order no, product, or company"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          aria-label="Filter by vendor"
        >
          <option value="all">All vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </div>

      <div className={styles.filters}>
        {filters.map((f) => (
          <Chip
            key={f.value}
            label={f.label}
            active={filter === f.value}
            onClick={() => setFilter(f.value)}
          />
        ))}
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        <EmptyState icon={<ShoppingBag size={24} />} title="No orders" body="No orders match this filter." />
      )}

      {state === 'live' && shown.length === 0 && (
        <EmptyState
          icon={<ShoppingBag size={24} />}
          title="No matching orders"
          body="No orders match the search or vendor filter."
          action={{ label: 'Clear', onClick: () => { setQ(''); setVendor('all'); } }}
        />
      )}

      {state === 'live' && shown.length > 0 && (
        <DataTable
          cols={COLS}
          headers={['Order', 'Order date', 'Dispatch', 'Product', 'Vendor', 'Company', 'Status', 'Total', 'POD', '']}
        >
          {shown.map((o) => (
            <Row
              key={o.id}
              cols={COLS}
              onClick={() => navigate(`/super-admin/orderDetail/${o.id.replace('#', '')}`)}
            >
              <div>
                <div className={styles.orderId}>{o.id}</div>
                {o.type === 'SMART_EPP' && <StatusPill label="Smart EPP" tone="info" />}
              </div>
              <div className={styles.date}>{o.date}</div>
              <div className={styles.date}>{o.dispatchDate}</div>
              <div className={s.cellName}>
                {o.productName}
                {o.itemCount > 1 && <span className={s.cellSub}> +{o.itemCount - 1} more</span>}
              </div>
              <div className={s.muted}>{o.vendor}</div>
              <div className={s.muted}>{o.company}</div>
              <div>
                <StatusPill label={o.status} tone={orderStatusTone[o.status]} />
              </div>
              <div className={s.price}>{inr(o.total)}</div>
              {/* One-click proof of delivery, as the partner Orders tab has.
                  `o.id` is display-formatted (#IMC-…) and the API does not match
                  that, so the cell acts on the row's real cuid. */}
              <div onClick={(e) => e.stopPropagation()}>
                <EpodCell
                  orderId={o.cuid ?? o.id.replace(/^#/, '')}
                  delivered={o.status === 'Delivered'}
                  epod={o.epod ?? null}
                  onDone={reload}
                />
              </div>
              <button
                className={s.iconBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/super-admin/orderDetail/${o.id.replace('#', '')}`);
                }}
                aria-label="View details"
              >
                <Eye size={16} />
              </button>
            </Row>
          ))}
        </DataTable>
      )}
    </div>
  );
}
