// Small CSV helpers for the reseller bulk stock/price round-trip. No dependency.

/**
 * Parse CSV text into row objects keyed by the header row. Handles quoted fields
 * (with escaped `""`) and commas inside quotes. Columns named in `numericCols`
 * are coerced to numbers; empty cells are omitted so partial updates stay partial.
 */
export function parseCsv(text: string, numericCols: Set<string> = new Set()): Record<string, unknown>[] {
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
      row[h] = numericCols.has(h) ? Number(v) : v;
    });
    return row;
  });
}

/** Quote a single CSV cell only when it needs it. */
function cell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text from a header row + data rows. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
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
