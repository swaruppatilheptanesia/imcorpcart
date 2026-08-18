import { useState } from 'react';
import { FileBarChart, FileText, FileSpreadsheet } from 'lucide-react';
import { Card, Button, Spinner, useToast } from '@/components';
import { reportDefs, exportReport } from '@/data/api';
import s from './screen.module.css';
import styles from './Reports.module.css';

// Fixture report id → API report type.
const REPORT_TYPE: Record<string, string> = {
  profit: 'PROFITABILITY',
  volume: 'VOLUME_VALUE',
  perf: 'PARTNER_PERFORMANCE',
  company: 'COMPANY_SPEND',
};

export function Reports() {
  const { flash } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const generate = async (id: string, kind: 'CSV' | 'PDF') => {
    const key = `${id}-${kind}`;
    setBusy(key);
    try {
      const rec = await exportReport(REPORT_TYPE[id] ?? id, kind);
      flash(rec.fileUrl ? `${kind} ready: ${rec.fileUrl}` : `${kind} export queued`);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.grid2}>
      {reportDefs.map((rep) => (
        <Card key={rep.id} pad="lg" className={styles.card}>
          <span className={styles.icon}>
            <FileBarChart size={20} />
          </span>
          <div className={styles.title}>{rep.title}</div>
          <div className={styles.range}>{rep.range}</div>
          <div className={styles.desc}>{rep.desc}</div>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              icon={busy === `${rep.id}-CSV` ? <Spinner size={14} /> : <FileSpreadsheet size={15} />}
              disabled={busy === `${rep.id}-CSV`}
              onClick={() => generate(rep.id, 'CSV')}
            >
              {busy === `${rep.id}-CSV` ? 'Generating…' : 'Export CSV'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={busy === `${rep.id}-PDF` ? <Spinner size={14} /> : <FileText size={15} />}
              disabled={busy === `${rep.id}-PDF`}
              onClick={() => generate(rep.id, 'PDF')}
            >
              {busy === `${rep.id}-PDF` ? 'Generating…' : 'Export PDF'}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
