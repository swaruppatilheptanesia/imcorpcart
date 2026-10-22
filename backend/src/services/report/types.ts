import type { ZodType } from 'zod';

/**
 * The report contract.
 *
 * One descriptor per report. The SAME `columns` array renders the CSV, the
 * Excel sheet and the on-screen preview, and the SAME `fetch` generator feeds
 * all three — so the file a client opens and the table an admin previewed
 * cannot disagree about a value. Adding a sixth report is one file under
 * `reports/` plus one line in `registry.ts`; no endpoint, writer or frontend
 * change.
 */

/** A rendered cell. Accessors resolve Decimals and Dates themselves. */
export type Cell = string | number | null;

export interface ReportColumn<Row> {
  /** Machine key — also the preview table's React key. */
  key: string;
  /** Header text, written to row 1 of the file and the table head. */
  header: string;
  accessor: (row: Row) => Cell;
  /** Excel-only hints; the CSV writer ignores them. */
  width?: number;
  numFmt?: string;
}

/** Filter controls, declared server-side so the screen stays report-agnostic. */
export type FilterFieldDef =
  // `defaultValue` is the report's own opinion about its period. It matters:
  // a catalogue defaulting to "added this month" shows 3 of 718 products and
  // reads as a bug, while an orders export defaulting to all time is a needless
  // full-table scan.
  | { kind: 'period'; key: string; label: string; defaultValue: string }
  | {
      kind: 'select';
      key: string;
      label: string;
      options: { value: string; label: string }[];
      allLabel?: string;
    };

export interface ReportContext {
  actorId: string;
}

export interface ReportDescriptor<Filters, Row> {
  id: ReportId;
  title: string;
  description: string;
  /** Download filename stem: `<fileStem>-2026-10-22.xlsx`. */
  fileStem: string;
  /** One schema serves preview and download alike. */
  filterSchema: ZodType<Filters>;
  /** Static, or resolved at catalogue time (e.g. the vendor dropdown). */
  filterFields: FilterFieldDef[] | (() => Promise<FilterFieldDef[]>);
  columns: ReportColumn<Row>[];
  /** Exact number of rows `fetch` will emit, for the pre-flight cap check. */
  count(filters: Filters, ctx: ReportContext): Promise<number>;
  /** Yields pages of already-flattened rows. Owns its own queries and cursor. */
  fetch(filters: Filters, ctx: ReportContext): AsyncGenerator<Row[], void, void>;
  /** Overrides REPORT.rowCap for this report. */
  maxRows?: number;
}

export type ReportId =
  | 'ORDERS_ADMIN'
  | 'ORDERS_RESELLER'
  | 'PRODUCTS'
  | 'USERS'
  | 'RESELLERS';

/** Keeps inference at the definition site; the registry erases it exactly once. */
export function defineReport<F, R>(d: ReportDescriptor<F, R>): ReportDescriptor<F, R> {
  return d;
}

// ── Shared cell formatting ───────────────────────────────────────────────────

/** `22-10-2026`, the form the client's existing sheets use. */
export function fmtDate(d: Date | null | undefined): string {
  if (!d) return '';
  const ist = new Date(d.getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(ist.getUTCDate())}-${p(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()}`;
}

export const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');

/** Join a list into one cell, the pipe convention the bulk sheet already uses. */
export const joinCell = (xs: (string | null | undefined)[]): string =>
  xs.filter((x): x is string => !!x && x.trim().length > 0).join(' | ');
