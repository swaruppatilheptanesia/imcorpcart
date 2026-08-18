import { useState } from 'react';
import { AlertTriangle, ShoppingBag } from 'lucide-react';
import { Chip, DataTable, Row, StatusPill, Skeleton, EmptyState } from '@/components';
import { getOrders } from '@/data/company-api';
import type { SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import s from '../../super-admin/screens/screen.module.css';

const COLS = '1.2fr 1.6fr 1fr 1fr 1fr';

const tone: Record<string, SemanticTone> = {
  PLACED: 'warning',
  CONFIRMED: 'warning',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'error',
  RETURNED: 'error',
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function Orders() {
  const [bucket, setBucket] = useState('all');
  const { data, state, error, reload } = useAsync(() => getOrders(bucket), [bucket], (d) => d.length === 0);

  return (
    <div>
      <div className={s.toolbar}>
        {FILTERS.map((f) => (
          <Chip key={f.key} label={f.label} active={bucket === f.key} onClick={() => setBucket(f.key)} />
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
        <EmptyState icon={<ShoppingBag size={24} />} title="No orders here" body="No orders match this filter yet." />
      )}

      {state === 'live' && data && (
        <DataTable cols={COLS} headers={['Order', 'Employee', 'Date', 'Status', 'Total']}>
          {data.map((o) => (
            <Row key={o.id} cols={COLS}>
              <div className={s.mono}>{o.orderNo}</div>
              <div className={s.muted}>{o.employee.user.fullName}</div>
              <div className={s.muted}>{fmtDate(o.createdAt)}</div>
              <div>
                <StatusPill label={o.status} tone={tone[o.status] ?? 'neutral'} />
              </div>
              <div className={s.price}>{inr(o.total)}</div>
            </Row>
          ))}
        </DataTable>
      )}
    </div>
  );
}
