import Link from 'next/link';
import { Card, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import { fmtDate, relative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { DAY, PLANS, STATUS_LABEL, type PlanId, type SubStatus } from '@/lib/plans';
import { FOUNDING_SLOTS, listAgencies, overview, recentAdminActions, type AgencyRow } from '@/server/admin';
import { AgencyTable, type Row } from './agency-table';
import { ACTION_LABEL, STATUS_TONE, describeAction } from './labels';

export const metadata = { title: 'Agencies' };

const TZ = 'Asia/Kolkata';

function planText(r: AgencyRow, now: Date) {
  const s = r.sub;
  if (!s) return '—';
  if (s.status === 'trialing' && s.trialEndsAt) {
    const days = Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / DAY);
    return days > 0 ? `Trial · ${days} day${days === 1 ? '' : 's'} left` : 'Trial · ended';
  }
  const plan = PLANS[s.plan as PlanId]?.name ?? s.plan;
  return `${plan} · ${s.seats} seat${s.seats === 1 ? '' : 's'}${s.provider === 'manual' ? ' · complimentary' : s.interval === 'year' ? ' · yearly' : ' · monthly'}`;
}

/** Plain, pre-formatted data for the client table (no Dates or functions). */
function toRow(r: AgencyRow, now: Date): Row {
  const s = r.sub;
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    ownerEmail: r.owner?.email ?? '',
    joined: fmtDate(r.createdAt, TZ),
    status: s?.status ?? null,
    statusLabel: s ? STATUS_LABEL[s.status as SubStatus] : '',
    statusTone: s ? STATUS_TONE[s.status as SubStatus] : 'neutral',
    discountPct: s?.discountPct ?? 0,
    plan: planText(r, now),
    members: r.members,
    seats: s?.seats ?? null,
    leads: r.leads,
    credits: r.creditsMonth,
    mrr: r.mrr,
    mrrText: r.mrr ? formatMoney(r.mrr, r.currency) : '—',
    lastActive: r.lastActivity ? relative(r.lastActivity, now) : 'never',
    trialEndingSoon: s?.status === 'trialing' && !!s.trialEndsAt && s.trialEndsAt.getTime() - now.getTime() < 7 * DAY,
  };
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const sp = await searchParams;
  const now = new Date();
  const [rows, log] = await Promise.all([listAgencies(), recentAdminActions()]);
  const o = overview(rows, now);
  const names = new Map(rows.map((r) => [r.id, r.name]));

  return (
    <>
      <PageHeader eyebrow="Super-admin" title="Agencies" sub="Every workspace on Kicko: plan, trial, usage and revenue." />

      <Card className="grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
        <Stat label="MRR" value={formatMoney(o.mrrInr, 'INR', { compact: true })} sub={o.mrrUsd ? `+ ${formatMoney(o.mrrUsd, 'USD')} USD` : 'before GST'} />
        <Stat label="Paying" value={o.paying} sub={`${o.complimentary} complimentary`} />
        <Stat label="On trial" value={o.trialing} sub={o.trialsEndingSoon ? `${o.trialsEndingSoon} ending in 7 days` : 'none ending this week'} subTone={o.trialsEndingSoon ? 'warn' : undefined} />
        <Stat label="At risk" value={o.atRisk} sub={`${o.suspended} suspended`} subTone={o.atRisk ? 'warn' : undefined} />
        <Stat label="Collected this month" value={formatMoney(o.revenueMonthInr, 'INR', { compact: true })} sub={`Founding discounts: ${o.foundingUsed} of ${FOUNDING_SLOTS}`} />
      </Card>

      <Card className="overflow-hidden">
        <AgencyTable rows={rows.map((r) => toRow(r, now))} initialFilter={sp.f ?? 'all'} initialQuery={sp.q ?? ''} />
      </Card>

      <Card>
        <CardHeader title="Admin log" sub="Every change made from this console." />
        {log.length === 0 ? (
          <EmptyState title="No admin changes yet" />
        ) : (
          <ul className="divide-y divide-line">
            {log.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <span className="font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span>
                {a.tenantId && <Link href={`/admin/agencies/${a.tenantId}`} className="font-semibold text-ink-2 hover:underline">{names.get(a.tenantId) ?? 'deleted agency'}</Link>}
                <span className="text-muted">{describeAction(a.action, a.details)}</span>
                <span className="ml-auto text-xs text-muted">{a.actorEmail} · {relative(a.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
