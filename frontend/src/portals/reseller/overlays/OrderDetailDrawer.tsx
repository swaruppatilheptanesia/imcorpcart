import { Drawer, StatusPill, Skeleton, EmptyState } from '@/components';
import { AlertTriangle } from 'lucide-react';
import type { SemanticTone } from '@/data/types';
import type { StoreOrderStatus } from '@/data/store-types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { getResellerOrderDetail } from '../data';
import styles from './OrderDetailDrawer.module.css';

const tone: Record<StoreOrderStatus, SemanticTone> = {
  Processing: 'warning',
  'In transit': 'info',
  Delivered: 'success',
  Cancelled: 'error',
};

export function OrderDetailDrawer({
  open,
  orderId,
  onClose,
}: {
  open: boolean;
  orderId: string | null;
  onClose: () => void;
}) {
  const { data, state, error } = useAsync(
    () => (orderId ? getResellerOrderDetail(orderId) : Promise.resolve(null)),
    [orderId],
  );

  return (
    <Drawer open={open} onClose={onClose} title={orderId ?? 'Order'} width={480}>
      {state === 'loading' && (
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton h={40} />
          <Skeleton h={120} />
        </div>
      )}
      {state === 'error' && (
        <EmptyState tone="error" icon={<AlertTriangle size={22} />} title="Couldn't load order" body={error ?? ''} />
      )}
      {data && (
        <div className={styles.wrap}>
          <div className={styles.topRow}>
            <div>
              <div className={styles.customer}>{data.customer}</div>
              <div className={styles.sub}>{data.company}</div>
            </div>
            <StatusPill label={data.status} tone={tone[data.status]} size="md" />
          </div>

          <div className={styles.section}>
            <div className={styles.label}>Items</div>
            {data.items.map((it, i) => (
              <div key={i} className={styles.item}>
                <div className={styles.itemName}>{it.name}</div>
                <div className={styles.itemMeta}>
                  <span className={styles.qty}>×{it.qty}</span>
                  <span className={styles.itemPrice}>{inr(it.price * it.qty)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={styles.section}>
            <div className={styles.label}>Timeline &amp; shipping</div>
            <Line k="Ordered" v={data.date} />
            <Line k="Dispatched" v={data.dispatchDate} />
            <Line k="Delivered" v={data.deliveredDate} />
            <Line k="Courier" v={data.courier} />
            <Line k="AWB" v={data.awb} mono />
            <Line k="Ship to" v={data.address} />
          </div>

          <div className={styles.section}>
            <div className={styles.label}>Totals</div>
            <Line k="Subtotal" v={inr(data.subtotal)} />
            <Line k="Total" v={inr(data.total)} strong />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Line({ k, v, strong, mono }: { k: string; v: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className={styles.line}>
      <span className={styles.lineKey}>{k}</span>
      <span className={strong ? styles.lineStrong : mono ? styles.lineMono : styles.lineVal}>{v}</span>
    </div>
  );
}
