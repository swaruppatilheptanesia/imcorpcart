import { useRef, useState } from 'react';
import { UploadCloud, Download, FileSpreadsheet, Info, AlertTriangle } from 'lucide-react';
import { Card, Button, useToast } from '@/components';
import { getAllOffers, bulkUpdateOffers, type ResellerBulkRow, type ResellerBulkResult } from '@/data/reseller-api';
import { parseCsv, toCsv, downloadCsv } from '@/lib/csv';
import s from './screen.module.css';
import styles from './Bulk.module.css';

const HEADERS = ['sku', 'product_name', 'reseller_price', 'customer_price', 'stock_quantity'];
const NUMERIC = new Set(['reseller_price', 'customer_price', 'stock_quantity']);

export function Bulk() {
  const { flash } = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ResellerBulkResult | null>(null);

  const download = async () => {
    setDownloading(true);
    try {
      const offers = await getAllOffers();
      if (!offers.length) {
        flash('You have no products yet. Ask the admin to attach you to products first.');
        return;
      }
      const rows = offers.map((o) => [
        o.sku,
        o.name,
        o.resellerPrice ?? '',
        o.eppPrice || '',
        o.quantity ?? 0,
      ]);
      downloadCsv('my-listings.csv', toCsv(HEADERS, rows));
      flash(`Downloaded ${offers.length} listing${offers.length === 1 ? '' : 's'}`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not download your listings');
    } finally {
      setDownloading(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseCsv(text, NUMERIC);
      const rows: ResellerBulkRow[] = parsed
        .map((r) => ({
          sku: String(r.sku ?? '').trim(),
          reseller_price: typeof r.reseller_price === 'number' ? r.reseller_price : undefined,
          customer_price: typeof r.customer_price === 'number' ? r.customer_price : undefined,
          stock_quantity: typeof r.stock_quantity === 'number' ? r.stock_quantity : undefined,
        }))
        .filter((r) => r.sku);
      if (!rows.length) {
        flash('No rows found (expected a CSV with a header row and at least one SKU)');
        return;
      }
      const res = await bulkUpdateOffers(rows);
      setResult(res);
      flash(
        `Updated ${res.updated} · skipped ${res.skipped}${res.errors.length ? ` · ${res.errors.length} error${res.errors.length === 1 ? '' : 's'}` : ''}`,
      );
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not process the file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={s.narrow}>
      <Card pad="lg">
        <div className={styles.template}>
          <span className={styles.templateIcon}>
            <FileSpreadsheet size={20} />
          </span>
          <div className={styles.templateBody}>
            <div className={styles.templateTitle}>1 · Download your listings</div>
            <div className={styles.templateSub}>
              Get a CSV of every product you sell, pre-filled with current prices &amp; stock.
            </div>
          </div>
          <Button
            variant="secondary"
            icon={<Download size={15} />}
            onClick={download}
            disabled={downloading}
          >
            {downloading ? 'Preparing…' : 'Download CSV'}
          </Button>
        </div>
        <div className={styles.note}>
          <Info size={15} className={styles.noteIcon} />
          <span>
            Edit <code className={styles.col}>reseller_price</code>,{' '}
            <code className={styles.col}>customer_price</code> and{' '}
            <code className={styles.col}>stock_quantity</code> only. Leave{' '}
            <code className={styles.col}>sku</code> and <code className={styles.col}>product_name</code>{' '}
            unchanged — rows are matched by SKU.
          </span>
        </div>
      </Card>

      <Card pad="lg" style={{ marginTop: 16 }}>
        <div className={styles.template}>
          <span className={styles.templateIcon}>
            <UploadCloud size={20} />
          </span>
          <div className={styles.templateBody}>
            <div className={styles.templateTitle}>2 · Upload the edited CSV</div>
            <div className={styles.templateSub}>
              Each row updates your price &amp; stock for that SKU. Blank cells are left unchanged.
            </div>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={onFile}
          style={{ display: 'none' }}
        />
        <button className={styles.dropzone} onClick={() => fileRef.current?.click()} disabled={uploading}>
          <UploadCloud size={28} />
          <div className={styles.dropTitle}>{uploading ? 'Uploading…' : 'Upload your filled CSV'}</div>
          <div className={styles.dropSub}>.csv · header row required</div>
        </button>

        {result && (
          <div className={styles.resultBox}>
            <div className={styles.resultLine}>
              {result.updated} updated · {result.skipped} skipped · {result.total} row
              {result.total === 1 ? '' : 's'}
            </div>
            {result.errors.length > 0 && (
              <>
                <div className={styles.errorHead}>
                  <AlertTriangle size={14} />
                  {result.errors.length} row{result.errors.length === 1 ? '' : 's'} not updated
                </div>
                <ul className={styles.errorList}>
                  {result.errors.map((er, i) => (
                    <li key={`${er.sku}-${i}`} className={styles.errorItem}>
                      <span className={styles.errSku}>{er.sku}</span>
                      <span>{er.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
