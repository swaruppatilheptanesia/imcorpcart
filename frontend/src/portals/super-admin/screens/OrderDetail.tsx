import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Download, AlertTriangle } from 'lucide-react';
import { Card, StatusPill, Timeline, ProductThumb, Skeleton, EmptyState } from '@/components';
import { getOrder, orderStatusTone, timelineSteps, statusToStep } from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import s from './screen.module.css';
import styles from './OrderDetail.module.css';

export function OrderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const { data: order, state, error } = useAsync(() => getOrder(id ?? ''), [id]);

  if (state === 'loading') {
    return (
      <div className={s.wide} style={{ display: 'grid', gap: 12 }}>
        <Skeleton h={60} />
        <Skeleton h={240} />
      </div>
    );
  }
  if (state === 'error' || !order) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load order"
        body={error ?? 'Order not found.'}
        action={{ label: 'Back to orders', onClick: () => navigate('/super-admin/orders') }}
      />
    );
  }

  const cancelled = order.status === 'Cancelled';
  const subtotal = order.items.reduce((n, it) => n + it.price * it.qty, 0);
  const gst = Math.round(subtotal * 0.18);

  return (
    <div className={s.wide}>
      <button className={styles.back} onClick={() => navigate('/super-admin/orders')}>
        <ArrowLeft size={16} /> Back to orders
      </button>

      <div className={styles.head}>
        <div>
          <div className={styles.orderId}>{order.id}</div>
          <div className={styles.company}>
            {order.company} · {order.buyer} · {order.date}
          </div>
        </div>
        <StatusPill label={order.status} tone={orderStatusTone[order.status]} size="md" />
      </div>

      <div className={styles.grid}>
        <div className={styles.col}>
          <Card>
            <div className={s.sectionTitle}>Items</div>
            <div className={styles.items}>
              {order.items.map((it, i) => (
                <div key={i} className={styles.item}>
                  <ProductThumb g1={it.g1} g2={it.g2} w={44} h={56} />
                  <div className={styles.itemBody}>
                    <div className={s.cellName}>{it.name}</div>
                    <div className={s.cellSub}>Qty {it.qty}</div>
                  </div>
                  <div className={s.price}>{inr(it.price * it.qty)}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className={s.sectionTitle}>Delivery timeline</div>
            <Timeline steps={timelineSteps} current={statusToStep[order.status]} cancelled={cancelled} />
          </Card>

          <Card>
            <div className={s.sectionTitle}>Documents</div>
            <div className={styles.docs}>
              {['Tax invoice', 'Proof of delivery'].map((d) => (
                <button key={d} className={styles.doc}>
                  <span className={styles.docLeft}>
                    <FileText size={17} />
                    {d}
                  </span>
                  <Download size={16} />
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className={styles.col}>
          <Card>
            <div className={s.sectionTitle}>Payment &amp; shipping</div>
            <div className={styles.totals}>
              <Line label="Subtotal" value={inr(subtotal)} />
              <Line label="GST (18%)" value={inr(gst)} />
              <div className={styles.divider} />
              <Line label="Total" value={inr(order.total)} strong />
            </div>
            <div className={styles.shipBlock}>
              <div className={styles.shipRow}>
                <span className={styles.shipLabel}>Courier</span>
                <span className={styles.shipVal}>{order.courier}</span>
              </div>
              <div className={styles.shipRow}>
                <span className={styles.shipLabel}>AWB</span>
                <span className={s.mono}>{order.awb}</span>
              </div>
              <div className={styles.shipRow}>
                <span className={styles.shipLabel}>Dispatched</span>
                <span className={styles.shipVal}>{order.dispatchDate}</span>
              </div>
            </div>
            <p className={styles.readonlyNote}>
              Fulfillment status is updated by the vendor from the reseller portal.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={styles.line}>
      <span className={strong ? styles.lineStrong : styles.lineLabel}>{label}</span>
      <span className={strong ? styles.lineStrong : styles.lineVal}>{value}</span>
    </div>
  );
}
