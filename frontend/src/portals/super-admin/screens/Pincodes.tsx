import { useEffect, useRef, useState } from 'react';
import { MapPin, AlertTriangle, Search, Plus, UploadCloud, Download, Pencil, Trash2 } from 'lucide-react';
import {
  Input,
  Button,
  DataTable,
  Row,
  Toggle,
  Field,
  Modal,
  EmptyState,
  Skeleton,
  useToast,
} from '@/components';
import {
  getPincodes,
  createPincode,
  updatePincode,
  deletePincode,
  importPincodes,
  getPincodesForExport,
  getDeliverySettings,
  updateDeliverySetting,
  type AdminPincode,
  type CourierCode,
  type DeliveryMode,
  type DeliverySettings,
  type BulkImportResult,
} from '@/data/api';
import { ApiError } from '@/data/http';
import { useAsync } from '@/lib/useAsync';
import { parseCsv, toCsv, downloadCsv } from '@/lib/csv';
import s from './screen.module.css';
import styles from './Pincodes.module.css';

const PAGE_SIZE = 25;
const COLS = '0.9fr 1fr 0.8fr 0.7fr 1fr 0.9fr 84px';

const COURIERS: { value: CourierCode; label: string }[] = [
  { value: 'BLUEDART', label: 'Blue Dart' },
  { value: 'DELHIVERY', label: 'Delhivery' },
  { value: 'DTDC', label: 'DTDC' },
  { value: 'EKART', label: 'Ekart' },
  { value: 'INDIA_POST', label: 'India Post' },
];
const COURIER_LABEL: Record<string, string> = Object.fromEntries(COURIERS.map((c) => [c.value, c.label]));
const MODES: { value: DeliveryMode; label: string }[] = [
  { value: 'APEX', label: 'Apex' },
  { value: 'DP', label: 'DP' },
  { value: 'SURFACE', label: 'Surface' },
];

type EditTarget = { mode: 'new' } | { mode: 'edit'; row: AdminPincode };

export function Pincodes() {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [courier, setCourier] = useState<'' | CourierCode>('');
  const [mode, setMode] = useState<'' | DeliveryMode>('');
  const [deliverable, setDeliverable] = useState<'' | 'true' | 'false'>('');
  const [status, setStatus] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<AdminPincode[]>([]);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Debounce the pincode search; any filter change resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);
  useEffect(() => setPage(1), [q, courier, mode, deliverable, status]);

  const filters = {
    q: q || undefined,
    courier: courier || undefined,
    mode: mode || undefined,
    serviceable: deliverable === '' ? undefined : deliverable === 'true',
    isActive: status === '' ? undefined : status === 'true',
  };

  const { data, state, error, reload } = useAsync(
    () => getPincodes({ ...filters, page, pageSize: PAGE_SIZE }),
    [q, courier, mode, deliverable, status, page],
    (d) => d.items.length === 0,
  );

  useEffect(() => {
    if (data) setRows(data.items);
  }, [data]);

  const meta = data?.meta;
  const pageCount = meta?.pageCount ?? 1;

  // Optimistic inline toggle of Deliverable / Active — patch locally, persist,
  // revert on error.
  const patchRow = async (row: AdminPincode, field: 'serviceable' | 'isActive', next: boolean) => {
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [field]: next } : r)));
    try {
      await updatePincode(row.id, { [field]: next });
    } catch (e) {
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, [field]: !next } : r)));
      flash(e instanceof ApiError ? e.message : 'Could not update row');
    }
  };

  const remove = async (row: AdminPincode) => {
    if (!window.confirm(`Delete ${row.pincode} · ${COURIER_LABEL[row.courier]} · ${row.mode}?`)) return;
    try {
      await deletePincode(row.id);
      flash('Row deleted');
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not delete row');
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const parsed = parseCsv(await file.text(), new Set(['tat_days']));
      if (!parsed.length) {
        flash('No rows found (expected a CSV with a header row)');
        return;
      }
      const res = await importPincodes(parsed);
      setImportResult(res);
      flash(
        `${res.created} created · ${res.updated} updated${res.errors.length ? ` · ${res.errors.length} error${res.errors.length === 1 ? '' : 's'}` : ''}`,
      );
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const all = await getPincodesForExport(filters);
      const headers = ['pincode', 'courier', 'mode', 'tat_days', 'serviceable', 'is_active', 'edl'];
      const body = all.map((r) => [
        r.pincode,
        r.courier,
        r.mode,
        r.tatDays,
        r.serviceable ? 'Yes' : 'No',
        r.isActive ? 'Yes' : 'No',
        r.edl ? 'Yes' : 'No',
      ]);
      downloadCsv('pincodes.csv', toCsv(headers, body));
      flash(`Exported ${all.length} row${all.length === 1 ? '' : 's'}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />

      <SettingsCard />

      <div className={s.toolbar}>
        <div className={s.search}>
          <Search size={16} className={s.searchIcon} />
          <Input
            className={s.searchInput}
            placeholder="Search pincode"
            value={qInput}
            inputMode="numeric"
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
        <select className={styles.select} value={courier} onChange={(e) => setCourier(e.target.value as '' | CourierCode)} aria-label="Filter by courier">
          <option value="">All couriers</option>
          {COURIERS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as '' | DeliveryMode)} aria-label="Filter by mode">
          <option value="">All modes</option>
          {MODES.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
        <select className={styles.select} value={deliverable} onChange={(e) => setDeliverable(e.target.value as '' | 'true' | 'false')} aria-label="Filter by deliverable">
          <option value="">Any deliverable</option>
          <option value="true">Deliverable</option>
          <option value="false">Not deliverable</option>
        </select>
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as '' | 'true' | 'false')} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <div className={s.spacer} />
        <Button variant="secondary" onClick={onExport} disabled={exporting}>
          <Download size={15} /> {exporting ? 'Exporting…' : 'Export'}
        </Button>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
          <UploadCloud size={15} /> {importing ? 'Importing…' : 'Import'}
        </Button>
        <Button onClick={() => setTarget({ mode: 'new' })}>
          <Plus size={15} /> Add pincode
        </Button>
      </div>

      {importResult && (
        <div className={styles.resultBox}>
          <div className={styles.resultLine}>
            {importResult.created} created · {importResult.updated} updated · {importResult.total} row
            {importResult.total === 1 ? '' : 's'}
          </div>
          {importResult.errors.length > 0 && (
            <>
              <div className={styles.errorHead}>
                <AlertTriangle size={14} />
                {importResult.errors.length} problem{importResult.errors.length === 1 ? '' : 's'} — fix and re-upload
              </div>
              <ul className={styles.errorList}>
                {importResult.errors.map((er, i) => (
                  <li key={`${er.sku}-${er.field}-${i}`} className={styles.errorItem}>
                    <span className={styles.errSku}>{er.sku}</span>
                    {er.field && er.field !== '—' && <span className={styles.errField}>{er.field}</span>}
                    <span>{er.message}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {state === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} h={48} />
          ))}
        </div>
      )}

      {state === 'error' && (
        <EmptyState
          tone="error"
          icon={<AlertTriangle size={24} />}
          title="Couldn't load pincodes"
          body={error ?? 'Something went wrong.'}
          action={{ label: 'Retry', onClick: reload }}
        />
      )}

      {state === 'empty' && (
        <EmptyState
          icon={<MapPin size={24} />}
          title="No pincodes match"
          body="Adjust the search or filters, or add a pincode."
          action={{ label: 'Add pincode', onClick: () => setTarget({ mode: 'new' }) }}
        />
      )}

      {state === 'live' && (
        <>
          <DataTable cols={COLS} headers={['Pincode', 'Courier', 'Mode', 'TAT (days)', 'Deliverable', 'Status', '']}>
            {rows.map((r) => (
              <Row key={r.id} cols={COLS}>
                <div className={styles.pin}>{r.pincode}</div>
                <div className={s.muted}>{COURIER_LABEL[r.courier] ?? r.courier}</div>
                <div>
                  <span className={styles.modeBadge}>{r.mode}</span>
                  {r.edl && <span className={styles.edlBadge} title="Extended delivery area (EDL/ODA)">EDL</span>}
                </div>
                <div className={styles.tat}>{r.tatDays}</div>
                <div className={styles.toggleCell}>
                  <Toggle on={r.serviceable} onClick={() => patchRow(r, 'serviceable', !r.serviceable)} />
                  <span className={r.serviceable ? styles.yes : styles.no}>{r.serviceable ? 'Yes' : 'No'}</span>
                </div>
                <div className={styles.toggleCell}>
                  <Toggle on={r.isActive} onClick={() => patchRow(r, 'isActive', !r.isActive)} />
                  <span className={r.isActive ? styles.yes : styles.no}>{r.isActive ? 'Active' : 'Inactive'}</span>
                </div>
                <div className={styles.rowActions}>
                  <button className={s.iconBtn} onClick={() => setTarget({ mode: 'edit', row: r })} aria-label="Edit">
                    <Pencil size={15} />
                  </button>
                  <button className={s.iconBtn} onClick={() => remove(r)} aria-label="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </Row>
            ))}
          </DataTable>

          <div className={styles.pager}>
            <span className={styles.pageInfo}>
              {meta ? `${meta.total.toLocaleString()} rows · page ${meta.page} of ${pageCount}` : ''}
            </span>
            <div className={styles.pagerBtns}>
              <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                Prev
              </Button>
              <Button variant="secondary" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {target && (
        <PincodeModal
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ── Global service / mode availability ───────────────────────────────────────

function SettingsCard() {
  const { flash } = useToast();
  const [settings, setSettings] = useState<DeliverySettings | null>(null);

  useEffect(() => {
    getDeliverySettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const toggle = async (key: string, enabled: boolean) => {
    setSettings((prev) =>
      prev
        ? {
            couriers: prev.couriers.map((c) => (c.key === key ? { ...c, enabled } : c)),
            modes: prev.modes.map((m) => (m.key === key ? { ...m, enabled } : m)),
          }
        : prev,
    );
    try {
      const next = await updateDeliverySetting(key, enabled);
      setSettings(next);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not update setting');
      getDeliverySettings().then(setSettings).catch(() => {});
    }
  };

  if (!settings) return null;

  return (
    <div className={styles.settings}>
      <div className={styles.settingsHead}>
        <div className={styles.settingsTitle}>Service &amp; mode availability</div>
        <div className={styles.settingsSub}>
          Disable a courier or a mode to exclude it from every pincode's delivery estimate.
        </div>
      </div>
      <div className={styles.settingsGroups}>
        <div className={styles.settingsGroup}>
          <div className={styles.groupLabel}>Couriers</div>
          <div className={styles.chips}>
            {settings.couriers.map((c) => (
              <label key={c.key} className={`${styles.chip} ${c.enabled ? styles.chipOn : ''}`}>
                <span>{c.label}</span>
                <Toggle on={c.enabled} onClick={() => toggle(c.key, !c.enabled)} />
              </label>
            ))}
          </div>
        </div>
        <div className={styles.settingsGroup}>
          <div className={styles.groupLabel}>Modes</div>
          <div className={styles.chips}>
            {settings.modes.map((m) => (
              <label key={m.key} className={`${styles.chip} ${m.enabled ? styles.chipOn : ''}`}>
                <span>{m.label}</span>
                <Toggle on={m.enabled} onClick={() => toggle(m.key, !m.enabled)} />
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create / edit modal ──────────────────────────────────────────────────────

function PincodeModal({ target, onClose, onSaved }: { target: EditTarget; onClose: () => void; onSaved: () => void }) {
  const { flash } = useToast();
  const editing = target.mode === 'edit';
  const src = target.mode === 'edit' ? target.row : null;

  const [pincode, setPincode] = useState(src?.pincode ?? '');
  const [courier, setCourier] = useState<CourierCode>(src?.courier ?? 'BLUEDART');
  const [mode, setMode] = useState<DeliveryMode>(src?.mode ?? 'APEX');
  const [tatDays, setTatDays] = useState(String(src?.tatDays ?? ''));
  const [serviceable, setServiceable] = useState(src?.serviceable ?? true);
  const [isActive, setIsActive] = useState(src?.isActive ?? true);
  const [edl, setEdl] = useState(src?.edl ?? false);
  const [busy, setBusy] = useState(false);

  const validPin = /^\d{6}$/.test(pincode.trim());
  const validTat = tatDays !== '' && Number(tatDays) >= 0;

  const save = async () => {
    if ((!editing && !validPin) || !validTat) return;
    setBusy(true);
    try {
      if (editing && src) {
        await updatePincode(src.id, { tatDays: Number(tatDays), serviceable, isActive, edl });
      } else {
        await createPincode({ pincode: pincode.trim(), courier, mode, tatDays: Number(tatDays), serviceable, isActive, edl });
      }
      onSaved();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : 'Could not save pincode');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${src?.pincode}` : 'Add pincode'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || (!editing && !validPin) || !validTat}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className={s.formRow}>
        <Field label="Pincode">
          <Input value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="400001" inputMode="numeric" disabled={editing} />
        </Field>
        <Field label="Courier">
          <select className={styles.select} value={courier} onChange={(e) => setCourier(e.target.value as CourierCode)} disabled={editing}>
            {COURIERS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Mode">
          <select className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as DeliveryMode)} disabled={editing}>
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="TAT (delivery days)">
        <Input value={tatDays} onChange={(e) => setTatDays(e.target.value)} placeholder="2" inputMode="numeric" />
      </Field>
      <div className={styles.toggleRows}>
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.toggleLabel}>Deliverable</div>
            <div className={styles.toggleHint}>Is this pincode serviceable on this mode?</div>
          </div>
          <Toggle on={serviceable} onClick={() => setServiceable((v) => !v)} />
        </div>
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.toggleLabel}>Active</div>
            <div className={styles.toggleHint}>Inactive rows are ignored by the engine.</div>
          </div>
          <Toggle on={isActive} onClick={() => setIsActive((v) => !v)} />
        </div>
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.toggleLabel}>Extended area (EDL/ODA)</div>
            <div className={styles.toggleHint}>Reachable but outside standard delivery.</div>
          </div>
          <Toggle on={edl} onClick={() => setEdl((v) => !v)} />
        </div>
      </div>
    </Modal>
  );
}
