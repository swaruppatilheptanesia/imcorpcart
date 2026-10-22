import { DataTable, Row } from '@/components';
import type { ReportPreview as Preview } from '@/data/api';
import styles from './reports.module.css';

/**
 * The preview table, built entirely from the server's column list.
 *
 * These rows come from the SAME endpoint and the same generator as the
 * downloaded file, so what is on screen and what lands in Excel cannot drift.
 * Reports are wide (Products has 22 columns), so the grid scrolls horizontally
 * rather than crushing columns to nothing.
 */
export function ReportPreview({ preview, limit }: { preview: Preview; limit: number }) {
  const cols = preview.columns.map(() => 'minmax(140px, 1fr)').join(' ');
  const shown = preview.rows.length;

  return (
    <div className={styles.tableScroll}>
      <div style={{ minWidth: preview.columns.length * 150 }}>
        <DataTable
          cols={cols}
          headers={preview.columns.map((c) => c.header)}
          footer={
            <span>
              Showing {shown} of {preview.total.toLocaleString('en-IN')} rows
              {preview.total > limit ? ' — the download contains all of them' : ''}
            </span>
          }
        >
          {preview.rows.map((row, i) => (
            <Row key={i} cols={cols}>
              {row.map((cell, c) => (
                <span key={preview.columns[c].key} className={styles.cell} title={cell == null ? '' : String(cell)}>
                  {cell === null || cell === '' ? '—' : String(cell)}
                </span>
              ))}
            </Row>
          ))}
        </DataTable>
      </div>
    </div>
  );
}
