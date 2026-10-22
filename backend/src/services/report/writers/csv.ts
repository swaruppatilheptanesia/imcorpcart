import type { Response } from 'express';
import { once } from 'events';
import type { AnyReport } from '../registry';
import type { Cell } from '../types';

/**
 * CSV writer.
 *
 * Hand-rolled rather than a dependency: it is ~30 lines, and the quoting has to
 * match `frontend/src/lib/csv.ts` exactly. That file's own header comment
 * records what happens when two CSV implementations drift — our downloaded
 * sheets quote product names containing commas, and a parser that splits on
 * every comma shifted every later column and silently applied nothing.
 */

/** Quote only when the value needs it, escaping `"` as `""` — as lib/csv.ts does. */
function quote(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Neutralise spreadsheet formulas.
 *
 * Product names, descriptions, POD notes and delivery addresses are all
 * user-authored, and these files are opened in Excel by definition. A cell
 * starting `=`, `+`, `-` or `@` is executed as a formula on open, so a crafted
 * product name becomes code running on an admin's machine. A leading apostrophe
 * makes Excel treat it as literal text.
 */
function deFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  return quote(deFormula(String(v)));
}

/** Backpressure-aware write: a 50k-row file must not buffer in memory. */
async function push(res: Response, chunk: string): Promise<void> {
  if (!res.write(chunk)) await once(res, 'drain');
}

export async function writeCsv(
  res: Response,
  report: AnyReport,
  pages: AsyncGenerator<unknown[], void, void>,
): Promise<number> {
  // UTF-8 BOM: without it Excel on Windows mis-decodes ₹ and non-ASCII names.
  await push(res, '﻿' + report.columns.map((c) => csvCell(c.header)).join(',') + '\r\n');

  let rows = 0;
  for await (const page of pages) {
    let buf = '';
    for (const row of page) {
      buf += report.columns.map((c) => csvCell(c.accessor(row))).join(',') + '\r\n';
      rows += 1;
    }
    await push(res, buf);
  }
  return rows;
}
