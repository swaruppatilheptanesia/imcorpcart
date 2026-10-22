import type { Response } from 'express';
import ExcelJS from 'exceljs';
import type { AnyReport } from '../registry';
import type { Cell } from '../types';

/**
 * Excel writer — the only file that knows exceljs exists, so it can be swapped
 * without touching a descriptor.
 *
 * Uses the STREAMING workbook writer, which commits rows to the response as
 * they arrive, so memory stays proportional to one page rather than the whole
 * result set. The payoff over CSV is typed cells: prices arrive as numbers
 * Excel can sum rather than text it right-aligns and refuses to total.
 */

/** Excel's hard limit is 32,767 characters; Description and Specification can exceed it. */
const MAX_CELL = 32_000;

function clamp(v: Cell): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  return v.length > MAX_CELL ? v.slice(0, MAX_CELL - 1) + '…' : v;
}

export async function writeXlsx(
  res: Response,
  report: AnyReport,
  pages: AsyncGenerator<unknown[], void, void>,
): Promise<number> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
  // `views` has to be passed at creation: on a streaming WorksheetWriter it is
  // a getter-only property, and assigning to it throws under strict mode (which
  // compiled TypeScript always is). Excel caps sheet names at 31 characters.
  const ws = wb.addWorksheet(report.title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Columns carry width and number format only — the header row is written
  // explicitly below so it can be styled before being committed. A streaming
  // worksheet commits rows as they are added, so row 1 cannot be restyled later.
  ws.columns = report.columns.map((c) => ({
    key: c.key,
    width: c.width ?? 18,
    ...(c.numFmt ? { style: { numFmt: c.numFmt } } : {}),
  }));

  const head = ws.addRow(report.columns.map((c) => c.header));
  head.font = { bold: true };
  head.commit();

  let rows = 0;
  for await (const page of pages) {
    for (const row of page) {
      ws.addRow(report.columns.map((c) => clamp(c.accessor(row)))).commit();
      rows += 1;
    }
  }

  ws.commit();
  await wb.commit();
  return rows;
}
