import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, RefreshCw, Download, Eye, EyeOff, Pencil } from 'lucide-react';
import { Card, Button, Field, Input, Toggle, StatusPill, DataTable, Row, EmptyState, Skeleton, useToast } from '@/components';
import {
  getVendorSource,
  getVendorSourceRuns,
  getVendorSourceProducts,
  updateVendorSource,
  syncVendorSource,
  setProductHidden,
  type VendorImportRun,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { fmtDate } from '@/data/map';
import { inr } from '@/lib/format';
import type { SemanticTone } from '@/data/types';
import { statusTone } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

const RUN_COLS = '1.1fr 0.7fr 0.7fr 0.7fr 0.7fr 1.1fr';
const PROD_COLS = '1.6fr 0.9fr 0.7fr 0.8fr 150px';
const runTone: Record<string, SemanticTone> = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'error',
  RUNNING: 'neutral',
};

export function VendorSourceDetail() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { flash } = useToast();
  const { data, state, error, reload } = useAsync(
    () => Promise.all([getVendorSource(id), getVendorSourceRuns(id, { pageSize: 20 }), getVendorSourceProducts(id, { pageSize: 100 })]),
    [id],
  );
  const [busy, setBusy] = useState(false);

  if (state === 'loading') {
    return (
      <div className={s.wide} style={{ display: 'grid', gap: 12 }}>
        <Skeleton h={60} />
        <Skeleton h={200} />
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load vendor source"
        body={error ?? 'Source not found.'}
        action={{ label: 'Back to sources', onClick: () => navigate('/super-admin/vendor-sources') }}
      />
    );
  }

  const [source, runs, products] = data;

  const toggleActive = async () => {
    try {
      await updateVendorSource(id, { active: !source.active });
      flash(source.active ? 'Vendor suspended — its products are hidden' : 'Vendor resumed');
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update');
    }
  };

  const runSync = async () => {
    setBusy(true);
    try {
      const run = await syncVendorSource(id);
      flash(`Sync ${run.status.toLowerCase()} — ${run.created} created · ${run.updated} updated · ${run.failed} failed`);
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (productId: string, hidden: boolean) => {
    try {
      await setProductHidden(productId, hidden);
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update');
    }
  };

  return (
    <div className={s.wide}>
      <button className={styles.back} onClick={() => navigate('/super-admin/vendor-sources')}>
        <ArrowLeft size={16} /> Back to sources
      </button>

      <div className={styles.detailHead}>
        <div>
          <div className={styles.detailName}>{source.name}</div>
          <div className={s.muted}>
            {source.adapter} · first-party · {source._count?.products ?? 0} products · EPP = MRP − {source.discountPct}%
          </div>
        </div>
        <div className={styles.detailHeadActions}>
          <StatusPill label={source.active ? source.status : 'Suspended'} tone={source.active ? statusTone[source.status] : 'neutral'} />
          <div className={styles.activeToggle}>
            <span className={s.muted}>Active</span>
            <Toggle on={source.active} onClick={toggleActive} />
          </div>
        </div>
      </div>

      <div className={styles.detailGrid}>
        <Card pad="lg">
          <div className={styles.cardTitle}>Sync</div>
          <p className={styles.cardHint}>
            Pull the vendor's catalog. Products go <strong>live immediately</strong> as first-party at EPP = MRP −{' '}
            {source.discountPct}%. Suspending the vendor (toggle above) hides all its products from the storefront.
          </p>
          <Button onClick={runSync} disabled={busy || !source.active}>
            <RefreshCw size={15} /> {busy ? 'Syncing…' : 'Run sync'}
          </Button>
          {source.lastSyncedAt && (
            <div className={s.muted} style={{ fontSize: 12.5, marginTop: 10 }}>Last synced {fmtDate(source.lastSyncedAt)}</div>
          )}
        </Card>

        <ConfigCard source={source} onSaved={reload} />
      </div>

      <Card pad="lg" style={{ marginTop: 14 }}>
        <div className={styles.cardTitle}>Imported products{products.meta.total ? ` · ${products.meta.total}` : ''}</div>
        {products.items.length === 0 ? (
          <EmptyState icon={<Download size={22} />} title="No products yet" body="Run a sync to import this vendor's products." />
        ) : (
          <DataTable cols={PROD_COLS} headers={['Product', 'Our price', 'Stock', 'On storefront', '']}>
            {products.items.map((p) => (
              <Row key={p.id} cols={PROD_COLS}>
                <div className={styles.nameCell}>
                  <div className={styles.name}>{p.name}</div>
                  <span className={s.mono} style={{ fontSize: 11.5 }}>{p.externalRef}</span>
                </div>
                <div className={s.price}>{p.offers[0] ? inr(p.offers[0].eppPrice) : '—'}</div>
                <div className={s.muted}>{p.offers[0]?.quantity ?? 0}</div>
                <div>
                  <StatusPill
                    label={p.hidden ? 'Hidden' : 'Live'}
                    tone={p.hidden ? 'neutral' : 'success'}
                  />
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button variant="secondary" onClick={() => toggleHidden(p.id, !p.hidden)}>
                    {p.hidden ? <><Eye size={14} /> Show</> : <><EyeOff size={14} /> Hide</>}
                  </Button>
                  <button className={s.iconBtn} onClick={() => navigate(`/super-admin/productEdit?id=${p.id}`)} aria-label="Edit product">
                    <Pencil size={15} />
                  </button>
                </div>
              </Row>
            ))}
          </DataTable>
        )}
        <p className={s.muted} style={{ fontSize: 12.5, margin: '10px 2px 0' }}>
          Edit a product's category, price (Sellers & prices) or details on its page — your edits are preserved on the next sync.
        </p>
      </Card>

      <Card pad="lg" style={{ marginTop: 14 }}>
        <div className={styles.cardTitle}>Import log{runs.meta.total ? ` · ${runs.meta.total}` : ''}</div>
        {runs.items.length === 0 ? (
          <EmptyState icon={<Download size={22} />} title="No imports yet" body="Run a sync to pull this vendor's products." />
        ) : (
          <DataTable cols={RUN_COLS} headers={['Started', 'Fetched', 'Created', 'Updated', 'Failed', 'Status']}>
            {runs.items.map((r) => (
              <Row key={r.id} cols={RUN_COLS}>
                <div className={s.muted}>{fmtDate(r.startedAt)}</div>
                <div>{r.fetched}</div>
                <div>{r.created}</div>
                <div>{r.updated}</div>
                <div className={r.failed ? undefined : s.muted}>{r.failed}</div>
                <div><StatusPill label={r.status} tone={runTone[r.status] ?? 'neutral'} /></div>
              </Row>
            ))}
          </DataTable>
        )}
        <RunErrors runs={runs.items} />
      </Card>
    </div>
  );
}

function RunErrors({ runs }: { runs: VendorImportRun[] }) {
  const latestWithErrors = runs.find((r) => r.errors && r.errors.length > 0);
  if (!latestWithErrors || !latestWithErrors.errors?.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className={s.muted} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <AlertTriangle size={14} /> {latestWithErrors.errors.length} error(s) in the latest failing run
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
        {latestWithErrors.errors.slice(0, 12).map((e, i) => (
          <li key={i} className={s.muted}>
            <code>{e.ref}</code> — {e.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigCard({ source, onSaved }: { source: import('@/data/api').VendorSource; onSaved: () => void }) {
  const { flash } = useToast();
  const [discount, setDiscount] = useState(String(source.discountPct));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await updateVendorSource(source.id, { discountPct: Number(discount) || 0 });
      flash('Pricing updated (applies to the next sync; existing prices are preserved)');
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Pricing</div>
      <Field label="Our discount off MRP (%)">
        <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" />
      </Field>
      <div className={s.muted} style={{ fontSize: 12.5, margin: '2px 0 8px' }}>
        We sell this vendor's products at EPP = MRP − this %. The vendor connection is set up by the team.
      </div>
      <Button variant="secondary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save pricing'}</Button>
    </Card>
  );
}
