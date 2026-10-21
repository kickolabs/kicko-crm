import clsx from 'clsx';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Sparkles } from 'lucide-react';
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';
import { fmtDateTime, fullName } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { listCalls, type CallFilter } from '@/server/calls/queries';
import { fmtDuration, telephony } from '@/server/calls/service';

import { UpgradeCard } from '@/components/upgrade';
import { hasFeature } from '@/lib/plans';

export const metadata = { title: 'Calls' };

const FILTERS: [CallFilter, string][] = [
  ['all', 'All'],
  ['missed', 'Missed'],
  ['inbound', 'Incoming'],
  ['outbound', 'Outgoing'],
  ['mine', 'Mine'],
];
const MISSED = ['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'];

export default async function CallsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ f?: string }> }) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  if (!hasFeature(ctx.subscription!, 'calling')) return <UpgradeCard slug={slug} feature="calling" canManage={can(ctx.role, 'settings.manage')} />;
  if (!can(ctx.role, 'lead.write') && !can(ctx.role, 'client.write')) notFound();
  const filter = FILTERS.find(([k]) => k === sp.f)?.[0] ?? 'all';
  const [calls, team, t] = await Promise.all([listCalls(ctx, filter), getTeam(ctx), telephony({ tenantId: ctx.tenant.id, slug })]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const tz = ctx.tenant.timezone;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <PageHeader
        title="Calls"
        sub={
          <>
            Click-to-call and incoming calls, with recordings and AI call notes.
            {t?.sandbox && <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-lime">CALLING SANDBOX</span>}
          </>
        }
        actions={!t && can(ctx.role, 'settings.manage') ? <LinkButton href={`/${slug}/settings?tab=calling`} size="sm" variant="primary">Connect calling</LinkButton> : undefined}
      />
      <div role="tablist" className="flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} role="tab" aria-selected={filter === k} href={k === 'all' ? '?' : `?f=${k}`} className={clsx('rounded-full px-3.5 py-1.5 text-[13px] font-semibold', filter === k ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2 hover:bg-paper-3')}>
            {label}
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {calls.length === 0 ? (
          <EmptyState
            title="No calls yet"
            body={t ? 'Use the Call button on any lead or client. Incoming calls to your number appear here too.' : 'Connect Exotel, Twilio or the calling sandbox in Settings → Calling.'}
          />
        ) : (
          <ul className="divide-y divide-line">
            {calls.map((c) => {
              const person = c.client ?? c.lead;
              const missed = MISSED.includes(c.status);
              const Icon = missed ? PhoneMissed : c.direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing;
              return (
                <li key={c.id}>
                  <Link href={`/${slug}/calls/${c.id}`} className="flex flex-wrap items-start gap-4 px-5 py-4 hover:bg-paper-3">
                    <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', missed ? 'bg-danger-bg text-danger' : 'bg-paper-2 text-ink')}>
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold">{person ? fullName(person) : c.contactPhone}</span>
                        <span className="text-xs text-muted">{person?.ref} · {c.contactPhone}</span>
                        {c.aiAgent && <Badge tone="ink">AI agent</Badge>}
                        {c.status === 'QUEUED' && c.scheduledAt && <Badge tone="info">Scheduled · {fmtDateTime(c.scheduledAt, tz)}</Badge>}
                        {missed && <Badge tone="danger">{c.status.replace('_', ' ').toLowerCase()}</Badge>}
                        {c.outcome && <Badge>{c.outcome}</Badge>}
                      </div>
                      {c.summary ? (
                        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-2"><Sparkles size={12} className="mr-1 inline" aria-label="AI" />{c.summary}</p>
                      ) : c.aiStatus === 'pending' ? (
                        <p className="mt-1 text-[13px] text-muted">Writing AI notes…</p>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-muted">
                      <div className="font-semibold text-ink tabular-nums">{c.status === 'COMPLETED' ? fmtDuration(c.durationSec) : missed || c.status === 'QUEUED' ? '' : 'Live'}</div>
                      <div>{fmtDateTime(c.startedAt, tz)}</div>
                      {c.agentId && <div>{names[c.agentId]}</div>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
