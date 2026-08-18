import { useRef, useState } from 'react';
import { UploadCloud, Info, FileSpreadsheet, Download } from 'lucide-react';
import { Segmented, Card, Field, Input, Button, useToast } from '@/components';
import { mappingRows, bulkImport, bulkPriceUpdate } from '@/data/api';
import s from './screen.module.css';
import styles from './Bulk.module.css';

const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/imcorpcart_products_template.xlsx`;

// Columns whose values should be coerced to numbers before POSTing.
const NUMERIC = new Set(['mrp', 'mop_price', 'epp_price', 'smart_epp_price', 'stock_quantity']);

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
  const [tab, setTab] = useState<'import' | 'price'>('import');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  // Price-update form
  const [scope, setScope] = useState<'all' | 'phones' | 'accessories' | 'bags'>('all');
  const [adjustment, setAdjustment] = useState<'increasePct' | 'decreasePct' | 'setAmount'>('increasePct');
  const [value, setValue] = useState('');
  const [applying, setApplying] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        flash('No rows found in the file (expected a CSV with a header row)');
        return;
      }
      const res = await bulkImport(rows);
      flash(`Imported ${res.created} · skipped ${res.skipped}${res.errors.length ? ` · ${res.errors.length} errors` : ''}`);
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

  return (
    <div className={s.narrow}>
      <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
      <div className={styles.tabs}>
        <Segmented
          options={[
            { value: 'import', label: 'Product import' },
            { value: 'price', label: 'Price update' },
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
      ) : (
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
      )}
    </div>
  );
}
