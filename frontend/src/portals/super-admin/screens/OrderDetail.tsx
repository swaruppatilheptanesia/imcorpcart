import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Download, AlertTriangle, Truck } from 'lucide-react';
import { Card, StatusPill, Timeline, ProductThumb, Skeleton, EmptyState, Button, Field, Input, useToast } from '@/components';
import { getOrder, orderStatusTone, timelineSteps, statusToStep, updateOrderTransit } from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import s from './screen.module.css';
import styles from './OrderDetail.module.css';

export function OrderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();

  const { data: order, state, error, reload } = useAsync(() => getOrder(id ?? ''), [id]);

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
          </Card>

          <Card>
            <div className={s.sectionTitle}>Update fulfilment</div>
            <TransitControl orderId={id ?? ''} cancelled={cancelled} onDone={reload} />
          </Card>
        </div>
      </div>
    </div>
  );
}

const SHIPMENT_STATUSES = [
  { value: 'DISPATCHED', label: 'Dispatched' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'RETURNED', label: 'Returned' },
];
const COURIERS = ['BLUEDART', 'DELHIVERY', 'DTDC', 'EKART', 'INDIA_POST'];

function TransitControl({ orderId, cancelled, onDone }: { orderId: string; cancelled: boolean; onDone: () => void }) {
  const { flash } = useToast();
  const [status, setStatus] = useState('DISPATCHED');
  const [awb, setAwb] = useState('');
  const [courier, setCourier] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (cancelled) {
    return <p className={s.muted} style={{ fontSize: 12.5 }}>This order is cancelled — fulfilment is closed.</p>;
  }

  const submit = async () => {
    setBusy(true);
    try {
      await updateOrderTransit(orderId, {
        status,
        awbNumber: awb.trim() || undefined,
        courierCode: courier || undefined,
        description: note.trim() || undefined,
      });
      flash('Fulfilment status updated');
      onDone();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className={s.muted} style={{ fontSize: 12.5, margin: 0 }}>
        You handle fulfilment for this order — set the shipment status (drives the customer's tracking timeline).
      </p>
      <Field label="Status">
        <select style={{ width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          {SHIPMENT_STATUSES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Courier">
          <select style={{ width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', font: 'inherit' }} value={courier} onChange={(e) => setCourier(e.target.value)}>
            <option value="">—</option>
            {COURIERS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label="AWB / tracking no.">
          <Input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Note (optional)">
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shown on the tracking event" />
      </Field>
      <Button onClick={submit} disabled={busy}>
        <Truck size={15} /> {busy ? 'Updating…' : 'Update fulfilment'}
      </Button>
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
