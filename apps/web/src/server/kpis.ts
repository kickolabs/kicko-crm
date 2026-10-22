import 'server-only';
import { can } from '@/lib/permissions';
import { db, type Ctx } from '@/lib/tenant';

// Eight-week trends behind the dashboard's number tiles. Weeks are rolling 7-day
// windows ending now, oldest first; the last point is "this week".

export const WEEKS = 8;
const DAY = 86400_000;

export type Trend = { points: (number | null)[]; labels: string[] };

/** Pure: the week each point ends on, oldest first. */
export function weekEnds(now: Date, weeks = WEEKS) {
  return Array.from({ length: weeks }, (_, i) => new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY));
}

const inWeek = (t: Date | null | undefined, end: Date) => Boolean(t && t.getTime() > end.getTime() - 7 * DAY && t.getTime() <= end.getTime());
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** Pure: per-week series from raw rows (exported for tests). */
export function buildTrends(
  rows: {
    leads: { createdAt: Date }[];
    closedLeads: { status: string; updatedAt: Date }[];
    cases: { createdAt: Date; status: string; outcome: string | null; decisionAt: Date | null; updatedAt: Date; lodgedAt: Date | null }[];
    payments: { paidAt: Date; amount: number }[] | null;
  },
  now: Date,
  tz: string,
) {
  const ends = weekEnds(now);
  const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: tz });
  const labels = ends.map((e) => `Week to ${fmt.format(e)}`);
  const closedAt = (c: (typeof rows.cases)[number]) => (c.status === 'CLOSED' ? (c.decisionAt ?? c.updatedAt) : null);

  const series = {
    newLeads: ends.map((e) => rows.leads.filter((l) => inWeek(l.createdAt, e)).length),
    // Won vs lost over the 30 days to each week's end.
    conversion: ends.map((e) => {
      const window = rows.closedLeads.filter((l) => l.updatedAt <= e && l.updatedAt.getTime() > e.getTime() - 30 * DAY);
      return pct(window.filter((l) => l.status === 'WON').length, window.length);
    }),
    // Open at each week's end: created by then, not yet closed by then.
    activeCases: ends.map((e) => rows.cases.filter((c) => c.createdAt <= e && !(closedAt(c) && closedAt(c)! <= e)).length),
    lodged: ends.map((e) => rows.cases.filter((c) => inWeek(c.lodgedAt, e)).length),
    // Approved vs refused (withdrawn left out) over the 90 days to each week's end.
    approval: ends.map((e) => {
      const decided = rows.cases.filter((c) => c.decisionAt && c.decisionAt <= e && c.decisionAt.getTime() > e.getTime() - 90 * DAY && (c.outcome === 'APPROVED' || c.outcome === 'REFUSED'));
      return pct(decided.filter((c) => c.outcome === 'APPROVED').length, decided.length);
    }),
    collected: rows.payments ? ends.map((e) => rows.payments!.filter((p) => inWeek(p.paidAt, e)).reduce((s, p) => s + p.amount, 0)) : null,
  };
  const decisions90 = rows.cases.filter((c) => c.decisionAt && c.decisionAt.getTime() > now.getTime() - 90 * DAY && (c.outcome === 'APPROVED' || c.outcome === 'REFUSED'));
  const trend = (points: (number | null)[]): Trend => ({ points, labels });
  return {
    newLeads: trend(series.newLeads),
    conversion: trend(series.conversion),
    activeCases: trend(series.activeCases),
    lodged: trend(series.lodged),
    approval: { ...trend(series.approval), rate: series.approval.at(-1) ?? null, decisions: decisions90.length },
    collected: series.collected ? trend(series.collected) : null,
    openedThisWeek: rows.cases.filter((c) => inWeek(c.createdAt, now)).length,
  };
}

export function getKpiTrends(ctx: Ctx, now = new Date()) {
  const since = new Date(now.getTime() - (WEEKS * 7 + 90) * DAY);
  const billing = can(ctx.role, 'billing.read');
  return db(ctx, async (tx) => {
    const [leads, closedLeads, cases, payments] = await Promise.all([
      tx.lead.findMany({ where: { createdAt: { gt: new Date(now.getTime() - WEEKS * 7 * DAY) } }, select: { createdAt: true } }),
      tx.lead.findMany({ where: { status: { in: ['WON', 'LOST'] }, updatedAt: { gt: since } }, select: { status: true, updatedAt: true } }),
      tx.case.findMany({
        where: { OR: [{ status: { not: 'CLOSED' } }, { updatedAt: { gt: since } }, { decisionAt: { gt: since } }] },
        select: { createdAt: true, status: true, outcome: true, decisionAt: true, updatedAt: true, lodgedAt: true },
      }),
      billing ? tx.payment.findMany({ where: { paidAt: { gt: new Date(now.getTime() - WEEKS * 7 * DAY) } }, select: { paidAt: true, amount: true } }) : null,
    ]);
    return buildTrends({ leads, closedLeads, cases, payments }, now, ctx.tenant.timezone);
  });
}
