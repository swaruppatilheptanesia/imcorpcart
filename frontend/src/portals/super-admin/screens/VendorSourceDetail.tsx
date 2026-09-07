import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, RefreshCw, Download, Eye, EyeOff, Pencil } from 'lucide-react';
import { Card, Button, Field, Input, Toggle, StatusPill, DataTable, Row, EmptyState, Skeleton, useToast } from '@/components';
import {
  getVendorSource,
  getVendorSourceRuns,
  getVendorSourceProducts,
  getVendorSourceRun,
  updateVendorSource,
  syncVendorSource,
  setProductHidden,
  getVendorWalletBalance,
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
const PROD_PAGE_SIZE = 20;
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
    () => Promise.all([getVendorSource(id), getVendorSourceRuns(id, { pageSize: 20 })]),
    [id],
  );
  // Imported products get their own page state + reload (independent of source/runs).
  const [prodPage, setProdPage] = useState(1);
  const { data: prods, reload: reloadProducts } = useAsync(
    () => getVendorSourceProducts(id, { page: prodPage, pageSize: PROD_PAGE_SIZE }),
    [id, prodPage],
  );
  const [busy, setBusy] = useState(false);

  // Background sync: kick off → poll the RUNNING run for live progress.
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<VendorImportRun | null>(null);
  const finishedRef = useRef<string | null>(null); // guards against re-adopting a just-finished run

  // Adopt an in-flight run on load/refresh (so progress resumes across a page reload).
  const latestRun = data?.[1]?.items?.[0];
  useEffect(() => {
    if (latestRun && latestRun.status === 'RUNNING' && !activeRunId && latestRun.id !== finishedRef.current) {
      setActiveRunId(latestRun.id);
      setProgress(latestRun);
    }
  }, [latestRun, activeRunId]);

  // Poll the active run every 2s until it finishes.
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const finish = (r: VendorImportRun) => {
      finishedRef.current = r.id;
      flash(`Sync ${r.status.toLowerCase()} — ${r.created} created · ${r.updated} updated · ${r.failed} failed`);
      setActiveRunId(null);
      setProgress(null);
      reload(); // source counts + Import log
      setProdPage(1);
      reloadProducts();
    };
    const tick = async () => {
      try {
        const r = await getVendorSourceRun(id, activeRunId);
        if (cancelled) return;
        setProgress(r);
        if (r.status !== 'RUNNING') return finish(r);
        if (Date.now() - startedAt > 20 * 60 * 1000) {
          flash('Sync is taking a while — check the Import log shortly.');
          setActiveRunId(null);
        }
      } catch {
        /* transient poll error — keep trying */
      }
    };
    const iv = setInterval(tick, 2000);
    tick(); // immediate first poll
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, id]);

  const syncing = busy || activeRunId != null;

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

  const [source, runs] = data;
  const prodItems = prods?.items ?? [];
  const prodTotal = prods?.meta.total ?? 0;
  const prodPageCount = prods?.meta.pageCount ?? 1;

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
      const run = await syncVendorSource(id); // 202 — RUNNING run; import continues in the background
      finishedRef.current = null;
      setProgress(run);
      setActiveRunId(run.id); // starts the polling effect
      reload(); // surface the RUNNING row in the Import log
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        flash('A sync is already running for this vendor');
        reload(); // the resume effect adopts the in-flight run
      } else {
        flash(e instanceof ApiError ? e.message : 'Could not start sync');
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = async (productId: string, hidden: boolean) => {
    try {
      await setProductHidden(productId, hidden);
      reloadProducts(); // only the products table changed — keep the current page
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
          <Button onClick={runSync} disabled={syncing || !source.active}>
            <RefreshCw size={15} style={syncing ? { animation: 'saSpin 1s linear infinite' } : undefined} />{' '}
            {syncing ? 'Syncing…' : 'Run sync'}
          </Button>
          {activeRunId && progress ? (
            <div className={s.muted} style={{ fontSize: 12.5, marginTop: 10 }}>
              Importing… {progress.fetched} fetched · {progress.created} new · {progress.updated} updated
              {progress.failed ? ` · ${progress.failed} failed` : ''} — runs in the background, safe to leave this page.
            </div>
          ) : (
            source.lastSyncedAt && (
              <div className={s.muted} style={{ fontSize: 12.5, marginTop: 10 }}>Last synced {fmtDate(source.lastSyncedAt)}</div>
            )
          )}
        </Card>

        <ConfigCard source={source} onSaved={reload} />
      </div>

      {source.adapter === 'hubble' && <WalletCard id={id} />}

      <Card pad="lg" style={{ marginTop: 14 }}>
        <div className={styles.cardTitle}>Imported products{prodTotal ? ` · ${prodTotal}` : ''}</div>
        {!prods ? (
          <Skeleton h={160} />
        ) : prodTotal === 0 ? (
          <EmptyState icon={<Download size={22} />} title="No products yet" body="Run a sync to import this vendor's products." />
        ) : (
          <DataTable
            cols={PROD_COLS}
            headers={['Product', 'Our price', 'Stock', 'On storefront', '']}
            footer={
              prodPageCount > 1 ? (
                <>
                  <span>
                    Showing {(prodPage - 1) * PROD_PAGE_SIZE + 1}–{Math.min(prodPage * PROD_PAGE_SIZE, prodTotal)} of {prodTotal}
                  </span>
                  <div className={styles.pager}>
                    <button className={styles.pageBtn} disabled={prodPage <= 1} onClick={() => setProdPage((p) => Math.max(1, p - 1))}>
                      Prev
                    </button>
                    <button
                      className={styles.pageBtn}
                      disabled={prodPage >= prodPageCount}
                      onClick={() => setProdPage((p) => Math.min(prodPageCount, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : undefined
            }
          >
            {prodItems.map((p) => (
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

// Hubble client wallet balance (ops aid): the client tops this up offline, and
// every voucher order auto-debits it. A low/empty balance means new voucher orders
// will fail to issue (and buyers get refunded), so it's worth surfacing.
function WalletCard({ id }: { id: string }) {
  const { data, state, reload } = useAsync(() => getVendorWalletBalance(id), [id]);
  return (
    <Card pad="lg" style={{ marginTop: 14 }}>
      <div className={styles.cardTitle}>Hubble wallet</div>
      <p className={styles.cardHint}>
        Voucher orders are paid from this Hubble wallet (the client tops it up with their Hubble account manager).
        Keep it funded — an empty wallet means new gift-card orders can’t be issued and buyers are refunded.
      </p>
      {state === 'loading' ? (
        <Skeleton h={28} w={160} />
      ) : data?.configured && data.balance != null ? (
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{inr(data.balance)}</div>
      ) : (
        <div className={s.muted} style={{ fontSize: 12.5 }}>
          {data && !data.configured
            ? 'Hubble is not configured on the server (set HUBBLE_CLIENT_ID / HUBBLE_CLIENT_SECRET and restart).'
            : 'Balance unavailable right now.'}
        </div>
      )}
      <Button variant="secondary" onClick={reload} style={{ marginTop: 10 }}>
        <RefreshCw size={14} /> Refresh
      </Button>
    </Card>
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
