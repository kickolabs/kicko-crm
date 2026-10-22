// Calendar maths on local calendar dates ("2026-10-22"), independent of time zone:
// the page converts to instants with the agency's zone only at the edges.

export type CalView = 'day' | 'week' | 'month';

const toDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);

export const isYmd = (s: string | undefined): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDate(s).getTime()));

export function addDays(ymd: string, n: number) {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYmd(d);
}

export function addMonths(ymd: string, n: number) {
  const d = toDate(ymd);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toYmd(d);
}

/** Monday of the week containing `ymd`. */
export const weekStart = (ymd: string) => addDays(ymd, -((toDate(ymd).getUTCDay() + 6) % 7));

/** The days a view shows: one, seven, or whole weeks covering the month (Monday first). */
export function viewDays(view: CalView, ymd: string) {
  if (view === 'day') return [ymd];
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => addDays(weekStart(ymd), i));
  const first = `${ymd.slice(0, 7)}-01`;
  const start = weekStart(first);
  const next = addMonths(first, 1);
  const days: string[] = [];
  for (let d = start; d < next || days.length % 7; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Where "previous / next" goes from a date in a view. */
export const step = (view: CalView, ymd: string, dir: 1 | -1) => (view === 'month' ? addMonths(ymd, dir) : addDays(ymd, dir * (view === 'week' ? 7 : 1)));

export type Placed<T> = T & { col: number; cols: number };

/**
 * Side-by-side columns for overlapping events in one day (minutes from midnight).
 * Events that overlap, directly or through a chain, share the width equally.
 */
export function layoutDay<T extends { start: number; end: number }>(events: T[]): Placed<T>[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let colEnds: number[] = [];
  let groupEnd = -1;
  const flush = () => {
    for (const e of group) e.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds = [];
  };
  for (const e of sorted) {
    if (e.start >= groupEnd && group.length) flush();
    let col = colEnds.findIndex((end) => end <= e.start);
    if (col < 0) col = colEnds.length;
    colEnds[col] = Math.max(e.end, e.start + 15);
    groupEnd = Math.max(groupEnd, colEnds[col]!);
    group.push({ ...e, col, cols: 1 });
  }
  if (group.length) flush();
  return out;
}
