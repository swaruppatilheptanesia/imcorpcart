import { useState } from 'react';
import { AlertTriangle, Landmark, Check, X, Eye, MapPin } from 'lucide-react';
import { Chip, DataTable, Row, StatusPill, EmptyState, Skeleton, Button, Modal, Field, Input, Avatar, useToast } from '@/components';
import { getSeppRequests, decideSeppRequest, markInstallmentPaid, type SeppQueueFilter } from '@/data/company-api';
import { SEPP_STATUS_LABEL, SEPP_STATUS_TONE, type SeppRequestView } from '@/data/sepp-types';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { fmtDate } from '@/data/map';
import s from '../../super-admin/screens/screen.module.css';
import styles from '../../super-admin/screens/Reviews.module.css';

const COLS = 'minmax(0, 1.4fr) minmax(0, 1.6fr) 96px 104px minmax(0, 1fr) 150px 190px';

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** HR stage-1 queue for Smart EPP lease requests. Approving hands the request
 *  to the leasing company; rejecting releases the employee's limit and refunds
 *  any advance they paid. */
export function SeppRequests() {
  const { flash } = useToast();
  const [filter, setFilter] = useState<SeppQueueFilter>('PENDING');
  const [selected, setSelected] = useState<SeppRequestView | null>(null);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);

  const { data, state, error, reload } = useAsync(
    () => getSeppRequests(filter),
    [filter],
    (d) => d.length === 0,
  );
  const rows = data ?? [];

  const open = (r: SeppRequestView) => {
    setSelected(r);
    setComments('');
  };

  const decide = async (r: SeppRequestView, decision: 'APPROVED' | 'REJECTED') => {
    if (decision === 'REJECTED' && !comments.trim() && !window.confirm('Reject without a reason?')) return;
    setBusy(true);
    try {
      await decideSeppRequest(r.id, decision, comments.trim() || undefined);
      flash(decision === 'APPROVED' ? `${r.requestNo} approved — sent to the leasing company` : `${r.requestNo} rejected — limit released${r.advanceAmount > 0 ? ', advance refunded' : ''}`);
      setSelected(null);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not record the decision');
    } finally {
      setBusy(false);
    }
  };

  // Payroll deducted this month's EMI → restore that slice of the limit.
  const recordPaid = async (r: SeppRequestView, no: number) => {
    setBusy(true);
    try {
      const updated = await markInstallmentPaid(r.id, no);
      setSelected(updated);
      flash(`EMI #${no} recorded — ${r.quote ? inr(r.quote.preTaxDeduction) : 'that instalment'} of ${r.employee.name.split(' ')[0]}'s limit restored`);
      reload();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  };

  const filters: { value: SeppQueueFilter; label: string }[] = [
    { value: 'PENDING', label: 'Awaiting HR' },
    { value: 'APPROVED', label: 'Approved / financed' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'all', label: 'All' },
  ];

  const pendingHr = (r: SeppRequestView) => r.status === 'SUBMITTED';

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
          title="No Smart EPP requests"
          body={filter === 'PENDING' ? 'Nothing is waiting for your approval right now.' : 'No requests match this filter.'}
        />
      )}

      {state === 'live' && (
        <DataTable cols={COLS} headers={['Request', 'Employee', 'EMI / month', 'Uses limit', 'Deliver to', 'Status', '']}>
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
                  <div className={`${s.cellSub} ${s.truncate}`}>
                    {r.employee.employeeCode}
                    {r.employee.department ? ` · ${r.employee.department}` : ''}
                  </div>
                </div>
              </div>
              <div className={s.price}>{r.quote ? inr(r.quote.monthlyRental) : '—'}</div>
              <div className={s.price}>{r.quote ? inr(r.quote.totalPreTaxDeduction) : inr(r.totalAmount)}</div>
              <div className={`${s.muted} ${s.truncate}`}>{r.address.label || r.address.city}</div>
              <div>
                <StatusPill label={SEPP_STATUS_LABEL[r.status]} tone={SEPP_STATUS_TONE[r.status]} />
              </div>
              <div className={styles.actions}>
                <button className={s.iconBtn} onClick={() => open(r)} aria-label="View request" title="View">
                  <Eye size={16} />
                </button>
                {pendingHr(r) && (
                  <>
                    <Button size="sm" icon={<Check size={14} />} disabled={busy} onClick={() => decide(r, 'APPROVED')}>
                      Approve
                    </Button>
                    <Button size="sm" variant="secondary" icon={<X size={14} />} disabled={busy} onClick={() => open(r)}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </Row>
          ))}
        </DataTable>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={`Smart EPP request — ${selected?.requestNo ?? ''}`}
        width={640}
        footer={
          selected && (
            <div className={styles.modalFooter}>
              <span className={s.muted} style={{ fontSize: 12.5 }}>
                {pendingHr(selected) ? 'Approving sends this to the leasing company.' : SEPP_STATUS_LABEL[selected.status]}
              </span>
              {pendingHr(selected) && (
                <div className={styles.modalActions}>
                  <Button variant="secondary" icon={<X size={15} />} disabled={busy} onClick={() => decide(selected, 'REJECTED')}>
                    Reject
                  </Button>
                  <Button icon={<Check size={15} />} disabled={busy} onClick={() => decide(selected, 'APPROVED')}>
                    Approve
                  </Button>
                </div>
              )}
            </div>
          )
        }
      >
        {selected && (
          <div className={styles.detail}>
            <div className={styles.detailMeta}>
              <StatusPill label={SEPP_STATUS_LABEL[selected.status]} tone={SEPP_STATUS_TONE[selected.status]} />
              <span className={s.muted} style={{ fontSize: 12.5 }}>
                Submitted {fmtDate(selected.submittedAt ?? selected.createdAt)}
              </span>
            </div>

            <div>
              <div className={styles.detailTitle}>{selected.employee.name}</div>
              <div className={s.cellSub}>
                {selected.employee.email} · {selected.employee.employeeCode}
                {selected.employee.department ? ` · ${selected.employee.department}` : ''}
                {selected.employee.monthlySalary > 0 ? ` · salary ${inr(selected.employee.monthlySalary)}/mo` : ''}
              </div>
            </div>

            <div>
              <div className={s.cellSub} style={{ marginBottom: 6 }}>Items</div>
              {selected.items.map((it) => (
                <div key={it.productId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--hair)' }}>
                  <span>
                    {it.name}
                    {it.quantity > 1 ? ` × ${it.quantity}` : ''}
                    <span className={s.cellSub}> {it.brand}</span>
                  </span>
                  <span className={s.price}>{inr(it.lineTotal)}</span>
                </div>
              ))}
            </div>

            {selected.quote && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 13 }}>
                <Kv k="Asset cost (incl. GST)" v={inr(selected.quote.assetCost)} />
                <Kv k="Tenure" v={`${selected.quote.tenureMonths} months`} />
                <Kv k="Monthly rental (incl. GST)" v={inr(selected.quote.monthlyRental)} />
                <Kv k="GST input credit / month" v={inr(selected.quote.gstInput)} />
                <Kv k="Pre-tax salary deduction / month" v={inr(selected.quote.preTaxDeduction)} strong />
                <Kv k="Net after tax saving / month" v={inr(selected.quote.postTaxDeduction)} />
                <Kv k="Uses purchase limit" v={inr(selected.quote.totalPreTaxDeduction)} strong />
                <Kv k="Effective cost to employee" v={inr(selected.quote.effectivePrice)} />
                <Kv
                  k="Advance paid"
                  v={selected.advanceAmount > 0 ? `${inr(selected.advanceAmount)}${selected.advanceRefundedAt ? ' (refunded)' : ''}` : '—'}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
              <MapPin size={15} style={{ marginTop: 2, color: 'var(--text3)' }} />
              <div>
                <strong>{selected.address.label || 'Office'}</strong>
                <div className={s.cellSub}>
                  {[selected.address.line1, selected.address.line2, `${selected.address.city}, ${selected.address.state}`, selected.address.pincode].filter(Boolean).join(', ')}
                </div>
              </div>
            </div>

            {selected.approvals.some((a) => a.comments) && (
              <div className={styles.detailFoot}>
                {selected.approvals
                  .filter((a) => a.comments)
                  .map((a) => (
                    <div key={a.stage}>
                      <strong>{a.stage === 'HR' ? 'HR' : 'Leasing'}:</strong> {a.comments}
                    </div>
                  ))}
              </div>
            )}

            {selected.leaseTerms && (
              <div>
                <div className={s.cellSub} style={{ marginBottom: 6 }}>
                  EMI schedule · {selected.leaseTerms.leasingCompany} · {inr(selected.leaseTerms.emiAmount)} × {selected.leaseTerms.tenureMonths}
                  {selected.orders.length > 0 ? ` · orders ${selected.orders.map((o) => o.orderNo).join(', ')}` : ''}
                </div>
                <div style={{ fontSize: 13 }}>
                  {selected.leaseTerms.installments.map((i) => {
                    const due = new Date(i.dueDate) <= new Date();
                    return (
                      <div
                        key={i.installmentNo}
                        style={{ display: 'grid', gridTemplateColumns: '44px 1fr 110px 130px', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--hair)' }}
                      >
                        <span className={s.mono}>#{i.installmentNo}</span>
                        <span className={s.muted}>{fmtDate(i.dueDate)}</span>
                        <span className={s.price}>{inr(i.amount)}</span>
                        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          {i.paidAt ? (
                            <StatusPill label={`Paid ${fmtDate(i.paidAt)}`} tone="success" />
                          ) : (
                            <Button size="sm" variant={due ? 'primary' : 'secondary'} icon={<Check size={13} />} disabled={busy} onClick={() => recordPaid(selected, i.installmentNo)}>
                              Mark paid
                            </Button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className={s.cellSub} style={{ marginTop: 6 }}>
                  Marking an EMI paid restores {selected.quote ? inr(selected.quote.preTaxDeduction) : 'its pre-tax amount'} of the employee's Smart EPP purchase limit.
                </div>
              </div>
            )}

            {pendingHr(selected) && (
              <Field label="Comments" hint="Optional for approval; recommended when rejecting — shown to the employee">
                <Input value={comments} onChange={(e) => setComments(e.target.value)} placeholder="e.g. Approved within policy / Exceeds grade entitlement" />
              </Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Kv({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', borderBottom: '1px solid var(--hair)', fontWeight: strong ? 700 : 400 }}>
      <span style={{ color: strong ? 'var(--text)' : 'var(--text2)' }}>{k}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</span>
    </div>
  );
}
