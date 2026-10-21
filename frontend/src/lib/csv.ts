// Small CSV helpers, shared by every admin/reseller sheet round-trip. No dependency.
//
// One splitter serves them all. They had drifted — the vendor discount sheet
// split on every comma while the product sheet honoured quotes, so a product
// name containing a comma (which our own downloaded sheets quote) shifted every
// later column and the upload silently applied nothing.

/** Split one CSV line, honouring "quoted, fields" and `""` escapes. */
export function splitCsvLine(line: string): string[] {
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
}

/**
 * Parse a sheet into its header row plus raw cells, blank cells included.
 *
 * Use this where "present but blank" has to stay distinguishable from absent —
 * every importer here reads a blank cell as *leave this field alone*, which is
 * only expressible if the cell survives parsing. `parseCsv` below drops blanks
 * instead, which suits the reseller round-trip it was written for.
 */
export function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return { headers: [], rows: [] };
  return { headers: splitCsvLine(lines[0]), rows: lines.slice(1).map(splitCsvLine) };
}

/**
 * Parse CSV text into row objects keyed by the header row. Columns named in
 * `numericCols` are coerced to numbers; empty cells are omitted so partial
 * updates stay partial — use `parseCsvTable` where a blank cell must survive.
 */
export function parseCsv(text: string, numericCols: Set<string> = new Set()): Record<string, unknown>[] {
  const { headers, rows } = parseCsvTable(text);
  return rows.map((cells) => {
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      const v = cells[i] ?? '';
      if (v === '') return;
      row[h] = numericCols.has(h) ? Number(v) : v;
    });
    return row;
  });
}

/** Quote a single CSV cell only when it needs it. */
export function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from a header row + data rows. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
