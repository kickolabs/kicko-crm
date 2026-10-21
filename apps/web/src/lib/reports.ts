// Reports: a spec (what to count, grouped how, over which period) and the pure
// aggregation. Ready-made reports are preset specs; the builder edits the same spec.

import type { CfDef } from './custom-fields';

export type ReportEntity = 'leads' | 'clients' | 'cases' | 'payments';
export type Measure = 'count' | 'conversion' | 'approval' | 'amount';
export type Period = 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'this_year' | 'last_year' | 'all' | 'custom';

export type ReportSpec = {
  entity: ReportEntity;
  groupBy: string;
  splitBy: string | null;
  measure: Measure;
  period: Period;
  from?: string; // YYYY-MM-DD, for custom
  to?: string;
  /** Cases: which date the period applies to. */
  dateField?: 'created' | 'lodged' | 'decision';
  /** Only rows where dimension = value, e.g. { status: 'OPEN' }. */
  filter?: Record<string, string>;
};

export const ENTITY_LABEL: Record<ReportEntity, string> = { leads: 'Leads', clients: 'Clients', cases: 'Cases', payments: 'Payments' };

/** Built-in dimensions per entity. Custom fields (dropdown, yes/no, text, number) are added as `cf:<key>`. */
export const DIMENSIONS: Record<ReportEntity, { key: string; label: string }[]> = {
  leads: [
    { key: 'source', label: 'Source' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' },
    { key: 'country', label: 'Country of interest' }, { key: 'category', label: 'Visa type' }, { key: 'month', label: 'Month' }, { key: 'week', label: 'Week' },
  ],
  clients: [{ key: 'owner', label: 'Owner' }, { key: 'nationality', label: 'Nationality' }, { key: 'month', label: 'Month' }],
  cases: [
    { key: 'product', label: 'Visa product' }, { key: 'country', label: 'Country' }, { key: 'category', label: 'Visa type' }, { key: 'stage', label: 'Stage' },
    { key: 'status', label: 'Status' }, { key: 'outcome', label: 'Outcome' }, { key: 'owner', label: 'Owner' }, { key: 'month', label: 'Month' },
  ],
  payments: [{ key: 'month', label: 'Month' }, { key: 'method', label: 'Method' }, { key: 'owner', label: 'Client owner' }],
};

export const MEASURES: Record<ReportEntity, { key: Measure; label: string }[]> = {
  leads: [{ key: 'count', label: 'Number of leads' }, { key: 'conversion', label: 'Conversion rate' }],
  clients: [{ key: 'count', label: 'Number of clients' }],
  cases: [{ key: 'count', label: 'Number of cases' }, { key: 'approval', label: 'Approval rate' }],
  payments: [{ key: 'amount', label: 'Amount collected' }, { key: 'count', label: 'Number of payments' }],
};

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' }, { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' }, { key: 'this_year', label: 'This year' }, { key: 'last_year', label: 'Last year' },
  { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom dates' },
];

export const PRESETS: { id: string; name: string; about: string; spec: ReportSpec; billing?: boolean }[] = [
  { id: 'lead-sources', name: 'Which sources bring clients', about: 'Leads by source, and how many became clients', spec: { entity: 'leads', groupBy: 'source', splitBy: null, measure: 'conversion', period: 'last_90' } },
  { id: 'counsellors', name: 'Counsellor performance', about: 'Leads each counsellor has, by status', spec: { entity: 'leads', groupBy: 'owner', splitBy: 'status', measure: 'count', period: 'this_month' } },
  { id: 'leads-monthly', name: 'Leads per month', about: 'New leads each month, by source', spec: { entity: 'leads', groupBy: 'month', splitBy: 'source', measure: 'count', period: 'this_year' } },
  { id: 'approvals', name: 'Visa approval rate', about: 'Decided cases by visa product: approved vs refused', spec: { entity: 'cases', groupBy: 'product', splitBy: null, measure: 'approval', period: 'this_year', dateField: 'decision' } },
  { id: 'pipeline', name: 'Open cases by stage', about: 'Where active cases are right now', spec: { entity: 'cases', groupBy: 'stage', splitBy: null, measure: 'count', period: 'all', filter: { status: 'OPEN' } } },
  { id: 'collections', name: 'Collections by month', about: 'Payments received, by method', spec: { entity: 'payments', groupBy: 'month', splitBy: 'method', measure: 'amount', period: 'this_year' }, billing: true },
];

// ── Periods ─────────────────────────────────────────────────────────────────

/** [from, to) for a period, in UTC days (an agency's day boundary may differ by a few hours). */
export function periodRange(spec: Pick<ReportSpec, 'period' | 'from' | 'to'>, now = new Date()): { from: Date | null; to: Date | null } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const day = Date.UTC(y, m, now.getUTCDate());
  const D = 86400_000;
  switch (spec.period) {
    case 'this_month': return { from: new Date(Date.UTC(y, m, 1)), to: null };
    case 'last_month': return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
    case 'last_30': return { from: new Date(day - 29 * D), to: null };
    case 'last_90': return { from: new Date(day - 89 * D), to: null };
    case 'this_year': return { from: new Date(Date.UTC(y, 0, 1)), to: null };
    case 'last_year': return { from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y, 0, 1)) };
    case 'custom': {
      const f = spec.from && /^\d{4}-\d{2}-\d{2}$/.test(spec.from) ? new Date(`${spec.from}T00:00:00Z`) : null;
      const t = spec.to && /^\d{4}-\d{2}-\d{2}$/.test(spec.to) ? new Date(new Date(`${spec.to}T00:00:00Z`).getTime() + D) : null;
      return { from: f, to: t };
    }
    default: return { from: null, to: null };
  }
}

export const monthKey = (d: Date) => d.toISOString().slice(0, 7); // 2026-03
export function weekKey(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // Monday
  return t.toISOString().slice(0, 10);
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/** One record reduced to what reports need. */
export type Fact = { dims: Record<string, string | null>; amount?: number; won?: boolean; outcome?: string | null };

export type Cell = { n: number; amount: number; won: number; decided: number; approved: number };
export type ReportTable = {
  columns: string[]; // split values (or ['__all'])
  rows: { key: string; cells: Record<string, Cell>; total: Cell }[];
  totals: Record<string, Cell>;
  grand: Cell;
  truncated: boolean;
};

const empty = (): Cell => ({ n: 0, amount: 0, won: 0, decided: 0, approved: 0 });
const add = (c: Cell, f: Fact) => {
  c.n++;
  c.amount += f.amount ?? 0;
  if (f.won) c.won++;
  if (f.outcome === 'APPROVED' || f.outcome === 'REFUSED') c.decided++;
  if (f.outcome === 'APPROVED') c.approved++;
};

const NONE = '__none';
export const ALL = '__all';

export function aggregate(facts: Fact[], spec: Pick<ReportSpec, 'groupBy' | 'splitBy' | 'filter' | 'measure'>, maxRows = 50): ReportTable {
  const rows = new Map<string, { cells: Map<string, Cell>; total: Cell }>();
  const totals = new Map<string, Cell>();
  const grand = empty();
  for (const f of facts) {
    if (spec.filter && Object.entries(spec.filter).some(([k, v]) => (f.dims[k] ?? NONE) !== v)) continue;
    const r = f.dims[spec.groupBy] ?? NONE;
    const c = spec.splitBy ? (f.dims[spec.splitBy] ?? NONE) : ALL;
    let row = rows.get(r);
    if (!row) rows.set(r, (row = { cells: new Map(), total: empty() }));
    let cell = row.cells.get(c);
    if (!cell) row.cells.set(c, (cell = empty()));
    let tot = totals.get(c);
    if (!tot) totals.set(c, (tot = empty()));
    add(cell, f);
    add(row.total, f);
    add(tot, f);
    add(grand, f);
  }
  const score = (c: Cell) => (spec.measure === 'amount' ? c.amount : c.n);
  const time = spec.groupBy === 'month' || spec.groupBy === 'week';
  let list = [...rows.entries()].map(([key, v]) => ({ key, cells: Object.fromEntries(v.cells), total: v.total }));
  list.sort((a, b) => (time ? a.key.localeCompare(b.key) : score(b.total) - score(a.total) || a.key.localeCompare(b.key)));
  const truncated = list.length > maxRows;
  if (truncated) list = list.slice(0, maxRows);
  const columns = [...totals.entries()].sort((a, b) => (spec.splitBy === 'month' ? a[0].localeCompare(b[0]) : score(b[1]) - score(a[1]))).map(([k]) => k);
  return { columns, rows: list, totals: Object.fromEntries(totals), grand, truncated };
}

/** The number shown for a cell, given the measure. Rates are null when there's nothing to divide. */
export function measureValue(c: Cell | undefined, m: Measure): number | null {
  if (!c) return m === 'count' || m === 'amount' ? 0 : null;
  if (m === 'count') return c.n;
  if (m === 'amount') return c.amount;
  if (m === 'conversion') return c.n ? Math.round((c.won / c.n) * 1000) / 10 : null;
  return c.decided ? Math.round((c.approved / c.decided) * 1000) / 10 : null;
}

/** Custom fields that make sense to group by. Numbers and text are grouped by exact value. */
export const groupableCustom = (defs: CfDef[]) => defs.filter((d) => d.type !== 'date');

// ── URL ⇄ spec ──────────────────────────────────────────────────────────────

export function specFromParams(p: Record<string, string | undefined>, fallback: ReportSpec): ReportSpec {
  const entity = (['leads', 'clients', 'cases', 'payments'] as const).find((e) => e === p.e) ?? fallback.entity;
  const sameEntity = entity === fallback.entity;
  const measure = MEASURES[entity].find((m) => m.key === p.m)?.key ?? (sameEntity ? fallback.measure : MEASURES[entity][0]!.key);
  const period = PERIODS.find((x) => x.key === p.p)?.key ?? fallback.period;
  const filter = p.f ? Object.fromEntries(p.f.split(',').map((kv) => kv.split(':') as [string, string]).filter(([k, v]) => k && v)) : sameEntity ? fallback.filter : undefined;
  return {
    entity,
    groupBy: p.g ?? (sameEntity ? fallback.groupBy : DIMENSIONS[entity][0]!.key),
    splitBy: p.s !== undefined ? p.s || null : sameEntity ? fallback.splitBy : null,
    measure,
    period,
    from: p.from,
    to: p.to,
    dateField: (['created', 'lodged', 'decision'] as const).find((d) => d === p.d) ?? (sameEntity ? fallback.dateField : undefined),
    filter,
  };
}

export function specToParams(s: ReportSpec): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      e: s.entity, g: s.groupBy, s: s.splitBy ?? '', m: s.measure, p: s.period, from: s.period === 'custom' ? s.from : undefined, to: s.period === 'custom' ? s.to : undefined,
      d: s.dateField, f: s.filter && Object.keys(s.filter).length ? Object.entries(s.filter).map(([k, v]) => `${k}:${v}`).join(',') : undefined,
    }).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
}

/** CSV of a report table, with labels already applied. */
export function tableCsv(head: string[], body: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...body].map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
