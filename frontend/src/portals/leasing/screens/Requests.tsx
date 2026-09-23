import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Landmark, Check, X, Eye, MapPin, Building2 } from 'lucide-react';
import { Chip, DataTable, Row, StatusPill, EmptyState, Skeleton, Button, Drawer, Field, Input, Avatar, useToast } from '@/components';
import { getRequests, getRequest, decideRequest, type LeasingQueueFilter } from '@/data/leasing-api';
import { SEPP_STATUS_LABEL, SEPP_STATUS_TONE, type SeppRequestView } from '@/data/sepp-types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import { QuoteBreakdown, Kv } from '../QuoteBreakdown';
import { useLeasing } from '../context';
import s from '../../super-admin/screens/screen.module.css';
import styles from '../../super-admin/screens/Reviews.module.css';

const COLS = 'minmax(0, 1.5fr) minmax(0, 1.5fr) minmax(0, 1.2fr) 96px 100px 150px 116px';

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// Labels from the leasing desk's point of view.
const LABEL: Record<string, string> = {
  ...SEPP_STATUS_LABEL,
  HR_APPROVED: 'Awaiting decision',
  ORDERED: 'Financed',
};

/** Stage-2 queue. Approving writes the lease terms + schedule and turns the
 *  request into orders; rejecting releases the employee's limit and refunds the
 *  advance they paid. */
export function Requests() {
  const { flash } = useToast();
  const { refreshProfile } = useLeasing();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<LeasingQueueFilter>('PENDING');
  const [selected, setSelected] = useState<SeppRequestView | null>(null);
  const [comments, setComments] = useState('');
  const [tenure, setTenure] = useState('');
  const [emi, setEmi] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, state, error, reload } = useAsync(
    () => getRequests(filter),
    [filter],
    (d) => d.length === 0,
  );
  const rows = data ?? [];

  const open = (r: SeppRequestView) => {
    setSelected(r);
    setComments('');
    setTenure(String(r.quote?.tenureMonths ?? 12));
    setEmi(String(r.quote?.monthlyRental ?? ''));
  };

  // Deep link from the dashboard: /leasing/requests?open=<id>
  const openId = params.get('open');
  useEffect(() => {
    if (!openId) return;
    getRequest(openId)
      .then(open)
      .catch(() => flash('That request is no longer available'))
      .finally(() => {
        params.delete('open');
        setParams(params, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const pending = (r: SeppRequestView) => r.status === 'HR_APPROVED';

  const decide = async (r: SeppRequestView, decision: 'APPROVED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !comments.trim() && !window.confirm('Reject without a reason? The employee sees your comment.')) return;
    const t = Number(tenure);
    const e = Number(emi);
    if (decision === 'APPROVED') {
      if (!Number.isInteger(t) || t < 1 || t > 60) return flash('Tenure must be 1–60 whole months');
      if (!(e > 0)) return flash('Enter the monthly rental');
    }
    setBusy(true);
    try {
      const updated = await decideRequest(r.id, {
        decision,
        comments: comments.trim() || undefined,
        ...(decision === 'APPROVED' ? { tenureMonths: t, emiAmount: e } : {}),
      });
      flash(
        decision === 'APPROVED'
          ? `${r.requestNo} financed — ${updated.orders.length} order${updated.orders.length === 1 ? '' : 's'} placed for delivery`
          : `${r.requestNo} declined — limit released${r.advanceAmount > 0 ? ', advance refunded' : ''}`,
      );
      setSelected(null);
      reload();
      refreshProfile();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Could not record the decision');
    } finally {
      setBusy(false);
    }
  };

  const filters: { value: LeasingQueueFilter; label: string }[] = [
    { value: 'PENDING', label: 'Awaiting decision' },
    { value: 'APPROVED', label: 'Financed' },
    { value: 'REJECTED', label: 'Declined' },
    { value: 'all', label: 'All' },
  ];

  const hrStep = (r: SeppRequestView) => r.approvals.find((a) => a.stage === 'HR');

  return (
    <div>
      <div className={styles.filters}>
        {filters.map((f) => (
          <Chip key={f.value} label={f.label} active={filter === f.value} onClick={() => setFilter(f.value)} />
        ))}
      </div>

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} h={56} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load requests"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<Landmark size={24} />}
          title="No lease requests"
          body={filter === 'PENDING' ? 'Nothing is waiting for your decision. Requests appear here once HR approves them.' : 'No requests match this filter.'}
        />
      )}

      {state === 'live' && (
        <DataTable cols={COLS} headers={['Request', 'Employee', 'Company', 'Rental / mo', 'Asset cost', 'Status', '']}>
          {rows.map((r) => (
            <Row key={r.id} cols={COLS}>
              <button className={styles.productBtn} style={{ display: 'block' }} onClick={() => open(r)} title="View request">
                <div className={s.cellName}>{r.requestNo}</div>
                <div className={`${s.cellSub} ${s.truncate}`}>
                  {r.items.map((i) => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join(', ')}
                </div>
              </button>
              <div className={s.cellMain}>
                <Avatar initials={initialsOf(r.employee.name)} size={30} />
                <div className={s.truncate}>
                  <div className={s.cellName}>{r.employee.name}</div>
                  <div className={`${s.cellSub} ${s.truncate}`}>{r.employee.employeeCode}</div>
                </div>
              </div>
              <div className={s.truncate}>
                <div className={s.cellName}>{r.company.name}</div>
                <div className={`${s.cellSub} ${s.truncate}`}>HR ok {fmtDate(hrStep(r)?.decidedAt)}</div>
              </div>
              <div className={s.price}>{r.quote ? inr(r.quote.monthlyRental) : '—'}</div>
              <div className={s.price}>{inr(r.totalAmount)}</div>
              <div style={{ minWidth: 0 }}>
                <StatusPill label={LABEL[r.status]} tone={SEPP_STATUS_TONE[r.status]} />
              </div>
              <div className={styles.actions}>
                <button className={s.iconBtn} onClick={() => open(r)} aria-label="View request" title="View">
                  <Eye size={16} />
                </button>
                {pending(r) && (
                  <Button size="sm" icon={<Check size={14} />} disabled={busy} onClick={() => open(r)}>
                    Review
                  </Button>
                )}
              </div>
            </Row>
          ))}
        </DataTable>
      )}

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Lease request ${selected.requestNo}` : ''}
        width={600}
        footer={
          selected && pending(selected) ? (
            <div className={styles.modalFooter}>
              <span className={s.muted} style={{ fontSize: 12.5 }}>
                Approving places the order{selected.items.length > 1 ? 's' : ''} for delivery to the office branch.
              </span>
              <div className={styles.modalActions}>
                <Button variant="secondary" icon={<X size={15} />} disabled={busy} onClick={() => decide(selected, 'REJECTED')}>
                  Decline
                </Button>
                <Button icon={<Check size={15} />} disabled={busy} onClick={() => decide(selected, 'APPROVED')}>
                  Approve &amp; finance
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailMeta}>
              <StatusPill label={LABEL[selected.status]} tone={SEPP_STATUS_TONE[selected.status]} />
              <span className={s.muted} style={{ fontSize: 12.5 }}>
                Submitted {fmtDate(selected.submittedAt ?? selected.createdAt)}
                {hrStep(selected)?.decidedAt ? ` · HR approved ${fmtDate(hrStep(selected)!.decidedAt)}` : ''}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div className={styles.detailTitle}>{selected.employee.name}</div>
                <div className={s.cellSub}>
                  {selected.employee.email}
                  <br />
                  {selected.employee.employeeCode}
                  {selected.employee.department ? ` · ${selected.employee.department}` : ''}
                  {selected.employee.monthlySalary > 0 ? ` · ${inr(selected.employee.monthlySalary)}/mo salary` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Building2 size={15} style={{ marginTop: 3, color: 'var(--text3)' }} />
                <div>
                  <div className={styles.detailTitle}>{selected.company.name}</div>
                  <div className={s.cellSub}>Lessee (deducts via payroll)</div>
                </div>
              </div>
            </div>

            <div>
              <div className={s.cellSub} style={{ marginBottom: 6 }}>Assets</div>
              {selected.items.map((it) => (
                <div key={it.productId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--hair)' }}>
                  <span>
                    {it.name}
                    {it.quantity > 1 ? ` × ${it.quantity}` : ''}
                    <span className={s.cellSub}> {it.brand} · {it.sku}</span>
                  </span>
                  <span className={s.price}>{inr(it.lineTotal)}</span>
                </div>
              ))}
            </div>

            {selected.quote && <QuoteBreakdown quote={selected.quote} advance={selected.advanceAmount} />}

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
              <MapPin size={15} style={{ marginTop: 2, color: 'var(--text3)' }} />
              <div>
                <strong>Deliver to {selected.address.label || 'office'}</strong>
                <div className={s.cellSub}>
                  {[selected.address.line1, selected.address.line2, `${selected.address.city}, ${selected.address.state}`, selected.address.pincode].filter(Boolean).join(', ')}
                  {' · '}
                  {selected.address.contactName}, {selected.address.contactPhone}
                </div>
              </div>
            </div>

            {selected.approvals.some((a) => a.comments) && (
              <div className={styles.detailFoot}>
                {selected.approvals
                  .filter((a) => a.comments)
                  .map((a) => (
                    <div key={a.stage}>
                      <strong>{a.stage === 'HR' ? `HR${a.approver ? ` (${a.approver})` : ''}` : 'Leasing'}:</strong> {a.comments}
                    </div>
                  ))}
              </div>
            )}

            {selected.leaseTerms && (
              <div>
                <div className={s.cellSub} style={{ marginBottom: 6 }}>Lease terms</div>
                <div style={{ fontSize: 13 }}>
                  <Kv k="Financed" v={inr(selected.leaseTerms.financedAmount)} strong />
                  <Kv k="Rental" v={`${inr(selected.leaseTerms.emiAmount)} × ${selected.leaseTerms.tenureMonths} months`} />
                  <Kv k="First installment due" v={fmtDate(selected.leaseTerms.installments[0]?.dueDate)} />
                  <Kv
                    k="Installments paid"
                    v={`${selected.leaseTerms.installments.filter((i) => i.paidAt).length} / ${selected.leaseTerms.installments.length}`}
                  />
                </div>
              </div>
            )}

            {selected.orders.length > 0 && (
              <div>
                <div className={s.cellSub} style={{ marginBottom: 6 }}>Orders placed</div>
                {selected.orders.map((o) => (
                  <div key={o.orderNo} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--hair)' }}>
                    <span className={s.mono}>{o.orderNo}</span>
                    <span className={s.muted}>{o.status}</span>
                  </div>
                ))}
              </div>
            )}

            {pending(selected) && (
              <>
                <div className={s.formRow2}>
                  <Field label="Tenure (months)" hint="Prefilled from the quote">
                    <Input type="number" min={1} max={60} step="1" value={tenure} onChange={(e) => setTenure(e.target.value)} />
                  </Field>
                  <Field label="Monthly rental (₹, incl. GST)" hint="Prefilled from the quote">
                    <Input type="number" min={1} step="1" value={emi} onChange={(e) => setEmi(e.target.value)} />
                  </Field>
                </div>
                <Field label="Comments" hint="Optional for approval; recommended when declining — shown to the employee and HR">
                  <Input value={comments} onChange={(e) => setComments(e.target.value)} placeholder="e.g. Approved on standard terms / Exceeds exposure for this corporate" />
                </Field>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
