import { AlertTriangle, TrendingUp, TrendingDown, Download } from 'lucide-react';
import { Card, StatCard, ProductThumb, Skeleton, EmptyState, Button, useToast } from '@/components';
import { useAsync } from '@/lib/useAsync';
import { useRS } from '../context';
import { getResellerDashboard } from '../data';
import s from './screen.module.css';
import styles from './Performance.module.css';

export function Performance() {
  const { flash } = useToast();
  const { dateRange } = useRS();
  const { data, state, error, reload } = useAsync(() => getResellerDashboard(), [dateRange]);

  if (state === 'loading') {
    return (
      <div className={styles.grid}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className={styles.skelCard}>
            <Skeleton h={11} w="40%" />
            <Skeleton h={26} w="60%" />
            <Skeleton h={34} w="100%" />
          </Card>
        ))}
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load performance"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );
  }

  return (
    <div>
      <div className={styles.exportRow}>
        <span className={styles.rangeNote}>· Last {dateRange === '7D' ? '7 days' : dateRange === '30D' ? '30 days' : dateRange}</span>
        <div className={s.spacer} />
        <Button variant="secondary" size="sm" icon={<Download size={15} />} onClick={() => flash('Exporting CSV…')}>
          Export CSV
        </Button>
        <Button variant="secondary" size="sm" icon={<Download size={15} />} onClick={() => flash('Exporting PDF…')}>
          Export PDF
        </Button>
      </div>

      <div className={styles.grid}>
        <StatCard label="Sales value · your catalog" value={data.salesValue} delta={data.salesDelta.replace('▲ ', '')} sub="vs previous period" />
        <Card className={styles.volCard}>
          <div className={styles.statLabel}>Order volume · your catalog</div>
          <div className={styles.volVal}>{data.orderVolume}</div>
          <div className={styles.volDelta}>{data.orderDelta}</div>
        </Card>
        <Card className={styles.deliveryCard}>
          <div className={styles.statLabel}>Delivery performance</div>
          <div className={styles.deliveryVal}>{data.deliveryPct}<span className={styles.deliverySuffix}> on-time</span></div>
          <div className={styles.deliveryNote}>{data.deliveryNote}</div>
        </Card>
        <Card className={styles.rankCard}>
          <div className={styles.cardTitle}>Best sellers</div>
          <div className={styles.rankList}>
            {data.bestSellers.map((p) => (
              <div key={p.name} className={styles.rankRow}>
                <ProductThumb g1={p.g1} g2={p.g2} w={30} h={38} />
                <div className={styles.rankName}>{p.name}</div>
                <span className={styles.rankUp}><TrendingUp size={13} /> {p.metric}</span>
              </div>
            ))}
            {data.worstSellers.map((p) => (
              <div key={p.name} className={styles.rankRow}>
                <ProductThumb g1={p.g1} g2={p.g2} w={30} h={38} />
                <div className={styles.rankName}>{p.name}</div>
                <span className={styles.rankDown}><TrendingDown size={13} /> {p.metric}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className={styles.wideCard}>
          <div className={styles.cardTitle}>Most wishlisted · your products</div>
          <div className={styles.wishGrid}>
            {data.mostWishlisted.map((p) => (
              <div key={p.name} className={styles.wishItem}>
                <ProductThumb g1={p.g1} g2={p.g2} w={40} h={50} />
                <div className={styles.wishBody}>
                  <div className={styles.wishName}>{p.name}</div>
                  <div className={styles.wishTrend}>{p.metric}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className={styles.wideCard}>
          <div className={styles.cardTitle}>Top customers</div>
          <div className={styles.custList}>
            {data.topCustomers.map((c, i) => (
              <div key={c.name} className={styles.custRow}>
                <span className={styles.custRank}>{i + 1}</span>
                <span className={styles.custName}>{c.name}</span>
                <span className={styles.custSpend}>{c.spend}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
