import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { Button, Card, EmptyState, Segmented, Skeleton, Spinner, useToast } from '@/components';
import {
  getReportCatalogue,
  getReportPreview,
  downloadReport,
  type ReportFilterValues,
  type ReportFormat,
} from '@/data/api';
import { useAsync } from '@/lib/useAsync';
import { useSA } from '../context';
import { ReportFilters } from './reports/ReportFilters';
import { ReportPreview } from './reports/ReportPreview';
import s from './screen.module.css';
import styles from './reports/reports.module.css';

const PREVIEW_LIMIT = 50;

/** The admin Topbar's 7D/30D/QTD/YTD control maps onto the report periods. */
const RANGE_TO_PERIOD: Record<string, string> = {
  '7D': 'WEEK',
  '30D': 'MONTH',
  QTD: 'QUARTER',
  YTD: 'YEAR',
};

/**
 * Reports.
 *
 * Entirely data-driven off `GET /reports`: the report list, every column and
 * every filter control come from the server, so adding a sixth report touches
 * no file in this folder.
 */
export function Reports() {
  const { flash } = useToast();
  const { dateRange } = useSA();

  const { data: catalogue, state: catState, error, reload } = useAsync(() => getReportCatalogue(), []);
  const [id, setId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReportFilterValues>({});
  const [debounced, setDebounced] = useState<ReportFilterValues>({});
  const [busy, setBusy] = useState<ReportFormat | null>(null);

  const report = useMemo(
    () => catalogue?.find((r) => r.id === id) ?? catalogue?.[0] ?? null,
    [catalogue, id],
  );

  // Seed the filters from the report's own defaults whenever the report
  // changes, taking the period from the range control the Topbar already shows.
  useEffect(() => {
    if (!report) return;
    const seeded: ReportFilterValues = {};
    for (const f of report.filterFields) {
      if (f.kind !== 'period') {
        seeded[f.key] = 'all';
        continue;
      }
      // A report that wants all time gets all time: the Topbar's range applies
      // only where the report is genuinely date-scoped, so the Products
      // catalogue does not open filtered to "added this month".
      seeded[f.key] =
        f.defaultValue === 'ALL' ? 'ALL' : (RANGE_TO_PERIOD[dateRange] ?? f.defaultValue ?? 'MONTH');
    }
    setFilters(seeded);
  }, [report?.id, dateRange]);

  // The preview re-runs an exact COUNT, so don't fire it on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(filters), 400);
    return () => clearTimeout(t);
  }, [filters]);

  const { data: preview, state: prevState } = useAsync(
    () => (report ? getReportPreview(report.id, debounced) : Promise.resolve(null)),
    [report?.id, JSON.stringify(debounced)],
  );

  const download = async (format: ReportFormat) => {
    if (!report) return;
    setBusy(format);
    try {
      await downloadReport(report.id, format, debounced, report.fileStem);
      flash(`${format === 'CSV' ? 'CSV' : 'Excel'} downloaded`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  if (catState === 'loading') {
    return (
      <div className={s.wide} style={{ display: 'grid', gap: 12 }}>
        <Skeleton h={48} />
        <Skeleton h={320} />
      </div>
    );
  }
  if (catState === 'error' || !catalogue || !report) {
    return (
      <EmptyState
        tone="error"
        icon={<AlertTriangle size={24} />}
        title="Couldn't load reports"
        body={error ?? 'Something went wrong.'}
        action={{ label: 'Retry', onClick: reload }}
      />
    );
  }

  const blocked = preview?.overCap ?? false;

  return (
    <div className={s.wide}>
      <div className={styles.bar}>
        <Segmented
          options={catalogue.map((r) => ({ value: r.id, label: r.title }))}
          value={report.id}
          onChange={(v) => setId(v)}
        />
      </div>

      <Card pad="lg">
        <div className={s.sectionTitle}>{report.title}</div>
        <p className={styles.desc}>{report.description}</p>

        <div className={styles.bar}>
          <ReportFilters
            fields={report.filterFields}
            values={filters}
            onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          />
          <div className={styles.spacer} />
          <Button
            variant="secondary"
            icon={busy === 'CSV' ? <Spinner size={14} /> : <FileText size={15} />}
            disabled={!!busy || blocked}
            onClick={() => download('CSV')}
          >
            {busy === 'CSV' ? 'Preparing…' : 'Download CSV'}
          </Button>
          <Button
            icon={busy === 'XLSX' ? <Spinner size={14} /> : <FileSpreadsheet size={15} />}
            disabled={!!busy || blocked}
            onClick={() => download('XLSX')}
          >
            {busy === 'XLSX' ? 'Preparing…' : 'Download Excel'}
          </Button>
        </div>

        {blocked && preview && (
          // Said before the click, not after: the server refuses an over-cap
          // export outright rather than sending a half file.
          <p className={styles.overCap}>
            This selection has {preview.total.toLocaleString('en-IN')} rows; the export limit is{' '}
            {preview.cap.toLocaleString('en-IN')}. Narrow the date range or add a filter.
          </p>
        )}

        {prevState === 'loading' && <Skeleton h={260} />}
        {prevState !== 'loading' && preview && preview.rows.length === 0 && (
          <EmptyState
            icon={<Download size={24} />}
            title="Nothing to report"
            body="No rows match these filters. Try a wider date range."
          />
        )}
        {prevState !== 'loading' && preview && preview.rows.length > 0 && (
          <ReportPreview preview={preview} limit={PREVIEW_LIMIT} />
        )}
      </Card>
    </div>
  );
}
