'use client';

import clsx from 'clsx';
import { useState, useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { ActionButton, ActionForm, FormBanner, FormField, Modal, SubmitButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input, Textarea } from '@/components/ui';
import {
  deleteKnowledgeAction,
  previewAssistantAction,
  saveAssistantSettingsAction,
  saveKnowledgeAction,
  seedKnowledgeAction,
  toggleKnowledgeAction,
} from '../actions-phase5';

type Cfg = { mode: 'off' | 'always' | 'after_hours'; name: string; days: number[]; start: string; end: string; booking: boolean };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODES: [Cfg['mode'], string, string][] = [
  ['off', 'Off', 'Staff answer every message'],
  ['always', 'Always on', 'Answers instantly, day and night'],
  ['after_hours', 'Outside office hours', 'Staff answer during the day; AI covers nights and holidays'],
];

export function AssistantSettingsCard({ slug, cfg, connected }: { slug: string; cfg: Cfg; connected: boolean }) {
  const [saved, setSaved] = useState(false);
  const [mode, setMode] = useState(cfg.mode);
  return (
    <Card>
      <CardHeader
        title="WhatsApp AI assistant"
        sub="Answers from your own knowledge base and each client's record, books consultations, and hands off to your team when it should."
        action={<Badge tone={cfg.mode === 'off' ? 'neutral' : 'ok'}>{cfg.mode === 'off' ? 'Off' : 'On'}</Badge>}
      />
      <ActionForm action={saveAssistantSettingsAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4 p-5">
        {saved && <FormBanner tone="ok">Assistant settings saved.</FormBanner>}
        {!connected && <FormBanner tone="warn">Connect WhatsApp first (the WhatsApp tab). The sandbox works too.</FormBanner>}
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">When should it reply?</legend>
          {MODES.map(([v, label, sub]) => (
            <label key={v} className={clsx('flex cursor-pointer flex-col gap-0.5 rounded-[14px] px-3.5 py-3 text-sm', mode === v ? 'bg-ink text-paper' : 'shadow-[inset_0_0_0_1px_var(--color-line-2)]')}>
              <span className="flex items-center gap-2 font-bold">
                <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="accent-lime" />
                {label}
              </span>
              <span className={clsx('text-xs', mode === v ? 'text-paper/70' : 'text-muted')}>{sub}</span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="Assistant name" name="name" hint="Customers see this name"><Input name="name" defaultValue={cfg.name} maxLength={30} required /></FormField>
          <FormField label="Office opens" name="start"><Input name="start" type="time" defaultValue={cfg.start} required /></FormField>
          <FormField label="Office closes" name="end"><Input name="end" type="time" defaultValue={cfg.end} required /></FormField>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">Office days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 rounded-full bg-paper-3 px-3 py-1.5 text-[13px] font-semibold">
                <input type="checkbox" name="days" value={i} defaultChecked={cfg.days.includes(i)} className="accent-ink" /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="booking" defaultChecked={cfg.booking} className="mt-0.5 h-4 w-4 accent-ink" />
          <span><strong>Let it book consultations</strong><br /><span className="text-muted">Uses your booking hours from the Client portal tab and the counsellor's calendar.</span></span>
        </label>
        <p className="text-xs leading-relaxed text-muted">
          It never gives immigration advice or guarantees, only answers from what you write below and the client's own case, and hands off complaints or anything it's unsure about (a task is created for the owner). Customers can reply STOP to opt out.
        </p>
        <div><SubmitButton>Save assistant</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

type Item = { id: string; question: string; answer: string; active: boolean };

export function KnowledgeCard({ slug, items }: { slug: string; items: Item[] }) {
  return (
    <Card>
      <CardHeader
        title="Knowledge base"
        sub="Your answers to common questions. The assistant only uses these, so keep them accurate."
        action={<KnowledgeEditor slug={slug} />}
      />
      <ul className="divide-y divide-line">
        {items.length === 0 && (
          <li className="flex flex-wrap items-center gap-3 px-5 py-5 text-sm text-muted">
            No answers yet.
            <ActionButton action={() => seedKnowledgeAction(slug)} variant="primary" size="sm">Add starter answers</ActionButton>
          </li>
        )}
        {items.map((k) => (
          <li key={k.id} className={clsx('flex flex-wrap items-start gap-3 px-5 py-3.5', !k.active && 'opacity-55')}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold">{k.question}</div>
              <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{k.answer}</p>
            </div>
            <div className="flex items-center gap-1">
              <ActionButton action={() => toggleKnowledgeAction(slug, k.id, !k.active)} variant="ghost">{k.active ? 'Hide' : 'Use'}</ActionButton>
              <KnowledgeEditor slug={slug} item={k} />
              <ActionButton action={() => deleteKnowledgeAction(slug, k.id)} variant="ghost" confirm="Delete this answer?">Delete</ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function KnowledgeEditor({ slug, item }: { slug: string; item?: Item }) {
  return (
    <Modal
      title={item ? 'Edit answer' : 'New answer'}
      trigger={(open) => <Button size="sm" variant={item ? 'ghost' : 'primary'} onClick={open}>{item ? 'Edit' : '+ Answer'}</Button>}
    >
      {(close) => (
        <ActionForm action={saveKnowledgeAction.bind(null, slug, item?.id ?? null)} onSuccess={close} className="flex flex-col gap-4">
          <FormField label="Question" name="question" hint="As a customer would ask it"><Input name="question" defaultValue={item?.question} required /></FormField>
          <FormField label="Answer" name="answer"><Textarea name="answer" defaultValue={item?.answer} className="min-h-32" required /></FormField>
          <div><SubmitButton>Save answer</SubmitButton></div>
        </ActionForm>
      )}
    </Modal>
  );
}

type Turn = { from: 'customer' | 'assistant'; text: string; actions?: string[] };

export function PlaygroundCard({ slug, name }: { slug: string; name: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<boolean | null>(null);
  const [pending, start] = useTransition();

  const send = () => {
    const message = text.trim();
    if (!message) return;
    setText('');
    const history = turns.map(({ from, text }) => ({ from, text }));
    setTurns((t) => [...t, { from: 'customer', text: message }]);
    start(async () => {
      const r = await previewAssistantAction(slug, { history, message });
      if (r.ok && r.data) {
        setErr(null);
        setSandbox(r.data.sandbox);
        setTurns((t) => [...t, { from: 'assistant', text: r.data!.reply, actions: r.data!.actions }]);
      } else if (!r.ok) setErr(r.error);
    });
  };

  return (
    <Card>
      <CardHeader
        title="Try it"
        sub="Chat as a new customer would. Nothing is sent or saved."
        action={turns.length > 0 && <Button size="sm" variant="ghost" onClick={() => setTurns([])}>Reset</Button>}
      />
      <div className="flex flex-col gap-3 p-5">
        <ol aria-label="Test conversation" className="flex min-h-40 flex-col gap-2.5 rounded-[16px] bg-paper-3 p-4">
          {turns.length === 0 && <li className="m-auto text-sm text-muted">Say hi, ask about documents, or ask to book a consultation.</li>}
          {turns.map((t, i) => (
            <li key={i} className={clsx('flex max-w-[85%] flex-col gap-1', t.from === 'customer' ? 'self-start' : 'items-end self-end')}>
              <span className="text-[11px] font-semibold text-muted">{t.from === 'customer' ? 'Customer' : <><Sparkles size={11} className="inline" /> {name}</>}</span>
              <p className={clsx('rounded-[16px] px-3.5 py-2 text-sm leading-relaxed whitespace-pre-line', t.from === 'customer' ? 'rounded-bl-[4px] bg-card shadow-[0_0_0_1px_var(--color-line)]' : 'rounded-br-[4px] bg-[#1F3B2C] text-paper')}>{t.text}</p>
              {t.actions?.map((a) => <Badge key={a} tone="lime">{a}</Badge>)}
            </li>
          ))}
          {pending && <li className="self-end text-xs text-muted">{name} is typing…</li>}
        </ol>
        {err && <span role="alert" className="text-xs font-medium text-danger">{err}</span>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="flex gap-2"
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message as a customer…" aria-label="Test message" className="min-w-0 flex-1" />
          <Button type="submit" variant="primary" disabled={pending || !text.trim()}>Send</Button>
        </form>
        {sandbox && <p className="text-xs text-muted">Sandbox mode: replies come from keyword rules and your knowledge base. Add an Anthropic API key for real AI answers in any language.</p>}
      </div>
    </Card>
  );
}
