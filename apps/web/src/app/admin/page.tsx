import clsx from 'clsx';
import Link from 'next/link';
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Stat } from '@/components/ui';
import { fmtDate, relative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { DAY, PLANS, STATUS_LABEL, type PlanId, type SubStatus } from '@/lib/plans';
import { FOUNDING_SLOTS, listAgencies, overview, recentAdminActions, type AgencyRow } from '@/server/admin';
import { ACTION_LABEL, STATUS_TONE, describeAction } from './labels';

export const metadata = { title: 'Agencies' };

const FILTERS = [
  ['all', 'All'],
  ['trialing', 'Trial'],
  ['ending', 'Trial ending'],
  ['paying', 'Paying'],
  ['risk', 'At risk'],
  ['suspended', 'Suspended'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const TZ = 'Asia/Kolkata';

function matches(r: AgencyRow, f: Filter, now: Date) {
  const s = r.sub?.status;
  if (f === 'trialing') return s === 'trialing';
  if (f === 'ending') return s === 'trialing' && !!r.sub?.trialEndsAt && r.sub.trialEndsAt.getTime() - now.getTime() < 7 * DAY;
  if (f === 'paying') return r.mrr > 0;
  if (f === 'risk') return s === 'past_due' || s === 'read_only';
  if (f === 'suspended') return s === 'suspended';
  return true;
}

function planCell(r: AgencyRow, now: Date) {
  const s = r.sub;
  if (!s) return '—';
  if (s.status === 'trialing' && s.trialEndsAt) {
    const days = Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / DAY);
    return days > 0 ? `Trial · ${days} day${days === 1 ? '' : 's'} left` : 'Trial · ended';
  }
  const plan = PLANS[s.plan as PlanId]?.name ?? s.plan;
  return `${plan} · ${s.seats} seat${s.seats === 1 ? '' : 's'}${s.provider === 'manual' ? ' · complimentary' : s.interval === 'year' ? ' · yearly' : ' · monthly'}`;
}

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const sp = await searchParams;
  const filter = (FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all') as Filter;
  const q = (sp.q ?? '').trim().toLowerCase();
  const now = new Date();
  const [rows, log] = await Promise.all([listAgencies(), recentAdminActions()]);
  const o = overview(rows, now);
  const shown = rows.filter((r) => matches(r, filter, now) && (!q || [r.name, r.slug, r.owner?.email ?? ''].some((x) => x.toLowerCase().includes(q))));
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
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <nav aria-label="Filter agencies" className="flex flex-wrap gap-1">
            {FILTERS.map(([k, label]) => (
              <Link
                key={k}
                href={{ pathname: '/admin', query: { ...(k === 'all' ? {} : { f: k }), ...(q ? { q } : {}) } }}
                aria-current={filter === k ? 'page' : undefined}
                className={clsx('rounded-full px-3 py-1 text-xs font-bold', filter === k ? 'bg-ink text-paper' : 'text-muted hover:bg-paper-3')}
              >
                {label} <span className="tabular-nums opacity-60">{rows.filter((r) => matches(r, k, now)).length}</span>
              </Link>
            ))}
          </nav>
          <form className="ml-auto" action="/admin">
            {filter !== 'all' && <input type="hidden" name="f" value={filter} />}
            <Input name="q" defaultValue={sp.q ?? ''} placeholder="Search name, address or owner email" aria-label="Search agencies" className="h-9 w-72" />
          </form>
        </div>
        {shown.length === 0 ? (
          <EmptyState title="No agencies match" body="Try another filter or search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] font-bold tracking-wide text-muted uppercase">
                <tr className="border-b border-line">
                  <th className="px-5 py-2.5">Agency</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Plan</th>
                  <th className="px-3 py-2.5 text-right">Users</th>
                  <th className="px-3 py-2.5 text-right">Leads</th>
                  <th className="px-3 py-2.5 text-right">AI credits</th>
                  <th className="px-3 py-2.5 text-right">MRR</th>
                  <th className="px-5 py-2.5">Last active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.id} className="hover:bg-paper-3">
                    <td className="px-5 py-3">
                      <Link href={`/admin/agencies/${r.id}`} className="font-bold hover:underline">{r.name}</Link>
                      <div className="text-xs text-muted">/{r.slug} · {r.owner?.email ?? 'no owner'} · joined {fmtDate(r.createdAt, TZ)}</div>
                    </td>
                    <td className="px-3 py-3">
                      {r.sub ? <Badge tone={STATUS_TONE[r.sub.status as SubStatus]}>{STATUS_LABEL[r.sub.status as SubStatus]}</Badge> : '—'}
                      {(r.sub?.discountPct ?? 0) > 0 && <Badge tone="lime" className="ml-1">{r.sub!.discountPct}% off</Badge>}
                    </td>
                    <td className="px-3 py-3 text-xs">{planCell(r, now)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.members}{r.sub ? <span className="text-muted">/{r.sub.seats}</span> : null}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.leads.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{r.creditsMonth.toLocaleString('en-IN')}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{r.mrr ? formatMoney(r.mrr, r.currency) : '—'}</td>
                    <td className="px-5 py-3 text-xs text-muted">{r.lastActivity ? relative(r.lastActivity, now) : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
