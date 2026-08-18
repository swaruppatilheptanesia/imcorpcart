import { Inbox, AlertTriangle } from 'lucide-react';
import {
  Card,
  StatCard,
  Donut,
  Skeleton,
  StatusPill,
  ProductThumb,
  EmptyState,
  ProgressBar,
} from '@/components';
import { getDashboard } from '@/data/api';
import type { SemanticTone } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { compactInr, gradientFor } from '@/data/map';
import { inr } from '@/lib/format';
import { useSA } from '../context';
import styles from './Dashboard.module.css';

// Map the API OrderStatus of recent orders → a status pill tone.
const RECENT_TONE: Record<string, SemanticTone> = {
  PLACED: 'warning',
  CONFIRMED: 'warning',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'error',
  RETURNED: 'error',
};

// Delivery-donut colors per shipment status.
const DONUT_COLOR: Record<string, string> = {
  DELIVERED: 'var(--success)',
  IN_TRANSIT: 'var(--accent)',
  OUT_FOR_DELIVERY: 'var(--accent)',
  DISPATCHED: 'var(--info, #3b82f6)',
  PENDING: 'var(--warning)',
  FAILED: 'var(--error)',
  RETURNED: 'var(--error)',
};

export function Dashboard() {
  const { dateRange } = useSA();
  const { data, state, error, reload } = useAsync(
    () => getDashboard(dateRange),
    [dateRange],
    (d) => d.stats.orders === 0,
  );

  return (
    <div>
      {state === 'loading' && (
        <div className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className={styles.skelCard}>
              <Skeleton h={11} w="40%" />
              <Skeleton h={26} w="60%" />
              <Skeleton h={34} w="100%" />
            </Card>
          ))}
        </div>
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<Inbox size={24} />}
          title="No data for this range"
          body="There's nothing to show for the selected period yet. Try a wider date range."
        />
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load dashboard"
          body={error ?? 'Something went wrong fetching your metrics.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'live' && data && (
        <div className={styles.grid}>
          <StatCard label="Gross merchandise value" value={compactInr(data.stats.gmv)} sub="realised in range" />
          <StatCard label="Orders" value={String(data.stats.orders)} sub={`avg ${inr(data.stats.avgOrderValue)}`} />
          <StatCard label="Gross margin" value={compactInr(data.stats.grossMargin)} sub="surcharge + GST proxy" />

          <Card className={styles.listCard}>
            <div className={styles.cardTitle}>Top companies by spend</div>
            <div className={styles.barList}>
              {data.topCompanies.length === 0 && <div className={styles.barVal}>No orders yet</div>}
              {data.topCompanies.map((c) => (
                <div key={c.companyId} className={styles.barRow}>
                  <div className={styles.barLabel}>{c.name}</div>
                  <ProgressBar pct={c.pct} />
                  <div className={styles.barVal}>{compactInr(c.spend)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className={styles.listCard}>
            <div className={styles.cardTitle}>Top products</div>
            <div className={styles.rankList}>
              {data.topProducts.length === 0 && <div className={styles.barVal}>No orders yet</div>}
              {data.topProducts.map((p) => {
                const [g1, g2] = gradientFor(p.productId);
                return (
                  <div key={p.productId} className={styles.rankRow}>
                    <ProductThumb g1={g1} g2={g2} w={26} h={34} />
                    <div className={styles.rankName}>{p.name}</div>
                    <div className={styles.rankMeta}>
                      <span>{p.units} units</span>
                      <span className={styles.rankVal}>{compactInr(p.value)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className={styles.listCard}>
            <div className={styles.cardTitle}>Partner performance</div>
            <div className={styles.partnerList}>
              {data.partners.length === 0 && <div className={styles.barVal}>No shipments yet</div>}
              {data.partners.map((p) => (
                <div key={p.partnerId} className={styles.partnerRow}>
                  <span className={styles.partnerDot} style={{ background: 'var(--accent)' }} />
                  <div className={styles.partnerName}>{p.name}</div>
                  <span className={styles.partnerOt}>{p.shipments} shipments</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className={styles.donutCard}>
            <div className={styles.cardTitle}>Delivery performance</div>
            {data.deliveryDonut.length === 0 ? (
              <div className={styles.barVal}>No shipments yet</div>
            ) : (
              (() => {
                const total = data.deliveryDonut.reduce((n, d) => n + d.count, 0) || 1;
                const segments = data.deliveryDonut.map((d) => ({
                  label: d.status,
                  pct: Math.round((d.count / total) * 100),
                  color: DONUT_COLOR[d.status] ?? 'var(--text3)',
                }));
                return (
                  <div className={styles.donutWrap}>
                    <Donut segments={segments} />
                    <div className={styles.legend}>
                      {segments.map((d) => (
                        <div key={d.label} className={styles.legendRow}>
                          <span className={styles.legendDot} style={{ background: d.color }} />
                          {d.label}
                          <span className={styles.legendPct}>{d.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()
            )}
          </Card>

          <Card className={styles.wideCard}>
            <div className={styles.cardTitle}>Most wishlisted</div>
            <div className={styles.wishGrid}>
              {data.topWishlisted.length === 0 && <div className={styles.barVal}>No wishlist activity yet</div>}
              {data.topWishlisted.map((w) => {
                const [g1, g2] = gradientFor(w.productId);
                return (
                  <div key={w.productId} className={styles.wishItem}>
                    <ProductThumb g1={g1} g2={g2} w={40} h={50} />
                    <div className={styles.wishBody}>
                      <div className={styles.wishName}>{w.name}</div>
                      <div className={styles.wishMeta}>{w.saves} saves</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className={styles.wideCard}>
            <div className={styles.cardTitle}>Recent orders</div>
            <div className={styles.recentList}>
              {data.recentOrders.length === 0 && <div className={styles.barVal}>No orders yet</div>}
              {data.recentOrders.map((o) => (
                <div key={o.id} className={styles.recentRow}>
                  <span className={styles.recentId}>#{o.id}</span>
                  <span className={styles.recentCompany}>{o.company}</span>
                  <span className={styles.recentProduct}>{o.product}</span>
                  <span className={styles.recentValue}>{inr(o.value)}</span>
                  <StatusPill label={o.status} tone={RECENT_TONE[o.status] ?? 'neutral'} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
