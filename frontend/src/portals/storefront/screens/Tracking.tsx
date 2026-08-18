import { useParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Card, Timeline, Skeleton, EmptyState } from '@/components';
import { trackingSteps } from '@/data/fixtures/storefront';
import { fmtDate } from '@/data/map';
import { useAsync } from '@/lib/useAsync';
import { getTracking } from '@/data/shop-api';
import styles from './Tracking.module.css';

// Shipment status → number of completed timeline steps (of 5).
const STEP_FOR: Record<string, number> = {
  PENDING: 2,
  DISPATCHED: 3,
  IN_TRANSIT: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  FAILED: 3,
  RETURNED: 2,
};

export function Tracking() {
  const { id } = useParams();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, state, error, reload } = useAsync<any>(() => getTracking(id ?? ''), [id]);

  if (state === 'loading') return <Skeleton h={280} />;
  if (state === 'error' || !data)
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load tracking"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );

  const shipStatus: string | undefined = data.shipment?.status;
  const step = data.status === 'DELIVERED' ? 5 : shipStatus ? STEP_FOR[shipStatus] ?? 1 : 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = data.shipment?.trackingEvents ?? [];

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.orderId}>{data.orderNo}</div>
        <div className={styles.sub}>{data.shipment?.courier?.name ?? 'Awaiting dispatch'}</div>
      </div>

      <Card pad="lg">
        <div className={styles.cardTitle}>Delivery timeline</div>
        <div className={styles.timelineRows}>
          <Timeline steps={trackingSteps} current={step} />
          <div className={styles.times}>
            {trackingSteps.map((_, i) => {
              const ev = events[i];
              return (
                <div key={i} className={styles.time}>
                  {i < step ? (ev ? fmtDate(ev.occurredAt) : '✓') : ''}
                </div>
              );
            })}
          </div>
        </div>

        {events.length > 0 && (
          <div style={{ marginTop: 18, display: 'grid', gap: 8 }}>
            {events.map((e, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--text2)' }}>
                <strong style={{ color: 'var(--text)' }}>{e.status.replace(/_/g, ' ')}</strong>
                {e.description ? ` — ${e.description}` : ''} · {fmtDate(e.occurredAt)}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
