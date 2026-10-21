'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, CheckCheck, Clock, FileText, Paperclip, Sparkles, TriangleAlert } from 'lucide-react';
import type { ThreadView } from '@/server/thread-view';
import { ActionButton, ActionForm, SubmitButton } from '@/components/forms';
import { Select, buttonCls } from '@/components/ui';
import { staffMessageAction } from '../actions-phase3';
import {
  saveMediaToDocumentAction,
  setOptInAction,
  simulateStatusAction,
  waMediaUrlAction,
  waSendTemplateAction,
  waSendTextAction,
} from '../actions-phase4';
import { setAssistantPausedAction } from '../actions-phase5';

type View = NonNullable<ThreadView>;
type Msg = View['messages'][number];

export function Conversation({ slug, view }: { slug: string; view: View }) {
  const end = useRef<HTMLLIElement>(null);
  const lastInboundChannel = [...view.messages].reverse().find((m) => m.direction === 'INBOUND')?.channel;
  const [channel, setChannel] = useState<'whatsapp' | 'portal'>(
    view.whatsapp && (lastInboundChannel === 'WHATSAPP' || !view.portal) ? 'whatsapp' : view.portal ? 'portal' : 'whatsapp',
  );

  useEffect(() => {
    // Block body: newer browsers return a Promise from scrollIntoView, and an
    // effect must return nothing (or a cleanup function).
    end.current?.scrollIntoView({ block: 'end' });
  }, [view.messages.length]);
  useEffect(() => {
    // A plain request, not a server action: an action fired automatically while the
    // page is navigating could leave the user's next click (e.g. "Resume AI") stuck.
    // Unread counts catch up on the next refresh.
    if (view.unread > 0) void fetch(`/api/t/${slug}/inbox/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: view.key }) }).catch(() => {});
  }, [view.unread, view.key, slug]);

  const canWhatsApp = Boolean(view.whatsapp);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ol className="flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5" aria-live="polite">
        {view.messages.length === 0 && (
          <li className="m-auto max-w-xs text-center text-sm text-muted">
            No messages yet.{canWhatsApp ? ' Start on WhatsApp with an approved template.' : view.portal ? ` Messages you send appear in ${view.firstName}'s portal.` : ''}
          </li>
        )}
        {view.messages.map((m) => (
          <Bubble key={m.id} slug={slug} m={m} view={view} />
        ))}
        <li ref={end} aria-hidden="true" />
      </ol>

      <div className="border-t border-line">
        {view.assistant && <AssistantBar slug={slug} view={view} a={view.assistant} />}
        {(canWhatsApp || view.portal) && (canWhatsApp && view.portal) && (
          <div role="tablist" aria-label="Send via" className="flex gap-1 px-4 pt-3">
            {canWhatsApp && <ChannelTab on={channel === 'whatsapp'} onClick={() => setChannel('whatsapp')} label="WhatsApp" />}
            {view.portal && <ChannelTab on={channel === 'portal'} onClick={() => setChannel('portal')} label="Portal" />}
          </div>
        )}
        {channel === 'whatsapp' && view.whatsapp ? (
          <WhatsAppComposer slug={slug} view={view} wa={view.whatsapp} />
        ) : view.portal ? (
          <TextComposer
            key="portal"
            action={staffMessageAction.bind(null, slug, view.id)}
            placeholder={`Message ${view.firstName}… (shows in their portal)`}
          />
        ) : (
          <p className="px-5 py-4 text-sm text-muted">
            {view.phone ? 'Connect WhatsApp in Settings to message this lead.' : 'Add a phone number to message this lead on WhatsApp.'}
          </p>
        )}
      </div>
    </div>
  );
}

function AssistantBar({ slug, view, a }: { slug: string; view: View; a: NonNullable<View['assistant']> }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper-3 px-4 py-2 text-xs">
      <Sparkles size={13} className="shrink-0" />
      <span className="min-w-0 flex-1 text-ink-2">
        <strong>{a.text.title}</strong> · {a.text.detail}
      </span>
      {(a.status === 'handed_off' || a.status === 'paused') && (
        <ActionButton action={() => setAssistantPausedAction(slug, view.key, false)} variant="primary" className="h-7 px-2.5 text-xs">
          {a.status === 'paused' ? 'Resume AI now' : 'Resume AI'}
        </ActionButton>
      )}
      {a.status === 'active' && (
        <ActionButton action={() => setAssistantPausedAction(slug, view.key, true)} className="h-7 px-2.5 text-xs">Take over</ActionButton>
      )}
    </div>
  );
}

function ChannelTab({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" role="tab" aria-selected={on} onClick={onClick} className={clsx('rounded-full px-3 py-1 text-xs font-bold', on ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}>
      {label}
    </button>
  );
}

function Ticks({ m }: { m: Msg }) {
  if (m.channel !== 'WHATSAPP' || m.direction !== 'OUTBOUND') return m.readByClient ? <span> · Seen</span> : null;
  const label = { QUEUED: 'Sending', SENT: 'Sent', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', RECEIVED: '' }[m.status ?? 'QUEUED'];
  const icon =
    m.status === 'QUEUED' ? <Clock size={12} /> :
    m.status === 'SENT' ? <Check size={13} /> :
    m.status === 'FAILED' ? <TriangleAlert size={12} /> :
    <CheckCheck size={14} className={m.status === 'READ' ? 'text-[#4D9BFF]' : undefined} />;
  return <span className={clsx('inline-flex items-center gap-0.5', m.status === 'FAILED' && 'text-danger')} title={label}> · {icon}<span className="sr-only">{label}</span></span>;
}

function Bubble({ slug, m, view }: { slug: string; m: Msg; view: View }) {
  const ours = m.direction === 'OUTBOUND';
  const wa = m.channel === 'WHATSAPP';
  return (
    <li className={clsx('flex max-w-[78%] flex-col gap-1', ours ? 'items-end self-end' : 'self-start')}>
      {m.template && <span className="text-[10px] font-bold tracking-wide text-muted uppercase">Template · {m.template}</span>}
      {m.ai && (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wide text-muted uppercase">
          <Sparkles size={11} /> AI reply
        </span>
      )}
      <div
        className={clsx(
          'rounded-[16px] px-4 py-2.5 leading-relaxed whitespace-pre-line',
          ours ? (wa ? 'rounded-br-[4px] bg-[#1F3B2C] text-paper' : 'rounded-br-[4px] bg-ink text-paper') : 'rounded-bl-[4px] bg-card shadow-[0_0_0_1px_var(--color-line)]',
          m.status === 'FAILED' && 'opacity-60',
        )}
      >
        {m.media && <MediaRow slug={slug} m={m} targets={view.saveTargets} ours={ours} />}
        {m.body}
      </div>
      <span className="flex items-center gap-1 text-[11px] text-muted">
        <span className={clsx('rounded px-1 text-[9px] font-extrabold', wa ? 'bg-[#DCF5D6] text-[#1F6B14]' : 'bg-info-bg text-info')}>{wa ? 'WA' : 'PORTAL'}</span>
        {m.author} · {m.at}
        <Ticks m={m} />
      </span>
      {m.status === 'FAILED' && m.error && <span role="alert" className="text-[11px] font-semibold text-danger">{m.error}</span>}
      {view.whatsapp?.mode === 'sandbox' && wa && ours && (m.status === 'SENT' || m.status === 'DELIVERED') && (
        <span className="flex gap-2 text-[10px] text-muted">
          Simulate:
          <ActionButton action={() => simulateStatusAction(slug, m.id, 'delivered')} variant="ghost" className="h-auto px-1 py-0 text-[10px]">delivered</ActionButton>
          <ActionButton action={() => simulateStatusAction(slug, m.id, 'read')} variant="ghost" className="h-auto px-1 py-0 text-[10px]">read</ActionButton>
        </span>
      )}
    </li>
  );
}

function MediaRow({ slug, m, targets, ours }: { slug: string; m: Msg; targets: View['saveTargets']; ours: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  if (!m.media) return null;
  return (
    <div className={clsx('mb-2 flex flex-col gap-2 rounded-[10px] p-2.5', ours ? 'bg-white/10' : 'bg-paper-3')}>
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        {m.media.type === 'image' ? <Paperclip size={14} /> : <FileText size={14} />}
        <span className="truncate">{m.media.name ?? m.media.type}</span>
        {m.media.available && (
          <button
            type="button"
            className="ml-auto text-xs font-bold underline underline-offset-4"
            onClick={async () => {
              const r = await waMediaUrlAction(slug, m.id);
              if (r.ok && r.data) window.open(r.data, '_blank', 'noopener');
            }}
          >
            View
          </button>
        )}
      </div>
      {m.media.available && !ours && targets.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Select aria-label="Save to document" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 text-xs">
            <option value="">Save to documents…</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
          <button
            type="button"
            disabled={!target || pending}
            className={buttonCls('primary', 'sm', 'h-8')}
            onClick={() =>
              start(async () => {
                const r = await saveMediaToDocumentAction(slug, m.id, target);
                setNote(r.ok ? 'Saved · to review' : r.error);
                if (r.ok) router.refresh();
              })
            }
          >
            Save
          </button>
        </div>
      )}
      {note && <span className="text-[11px] font-semibold">{note}</span>}
    </div>
  );
}

function TextComposer({ action, placeholder }: { action: Parameters<typeof ActionForm>[0]['action']; placeholder: string }) {
  const [key, setKey] = useState(0);
  return (
    <ActionForm key={key} action={action} onSuccess={() => setKey((k) => k + 1)} className="flex items-end gap-2 p-4">
      <label className="sr-only" htmlFor={`compose-${placeholder.length}`}>Message</label>
      <textarea
        id={`compose-${placeholder.length}`}
        name="body"
        rows={2}
        placeholder={placeholder}
        className="min-h-12 flex-1 resize-none rounded-[14px] bg-card px-4 py-3 shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-ink)]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <SubmitButton>Send</SubmitButton>
    </ActionForm>
  );
}

function WhatsAppComposer({ slug, view, wa }: { slug: string; view: View; wa: NonNullable<View['whatsapp']> }) {
  const [mode, setMode] = useState<'text' | 'template'>(wa.windowOpen ? 'text' : 'template');
  return (
    <div className="flex flex-col">
      <div className={clsx('mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-[10px] px-3 py-2 text-xs font-semibold', wa.windowOpen ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn-ink')}>
        {wa.windowOpen ? `24-hour window open until ${wa.closes}` : '24-hour window closed: WhatsApp allows only approved templates until they reply'}
        {wa.mode === 'sandbox' && <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] text-lime">SANDBOX</span>}
        {wa.windowOpen && (
          <button type="button" className="ml-auto underline underline-offset-4" onClick={() => setMode(mode === 'text' ? 'template' : 'text')}>
            {mode === 'text' ? 'Use a template' : 'Write a message'}
          </button>
        )}
      </div>
      {!wa.optIn && !wa.windowOpen && (
        <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          No WhatsApp opt-in on record. Only message people who agreed to hear from you.
          <ActionButton action={() => setOptInAction(slug, view.key, true)} variant="ghost" className="h-auto px-1 py-0 text-xs underline">
            They agreed: record opt-in
          </ActionButton>
        </div>
      )}
      {mode === 'text' && wa.windowOpen ? (
        <TextComposer key="wa" action={waSendTextAction.bind(null, slug, view.key)} placeholder={`WhatsApp ${view.firstName}… (Ctrl+Enter to send)`} />
      ) : (
        <TemplateComposer slug={slug} view={view} templates={wa.templates} />
      )}
    </div>
  );
}

function TemplateComposer({ slug, view, templates }: { slug: string; view: View; templates: NonNullable<View['whatsapp']>['templates'] }) {
  const [value, setValue] = useState(templates[0]?.value ?? '');
  const [params, setParams] = useState<string[]>([view.firstName]);
  const [key, setKey] = useState(0);
  const t = templates.find((x) => x.value === value);
  if (!templates.length) return <p className="p-4 text-sm text-muted">No approved templates. Sync them in Settings → WhatsApp.</p>;
  const preview = t ? t.body.replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] || `{{${n}}}`) : '';
  return (
    <ActionForm key={key} action={waSendTemplateAction.bind(null, slug, view.key)} onSuccess={() => { setKey((k) => k + 1); setParams([view.firstName]); }} className="flex flex-col gap-2 p-4">
      <input type="hidden" name="template" value={value} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="tpl">Template</label>
        <Select id="tpl" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-64">
          {templates.map((x) => <option key={x.value} value={x.value}>{x.name}{x.category === 'MARKETING' ? ' (marketing)' : ''}</option>)}
        </Select>
        {t &&
          Array.from({ length: t.variables }, (_, i) => (
            <input
              key={i}
              name={`p${i + 1}`}
              aria-label={`Template field ${i + 1}`}
              placeholder={`{{${i + 1}}}`}
              value={params[i] ?? ''}
              onChange={(e) => setParams((p) => Object.assign([...p], { [i]: e.target.value }))}
              className="h-9 min-w-28 flex-1 rounded-[10px] bg-card px-3 text-sm shadow-[inset_0_0_0_1px_var(--color-line-2)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-ink)]"
            />
          ))}
      </div>
      <div className="flex items-end gap-2">
        <p className="flex-1 rounded-[12px] bg-paper-3 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">{preview}</p>
        <SubmitButton>Send template</SubmitButton>
      </div>
    </ActionForm>
  );
}
