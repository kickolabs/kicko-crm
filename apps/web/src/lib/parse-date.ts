// Dates as people type them in spreadsheets and forms.

export type DateOrder = 'DMY' | 'MDY';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function ymd(y: number, m: number, d: number) {
  if (y < 100) y += y < 50 ? 2000 : 1900;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return dt;
}

/** Parse a date cell: ISO, 12/03/2024 (by `order`), 12-Mar-2024, Mar 12 2024, or an Excel serial number. */
export function parseDate(raw: string, order: DateOrder = 'DMY'): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?: .*)?$/);
  if (m) return order === 'DMY' ? ymd(+m[3]!, +m[2]!, +m[1]!) : ymd(+m[3]!, +m[1]!, +m[2]!);
  m = s.match(/^(\d{1,2})[-\s/]([a-z]{3})[a-z]*[-\s/,]+(\d{2,4})$/i);
  if (m && MONTHS.includes(m[2]!.toLowerCase())) return ymd(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase()) + 1, +m[1]!);
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m && MONTHS.includes(m[1]!.toLowerCase())) return ymd(+m[3]!, MONTHS.indexOf(m[1]!.toLowerCase()) + 1, +m[2]!);
  // Excel stores dates as days since 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20_000 && n < 80_000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400_000);
  }
  return null;
}
