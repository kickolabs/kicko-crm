import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui';
import { fmtDate, fmtDateTime, relative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { ROLE_LABEL } from '@/lib/permissions';
import { DAY, PLANS, STATUS_LABEL, type PlanId, type SubStatus } from '@/lib/plans';
import { agencyDetail, FOUNDING_SLOTS, foundingTaken } from '@/server/admin';
import { AdminTools } from '../../admin-forms';
import { ACTION_LABEL, STATUS_TONE, describeAction } from '../../labels';

export const metadata = { title: 'Agency' };

const TZ = 'Asia/Kolkata';
const CREDIT_LABEL: Record<string, string> = { call_notes: 'AI call notes', voice_notes: 'Voice agent notes', wa_reply: 'WhatsApp AI replies', doc_check: 'Document checks', brief: 'Yu briefs', other: 'Other' };

export default async function AgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [a, taken] = await Promise.all([agencyDetail(id), foundingTaken(id)]);
  if (!a) notFound();
  const s = a.sub;
  const now = new Date();
  const foundingLeft = Math.max(0, FOUNDING_SLOTS - taken);
  const trialDays = s?.status === 'trialing' && s.trialEndsAt ? Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / DAY) : null;

  return (
    <>
      <nav className="text-[13px] font-semibold text-muted">
        <Link href="/admin" className="hover:text-ink">Agencies</Link> <span className="text-faint">/</span> <span className="text-ink">{a.name}</span>
      </nav>
      <PageHeader
        title={a.name}
        sub={<>/{a.slug} · {a.country} · joined {fmtDate(a.createdAt, TZ)} · last active {a.lastActivity ? relative(a.lastActivity, now) : 'never'}</>}
        actions={s && <Badge tone={STATUS_TONE[s.status as SubStatus]}>{STATUS_LABEL[s.status as SubStatus]}</Badge>}
      />

      <Card className="grid grid-cols-2 divide-line md:grid-cols-5 md:divide-x">
        <Stat
          label="Plan"
          value={s ? (s.status === 'trialing' ? 'Trial' : (PLANS[s.plan as PlanId]?.name ?? s.plan)) : '—'}
          sub={s ? (trialDays != null ? (trialDays > 0 ? `${trialDays} days left · ends ${fmtDate(s.trialEndsAt, TZ)}` : 'ended') : s.currentPeriodEnd ? `${s.provider === 'manual' ? 'complimentary · ' : ''}${s.cancelAtPeriodEnd ? 'ends' : 'renews'} ${fmtDate(s.currentPeriodEnd, TZ)}` : '') : ''}
        />
        <Stat label="Seats" value={`${a.members}/${s?.seats ?? 0}`} sub="active users / paid seats" />
        <Stat label="MRR" value={a.mrr ? formatMoney(a.mrr, a.currency) : '—'} sub={s?.discountPct ? `${s.discountPct}% discount` : 'no discount'} />
        <Stat label="Paid to date" value={formatMoney(a.revenue, a.currency, { compact: true })} sub="before GST" />
        <Stat label="AI credits this month" value={a.creditsMonth.toLocaleString('en-IN')} sub={`${(s?.topUpCredits ?? 0).toLocaleString('en-IN')} purchased left`} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Account changes" sub="Each change is logged with your email and the reason." />
            <div className="p-5">
              {s ? <AdminTools tenantId={a.id} status={s.status} discountPct={s.discountPct} foundingLeft={foundingLeft} /> : <EmptyState title="No subscription record" />}
            </div>
          </Card>

          <Card>
            <CardHeader title="Admin log" />
            {a.log.length === 0 ? (
              <EmptyState title="No changes yet" />
            ) : (
              <ul className="divide-y divide-line">
                {a.log.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-3 text-sm">
                    <span className="font-semibold">{ACTION_LABEL[l.action] ?? l.action}</span>
                    <span className="text-muted">{describeAction(l.action, l.details)}</span>
                    <span className="ml-auto text-xs text-muted">{l.actorEmail} · {fmtDateTime(l.createdAt, TZ)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Owner" />
            <div className="flex flex-col gap-1 px-5 py-4 text-sm">
              {a.owner ? (
                <>
                  <span className="font-bold">{a.owner.name}</span>
                  <a href={`mailto:${a.owner.email}`} className="text-ink-2 hover:underline">{a.owner.email}</a>
                  {a.owner.phone && <a href={`tel:${a.owner.phone}`} className="text-ink-2 hover:underline">{a.owner.phone}</a>}
                </>
              ) : (
                <span className="text-muted">No owner on the team</span>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Free trial" />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-sm">
              <dt className="text-muted">Owner mobile</dt>
              <dd className="font-semibold">{a.trial.mobile ?? '—'} {a.trial.mobile && (a.trial.verified ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">not verified</Badge>)}</dd>
              <dt className="text-muted">Trial used</dt>
              <dd className="font-semibold">{a.trial.usedAt ? fmtDate(a.trial.usedAt, a.timezone) : 'Not yet'}{a.trial.usedAt && !a.trial.claimedHere ? ' (in another workspace)' : ''}</dd>
              {a.trial.sameNetwork >= 3 && (
                <>
                  <dt className="text-muted">Network</dt>
                  <dd><Badge tone="warn">{a.trial.sameNetwork} trials from this network in 30 days</Badge></dd>
                </>
              )}
              {a.trial.reviews.map((r) => (
                <div key={r.id} className="contents">
                  <dt className="text-muted">Review</dt>
                  <dd>{r.reason} · <Badge tone={r.status === 'open' ? 'warn' : r.status === 'granted' ? 'ok' : 'neutral'}>{r.status}</Badge></dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Workspace" />
            <dl className="grid grid-cols-3 gap-3 px-5 py-4 text-center">
              {([['Leads', a.leads], ['Clients', a.clients], ['Cases', a.cases]] as const).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="text-xl font-extrabold tabular-nums">{v.toLocaleString('en-IN')}</dd></div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Team" sub={`${a.team.filter((m) => m.active).length} active`} />
            <ul className="divide-y divide-line">
              {a.team.map((m) => (
                <li key={m.userId} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{m.name}</div>
                    <div className="truncate text-xs text-muted">{m.email}</div>
                  </div>
                  <Badge>{ROLE_LABEL[m.role]}</Badge>
                  {!m.active && <Badge tone="neutral">Inactive</Badge>}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Usage this month" />
            <ul className="divide-y divide-line text-sm">
              {a.creditsByAction.map((c) => (
                <li key={c.action} className="flex justify-between px-5 py-2"><span>{CREDIT_LABEL[c.action] ?? c.action}</span><span className="tabular-nums">{c.credits.toLocaleString('en-IN')} credits</span></li>
              ))}
              {a.usage.map((u) => (
                <li key={`${u.capability}-${u.unit}`} className="flex justify-between px-5 py-2 text-muted"><span>{u.capability}</span><span className="tabular-nums">{u.quantity.toLocaleString('en-IN')} {u.unit}{u.quantity === 1 ? '' : 's'}</span></li>
              ))}
              {a.creditsByAction.length + a.usage.length === 0 && <li className="px-5 py-3 text-muted">Nothing used yet this month</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Kicko invoices" />
            {a.invoices.length === 0 ? (
              <p className="px-5 py-3 text-sm text-muted">No payments yet</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {a.invoices.map((i) => (
                  <li key={i.id} className="flex items-baseline justify-between gap-2 px-5 py-2.5">
                    <div className="min-w-0">
                      <div className="font-mono text-xs">{i.number}</div>
                      <div className="truncate text-xs text-muted">{i.description} · {fmtDate(i.paidAt, TZ)}</div>
                    </div>
                    <span className="font-semibold tabular-nums">{formatMoney(i.total, i.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
