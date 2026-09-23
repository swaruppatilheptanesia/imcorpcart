import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Card, StatCard, Skeleton, StatusPill, EmptyState, Button } from '@/components';
import { getProfile, getRequests } from '@/data/leasing-api';
import { SEPP_STATUS_LABEL, SEPP_STATUS_TONE } from '@/data/sepp-types';
import { useAsync } from '@/lib/useAsync';
import { compactInr, fmtDate } from '@/data/map';
import { inr } from '@/lib/format';
import { Kv } from '../QuoteBreakdown';
import styles from '../../super-admin/screens/Dashboard.module.css';

export function Dashboard() {
  const navigate = useNavigate();
  const { data, state, error, reload } = useAsync(
    async () => {
      const [profile, pending] = await Promise.all([getProfile(), getRequests('PENDING')]);
      return { profile, pending };
    },
    [],
  );

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
          <StatCard
            label="Awaiting your approval"
            value={String(data.profile.stats.pendingRequests)}
            sub="HR-approved Smart EPP requests"
          />
          <StatCard
            label="Active leases"
            value={String(data.profile.stats.approvedRequests)}
            sub={`${data.profile.stats.rejectedRequests} declined`}
          />
          <StatCard
            label="Financed"
            value={compactInr(data.profile.stats.financedTotal)}
            sub={`${inr(data.profile.stats.monthlyBook)} / month across the book`}
          />

          <Card className={styles.listCard}>
            <div className={styles.cardTitle}>Lease parameters</div>
            <div style={{ fontSize: 13 }}>
              <Kv k="PTPM (per ₹1,000 / month)" v={data.profile.ptpm.toFixed(2)} />
              <Kv k="Default tenure" v={`${data.profile.defaultTenureMonths} months`} />
              <Kv k="Buy-back" v={`${data.profile.repurchasePct}% of asset`} />
              <Kv k="PV discount (rentals / buy-back)" v={`${data.profile.pvDiscountLeasePct}% / ${data.profile.pvDiscountRepurchasePct}%`} />
              <Kv
                k="Advance at request"
                v={data.profile.advanceFeeType === 'PERCENT' ? `${data.profile.advanceFeeValue}% of asset` : inr(data.profile.advanceFeeValue)}
              />
              <Kv k="Companies attached" v={String(data.profile.stats.companies)} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Button size="sm" variant="secondary" icon={<ArrowRight size={14} />} onClick={() => navigate('/leasing/settings')}>
                Edit parameters
              </Button>
            </div>
          </Card>

          <Card className={styles.wideCard}>
            <div className={styles.cardTitle}>Awaiting your approval</div>
            <div className={styles.recentList}>
              {data.pending.length === 0 && <div className={styles.barVal}>Nothing is waiting for a decision.</div>}
              {data.pending.slice(0, 6).map((r) => (
                <button
                  key={r.id}
                  className={styles.recentRow}
                  style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}
                  onClick={() => navigate(`/leasing/requests?open=${r.id}`)}
                >
                  <span className={styles.recentId}>{r.requestNo}</span>
                  <span className={styles.recentCompany}>{r.employee.name} · {r.company.name}</span>
                  <span className={styles.recentProduct}>
                    {r.items.map((i) => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join(', ')}
                  </span>
                  <span className={styles.recentValue}>{r.quote ? `${inr(r.quote.monthlyRental)}/mo` : inr(r.totalAmount)}</span>
                  <StatusPill label={r.approvals.find((a) => a.stage === 'HR')?.decidedAt ? `HR ok · ${fmtDate(r.approvals.find((a) => a.stage === 'HR')!.decidedAt)}` : SEPP_STATUS_LABEL[r.status]} tone={SEPP_STATUS_TONE[r.status]} />
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
