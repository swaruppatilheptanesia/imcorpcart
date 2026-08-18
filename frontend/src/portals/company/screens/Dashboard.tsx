import { AlertTriangle } from 'lucide-react';
import { Card, StatCard, Skeleton, StatusPill, EmptyState, ProgressBar } from '@/components';
import { getDashboard } from '@/data/company-api';
import type { SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { compactInr } from '@/data/map';
import { inr } from '@/lib/format';
import styles from '../../super-admin/screens/Dashboard.module.css';

const TONE: Record<string, SemanticTone> = {
  PLACED: 'warning',
  CONFIRMED: 'warning',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'error',
  RETURNED: 'error',
};

export function Dashboard() {
  const { data, state, error, reload } = useAsync(() => getDashboard(), []);

  return (
    <div>
      {state === 'loading' && (
        <div className={styles.grid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className={styles.skelCard}>
              <Skeleton h={11} w="40%" />
              <Skeleton h={26} w="60%" />
              <Skeleton h={34} w="100%" />
            </Card>
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load dashboard"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {(state === 'live' || state === 'empty') && data && (
        <div className={styles.grid}>
          <StatCard label="Employees" value={String(data.stats.employees)} sub={`${data.stats.activeEmployees} active`} />
          <StatCard label="EPP orders" value={String(data.stats.orders)} sub="realised" />
          <StatCard label="Order value" value={compactInr(data.stats.orderValue)} sub={`avg ${inr(data.stats.avgOrderValue)}`} />

          <Card className={styles.listCard}>
            <div className={styles.cardTitle}>Top employees by spend</div>
            <div className={styles.barList}>
              {data.topEmployees.length === 0 && <div className={styles.barVal}>No orders yet</div>}
              {data.topEmployees.map((e) => (
                <div key={e.employeeId} className={styles.barRow}>
                  <div className={styles.barLabel}>{e.name}</div>
                  <ProgressBar pct={Math.min(100, Math.round((e.spend / (data.stats.orderValue || 1)) * 100))} />
                  <div className={styles.barVal}>{compactInr(e.spend)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className={styles.wideCard}>
            <div className={styles.cardTitle}>Recent orders</div>
            <div className={styles.recentList}>
              {data.recentOrders.length === 0 && <div className={styles.barVal}>No orders yet</div>}
              {data.recentOrders.map((o) => (
                <div key={o.id} className={styles.recentRow}>
                  <span className={styles.recentId}>#{o.id}</span>
                  <span className={styles.recentCompany}>{o.buyer}</span>
                  <span className={styles.recentProduct}>{o.product}</span>
                  <span className={styles.recentValue}>{inr(o.value)}</span>
                  <StatusPill label={o.status} tone={TONE[o.status] ?? 'neutral'} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
