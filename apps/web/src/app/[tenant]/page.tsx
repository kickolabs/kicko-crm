import Link from 'next/link';
import { ArrowRight, CalendarClock, DoorOpen, MessageCircle, Phone } from 'lucide-react';
import { Badge, Card, CardHeader, LinkButton, Stat } from '@/components/ui';
import { CATEGORY_LABEL, LEAD_STATUS_LABEL, LEAD_STATUSES } from '@/lib/constants';
import { fmtTime, fullName, relative } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { hasFeature } from '@/lib/plans';
import { liveNow } from '@/server/copilot';
import { getDashboard } from '@/server/queries';
import { CopilotBrief, CopilotUpsell } from './_components/copilot';
import { GetStarted } from './_components/get-started';

export const metadata = { title: 'Command' };

export default async function Dashboard({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  const [d, team, live] = await Promise.all([getDashboard(ctx), getTeam(ctx), liveNow(ctx)]);
  const tz = ctx.tenant.timezone;
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: tz }).format(new Date());
  const dateLine = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: tz }).format(new Date());
  const billing = can(ctx.role, 'billing.read');
  const reviewer = can(ctx.role, 'document.verify');
  const docRows = reviewer ? d.docsToReview : [];
  const payRows = billing ? d.overduePayments : [];
  const needs = d.overdueTasks.length + d.todayTasks.length + d.unassigned.length + d.waiting + d.stuckCases.length + docRows.length + payRows.length;

  const funnel = LEAD_STATUSES.filter((s) => s !== 'LOST').map((s) => ({ s, n: d.leadsByStatus[s] ?? 0 }));
  const funnelMax = Math.max(1, ...funnel.map((f) => f.n));
  const caseMax = Math.max(1, ...d.casesByCategory.map(([, n]) => n));
  // Copilot: on plans that include it; on Starter only people who can upgrade see the offer.
  const copilot = Boolean(ctx.subscription && hasFeature(ctx.subscription, 'copilot'));
  const rail = copilot ? (
    <CopilotBrief slug={slug} />
  ) : can(ctx.role, 'settings.manage') ? (
    <CopilotUpsell slug={slug} />
  ) : null;
  const liveCalls = live?.calls ?? [];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-[-0.04em] sm:text-[44px]">
          {weekday}.{' '}
          <span className="text-faint">
            {needs === 0 ? 'All clear.' : `${needs} thing${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you.`}
          </span>
        </h1>
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">
          {dateLine} · {ctx.tenant.name}
        </span>
      </div>

      <div className={rail ? 'grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]' : 'contents'}>
        {rail && <div className="xl:sticky xl:top-20 xl:order-last">{rail}</div>}
        <div className="flex min-w-0 flex-col gap-6">
          {can(ctx.role, 'settings.manage') && <GetStarted ctx={ctx} />}

          <section aria-label="Key numbers" className={`card grid grid-cols-2 divide-line sm:grid-cols-3 ${rail ? 'xl:[&>*:nth-child(-n+3)]:border-b xl:[&>*:nth-child(3n)]:border-r-0' : billing ? 'lg:grid-cols-6' : 'lg:grid-cols-5'} [&>*]:border-line [&>*:not(:last-child)]:border-r`}>
            <Stat label="New leads · 7d" value={d.newLeads} />
            <Stat label="Open leads" value={funnel.reduce((a, f) => a + (f.s === 'WON' ? 0 : f.n), 0)} sub={`${d.unassigned.length} unassigned`} subTone={d.unassigned.length ? 'warn' : undefined} />
            <Stat label="Conversion · 30d" value={d.conversion === null ? '—' : `${d.conversion}%`} sub="won vs lost" />
            <Stat label="Active cases" value={d.activeCases} sub={`${d.stuckCases.length} stuck 14d+`} subTone={d.stuckCases.length ? 'warn' : undefined} />
            <Stat label="Lodged this month" value={d.lodgedMonth} sub={d.docsToReview.length ? `${d.docsToReview.length} docs to review` : undefined} subTone={d.docsToReview.length ? 'warn' : undefined} />
            {billing && (
              <Stat
                label="Collected · month"
                value={formatMoney(d.collectedMonth, 'INR', { compact: true })}
                sub={d.overdueAmount ? `${formatMoney(d.overdueAmount, 'INR', { compact: true })} overdue` : 'nothing overdue'}
                subTone={d.overdueAmount ? 'warn' : 'ok'}
              />
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Lead pipeline" action={<Link href={`/${slug}/leads`} className="text-xs font-semibold text-muted hover:text-ink">Open board →</Link>} />
              <div className="grid grid-cols-[120px_1fr_44px] items-center gap-x-4 gap-y-3 px-5 py-5 text-[13px]">
                {funnel.map(({ s, n }) => (
                  <Bar key={s} label={LEAD_STATUS_LABEL[s]} n={n} pct={(n / funnelMax) * 100} href={`/${slug}/leads?view=table&status=${s}`} lime={s === 'WON'} />
                ))}
              </div>
              {d.casesByCategory.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
                  <span className="eyebrow mr-1 self-center">Active cases</span>
                  {d.casesByCategory.map(([cat, n]) => (
                    <Link key={cat} href={`/${slug}/cases?category=${cat}`} className="rounded-full bg-paper px-3 py-1 text-xs font-semibold text-ink-2 hover:bg-paper-2">
                      {CATEGORY_LABEL[cat]} {n}
                      <span className="ml-2 inline-block h-1.5 rounded-full bg-ink/70 align-middle" style={{ width: `${Math.max(8, (n / caseMax) * 40)}px` }} />
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <section aria-label="Today" className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-ink p-5 text-paper lg:col-span-2">
              <div className="flex items-center gap-2">
                <span className="live-dot h-2 w-2 rounded-full bg-lime" />
                <h2 className="text-base font-bold">{liveCalls.length ? 'Live now' : 'Today'}</h2>
              </div>
              {liveCalls.map((c) => (
                <Link key={c.id} href={c.href} className={`flex items-center gap-3 rounded-[12px] px-3.5 py-3 ${c.ai ? 'bg-lime/10 hover:bg-lime/15' : 'bg-white/5 hover:bg-white/10'}`}>
                  {c.ai ? (
                    <span className="wave flex w-[22px] items-center gap-[3px]" aria-hidden="true"><span /><span /><span /><span /><span /></span>
                  ) : (
                    <Phone size={16} className="text-[#C4CAD2]" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {c.ai ? `AI agent ${c.direction === 'INBOUND' ? '←' : '→'} ${c.who}` : `${c.agentId && names[c.agentId] ? names[c.agentId] : 'Team'} ↔ ${c.who}`}
                    </div>
                    <div className="truncate text-xs text-[#A9AFB7]">
                      {c.ai ? (c.purpose === 'reception' ? 'Answering' : 'Qualifying') : c.direction === 'INBOUND' ? 'Incoming call' : 'Counsellor call'} · since {fmtTime(new Date(c.since), tz)}
                    </div>
                  </div>
                </Link>
              ))}
              {live?.whatsapp && (live.whatsapp.replies > 0 || live.whatsapp.handoffs > 0) && (
                <Link href={`/${slug}/inbox`} className="flex items-center gap-3 rounded-[12px] bg-white/5 px-3.5 py-3 hover:bg-white/10">
                  <MessageCircle size={16} className="text-[#C4CAD2]" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">
                      {live.whatsapp.name} (AI) handled {live.whatsapp.chats} chat{live.whatsapp.chats === 1 ? '' : 's'}
                    </div>
                    <div className="truncate text-xs text-[#A9AFB7]">
                      Today · {live.whatsapp.replies} repl{live.whatsapp.replies === 1 ? 'y' : 'ies'} · {live.whatsapp.handoffs} handed to your team
                    </div>
                  </div>
                </Link>
              )}
              <Link href={`/${slug}/walk-ins`} className="flex items-center gap-3 rounded-[12px] bg-lime/10 px-3.5 py-3 hover:bg-lime/15">
                <DoorOpen size={18} className="text-lime" aria-hidden="true" />
                <div className="flex-1">
                  <div className="font-semibold">{d.waiting ? `${d.waiting} waiting in reception` : 'Reception queue is empty'}</div>
                  <div className="text-xs text-[#A9AFB7]">Walk-in check-ins</div>
                </div>
                <ArrowRight size={15} className="text-lime" aria-hidden="true" />
              </Link>
              {d.appointments.length === 0 && <p className="px-1 text-sm text-[#A9AFB7]">No appointments today.</p>}
              {d.appointments.slice(0, liveCalls.length ? 3 : 5).map((a) => {
                const who = a.client ? fullName(a.client) : a.lead ? fullName(a.lead) : null;
                const href = a.clientId ? `/${slug}/clients/${a.clientId}` : a.leadId ? `/${slug}/leads/${a.leadId}` : `/${slug}/calendar`;
                return (
                  <Link key={a.id} href={href} className="flex items-center gap-3 rounded-[12px] bg-white/5 px-3.5 py-3 hover:bg-white/10">
                    <CalendarClock size={16} className="text-[#C4CAD2]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{who ?? a.title}</div>
                      <div className="truncate text-xs text-[#A9AFB7]">
                        {fmtTime(a.startsAt, tz)} · {a.title}
                        {a.staffId && names[a.staffId] ? ` · ${names[a.staffId]}` : ''}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </section>
          </div>

          <Card>
            <CardHeader title="Priority queue" sub="Overdue work, unassigned leads and cases that haven't moved in two weeks" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                    <th className="px-5 py-2.5">Item</th>
                    <th className="px-3 py-2.5">Signal</th>
                    <th className="px-3 py-2.5">Owner</th>
                    <th className="px-5 py-2.5 text-right">Next</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...d.overdueTasks.map((t) => ({
                      key: `t${t.id}`,
                      title: t.title,
                      sub: t.case?.ref ?? (t.client ? fullName(t.client) : t.lead ? fullName(t.lead) : 'Task'),
                      signal: <span className="font-semibold text-danger">Overdue {t.dueAt ? relative(t.dueAt) : ''}</span>,
                      owner: t.assigneeId ? names[t.assigneeId] : '—',
                      href: t.caseId ? `/${slug}/cases/${t.caseId}` : t.clientId ? `/${slug}/clients/${t.clientId}` : t.leadId ? `/${slug}/leads/${t.leadId}` : `/${slug}/tasks`,
                      cta: 'Open',
                      hot: true,
                    })),
                    ...payRows.map((i) => ({
                      key: `p${i.id}`,
                      title: `${fullName(i.invoice.client)} · ${i.label}`,
                      sub: i.invoice.ref,
                      signal: <span className="font-semibold text-danger">{formatMoney(i.amount - i.paidAmount)} overdue · {relative(i.dueDate).replace(' ago', '')}</span>,
                      owner: i.invoice.client.ownerId ? names[i.invoice.client.ownerId] : '—',
                      href: `/${slug}/billing/${i.invoiceId}`,
                      cta: 'Collect',
                      hot: true,
                    })),
                    ...docRows.map((doc) => ({
                      key: `doc${doc.id}`,
                      title: `${doc.name}`,
                      sub: `${fullName(doc.client)} · ${doc.case.ref}`,
                      signal: <Badge tone="info">Uploaded · to review</Badge>,
                      owner: doc.case.ownerId ? names[doc.case.ownerId] : '—',
                      href: `/${slug}/cases/${doc.caseId}`,
                      cta: 'Review',
                      hot: false,
                    })),
                    ...d.unassigned.map((l) => ({
                      key: `l${l.id}`,
                      title: fullName(l),
                      sub: l.ref,
                      signal: <Badge tone="lime">New lead · unassigned</Badge>,
                      owner: '—',
                      href: `/${slug}/leads/${l.id}`,
                      cta: 'Assign',
                      hot: false,
                    })),
                    ...d.stuckCases.map((c) => ({
                      key: `c${c.id}`,
                      title: fullName(c.client),
                      sub: `${c.ref} · ${c.product.name}`,
                      signal: <span className="font-medium text-warn">{c.stageName} for {relative(c.stageSince).replace(' ago', '')}</span>,
                      owner: c.ownerId ? names[c.ownerId] : '—',
                      href: `/${slug}/cases/${c.id}`,
                      cta: 'Review',
                      hot: false,
                    })),
                    ...d.todayTasks.map((t) => ({
                      key: `d${t.id}`,
                      title: t.title,
                      sub: t.case?.ref ?? (t.client ? fullName(t.client) : t.lead ? fullName(t.lead) : 'Task'),
                      signal: <span className="text-ink-2">Due {t.dueAt ? fmtTime(t.dueAt, tz) : 'today'}</span>,
                      owner: t.assigneeId ? names[t.assigneeId] : '—',
                      href: t.caseId ? `/${slug}/cases/${t.caseId}` : t.clientId ? `/${slug}/clients/${t.clientId}` : t.leadId ? `/${slug}/leads/${t.leadId}` : `/${slug}/tasks`,
                      cta: 'Open',
                      hot: false,
                    })),
                  ].map((r) => (
                    <tr key={r.key} className="border-t border-line hover:bg-paper-3" style={r.hot ? { boxShadow: 'inset 3px 0 0 var(--color-lime)' } : undefined}>
                      <td className="px-5 py-3">
                        <Link href={r.href} className="font-bold hover:underline">
                          {r.title}
                        </Link>
                        <div className="text-[11px] font-medium text-muted">{r.sub}</div>
                      </td>
                      <td className="px-3 py-3">{r.signal}</td>
                      <td className="px-3 py-3 text-ink-2">{r.owner}</td>
                      <td className="px-5 py-3 text-right">
                        <Link href={r.href} className="font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                          {r.cta}
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {needs - d.waiting === 0 && (
                    <tr className="border-t border-line">
                      <td colSpan={4} className="px-5 py-8 text-center text-sm text-muted">
                        Nothing urgent. <LinkButton href={`/${slug}/leads?new=1`} size="sm" variant="primary" className="ml-2">Add a lead</LinkButton>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent activity" />
            <ul className="divide-y divide-line">
              {d.recent.length === 0 && <li className="px-5 py-6 text-sm text-muted">Activity across your agency shows up here.</li>}
              {d.recent.map((a) => {
                const subject = a.case ? a.case.ref : a.client ? fullName(a.client) : a.lead ? fullName(a.lead) : '';
                const href = a.caseId ? `/${slug}/cases/${a.caseId}` : a.clientId ? `/${slug}/clients/${a.clientId}` : a.leadId ? `/${slug}/leads/${a.leadId}` : '#';
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
                    <span className="w-24 shrink-0 text-xs font-semibold text-muted">{relative(a.createdAt)}</span>
                    <Link href={href} className="font-bold hover:underline">
                      {subject}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{a.summary}</span>
                    {a.actorId && names[a.actorId] && <span className="text-xs text-muted">{names[a.actorId]}</span>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, n, pct, href, lime }: { label: string; n: number; pct: number; href: string; lime?: boolean }) {
  return (
    <>
      <Link href={href} className="font-medium text-ink-2 hover:text-ink">
        {label}
      </Link>
      <div className="h-3 rounded-full bg-paper-2">
        <div
          className="h-3 rounded-full"
          style={{
            width: `${Math.max(n ? 3 : 0, pct)}%`,
            background: lime ? 'var(--color-lime)' : 'var(--color-ink)',
            opacity: lime ? 1 : 0.25 + (pct / 100) * 0.6,
            boxShadow: lime ? 'inset 0 0 0 1px rgb(18 20 23 / 0.25)' : undefined,
          }}
        />
      </div>
      <span className="text-right font-bold">{n}</span>
    </>
  );
}
