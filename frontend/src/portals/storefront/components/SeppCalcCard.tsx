import { Landmark } from 'lucide-react';
import { inr } from '@/lib/format';
import type { SeppProductBlock, SeppProfile } from '@/data/sepp-types';
import { cn } from '@/lib/cn';
import styles from './SeppCalcCard.module.css';

/** The Smart-EPP lease illustration for one product (per unit). Mirrors the
 *  client's "Financial Illustration" sheet: monthly salary impact on the left,
 *  what the device effectively costs over the tenure on the right. */
export function SeppCalcCard({ sepp, profile }: { sepp: SeppProductBlock; profile: SeppProfile }) {
  const q = sepp.quote;
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.icon}>
          <Landmark size={16} />
        </span>
        <div>
          <div className={styles.title}>Smart EPP calculation</div>
          <div className={styles.sub}>
            Operating lease via {profile.leasingCompany} · {q.tenureMonths} months · salary deduction
          </div>
        </div>
        <div className={styles.headline}>
          <span className={styles.emi}>{inr(q.monthlyRental)}</span>
          <span className={styles.emiPer}>/month</span>
        </div>
      </div>

      <div className={styles.cols}>
        <div className={styles.col}>
          <div className={styles.colTitle}>Monthly salary impact</div>
          <Row k="Asset cost (incl. GST)" v={inr(q.assetCost)} />
          <Row k="Monthly rental (incl. GST)" v={inr(q.monthlyRental)} />
          <Row k="GST input credit to your company" v={`− ${inr(q.gstInput)}`} muted />
          {q.adldMonthly > 0 && <Row k={`ADLD & theft insurance (${profile.adldPct}% p.a.)`} v={`+ ${inr(q.adldMonthly)}`} muted />}
          <Row k="Pre-tax deduction from salary" v={inr(q.preTaxDeduction)} strong />
          <Row k={`Income-tax saving (${profile.incomeTaxPct}% slab)`} v={`− ${inr(q.itShelter)}`} muted />
          <Row k="Net monthly salary impact" v={inr(q.postTaxDeduction)} strong accent />
        </div>

        <div className={styles.col}>
          <div className={styles.colTitle}>Over {q.tenureMonths} months</div>
          <Row k="Total lease payments" v={inr(q.totalLease)} />
          <Row k="Effective purchase (pre-tax × tenure)" v={inr(q.totalPreTaxDeduction)} strong />
          <Row k="Income-tax shelter" v={`− ${inr(q.totalItShelter)}`} muted />
          <Row k="GST credit on rent" v={`− ${inr(q.totalGstInput)}`} muted />
          {q.pvLease > 0 && <Row k="PV discount (leasing co.)" v={`− ${inr(q.pvLease)}`} muted />}
          <Row k="Buy-back at end of lease" v={`+ ${inr(q.repurchase)}`} muted />
          <Row k="Effective cost to you" v={inr(q.effectivePrice)} strong accent />
          <div className={styles.pct}>{q.effectivePct}% of the asset cost · you own the device at the end</div>
        </div>
      </div>

      <div className={cn(styles.limit, !sepp.withinLimit && styles.limitOver)}>
        {sepp.withinLimit
          ? `Within your Smart EPP limit — uses ${inr(sepp.totalDeduction)} of ${inr(profile.available)} available.`
          : `Exceeds your available Smart EPP limit (${inr(profile.available)}). Ask your HR admin to review your limit.`}
      </div>
      <div className={styles.foot}>
        Illustrative — final terms are confirmed by the leasing company at approval. Figures exclude any
        one-time advance levied by the leasing company.
      </div>
    </section>
  );
}

function Row({ k, v, muted, strong, accent }: { k: string; v: string; muted?: boolean; strong?: boolean; accent?: boolean }) {
  return (
    <div className={cn(styles.row, strong && styles.rowStrong)}>
      <span className={cn(styles.k, muted && styles.muted)}>{k}</span>
      <span className={cn(styles.v, muted && styles.muted, accent && styles.accent)}>{v}</span>
    </div>
  );
}
