import clsx from 'clsx';
import { AI_SHORT } from '@/lib/brand';
import { countryName } from '@/lib/countries';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PhoneIncoming, PhoneOutgoing, Sparkles } from 'lucide-react';
import { Badge, Card, CardHeader } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/constants';
import { fmtDateTime, fullName } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { getCall } from '@/server/calls/queries';
import { fmtDuration, type CallAi } from '@/server/calls/service';
import type { Segment } from '@/integrations/stt/port';
import { AddTaskButton, ApplyFieldsButton, CancelQueued, OutcomeForm, RecordingPlayer, RetryNotes } from './call-widgets';
import { voiceSettings } from '@/server/voice/agent';

export const metadata = { title: 'Call' };

const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Queued', RINGING: 'Ringing', IN_PROGRESS: 'In progress', COMPLETED: 'Completed',
  NO_ANSWER: 'No answer', BUSY: 'Busy', FAILED: 'Failed', CANCELED: 'Cancelled',
};
const SENTIMENT: Record<string, { label: string; tone: 'ok' | 'neutral' | 'danger' }> = {
  positive: { label: 'Positive', tone: 'ok' }, neutral: { label: 'Neutral', tone: 'neutral' }, negative: { label: 'Unhappy', tone: 'danger' },
};
const INTENT: Record<string, string> = { new_enquiry: 'New enquiry', case_update: 'Case update', payment: 'Payment', complaint: 'Complaint', other: 'Other' };

export default async function CallPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'lead.write') && !can(ctx.role, 'client.write')) notFound();
  const [call, team] = await Promise.all([getCall(ctx, id), getTeam(ctx)]);
  if (!call) notFound();
  const person = call.client ?? call.lead!;
  const href = call.client ? `/${slug}/clients/${call.client.id}` : `/${slug}/leads/${call.lead!.id}`;
  const agent = team.find((m) => m.userId === call.agentId)?.name;
  const ai = call.aiStatus === 'done' ? (call.ai as (CallAi & { actions?: string[] }) | null) : null;
  const botName = voiceSettings(ctx.tenant.settings).name;
  const segments = (call.transcript as Segment[] | null) ?? [];
  const tz = ctx.tenant.timezone;
  const Icon = call.direction === 'INBOUND' ? PhoneIncoming : PhoneOutgoing;
  const facts = ai
    ? ([
        ['Destination', ai.fields.interestCountry && (countryName(ai.fields.interestCountry))],
        ['Visa type', ai.fields.interestCategory && CATEGORY_LABEL[ai.fields.interestCategory]],
        ['Intake', ai.fields.intake],
        ['English test', ai.fields.englishTest],
        ['Budget', ai.fields.budget],
        ['Occupation', ai.fields.occupation],
        ['Age', ai.fields.age && String(ai.fields.age)],
      ].filter(([, v]) => v) as [string, string][])
    : [];

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/calls`} className="hover:text-ink">Calls</Link> <span className="text-faint">/</span> <span className="text-ink">{fmtDateTime(call.startedAt, tz)}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-lime text-ink"><Icon size={22} /></span>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em] sm:text-[40px]">
              <Link href={href} className="hover:underline">{fullName(person)}</Link>
            </h1>
            <div className="flex flex-wrap gap-x-2 text-[13px] font-medium text-muted">
              <span>{call.direction === 'INBOUND' ? 'Incoming' : 'Outgoing'}</span><span>·</span>
              <span>{call.contactPhone}</span><span>·</span>
              <span className="tabular-nums">{call.status === 'COMPLETED' ? fmtDuration(call.durationSec) : STATUS_LABEL[call.status]}</span>
              {agent && <><span>·</span><span>{agent}</span></>}
              <span>·</span><span>{call.provider}</span>
              {call.aiAgent && <><span>·</span><Badge tone="ink">AI agent{call.purpose === 'reception' ? ' · receptionist' : ' · qualification'}</Badge></>}
              {call.status === 'QUEUED' && call.scheduledAt && <><span>·</span><span>Scheduled for {fmtDateTime(call.scheduledAt, tz)}</span></>}
            </div>
          </div>
        </div>
        {call.status === 'QUEUED' && <CancelQueued slug={slug} callId={call.id} />}
        <Badge tone={call.status === 'COMPLETED' ? 'ok' : ['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'].includes(call.status) ? 'danger' : 'info'}>{STATUS_LABEL[call.status]}</Badge>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label={`Call notes by ${AI_SHORT}`} className="flex flex-col gap-4 rounded-[var(--radius-card)] bg-ink p-5 text-paper">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles size={16} className="text-lime" />
              <h2 className="text-lg font-extrabold tracking-tight">Call notes by {AI_SHORT}</h2>
              {ai && <Badge tone={SENTIMENT[ai.sentiment]!.tone}>{SENTIMENT[ai.sentiment]!.label}</Badge>}
              {ai && <Badge tone="lime">{INTENT[ai.intent]}</Badge>}
            </div>
            {call.recordingKey && <RecordingPlayer slug={slug} callId={call.id} />}
            {ai ? (
              <>
                <p className="text-[15px] leading-relaxed text-paper/90">{ai.summary}</p>
                {ai.nextSteps.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-bold tracking-wide text-paper/60 uppercase">Next steps</div>
                    <ul className="flex flex-col gap-1 text-sm text-paper/90">
                      {ai.nextSteps.map((s) => <li key={s} className="flex gap-2"><span className="text-lime">→</span>{s}</li>)}
                    </ul>
                  </div>
                )}
                {ai.actions && ai.actions.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-bold tracking-wide text-paper/60 uppercase">Done during the call</div>
                    <ul className="flex flex-wrap gap-2">
                      {ai.actions.map((a, i) => <li key={i}><Badge tone="lime">{a}</Badge></li>)}
                    </ul>
                  </div>
                )}
                {ai.tasks.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[11px] font-bold tracking-wide text-paper/60 uppercase">Suggested tasks</div>
                    <ul className="flex flex-col gap-2">
                      {ai.tasks.map((t, i) => (
                        <li key={t.title} className="flex flex-wrap items-center gap-3 rounded-[12px] bg-paper/10 px-3 py-2">
                          <span className="min-w-0 flex-1 text-sm font-semibold">{t.title}</span>
                          <span className="text-xs text-paper/60">{t.dueInDays === 0 ? 'today' : `in ${t.dueInDays} day${t.dueInDays > 1 ? 's' : ''}`}</span>
                          {can(ctx.role, 'task.write') && <AddTaskButton slug={slug} callId={call.id} index={i} added={Boolean(ai.added?.includes(i))} />}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-paper/50">
                  {ai.sandbox ? 'Sandbox notes from keyword rules. Add an Anthropic API key for AI-written notes.' : `Written by ${ai.model}.`} AI can be wrong: check before acting on it. It never gives immigration advice.
                </p>
              </>
            ) : call.aiStatus === 'pending' ? (
              <p className="text-sm text-paper/70">Transcribing and writing call notes…</p>
            ) : call.aiStatus === 'failed' || call.aiStatus === 'skipped' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-paper/70">{call.aiError}</p>
                {call.aiStatus === 'failed' && <RetryNotes slug={slug} callId={call.id} />}
              </div>
            ) : (
              <p className="text-sm text-paper/70">{call.status === 'COMPLETED' ? 'Notes appear here once the recording arrives.' : 'Notes are written after a recorded call ends.'}</p>
            )}
          </section>

          <Card>
            <CardHeader title="Transcript" sub={call.language ? `Language: ${call.language}` : undefined} />
            {segments.length === 0 ? (
              <p className="px-5 py-5 text-sm text-muted">No transcript for this call.</p>
            ) : (
              <ol className="flex flex-col gap-3 px-5 py-4">
                {segments.map((s, i) => {
                  const agentSide = s.speaker === 'agent';
                  return (
                    <li key={i} className={clsx('flex flex-col gap-0.5', agentSide ? 'items-end' : 'items-start')}>
                      <span className="text-[11px] font-semibold text-muted">
                        {s.speaker === 'agent' ? (call.aiAgent ? `${botName} (AI)` : (agent ?? 'Agency')) : s.speaker === 'contact' ? person.firstName : s.speaker} · {Math.floor(s.start / 60)}:{String(Math.floor(s.start % 60)).padStart(2, '0')}
                      </span>
                      <p className={clsx('max-w-[85%] rounded-[16px] px-3.5 py-2 text-sm leading-relaxed', agentSide ? 'rounded-br-[4px] bg-paper-2' : 'rounded-bl-[4px] bg-paper-3 shadow-[inset_0_0_0_1px_var(--color-line)]')}>{s.text}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Outcome" />
            <div className="p-5"><OutcomeForm slug={slug} callId={call.id} outcome={call.outcome} /></div>
          </Card>
          {facts.length > 0 && (
            <Card>
              <CardHeader title="What they told us" sub="Picked up from the call" action={<ApplyFieldsButton slug={slug} callId={call.id} />} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-[13px]">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <dt className="text-xs font-semibold text-muted">{k}</dt>
                    <dd className="font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          <Card>
            <CardHeader title="Timeline" />
            <dl className="grid gap-y-2 px-5 py-4 text-[13px]">
              {([
                ['Started', fmtDateTime(call.startedAt, tz)],
                ['Answered', call.answeredAt ? fmtDateTime(call.answeredAt, tz) : '—'],
                ['Ended', call.endedAt ? fmtDateTime(call.endedAt, tz) : '—'],
                ['Recording', call.recordingKey ? 'Saved' : call.recordingRef ? 'Downloading…' : 'None'],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
