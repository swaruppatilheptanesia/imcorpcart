import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, MapPin, Landmark, Check, X, Clock } from 'lucide-react';
import { Button, Card, StatusPill, Timeline, EmptyState, Skeleton, useToast } from '@/components';
import { inr } from '@/lib/format';
import { useAsync } from '@/lib/useAsync';
import { fmtDate } from '@/data/map';
import { getSeppRequest, cancelSeppRequest } from '@/data/shop-api';
import { SEPP_STATUS_LABEL, SEPP_STATUS_TONE, SEPP_TIMELINE_STEPS, seppTimelineStep } from '@/data/sepp-types';
import { useStore } from '../store-context';
import styles from './SeppRequestDetail.module.css';

export function SeppRequestDetail() {
  const { no } = useParams<{ no: string }>();
  const navigate = useNavigate();
  const { flash } = useToast();
  const { refreshProfile } = useStore();
  const [busy, setBusy] = useState(false);
  const { data: r, state, error, reload } = useAsync(() => getSeppRequest(no ?? ''), [no]);

  if (state === 'loading') return <Skeleton h={420} />;
  if (state === 'error' || !r) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load this request"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Back to orders', onClick: () => navigate('/shop/orders') }}
      />
    );
  }

  const q = r.quote;
  const tl = seppTimelineStep(r.status);
  const canCancel = r.status === 'SUBMITTED';

  const cancel = async () => {
    if (!window.confirm('Withdraw this Smart EPP request? Any advance paid will be refunded.')) return;
    setBusy(true);
    try {
      await cancelSeppRequest(r.requestNo);
      flash('Request cancelled');
      void refreshProfile();
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not cancel the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <button className={styles.back} onClick={() => navigate('/shop/orders')}>
        <ArrowLeft size={16} /> Orders
      </button>

      <div className={styles.head}>
        <div>
          <div className={styles.overline}>
            <Landmark size={14} /> Smart EPP request
          </div>
          <h1 className={styles.title}>{r.requestNo}</h1>
          <div className={styles.sub}>Submitted {fmtDate(r.submittedAt ?? r.createdAt)}</div>
        </div>
        <StatusPill label={SEPP_STATUS_LABEL[r.status]} tone={SEPP_STATUS_TONE[r.status]} size="md" />
      </div>

      <div className={styles.grid}>
        <div className={styles.main}>
          <Card pad="lg">
            <div className={styles.cardTitle}>Progress</div>
            <Timeline steps={SEPP_TIMELINE_STEPS} current={tl.current} cancelled={tl.cancelled} />
            <div className={styles.approvals}>
              {r.approvals.map((a) => (
                <div key={a.stage} className={styles.approval}>
                  <span className={styles.approvalIcon} data-status={a.status}>
                    {a.status === 'APPROVED' ? <Check size={13} /> : a.status === 'REJECTED' ? <X size={13} /> : <Clock size={13} />}
                  </span>
                  <div>
                    <div className={styles.approvalTitle}>
                      {a.stage === 'HR' ? 'HR approval' : 'Leasing approval'}
                      <span className={styles.approvalState}>
                        {a.status === 'PENDING' ? 'Pending' : `${a.status === 'APPROVED' ? 'Approved' : 'Rejected'}${a.approver ? ` by ${a.approver}` : ''}${a.decidedAt ? ` · ${fmtDate(a.decidedAt)}` : ''}`}
                      </span>
                    </div>
                    {a.comments && <div className={styles.approvalNote}>“{a.comments}”</div>}
                  </div>
                </div>
              ))}
            </div>
            {r.status === 'REJECTED' && (
              <div className={styles.note}>
                {r.advanceAmount > 0
                  ? r.advanceRefundedAt
                    ? `Your advance of ${inr(r.advanceAmount)} has been refunded to the original payment method.`
                    : `Your advance of ${inr(r.advanceAmount)} is being refunded.`
                  : 'No amount was charged for this request.'}
              </div>
            )}
            {r.orders.length > 0 && (
              <div className={styles.note}>
                Order{r.orders.length > 1 ? 's' : ''} placed:{' '}
                {r.orders.map((o, i) => (
                  <span key={o.orderNo}>
                    {i > 0 && ', '}
                    <button className={styles.link} onClick={() => navigate(`/shop/orderDetail/${o.orderNo}`)}>
                      {o.orderNo}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Card>

          <Card pad="lg">
            <div className={styles.cardTitle}>Items</div>
            {r.items.map((it) => (
              <div key={it.productId} className={styles.item}>
                <div className={styles.thumb}>{it.image ? <img src={it.image} alt="" /> : null}</div>
                <div className={styles.itemBody}>
                  <div className={styles.itemName}>{it.name}</div>
                  <div className={styles.itemSub}>
                    {it.brand}
                    {it.quantity > 1 ? ` · × ${it.quantity}` : ''}
                  </div>
                </div>
                <div className={styles.itemPrice}>{inr(it.lineTotal)}</div>
              </div>
            ))}
          </Card>

          {r.leaseTerms && (
            <Card pad="lg">
              <div className={styles.cardTitle}>EMI schedule · {r.leaseTerms.leasingCompany}</div>
              <div className={styles.schedule}>
                {r.leaseTerms.installments.map((i) => (
                  <div key={i.installmentNo} className={styles.installment}>
                    <span className={styles.instNo}>#{i.installmentNo}</span>
                    <span className={styles.instDate}>{fmtDate(i.dueDate)}</span>
                    <span className={styles.instAmt}>{inr(i.amount)}</span>
                    <span className={styles.instPaid}>{i.paidAt ? 'Paid' : 'Due'}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <aside className={styles.rail}>
          {q && (
            <Card pad="lg">
              <div className={styles.cardTitle}>Lease summary</div>
              <Row k="Monthly EMI (incl. GST)" v={inr(q.monthlyRental)} strong />
              <Row k="Pre-tax deduction / month" v={inr(q.preTaxDeduction)} />
              <Row k="Net after tax saving / month" v={inr(q.postTaxDeduction)} />
              <Row k="Tenure" v={`${q.tenureMonths} months`} />
              <Row k="Effective purchase" v={inr(q.totalPreTaxDeduction)} />
              <Row k="Effective cost to you" v={inr(q.effectivePrice)} />
              <Row k="Asset cost (incl. GST)" v={inr(q.assetCost)} />
              <div className={styles.divider} />
              <Row
                k="Advance paid"
                v={r.advanceAmount > 0 ? `${inr(r.advanceAmount)}${r.advanceRefundedAt ? ' · refunded' : ''}` : '—'}
                strong
              />
            </Card>
          )}

          <Card pad="lg">
            <div className={styles.cardTitle}>Deliver to office</div>
            <div className={styles.addr}>
              <MapPin size={16} />
              <div>
                <div className={styles.addrName}>{r.address.label || r.address.contactName}</div>
                <div className={styles.addrLine}>
                  {[r.address.line1, r.address.line2, `${r.address.city}, ${r.address.state}`, r.address.pincode].filter(Boolean).join(', ')}
                </div>
                <div className={styles.addrLine}>
                  {r.address.contactName} · {r.address.contactPhone}
                </div>
              </div>
            </div>
          </Card>

          {canCancel && (
            <Button variant="secondary" block onClick={cancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Withdraw request'}
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={styles.row} data-strong={strong ? '1' : undefined}>
      <span>{k}</span>
      <span className={styles.rowV}>{v}</span>
    </div>
  );
}
