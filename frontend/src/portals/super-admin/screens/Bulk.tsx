import { useRef, useState } from 'react';
import { UploadCloud, Info, FileSpreadsheet, Download, AlertTriangle } from 'lucide-react';
import { Button, Card, Field, Input, Segmented, Select, useToast } from '@/components';
import { mappingRows, bulkImport, bulkPriceUpdate, bulkCashbackUpdate, type BulkImportResult } from '@/data/api';
import s from './screen.module.css';
import styles from './Bulk.module.css';

const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/imcorpcart_products_template.xlsx`;

// Columns whose values should be coerced to numbers before POSTing.
const NUMERIC = new Set(['mrp', 'mop_price', 'cashback_value', 'epp_price', 'smart_epp_price', 'stock_quantity']);

// Percentage columns are deliberately kept OUT of NUMERIC. The client writes
// "18%", and Number('18%') is NaN, which JSON-serialises to null and is then
// coerced to 0 on the server — a silently wrong GST rate rather than an error.
// Strip the sign here and let the server validate what's left.
const PERCENT = new Set(['gst_percent', 'protection_plan_pct']);

// Minimal CSV parser (handles quoted fields + commas). Returns row objects keyed
// by the header row, with numeric columns coerced.
//
// Every header becomes a key, INCLUDING one whose cell is empty, so the server
// sees the sheet exactly as filled. Both a blank cell and an absent column mean
// "leave this field alone"; only the literal CLEAR empties a field. (A blank cell
// used to CLEAR the field, which is how a pricing-only upload deleted every
// product gallery on 13 Oct 2026.)
//
// Known limitation: lines are split before quotes are honoured, so a newline
// inside a quoted cell breaks the row. Multi-value cells are pipe-separated.
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
      if (!h) return; // trailing comma in the header row
      const v = cells[i] ?? '';
      // Posted as '' so the server reads it as "clear this field".
      if (v === '') {
        row[h] = '';
        return;
      }
      if (PERCENT.has(h)) {
        const n = Number(v.replace(/[%\s,]/g, ''));
        row[h] = Number.isFinite(n) ? n : v; // non-numeric → let the server name the field
        return;
      }
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

          {/* Read before uploading, not after: an upload is applied immediately and
              there is no undo. The blank-vs-CLEAR rule is the one that bites. */}
          <div className={styles.rules}>
            <div className={styles.rulesHead}>
              <Info size={15} />
              How an upload is applied
            </div>

            <div className={styles.ruleGrid}>
              <div className={styles.ruleCard}>
                <div className={styles.ruleCardTitle}>Leave a cell blank</div>
                <div className={styles.ruleCardBody}>
                  The field is <strong>left exactly as it is</strong>. So a sheet with only your
                  pricing columns filled changes only the pricing.
                </div>
              </div>
              <div className={styles.ruleCard}>
                <div className={styles.ruleCardTitle}>
                  Type <span className={styles.tokInline}>CLEAR</span>
                </div>
                <div className={styles.ruleCardBody}>
                  The field is <strong>emptied</strong>. This is the only way to remove a value
                  through the sheet.
                </div>
              </div>
            </div>

            <ul className={styles.ruleList}>
              <li className={styles.ruleItem}>
                <span className={styles.tok}>image_urls</span>
                <span>
                  Leave it blank to keep the images you uploaded on the product page — they are not
                  touched. Fill it to replace the gallery (first URL = main image), or{' '}
                  <span className={styles.tokQuiet}>CLEAR</span> to remove every image.
                </span>
              </li>
              <li className={styles.ruleItem}>
                <span className={styles.tok}>sku</span>
                <span>
                  Matches the product. An existing SKU is updated, a new one is created. A column you
                  leave out of the sheet entirely is never touched.
                </span>
              </li>
              <li className={styles.ruleItem}>
                <span className={styles.tokWarn}>exceptions</span>
                <span>
                  <span className={styles.tokQuiet}>mop_price</span>,{' '}
                  <span className={styles.tokQuiet}>cashback_type</span>,{' '}
                  <span className={styles.tokQuiet}>cashback_value</span> and{' '}
                  <span className={styles.tokQuiet}>stock_quantity</span> are always taken from the
                  sheet as given — a blank cell <strong>does</strong> reset these.
                </span>
              </li>
              <li className={styles.ruleItem}>
                <span className={styles.tokWarn}>required</span>
                <span>
                  <span className={styles.tokQuiet}>sku</span>,{' '}
                  <span className={styles.tokQuiet}>name</span>,{' '}
                  <span className={styles.tokQuiet}>category</span>,{' '}
                  <span className={styles.tokQuiet}>mrp</span> and{' '}
                  <span className={styles.tokQuiet}>epp_price</span> cannot be blank — those rows are
                  rejected and listed back to you, and nothing else in the file is affected.
                </span>
              </li>
              <li className={styles.ruleItem}>
                <span className={styles.tok}>a | b</span>
                <span>
                  Multi-value cells (<span className={styles.tokQuiet}>image_urls</span>,{' '}
                  <span className={styles.tokQuiet}>spec_rows</span>,{' '}
                  <span className={styles.tokQuiet}>about_item</span>,{' '}
                  <span className={styles.tokQuiet}>in_the_box</span>) separate entries with a pipe,
                  all on one line. Do not press Alt+Enter inside a cell — a line break splits the row.
                </span>
              </li>
            </ul>
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
            <div className={styles.dropSub}>
              Blank cells are left unchanged — write CLEAR to empty a field
            </div>
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
                <Select block value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
                  <option value="all">All products</option>
                  <option value="phones">Phones</option>
                  <option value="accessories">Accessories</option>
                  <option value="bags">Bags</option>
                </Select>
              </Field>
              <Field label="Adjustment">
                <Select
                  block
                  value={adjustment}
                  onChange={(e) => setAdjustment(e.target.value as typeof adjustment)}
                >
                  <option value="increasePct">Increase by %</option>
                  <option value="decreasePct">Decrease by %</option>
                  <option value="setAmount">Set to ₹</option>
                </Select>
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
                <Select block value={cbScope} onChange={(e) => setCbScope(e.target.value as typeof cbScope)}>
                  <option value="all">All products</option>
                  <option value="phones">Phones</option>
                  <option value="accessories">Accessories</option>
                  <option value="bags">Bags</option>
                </Select>
              </Field>
              <Field label="Cashback">
                <Select block value={cbType} onChange={(e) => setCbType(e.target.value as typeof cbType)}>
                  <option value="NONE">No cashback</option>
                  <option value="PERCENT">Percent of price</option>
                  <option value="FIXED">Fixed ₹ per unit</option>
                </Select>
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
