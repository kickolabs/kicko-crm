'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { ActionButton, ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input, Select } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import { dispatchDueCallsAction, saveVoiceSettingsAction, simulateInboundAiCallAction, syncVoiceAgentAction } from '../actions-phase5';

type Cfg = {
  name: string;
  language: string;
  voice: string;
  questions: string[];
  inbound: boolean;
  autoCall: boolean;
  autoCallDelayMin: number;
  autoCallSources: string[];
  days: number[];
  start: string;
  end: string;
  maxAttempts: number;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LANGUAGES: [string, string][] = [
  ['en-IN', 'English (India)'], ['hi-IN', 'Hindi'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['kn-IN', 'Kannada'], ['ml-IN', 'Malayalam'],
  ['bn-IN', 'Bengali'], ['mr-IN', 'Marathi'], ['gu-IN', 'Gujarati'], ['pa-IN', 'Punjabi'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['multi', 'Auto-detect (multilingual)'],
];
const SOURCES: [string, string][] = [['WEB_FORM', 'Web form'], ['ADS', 'Ads'], ['WALK_IN', 'Walk-in'], ['REFERRAL', 'Referral'], ['WHATSAPP', 'WhatsApp'], ['OTHER', 'Other']];

export function VoiceAgentCard({ slug, cfg, questions, connected }: { slug: string; cfg: Cfg; questions: { key: string; label: string }[]; connected: boolean }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title="Agent" sub="Calls new enquiries within minutes, asks your qualification questions, books consultations, and answers your number when you can't." />
      <ActionForm action={saveVoiceSettingsAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-col gap-5 p-5">
        {saved && <FormBanner tone="ok">Voice agent saved.</FormBanner>}
        {!connected && <FormBanner tone="warn">Connect a provider above first. The sandbox works without an account.</FormBanner>}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Agent name" name="name" hint="It always says it's an AI assistant"><Input name="name" defaultValue={cfg.name} maxLength={30} required /></FormField>
          <FormField label="Language" name="language">
            <Select name="language" defaultValue={cfg.language}>{LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </FormField>
          <FormField label="Voice ID" name="voice" hint="From your provider's voice library. Blank = provider default"><Input name="voice" defaultValue={cfg.voice} placeholder="e.g. 11labs-Monika" /></FormField>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Qualification questions</legend>
          <div className="flex flex-wrap gap-2">
            {questions.map((q) => (
              <label key={q.key} className="flex items-center gap-1.5 rounded-full bg-paper-3 px-3 py-1.5 text-[13px] font-semibold">
                <input type="checkbox" name="questions" value={q.key} defaultChecked={cfg.questions.includes(q.key)} className="accent-ink" /> {q.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 rounded-[14px] bg-paper-3 p-4 sm:grid-cols-2">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="autoCall" defaultChecked={cfg.autoCall} className="mt-0.5 h-4 w-4 accent-ink" />
            <span><strong>Call new enquiries automatically</strong><br /><span className="text-muted">Speed wins: leads called within minutes convert far better.</span></span>
          </label>
          <FormField label="Wait before calling (minutes)" name="autoCallDelayMin"><Input name="autoCallDelayMin" type="number" min={0} max={240} defaultValue={cfg.autoCallDelayMin} /></FormField>
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">For enquiries from</legend>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-[13px] font-semibold">
                  <input type="checkbox" name="autoCallSources" value={v} defaultChecked={cfg.autoCallSources.includes(v)} className="accent-ink" /> {l}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="inbound" defaultChecked={cfg.inbound} className="mt-0.5 h-4 w-4 accent-ink" />
          <span><strong>AI receptionist</strong><br /><span className="text-muted">Answers calls to the agent's number: knows existing clients' case stage, takes new enquiries, books consultations.</span></span>
        </label>

        <div className="grid gap-3 sm:grid-cols-4">
          <FormField label="Calls from" name="start"><Input name="start" type="time" defaultValue={cfg.start} min="09:00" max="21:00" required /></FormField>
          <FormField label="Calls until" name="end"><Input name="end" type="time" defaultValue={cfg.end} min="09:00" max="21:00" required /></FormField>
          <FormField label="Attempts if no answer" name="maxAttempts">
            <Select name="maxAttempts" defaultValue={String(cfg.maxAttempts)}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
          </FormField>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Calling days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 rounded-full bg-paper-3 px-3 py-1.5 text-[13px] font-semibold">
                <input type="checkbox" name="days" value={i} defaultChecked={cfg.days.includes(i)} className="accent-ink" /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs leading-relaxed text-muted">
          Calls only go out inside these hours (Indian rules allow 09:00–21:00); anything outside waits for the next slot. The agent says it's an AI and that the call is recorded, never gives immigration advice, and hands people to your team on request (a callback task is created). Answers come from your knowledge base on the AI assistant tab.
        </p>
        <div><SubmitButton>Save agent</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

export function VoiceSyncCard({
  slug,
  status,
  prompt,
  tools,
  tz,
}: {
  slug: string;
  tz: string;
  status: { state: 'none' | 'sandbox' | 'never' | 'synced' | 'stale'; at?: string };
  prompt: string;
  tools: { name: string; description: string }[];
}) {
  const label = { none: 'Not connected', sandbox: 'Sandbox: no sync needed', never: 'Not synced yet', synced: 'Up to date', stale: 'Changes not synced' }[status.state];
  const tone = status.state === 'synced' || status.state === 'sandbox' ? 'ok' : status.state === 'none' ? 'neutral' : 'warn';
  return (
    <Card>
      <CardHeader
        title="Prompt & tools"
        sub="Built from your settings and knowledge base, then pushed to the provider"
        action={<Badge tone={tone}>{label}</Badge>}
      />
      <div className="flex flex-col gap-4 p-5">
        {(status.state === 'never' || status.state === 'stale' || status.state === 'synced') && (
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton action={() => syncVoiceAgentAction(slug)} variant="primary" size="md">Sync agent</ActionButton>
            {status.at && <span className="text-xs text-muted">Last synced {fmtDateTime(status.at, tz)}</span>}
          </div>
        )}
        <details className="rounded-[14px] bg-paper-3 p-4 text-[13px]">
          <summary className="cursor-pointer font-semibold">View the agent's instructions</summary>
          <pre className="mt-3 max-h-80 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-2">{prompt}</pre>
        </details>
        <ul className="grid gap-2 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t.name} className="rounded-[12px] px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
              <code className="text-xs font-bold">{t.name}</code>
              <p className="text-xs text-muted">{t.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function VoiceQueueCard({ slug, queued }: { slug: string; queued: { id: string; name: string; when: string; attempt: number }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Scheduled AI calls"
        sub="Waiting for calling hours or a retry"
        action={
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await dispatchDueCallsAction(slug);
                setMsg(r.ok ? `${r.data ?? 0} call(s) started` : r.error);
              })
            }
          >
            {pending ? 'Starting…' : 'Run due calls now'}
          </Button>
        }
      />
      {msg && <p className="px-5 pt-3 text-sm font-semibold">{msg}</p>}
      <ul className="divide-y divide-line">
        {queued.length === 0 && <li className="px-5 py-4 text-sm text-muted">Nothing scheduled.</li>}
        {queued.map((q) => (
          <li key={q.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <Link href={`/${slug}/calls/${q.id}`} className="min-w-0 flex-1 font-semibold hover:underline">{q.name}</Link>
            <span className="text-muted">{q.when}{q.attempt > 1 ? ` · attempt ${q.attempt}` : ''}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function VoiceSimulatorCard({ slug, personas }: { slug: string; personas: { id: string; label: string }[] }) {
  const [callId, setCallId] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Receptionist simulator" sub="Pretend someone calls your AI receptionist. The full conversation, tool calls and notes run as on a real call." />
      <ActionForm action={simulateInboundAiCallAction.bind(null, slug)} onSuccess={(r) => setCallId(r.ok ? ((r.data as string | undefined) ?? null) : null)} className="flex flex-col gap-3.5 p-5">
        {callId && (
          <FormBanner tone="ok">
            The AI receptionist answered. <Link href={`/${slug}/calls/${callId}`} className="font-bold underline">Open call</Link>
          </FormBanner>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Caller's number" name="from"><Input name="from" type="tel" defaultValue="+91 98400 77881" required /></FormField>
          <FormField label="Caller" name="persona">
            <Select name="persona">{personas.filter((p) => p.id !== 'no-answer').map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select>
          </FormField>
        </div>
        <div><SubmitButton>Simulate incoming call</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}
