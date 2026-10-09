import { useEffect, useState } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import { Card, Field, Input, Button, Skeleton, EmptyState, useToast } from '@/components';
import { getParams, updateParams, previewParams, type LeaseParams, type SampleQuote } from '@/data/leasing-api';
import { useAsync } from '@/lib/useAsync';
import { inr } from '@/lib/format';
import { QuoteBreakdown, Kv } from '../QuoteBreakdown';
import { useLeasing } from '../context';
import s from '../../super-admin/screens/screen.module.css';
import styles from './Settings.module.css';

// Form state is kept as strings so partially-typed numbers don't snap.
interface Form {
  name: string;
  contactPhone: string;
  ptpm: string;
  defaultTenureMonths: string;
  repurchasePct: string;
  pvDiscountLeasePct: string;
  pvDiscountRepurchasePct: string;
}

function toForm(p: LeaseParams): Form {
  return {
    name: p.name,
    contactPhone: p.contactPhone ?? '',
    ptpm: String(p.ptpm),
    defaultTenureMonths: String(p.defaultTenureMonths),
    repurchasePct: String(p.repurchasePct),
    pvDiscountLeasePct: String(p.pvDiscountLeasePct),
    pvDiscountRepurchasePct: String(p.pvDiscountRepurchasePct),
  };
}

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

function toInput(f: Form) {
  return {
    name: f.name.trim() || undefined,
    contactPhone: f.contactPhone.trim() || null,
    ptpm: num(f.ptpm),
    defaultTenureMonths: num(f.defaultTenureMonths),
    repurchasePct: num(f.repurchasePct),
    pvDiscountLeasePct: num(f.pvDiscountLeasePct),
    pvDiscountRepurchasePct: num(f.pvDiscountRepurchasePct),
  };
}

function validate(f: Form): string | null {
  const checks: [string, string, number, number][] = [
    ['PTPM', f.ptpm, 0, 1000],
    ['Tenure', f.defaultTenureMonths, 1, 60],
    ['Buy-back %', f.repurchasePct, 0, 100],
    ['PV discount on rentals', f.pvDiscountLeasePct, 0, 100],
    ['PV discount on buy-back', f.pvDiscountRepurchasePct, 0, 100],
  ];
  for (const [label, v, lo, hi] of checks) {
    const n = Number(v);
    if (v.trim() === '' || Number.isNaN(n)) return `${label} is required`;
    if (n < lo || n > hi) return `${label} must be between ${lo} and ${hi}`;
  }
  if (!Number.isInteger(Number(f.defaultTenureMonths))) return 'Tenure must be whole months';
  return null;
}

/** Lease-parameter editor with a live illustration on the PDF sample device
 *  (₹98,900 phone, 18% GST, 30% slab, no ADLD) so the operator sees the effect
 *  of each change before saving. Saved values apply to every new quote. */
export function Settings() {
  const { flash } = useToast();
  const { refreshProfile } = useLeasing();
  const { data, state, error, reload } = useAsync(() => getParams(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [sample, setSample] = useState<SampleQuote | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !form) {
      setForm(toForm(data));
      setSample(data.sample);
    }
  }, [data, form]);

  // Debounced live preview of the unsaved form.
  useEffect(() => {
    if (!form || !dirty || validate(form)) return;
    const t = window.setTimeout(() => {
      previewParams(toInput(form))
        .then(setSample)
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(t);
  }, [form, dirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
  };

  const save = async () => {
    if (!form) return;
    const err = validate(form);
    if (err) {
      flash(err);
      return;
    }
    setSaving(true);
    try {
      const saved = await updateParams(toInput(form));
      setForm(toForm(saved));
      setSample(saved.sample);
      setDirty(false);
      refreshProfile();
      flash('Lease parameters saved — new quotes use them immediately');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (state === 'loading' || !form || !data) return <Skeleton h={420} />;
  if (state === 'error')
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load parameters"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );

  const problem = validate(form);

  return (
    <div className={s.grid2} style={{ alignItems: 'start' }}>
      <Card style={{ padding: 24 }}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Organisation</h2>
          <div className={s.formRow2}>
            <Field label="Leasing company name">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Contact phone">
              <Input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="Optional" />
            </Field>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Rental</h2>
          <div className={s.formRow2}>
            <Field label="PTPM" hint="Monthly rental per ₹1,000 of asset cost, incl. GST">
              <Input type="number" step="0.01" min={0} value={form.ptpm} onChange={(e) => set('ptpm', e.target.value)} />
            </Field>
            <Field label="Default tenure" hint="Months. Requests are quoted on this tenure">
              <Input type="number" step="1" min={1} max={60} value={form.defaultTenureMonths} onChange={(e) => set('defaultTenureMonths', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>End of lease</h2>
          <div className={s.formRow2}>
            <Field label="Buy-back price" hint="% of asset cost the employee pays to keep the device">
              <Input type="number" step="0.01" min={0} max={100} value={form.repurchasePct} onChange={(e) => set('repurchasePct', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Present-value discounts</h2>
          <div className={s.formRow2}>
            <Field label="On rentals" hint="% PV discount on the monthly streams (illustrative)">
              <Input type="number" step="0.01" min={0} max={100} value={form.pvDiscountLeasePct} onChange={(e) => set('pvDiscountLeasePct', e.target.value)} />
            </Field>
            <Field label="On buy-back" hint="% PV discount on the end-of-term buy-back">
              <Input type="number" step="0.01" min={0} max={100} value={form.pvDiscountRepurchasePct} onChange={(e) => set('pvDiscountRepurchasePct', e.target.value)} />
            </Field>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Advance at request</h2>
          <p className={styles.sectionNote}>
            Collected from the employee via Razorpay when they submit a request, and refunded
            automatically if HR or you reject it. <strong>imcorpcart sets this amount</strong> —
            contact them to change it.
          </p>
          {/* Read-only on purpose: the advance is admin-owned. A Kv row rather than
              a disabled input, because this is a fact about the arrangement, not a
              control that happens to be unavailable. Sourced from `data` (the saved
              params) since this screen can no longer change it. */}
          <div style={{ fontSize: 13 }}>
            <Kv
              k="Advance charged"
              v={
                data.advanceFeeValue <= 0
                  ? 'No advance'
                  : data.advanceFeeType === 'PERCENT'
                    ? `${data.advanceFeeValue}% of asset cost`
                    : inr(data.advanceFeeValue)
              }
              strong
            />
          </div>
        </section>

        <div className={styles.footer}>
          {problem && <span className={styles.problem}>{problem}</span>}
          <Button icon={<Save size={15} />} disabled={saving || !dirty || !!problem} onClick={save}>
            {saving ? 'Saving…' : 'Save parameters'}
          </Button>
        </div>
      </Card>

      <Card style={{ padding: 24, position: 'sticky', top: 0 }}>
        <h2 className={s.sectionTitle} style={{ marginTop: 0 }}>Illustration</h2>
        <p className={s.muted} style={{ fontSize: 13, marginTop: -6 }}>
          A {inr(sample?.assetCost ?? 98_900)} phone at 18% GST for an employee in the 30% slab, no ADLD.
          {dirty ? ' Reflects your unsaved changes.' : ''}
        </p>
        {sample ? (
          <QuoteBreakdown quote={sample.quote} advance={sample.advance} compact />
        ) : (
          <Skeleton h={260} />
        )}
      </Card>
    </div>
  );
}
