import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Download, AlertTriangle, Truck, Gift, RefreshCw, Mail } from 'lucide-react';
import { Card, StatusPill, Timeline, ProductThumb, Skeleton, EmptyState, Button, Field, Input, useToast } from '@/components';
import { getOrder, orderStatusTone, timelineSteps, statusToStep, updateOrderTransit, retryVoucherFulfilment, resendVoucherEmail } from '@/data/api';
import { ApiError } from '@/data/http';
import type { SemanticTone, Order } from '@/data/types';
import { useAsync } from '@/lib/useAsync';
import { fmtDate } from '@/data/map';
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

  // A pure gift-card (Hubble voucher) order: every line has an issuance status.
  // These are digital — no shipment/courier/transit/timeline — so the page shows
  // issuance + email status instead of the physical-fulfilment chrome.
  const isVoucherOrder = order.items.length > 0 && order.items.every((it) => !!it.fulfilmentStatus);
  const vAgg = order.items.some((it) => it.fulfilmentStatus === 'FAILED')
    ? { label: 'Failed', tone: 'error' as SemanticTone }
    : order.items.every((it) => it.fulfilmentStatus === 'DELIVERED')
      ? { label: 'Delivered', tone: 'success' as SemanticTone }
      : { label: 'Issuing', tone: 'warning' as SemanticTone };

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
        {isVoucherOrder ? (
          <StatusPill label={vAgg.label} tone={vAgg.tone} size="md" />
        ) : (
          <StatusPill label={order.status} tone={orderStatusTone[order.status]} size="md" />
        )}
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
                    <div className={s.cellSub}>
                      Qty {it.qty}
                      {it.denomination ? ` · ${inr(it.denomination)} each` : ''}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, alignItems: 'center' }}>
                      {it.vendorTag && (
                        <span
                          style={{
                            padding: '1px 7px',
                            borderRadius: 6,
                            fontSize: 11,
                            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                            color: 'var(--accent)',
                          }}
                          title="Imported from an external vendor"
                        >
                          {it.vendorTag}
                        </span>
                      )}
                      {/* Status + actions live in the "Gift card fulfilment" card for a
                          pure voucher order; keep the inline chip for mixed orders. */}
                      {!isVoucherOrder && it.fulfilmentStatus && (
                        <VoucherStatusChip
                          status={it.fulfilmentStatus}
                          orderId={id ?? ''}
                          itemId={it.itemId}
                          onDone={reload}
                        />
                      )}
                    </div>
                  </div>
                  <div className={s.price}>{inr(it.price * it.qty)}</div>
                </div>
              ))}
            </div>
          </Card>

          {isVoucherOrder ? (
            <VoucherFulfilmentCard order={order} orderId={id ?? ''} onDone={reload} />
          ) : (
            <>
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
            </>
          )}
        </div>

        <div className={styles.col}>
          {isVoucherOrder ? (
            <Card>
              <div className={s.sectionTitle}>Payment</div>
              <div className={styles.totals}>
                <Line label="Subtotal" value={inr(subtotal)} />
                <div className={styles.divider} />
                <Line label="Total" value={inr(order.total)} strong />
              </div>
              <div className={styles.shipBlock}>
                <div className={styles.shipRow}>
                  <span className={styles.shipLabel}>Type</span>
                  <span className={styles.shipVal}>Digital gift card · no shipping</span>
                </div>
              </div>
            </Card>
          ) : (
            <>
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
            </>
          )}
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

// The voucher-order fulfilment card (replaces the physical delivery-timeline /
// documents cards). One row per gift-card line: the issuance status + email status
// + Resend / Retry. The admin never sees the raw code.
function VoucherFulfilmentCard({ order, orderId, onDone }: { order: Order; orderId: string; onDone: () => void }) {
  const msgFor = (it: Order['items'][number]) => {
    if (it.fulfilmentStatus === 'DELIVERED') {
      const to = order.buyerEmail || 'the buyer';
      return `Voucher code emailed to ${to}${it.deliveredAt ? ` · ${fmtDate(it.deliveredAt)}` : ''}.`;
    }
    if (it.fulfilmentStatus === 'FAILED') {
      return 'Couldn’t be issued — the buyer was refunded.';
    }
    return 'Being issued by Hubble — the code is emailed to the buyer automatically when ready.';
  };
  return (
    <Card>
      <div className={s.sectionTitle}>Gift card fulfilment</div>
      <div className={styles.items}>
        {order.items.map((it, i) => (
          <div key={i} className={styles.vfRow}>
            <div className={styles.vfMain}>
              <div className={s.cellName}>{it.name}</div>
              <div className={s.cellSub}>{inr(it.denomination ?? it.price)} gift card</div>
              <div className={styles.vfMsg}>{msgFor(it)}</div>
            </div>
            <VoucherStatusChip status={it.fulfilmentStatus ?? ''} orderId={orderId} itemId={it.itemId} onDone={onDone} />
          </div>
        ))}
      </div>
    </Card>
  );
}

// Gift-card (Hubble voucher) fulfilment status + a retry control for stuck/failed
// lines. The admin never sees the raw code (privacy) — status only.
const VOUCHER_LABEL: Record<string, string> = {
  PENDING: 'Voucher: queued',
  PROCESSING: 'Voucher: issuing…',
  DELIVERED: 'Voucher: delivered',
  FAILED: 'Voucher: failed',
};
const VOUCHER_TONE: Record<string, string> = {
  PENDING: 'var(--text2)',
  PROCESSING: '#b26a00',
  DELIVERED: 'var(--success, #1a7f37)',
  FAILED: 'var(--danger, #d1242f)',
};
function VoucherStatusChip({
  status,
  orderId,
  itemId,
  onDone,
}: {
  status: string;
  orderId: string;
  itemId?: string;
  onDone: () => void;
}) {
  const { flash } = useToast();
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const color = VOUCHER_TONE[status] ?? 'var(--text2)';
  const canRetry = (status === 'FAILED' || status === 'PROCESSING' || status === 'PENDING') && !!itemId;
  const canResend = status === 'DELIVERED' && !!itemId;

  const retry = async () => {
    if (!itemId) return;
    setBusy(true);
    try {
      await retryVoucherFulfilment(orderId, itemId);
      flash('Retrying voucher issuance');
      onDone();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not retry');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!itemId) return;
    setResending(true);
    try {
      await resendVoucherEmail(orderId, itemId);
      flash('Voucher email resent to the buyer');
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not resend');
    } finally {
      setResending(false);
    }
  };

  const chipBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '1px 6px',
    borderRadius: 6,
    fontSize: 11,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
  } as const;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '1px 7px',
          borderRadius: 6,
          fontSize: 11,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
        }}
      >
        <Gift size={11} /> {VOUCHER_LABEL[status] ?? status}
      </span>
      {canRetry && (
        <button onClick={retry} disabled={busy} title="Retry issuance" style={{ ...chipBtn, cursor: busy ? 'default' : 'pointer' }}>
          <RefreshCw size={11} /> {busy ? '…' : 'Retry'}
        </button>
      )}
      {canResend && (
        <button
          onClick={resend}
          disabled={resending}
          title="Resend the voucher email to the buyer"
          style={{ ...chipBtn, cursor: resending ? 'default' : 'pointer' }}
        >
          <Mail size={11} /> {resending ? '…' : 'Resend email'}
        </button>
      )}
    </span>
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
