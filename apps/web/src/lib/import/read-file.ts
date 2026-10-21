// Reads a CSV or Excel file in the browser into a header row and text cells.
// Nothing is uploaded: rows go to the server only when the import runs.

import { LIMITS } from './fields';

export type Sheet = { headers: string[]; rows: string[][] };

export class SheetError extends Error {}

const cellText = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v); // phone numbers stored as numbers
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v).trim();
};

function tidy(raw: unknown[][]): Sheet {
  const rows = raw.map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ''));
  const head = rows.shift();
  if (!head) throw new SheetError('The file is empty.');
  // Columns without a header are kept only if they hold data.
  const headers = head.map((h, i) => h || `Column ${i + 1}`);
  const width = Math.max(headers.length, ...rows.slice(0, 200).map((r) => r.length));
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  if (rows.length > LIMITS.rows) throw new SheetError(`The file has ${rows.length.toLocaleString('en-IN')} rows. Import up to ${LIMITS.rows.toLocaleString('en-IN')} at a time: split it into smaller files.`);
  if (!rows.length) throw new SheetError('The file has a header row but no data.');
  return { headers: headers.slice(0, 60), rows: rows.map((r) => Array.from({ length: Math.min(width, 60) }, (_, i) => r[i] ?? '')) };
}

export async function readSpreadsheet(file: File): Promise<Sheet> {
  if (file.size > LIMITS.fileMb * 1024 * 1024) throw new SheetError(`The file is larger than ${LIMITS.fileMb} MB. Split it into smaller files.`);
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) throw new SheetError('Old Excel files (.xls) can’t be read. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV.');
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    try {
      return tidy((await readSheet(file)) as unknown[][]);
    } catch (e) {
      if (e instanceof SheetError) throw e;
      throw new SheetError('This Excel file couldn’t be read. Try saving it again as .xlsx or CSV.');
    }
  }
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    const Papa = (await import('papaparse')).default;
    const res = await new Promise<Papa.ParseResult<string[]>>((resolve, reject) =>
      Papa.parse<string[]>(file, { skipEmptyLines: 'greedy', complete: resolve, error: reject }),
    );
    return tidy(res.data);
  }
  throw new SheetError('Choose a CSV or Excel (.xlsx) file.');
}
