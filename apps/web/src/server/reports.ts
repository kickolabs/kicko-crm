import 'server-only';
import type { Prisma } from '@kicko/db';
import type { Stage } from '@kicko/db/visa-catalog';
import { z } from 'zod';
import { CATEGORY_LABEL, COUNTRIES, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL } from '@/lib/constants';
import { cfDisplay, type CfDef, type CfValues } from '@/lib/custom-fields';
import { aggregate, DIMENSIONS, MEASURES, monthKey, periodRange, weekKey, type Fact, type ReportEntity, type ReportSpec } from '@/lib/reports';
import { prisma } from '@kicko/db';
import { listFields } from './custom-fields';
import { inTenant, UserError, type Scope } from './scope';

// Runs a report spec: fetches only the columns it needs for the period, reduces each
// record to a Fact, aggregates, and returns labels for every value shown.

const MAX_RECORDS = 200_000;

export const METHOD_LABEL: Record<string, string> = { UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', RAZORPAY: 'Razorpay', OTHER: 'Other' };
const CASE_STATUS: Record<string, string> = { OPEN: 'Open', ON_HOLD: 'On hold', CLOSED: 'Closed' };
const OUTCOME: Record<string, string> = { APPROVED: 'Approved', REFUSED: 'Refused', WITHDRAWN: 'Withdrawn' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const range = (from: Date | null, to: Date | null) => (from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } : undefined);

function cfDims(values: unknown, defs: CfDef[]) {
  const v = (values ?? {}) as CfValues;
  return Object.fromEntries(defs.map((d) => [`cf:${d.key}`, v[d.key] === undefined ? null : String(v[d.key])]));
}

export async function runReport(scope: Scope, spec: ReportSpec, opts: { billing: boolean }) {
  if (spec.entity === 'payments' && !opts.billing) throw new UserError('Payment reports need billing access');
  const defs = spec.entity === 'payments' ? [] : ((await listFields(scope, spec.entity)) as CfDef[]);
  const dims = [...DIMENSIONS[spec.entity].map((d) => d.key), ...defs.filter((d) => d.type !== 'date').map((d) => `cf:${d.key}`)];
  if (!dims.includes(spec.groupBy) || (spec.splitBy && !dims.includes(spec.splitBy))) throw new UserError('Pick what to group by');
  if (!MEASURES[spec.entity].some((m) => m.key === spec.measure)) throw new UserError('Pick what to measure');
  const { from, to } = periodRange(spec);
  const when = range(from, to);
  const time = (d: Date) => ({ month: monthKey(d), week: weekKey(d) });

  const { facts, extra } = await inTenant(scope, async (tx) => {
    const extra: { products: { id: string; name: string; country: string; stages: Stage[] }[] } = { products: [] };
    let facts: Fact[] = [];
    if (spec.entity === 'leads') {
      const rows = await tx.lead.findMany({
        where: when ? { createdAt: when } : {},
        select: { source: true, status: true, ownerId: true, interestCountry: true, interestCategory: true, createdAt: true, clientId: true, customFields: true },
        take: MAX_RECORDS,
      });
      facts = rows.map((r) => ({
        dims: { source: r.source, status: r.status, owner: r.ownerId, country: r.interestCountry, category: r.interestCategory, ...time(r.createdAt), ...cfDims(r.customFields, defs) },
        won: r.status === 'WON' || r.clientId !== null,
      }));
    } else if (spec.entity === 'clients') {
      const rows = await tx.client.findMany({ where: when ? { createdAt: when } : {}, select: { ownerId: true, nationality: true, createdAt: true, customFields: true }, take: MAX_RECORDS });
      facts = rows.map((r) => ({ dims: { owner: r.ownerId, nationality: r.nationality, ...time(r.createdAt), ...cfDims(r.customFields, defs) } }));
    } else if (spec.entity === 'cases') {
      const field = spec.dateField === 'lodged' ? 'lodgedAt' : spec.dateField === 'decision' ? 'decisionAt' : 'createdAt';
      const rows = await tx.case.findMany({
        where: when ? ({ [field]: when } as Prisma.CaseWhereInput) : {},
        select: { productId: true, stageKey: true, status: true, outcome: true, ownerId: true, createdAt: true, lodgedAt: true, decisionAt: true, customFields: true, product: { select: { country: true, category: true } } },
        take: MAX_RECORDS,
      });
      facts = rows.map((r) => {
        const d = (field === 'lodgedAt' ? r.lodgedAt : field === 'decisionAt' ? r.decisionAt : r.createdAt) ?? r.createdAt;
        return {
          dims: { product: r.productId, country: r.product.country, category: r.product.category, stage: r.stageKey, status: r.status, outcome: r.outcome, owner: r.ownerId, ...time(d), ...cfDims(r.customFields, defs) },
          outcome: r.outcome,
        };
      });
      extra.products = (await tx.visaProduct.findMany({ select: { id: true, name: true, country: true, stages: true } })).map((p) => ({ ...p, stages: p.stages as Stage[] }));
    } else {
      const rows = await tx.payment.findMany({ where: when ? { paidAt: when } : {}, select: { amount: true, method: true, paidAt: true, client: { select: { ownerId: true } } }, take: MAX_RECORDS });
      facts = rows.map((r) => ({ dims: { method: r.method, owner: r.client.ownerId, ...time(r.paidAt) }, amount: r.amount }));
    }
    return { facts, extra };
  });

  const table = aggregate(facts, spec);
  // Pipeline-like values read best in their natural order, not by size.
  const order = (dim: string | null): string[] | null => {
    if (dim === 'status') return spec.entity === 'cases' ? ['OPEN', 'ON_HOLD', 'CLOSED'] : ['NEW', 'CONTACTED', 'QUALIFIED', 'CONSULT_BOOKED', 'WON', 'LOST'];
    if (dim === 'outcome') return ['APPROVED', 'REFUSED', 'WITHDRAWN'];
    if (dim === 'stage') {
      const pos = new Map<string, number>();
      for (const p of extra.products) p.stages.forEach((s, i) => pos.set(s.key, Math.min(pos.get(s.key) ?? i, i)));
      return [...pos.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    }
    return null;
  };
  const byOrder = (list: string[]) => (a: string, b: string) => (list.indexOf(a) === -1 ? 999 : list.indexOf(a)) - (list.indexOf(b) === -1 ? 999 : list.indexOf(b));
  const rowOrder = order(spec.groupBy);
  if (rowOrder) table.rows.sort((a, b) => byOrder(rowOrder)(a.key, b.key));
  const colOrder = order(spec.splitBy);
  if (colOrder) table.columns.sort(byOrder(colOrder));

  // Labels for every value that appears.
  const members = await inTenant(scope, (tx) => tx.membership.findMany({ select: { userId: true } }));
  const users = await prisma.user.findMany({ where: { id: { in: members.map((m) => m.userId) } }, select: { id: true, name: true } });
  const stageName = new Map<string, string>();
  for (const p of extra.products) for (const s of p.stages) if (!stageName.has(s.key)) stageName.set(s.key, s.name);
  const label = (dim: string | null, value: string): string => {
    if (value === '__all') return 'Total';
    if (value === '__none') return dim === 'owner' ? 'Unassigned' : '(none)';
    if (dim?.startsWith('cf:')) {
      const def = defs.find((d) => `cf:${d.key}` === dim);
      return def?.type === 'yesno' ? (value === 'true' ? 'Yes' : 'No') : def ? cfDisplay(def, def.type === 'number' ? Number(value) : value) : value;
    }
    switch (dim) {
      case 'source': return LEAD_SOURCE_LABEL[value as keyof typeof LEAD_SOURCE_LABEL] ?? value;
      case 'status': return spec.entity === 'cases' ? CASE_STATUS[value] ?? value : LEAD_STATUS_LABEL[value as keyof typeof LEAD_STATUS_LABEL] ?? value;
      case 'owner': return users.find((u) => u.id === value)?.name ?? 'Former member';
      case 'country': case 'nationality': return COUNTRIES[value] ?? value;
      case 'category': return CATEGORY_LABEL[value as keyof typeof CATEGORY_LABEL] ?? value;
      case 'month': return `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
      case 'week': {
        const d = new Date(`${value}T00:00:00Z`);
        return `Week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
      }
      case 'product': {
        const p = extra.products.find((x) => x.id === value);
        return p ? `${COUNTRIES[p.country] ?? p.country} · ${p.name}` : value;
      }
      case 'stage': return stageName.get(value) ?? value;
      case 'outcome': return OUTCOME[value] ?? value;
      case 'method': return METHOD_LABEL[value] ?? value;
      default: return value;
    }
  };
  return {
    table,
    rowLabels: Object.fromEntries(table.rows.map((r) => [r.key, label(spec.groupBy, r.key)])),
    columnLabels: Object.fromEntries(table.columns.map((c) => [c, label(spec.splitBy, c)])),
    customDims: defs.filter((d) => d.type !== 'date').map((d) => ({ key: `cf:${d.key}`, label: d.label })),
    capped: facts.length >= MAX_RECORDS,
  };
}

// ── Saved reports ───────────────────────────────────────────────────────────

const specSchema = z.object({
  entity: z.enum(['leads', 'clients', 'cases', 'payments']),
  groupBy: z.string().max(60),
  splitBy: z.string().max(60).nullable(),
  measure: z.enum(['count', 'conversion', 'approval', 'amount']),
  period: z.enum(['this_month', 'last_month', 'last_30', 'last_90', 'this_year', 'last_year', 'all', 'custom']),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  dateField: z.enum(['created', 'lodged', 'decision']).optional(),
  filter: z.record(z.string().max(60), z.string().max(100)).optional(),
});

export const listSavedReports = (scope: Scope) => inTenant(scope, (tx) => tx.savedReport.findMany({ orderBy: { name: 'asc' } }));

export async function saveReport(scope: Scope, name: string, spec: unknown) {
  const n = z.string().trim().min(1, 'Name the report').max(80).parse(name);
  const s = specSchema.parse(spec);
  return inTenant(scope, async (tx) => {
    if ((await tx.savedReport.count()) >= 100) throw new UserError('Up to 100 saved reports');
    return tx.savedReport.create({ data: { tenantId: scope.tenantId, name: n, spec: s, createdById: scope.actorId } });
  });
}

export const deleteSavedReport = (scope: Scope, id: string) => inTenant(scope, (tx) => tx.savedReport.delete({ where: { id } }));
