import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, RefreshCw, Download, Eye, EyeOff, Pencil, Upload } from 'lucide-react';
import { Card, Button, Field, Input, Modal, Toggle, StatusPill, DataTable, Row, EmptyState, Skeleton, useToast } from '@/components';
import {
  getVendorSource,
  getVendorSourceRuns,
  getVendorSourceProducts,
  getVendorSourceRun,
  updateVendorSource,
  syncVendorSource,
  repriceVendorSource,
  setProductHidden,
  setVendorProductDiscounts,
  getVendorWalletBalance,
  type VendorImportRun,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { fmtDate } from '@/data/map';
import { inr } from '@/lib/format';
import { parseCsvTable, toCsv, downloadCsv } from '@/lib/csv';
import type { SemanticTone } from '@/data/types';
import { statusTone } from './Partners';
import s from './screen.module.css';
import styles from './Partners.module.css';

const RUN_COLS = '1.1fr 0.7fr 0.7fr 0.7fr 0.8fr 0.7fr 1.1fr';
const PROD_COLS = 'minmax(0, 1.5fr) 0.85fr 0.85fr 0.9fr 0.55fr 0.7fr 128px';
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
            {source.adapter} · first-party · {source._count?.products ?? 0} products · EPP = vendor price − {source.discountPct}%
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
            Pull the vendor's catalog. Products go <strong>live immediately</strong> as first-party at EPP = vendor
            price − {source.discountPct}%. Suspending the vendor (toggle above) hides all its products from the
            storefront.
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

        <ConfigCard source={source} onSaved={reload} onProductsChanged={reloadProducts} />
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
            headers={['Product', 'Vendor price', 'Our price', 'Discount %', 'Stock', 'On storefront', '']}
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
                {/* The discount basis, shown next to the result so "EPP = vendor
                    price − x%" is checkable at a glance. The list price appears
                    only when the feed sends a different selling price. */}
                <div className={s.muted}>
                  {inr(p.mop ?? p.mrp)}
                  {p.mop != null && p.mop !== p.mrp && (
                    <span style={{ marginLeft: 6, textDecoration: 'line-through', opacity: 0.6 }}>{inr(p.mrp)}</span>
                  )}
                </div>
                <div className={s.price}>{p.offers[0] ? inr(p.offers[0].eppPrice) : '—'}</div>
                {/* Blank = inheriting the source's rate (shown as the placeholder). */}
                <DiscountCell
                  sourceId={id}
                  sku={p.sku}
                  value={p.vendorDiscountPct}
                  inherited={source.discountPct}
                  onSaved={reloadProducts}
                />
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
          <DataTable cols={RUN_COLS} headers={['Started', 'Fetched', 'Created', 'Updated', 'Delisted', 'Failed', 'Status']}>
            {runs.items.map((r) => (
              <Row key={r.id} cols={RUN_COLS}>
                <div className={s.muted}>{fmtDate(r.startedAt)}</div>
                <div>{r.fetched}</div>
                <div>{r.created}</div>
                <div>{r.updated}</div>
                <div
                  className={r.deactivated ? undefined : s.muted}
                  title={r.deactivated ? 'Taken off sale — the vendor no longer lists them' : undefined}
                >
                  {r.deactivated ?? 0}
                </div>
                <div className={r.failed ? undefined : s.muted}>{r.failed}</div>
                <div><StatusPill label={r.status} tone={runTone[r.status] ?? 'neutral'} /></div>
              </Row>
            ))}
          </DataTable>
        )}
        <RunErrors runs={runs.items} />
        <p className={s.muted} style={{ fontSize: 12.5, margin: '10px 2px 0' }}>
          Products the vendor stops listing are taken off sale automatically and go back on sale if the vendor lists them again.
        </p>
      </Card>
    </div>
  );
}

/**
 * Bulk-set per-product discounts from a two-column CSV (`sku,discount_pct`).
 *
 * Deliberately NOT the 34-column product template: that sheet requires
 * sku + name + category + mrp + epp_price + stock_quantity on every row, so a
 * discount-only change through it means restating five columns nobody wants to
 * touch. Cell meanings match that sheet's convention — a blank cell leaves the
 * product alone, `CLEAR` puts it back on the vendor's rate.
 */
function DiscountCsv({
  sourceId,
  sourceSlug,
  inherited,
  onDone,
}: {
  sourceId: string;
  sourceSlug: string;
  inherited: number;
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ updated: number; errors: { sku: string; message: string }[] } | null>(null);
  const { flash } = useToast();

  /**
   * Download the sheet to edit — the vendor's actual products, not a blank
   * template. These SKUs are machine-generated (`hubble-01GN6QQJFZ…`), so nobody
   * can type them; the only workable sheet is one we hand over pre-filled.
   *
   * `discount_pct` comes down holding each product's current override and blank
   * where it inherits, which round-trips exactly: edit a few cells, upload the
   * same file, and only those products change (a blank cell means "leave alone").
   * The extra name/price columns are there to read by — the importer matches on
   * header name and ignores the rest.
   */
  const download = async () => {
    setBusy(true);
    try {
      const all: Awaited<ReturnType<typeof getVendorSourceProducts>>['items'] = [];
      let page = 1;
      let pageCount = 1;
      do {
        const r = await getVendorSourceProducts(sourceId, { page, pageSize: 100 });
        all.push(...r.items);
        pageCount = r.meta.pageCount || 1;
        page += 1;
      } while (page <= pageCount);

      const csv = toCsv(
        ['sku', 'name', 'vendor_price', 'our_price', 'discount_pct'],
        all.map((p) => [
          p.sku,
          p.name,
          p.mop ?? p.mrp,
          p.offers[0]?.eppPrice ?? '',
          // Blank where the product inherits, so re-uploading untouched rows is a no-op.
          p.vendorDiscountPct ?? '',
        ]),
      );
      downloadCsv(`${sourceSlug || 'vendor'}-discounts.csv`, csv);
      flash(`Downloaded ${all.length} product${all.length === 1 ? '' : 's'}`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not build the sheet');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so re-picking the same file fires again
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      // The SAME quote-aware parser the product sheet uses. A naive split broke
      // on the quoted product names our own downloaded sheet contains, shifting
      // every later column so the upload silently applied nothing.
      const { headers: head, rows: cellRows } = parseCsvTable(await file.text());
      const headers = head.map((h) => h.toLowerCase());
      const iSku = headers.indexOf('sku');
      const iPct = headers.findIndex((h) => h === 'discount_pct' || h === 'discount' || h === 'discount%');
      if (iSku === -1 || iPct === -1) {
        flash('Needs a header row with "sku" and "discount_pct"');
        return;
      }
      const rows: { sku: string; discountPct: number | null }[] = [];
      for (const cells of cellRows) {
        const sku = cells[iSku];
        const raw = (cells[iPct] ?? '').replace(/[%\s]/g, '');
        if (!sku) continue;
        if (raw === '') continue; // blank = leave this product alone
        rows.push({ sku, discountPct: raw.toUpperCase() === 'CLEAR' ? null : Number(raw) });
      }
      if (!rows.length) {
        flash('No rows to apply — every discount cell was blank');
        return;
      }
      const r = await setVendorProductDiscounts(sourceId, rows);
      setResult(r);
      flash(`${r.updated} product${r.updated === 1 ? '' : 's'} updated${r.errors.length ? `, ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}` : ''}`);
      onDone();
    } catch (err) {
      flash(err instanceof ApiError ? err.message : 'Could not apply the discounts');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={download} disabled={busy}>
          <Download size={14} /> Download sheet
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={14} /> {busy ? 'Working…' : 'Upload discounts'}
        </Button>
      </div>
      <div className={s.muted} style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 8 }}>
        Set a discount <strong>per product</strong>. The sheet comes pre-filled with this vendor&rsquo;s
        products — edit the <span className={s.mono}>discount_pct</span> column and upload it back. A blank
        cell leaves that product on the default {inherited}% below;{' '}
        <span className={s.mono}>CLEAR</span> puts a product back on it.
      </div>
      {result && result.errors.length > 0 && (
        <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {result.errors.slice(0, 8).map((er) => (
            <li key={er.sku} className={s.muted} style={{ fontSize: 12.5 }}>
              <span className={s.mono}>{er.sku}</span> — {er.message}
            </li>
          ))}
          {result.errors.length > 8 && (
            <li className={s.muted} style={{ fontSize: 12.5 }}>…and {result.errors.length - 8} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Per-product discount cell: type a % and it saves on blur / Enter.
 *
 * Empty means "inherit the source's rate" — shown as a quiet placeholder of the
 * inherited number, so the admin can see what a product is actually on without
 * the table looking like every row has been set. `0` is a real value and is
 * shown as 0, because a product pinned to no discount is NOT the same as one
 * following the source.
 */
function DiscountCell({
  sourceId,
  sku,
  value,
  inherited,
  onSaved,
}: {
  sourceId: string;
  sku: string;
  value: number | null;
  inherited: number;
  onSaved: () => void;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const [busy, setBusy] = useState(false);
  const { flash } = useToast();

  // The row can be replaced underneath us by a reload or a page change.
  useEffect(() => setText(value == null ? '' : String(value)), [value, sku]);

  const commit = async () => {
    const raw = text.trim().replace(/[%\s]/g, '');
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) {
      flash('Discount must be between 0 and 100');
      setText(value == null ? '' : String(value));
      return;
    }
    if (next === value) return; // nothing typed, or typed back to what it was
    setBusy(true);
    try {
      const r = await setVendorProductDiscounts(sourceId, [{ sku, discountPct: next }]);
      if (r.errors.length) flash(r.errors[0].message);
      else flash(next === null ? `Back to the vendor rate (${inherited}%)` : `Set to ${next}%`);
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save the discount');
      setText(value == null ? '' : String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(value == null ? '' : String(value));
      }}
      disabled={busy}
      inputMode="numeric"
      placeholder={String(inherited)}
      inputSize="sm"
      aria-label={`Discount for ${sku}`}
    />
  );
}

function RunErrors({ runs }: { runs: VendorImportRun[] }) {
  const latestWithErrors = runs.find((r) => r.errors && r.errors.length > 0);
  if (!latestWithErrors || !latestWithErrors.errors?.length) return null;
  // A run can finish SUCCESS and still leave a note (e.g. pruning was skipped),
  // so only call these "errors" when rows actually failed.
  const failedRows = latestWithErrors.failed > 0;
  const label = failedRows
    ? `${latestWithErrors.errors.length} error(s) in the most recent run that had failures`
    : `Note from the run on ${fmtDate(latestWithErrors.startedAt)}`;
  return (
    <div style={{ marginTop: 12 }}>
      <div className={s.muted} style={{ fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <AlertTriangle size={14} /> {label}
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

function ConfigCard({
  source,
  onSaved,
  onProductsChanged,
}: {
  source: import('@/data/api').VendorSource;
  onSaved: () => void;
  onProductsChanged: () => void;
}) {
  const { flash } = useToast();
  const [discount, setDiscount] = useState(String(source.discountPct));
  const [busy, setBusy] = useState(false);
  const [confirmReprice, setConfirmReprice] = useState(false);

  const productCount = source._count?.products ?? 0;
  // Blank or non-numeric would post 0 and silently wipe the discount.
  const parsed = Number(discount);
  const valid = discount.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100;

  const save = async () => {
    if (!valid) {
      flash('Enter a discount between 0 and 100');
      return;
    }
    setBusy(true);
    try {
      await updateVendorSource(source.id, { discountPct: parsed });
      // The importer prices a product only when it first creates it, so this
      // saves the rule for future imports and changes nothing already imported.
      flash('Saved — applies to newly imported products. Use "Apply to existing" to reprice the current catalogue.');
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const reprice = async () => {
    setBusy(true);
    try {
      const r = await repriceVendorSource(source.id);
      // `skipped` are the products on their own rate — reporting them is the
      // only signal that this action deliberately left some prices alone.
      const kept = r.skipped ? ` · kept ${r.skipped} on their own discount` : '';
      flash(
        r.repriced === 0
          ? `Already priced at vendor price − ${r.discountPct}%${kept} — nothing to change`
          : `Repriced ${r.repriced} of ${r.considered} products to vendor price − ${r.discountPct}%${kept}`,
      );
      setConfirmReprice(false);
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not reprice');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card pad="lg">
      <div className={styles.cardTitle}>Pricing</div>
      {/* Per-product discounts first: that is the routine job. The source-wide
          rate below is the default new products land on. */}
      <DiscountCsv
        sourceId={source.id}
        sourceSlug={source.slug}
        inherited={source.discountPct}
        onDone={onProductsChanged}
      />
      <Field label="Default discount off the vendor's price, for products without their own (%)">
        <Input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" />
      </Field>
      <div className={s.muted} style={{ fontSize: 12.5, margin: '2px 0 8px' }}>
        We sell this vendor's products at the vendor's price minus this %. Where the feed sends both a list price
        (MRP) and a selling price, the <strong>selling price</strong> is the basis — that price is also what the
        public pays, so the employee always pays less. This is the <strong>default</strong>: any product given its
        own discount below keeps it, and is left alone by &ldquo;Apply to existing&rdquo;. The vendor connection is
        set up by the team.
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save pricing'}</Button>
        {productCount > 0 && (
          <Button variant="secondary" onClick={() => setConfirmReprice(true)} disabled={busy}>
            Apply to existing products
          </Button>
        )}
      </div>

      <Modal
        open={confirmReprice}
        onClose={() => setConfirmReprice(false)}
        title="Reprice existing products"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReprice(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={reprice} disabled={busy}>
              {busy ? 'Repricing…' : `Reprice ${productCount}`}
            </Button>
          </>
        }
      >
        <p className={s.muted} style={{ marginTop: 0, lineHeight: 1.55 }}>
          Sets products from <strong>{source.name}</strong> to{' '}
          <strong>vendor price − {source.discountPct}%</strong>.
        </p>
        <p className={s.muted} style={{ lineHeight: 1.55 }}>
          Any price edited by hand on the Products screen will be replaced. Products given their own
          discount are <strong>not</strong> touched — this only resets the ones following{' '}
          {source.name}&rsquo;s rate. Save the discount first if you&rsquo;ve just changed it.
        </p>
      </Modal>
    </Card>
  );
}
