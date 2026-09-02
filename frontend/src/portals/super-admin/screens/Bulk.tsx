import { useRef, useState } from 'react';
import { UploadCloud, Info, FileSpreadsheet, Download, AlertTriangle } from 'lucide-react';
import { Segmented, Card, Field, Input, Button, useToast } from '@/components';
import { mappingRows, bulkImport, bulkPriceUpdate, bulkCashbackUpdate, type BulkImportResult } from '@/data/api';
import s from './screen.module.css';
import styles from './Bulk.module.css';

const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/imcorpcart_products_template.xlsx`;

// Columns whose values should be coerced to numbers before POSTing.
const NUMERIC = new Set(['mrp', 'mop_price', 'cashback_value', 'gst_percent', 'epp_price', 'smart_epp_price', 'stock_quantity']);

// Minimal CSV parser (handles quoted fields + commas). Returns row objects keyed
// by the header row, with numeric columns coerced.
function parseCsv(text: string): Record<string, unknown>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const v = cells[i] ?? '';
      if (v === '') return;
      row[h] = NUMERIC.has(h) ? Number(v) : v;
    });
    return row;
  });
}

export function Bulk() {
  const { flash } = useToast();
  const [tab, setTab] = useState<'import' | 'price' | 'cashback'>('import');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  // Price-update form
  const [scope, setScope] = useState<'all' | 'phones' | 'accessories' | 'bags'>('all');
  const [adjustment, setAdjustment] = useState<'increasePct' | 'decreasePct' | 'setAmount'>('increasePct');
  const [value, setValue] = useState('');
  const [applying, setApplying] = useState(false);

  // Cashback-update form
  const [cbScope, setCbScope] = useState<'all' | 'phones' | 'accessories' | 'bags'>('all');
  const [cbType, setCbType] = useState<'NONE' | 'PERCENT' | 'FIXED'>('PERCENT');
  const [cbValue, setCbValue] = useState('');
  const [cbApplying, setCbApplying] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        flash('No rows found in the file (expected a CSV with a header row)');
        return;
      }
      const res = await bulkImport(rows);
      setImportResult(res);
      flash(
        `${res.created} created · ${res.updated} updated${res.errors.length ? ` · ${res.errors.length} error${res.errors.length === 1 ? '' : 's'}` : ''}`,
      );
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const applyPrice = async () => {
    if (!value || Number.isNaN(Number(value))) {
      flash('Enter a value');
      return;
    }
    setApplying(true);
    try {
      const res = await bulkPriceUpdate({ scope, adjustment, value: Number(value) });
      flash(`Updated ${res.affectedPrices} price(s) across ${res.matchedProducts} product(s)`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Price update failed');
    } finally {
      setApplying(false);
    }
  };

  const applyCashback = async () => {
    if (cbType !== 'NONE' && (!cbValue || Number.isNaN(Number(cbValue)) || Number(cbValue) <= 0)) {
      flash('Enter a cashback value greater than 0');
      return;
    }
    setCbApplying(true);
    try {
      const res = await bulkCashbackUpdate({
        scope: cbScope,
        cashbackType: cbType,
        cashbackValue: cbType !== 'NONE' ? Number(cbValue) : undefined,
      });
      flash(
        cbType === 'NONE'
          ? `Cleared cashback on ${res.matchedProducts} product(s)`
          : `Cashback set on ${res.matchedProducts} product(s)`,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Cashback update failed');
    } finally {
      setCbApplying(false);
    }
  };

  return (
    <div className={s.narrow}>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
      <div className={styles.tabs}>
        <Segmented
          options={[
            { value: 'import', label: 'Product import' },
            { value: 'price', label: 'Price update' },
            { value: 'cashback', label: 'Cashback' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'import' ? (
        <Card pad="lg">
          <div className={styles.template}>
            <span className={styles.templateIcon}>
              <FileSpreadsheet size={20} />
            </span>
            <div className={styles.templateBody}>
              <div className={styles.templateTitle}>Start from the product template</div>
              <div className={styles.templateSub}>
                Pre-filled with the exact catalog columns. Fill one product per row, export it as
                CSV, then upload it below.
              </div>
            </div>
            <a
              href={TEMPLATE_URL}
              download="imcorpcart_products_template.xlsx"
              className={styles.templateBtn}
              onClick={() => flash('Downloading template…')}
            >
              <Download size={15} />
              Download .xlsx
            </a>
          </div>

          <button
            className={styles.dropzone}
            style={{ width: '100%', cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            <UploadCloud size={28} />
            <div className={styles.dropTitle}>{importing ? 'Importing…' : 'Upload a filled CSV'}</div>
            <div className={styles.dropSub}>.csv · header row required · max 5MB</div>
          </button>

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

          <div className={s.sectionTitle} style={{ marginTop: 22 }}>
            Column mapping
          </div>
          <div className={styles.mapHead}>
            <span>CSV column</span>
            <span>Maps to field</span>
          </div>
          {mappingRows.map((m) => (
            <div key={m.csv} className={styles.mapRow}>
              <span className={styles.csvCol}>{m.csv}</span>
              <span className={styles.arrow}>→</span>
              <span className={styles.fieldCol}>{m.field}</span>
            </div>
          ))}
        </Card>
      ) : tab === 'price' ? (
        <Card pad="lg">
          <div className={styles.priceForm}>
            <div className={s.grid2}>
              <Field label="Apply to">
                <select className={styles.select} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                  <option value="all">All products</option>
                  <option value="phones">Phones</option>
                  <option value="accessories">Accessories</option>
                  <option value="bags">Bags</option>
                </select>
              </Field>
              <Field label="Adjustment">
                <select
                  className={styles.select}
                  value={adjustment}
                  onChange={(e) => setAdjustment(e.target.value as typeof adjustment)}
                >
                  <option value="increasePct">Increase by %</option>
                  <option value="decreasePct">Decrease by %</option>
                  <option value="setAmount">Set to ₹</option>
                </select>
              </Field>
            </div>
            <Field label="Value">
              <Input
                prefix={adjustment === 'setAmount' ? '₹' : '%'}
                inputMode="numeric"
                placeholder="5"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          </div>

          <div className={styles.info}>
            <Info size={16} />
            Changes apply to EPP prices only, across the selected scope.
          </div>

          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setValue('')} disabled={applying}>
              Reset
            </Button>
            <Button onClick={applyPrice} disabled={applying}>
              {applying ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card pad="lg">
          <div className={styles.priceForm}>
            <div className={s.grid2}>
              <Field label="Apply to">
                <select className={styles.select} value={cbScope} onChange={(e) => setCbScope(e.target.value as typeof cbScope)}>
                  <option value="all">All products</option>
                  <option value="phones">Phones</option>
                  <option value="accessories">Accessories</option>
                  <option value="bags">Bags</option>
                </select>
              </Field>
              <Field label="Cashback">
                <select className={styles.select} value={cbType} onChange={(e) => setCbType(e.target.value as typeof cbType)}>
                  <option value="NONE">No cashback</option>
                  <option value="PERCENT">Percent of price</option>
                  <option value="FIXED">Fixed ₹ per unit</option>
                </select>
              </Field>
            </div>
            {cbType !== 'NONE' && (
              <Field label={cbType === 'PERCENT' ? 'Cashback percent' : 'Cashback amount (per unit)'}>
                <Input
                  prefix={cbType === 'PERCENT' ? '%' : '₹'}
                  inputMode="numeric"
                  placeholder={cbType === 'PERCENT' ? '5' : '200'}
                  value={cbValue}
                  onChange={(e) => setCbValue(e.target.value)}
                />
              </Field>
            )}
          </div>

          <div className={styles.info}>
            <Info size={16} />
            {cbType === 'NONE'
              ? 'Clears cashback on every product in the selected scope.'
              : 'Rewarded to the shopper’s wallet when their order is delivered. Applies to every product in the selected scope.'}
          </div>

          <div className={styles.footer}>
            <Button variant="secondary" onClick={() => setCbValue('')} disabled={cbApplying}>
              Reset
            </Button>
            <Button onClick={applyCashback} disabled={cbApplying}>
              {cbApplying ? 'Applying…' : 'Apply'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
