'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Bot, Phone, PhoneOff, Sparkles, X } from 'lucide-react';
import { ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { callStatusAction, setMyPhoneAction, startAiCallAction, startCallAction } from '../actions-phase5';
import { AI_SHORT } from '@/lib/brand';

// Click-to-call: the provider rings the counsellor's phone, then the client.
// A floating HUD follows the call live, then shows the AI notes when ready.

type Live = NonNullable<Awaited<ReturnType<typeof callStatusAction>>>;

export function CallButton({
  slug,
  contactKey,
  contactName,
  calling,
}: {
  slug: string;
  contactKey: string;
  contactName: string;
  /** null = no calling provider connected. */
  calling: { sandbox: boolean; myPhone: string | null; scripts: { id: string; label: string }[] } | null;
}) {
  const [callId, setCallId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [script, setScript] = useState(calling?.scripts[0]?.id ?? '');

  const place = (scriptId?: string) =>
    start(async () => {
      const r = await startCallAction(slug, contactKey, scriptId);
      if (r.ok && r.data) {
        setErr(null);
        setCallId(r.data);
      } else if (!r.ok) setErr(r.error);
    });

  if (!calling) {
    return (
      <Link href={`/${slug}/settings?tab=calling`} className="inline-flex h-10 items-center gap-2 rounded-[12px] px-3.5 text-sm font-semibold text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink" title="Connect a calling provider to call from Kicko">
        <Phone size={15} /> Set up calling
      </Link>
    );
  }

  const busy = pending || Boolean(callId);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {calling.sandbox ? (
        <Modal
          title={`Sandbox call to ${contactName}`}
          trigger={(open) => (
            <Button variant="lime" disabled={busy} onClick={open}>
              <Phone size={15} /> Call
            </Button>
          )}
        >
          {(close) => (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted">No phones ring in the sandbox. The call plays a scripted conversation, then the recording, transcript and AI notes arrive as they would on a real call.</p>
              <FormField label="Conversation" name="script">
                <Select name="script" value={script} onChange={(e) => setScript(e.target.value)}>
                  {calling.scripts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </FormField>
              <div>
                <Button variant="primary" onClick={() => { close(); place(script); }}>
                  <Phone size={15} /> Start call
                </Button>
              </div>
            </div>
          )}
        </Modal>
      ) : calling.myPhone ? (
        <Button variant="lime" disabled={busy} onClick={() => place()} title={`We ring ${calling.myPhone} first, then ${contactName}`}>
          <Phone size={15} /> {pending ? 'Calling…' : 'Call'}
        </Button>
      ) : (
        <Modal
          title="Your mobile number"
          trigger={(open) => (
            <Button variant="lime" onClick={open}>
              <Phone size={15} /> Call
            </Button>
          )}
        >
          {(close) => (
            <ActionForm action={setMyPhoneAction.bind(null, slug)} onSuccess={() => { close(); place(); }} className="flex flex-col gap-4">
              <p className="text-sm text-muted">We ring your phone first. When you answer, we connect {contactName}. Your number is never shown to clients.</p>
              <FormField label="Your mobile" name="phone"><Input name="phone" type="tel" placeholder="+91 98765 43210" required autoFocus /></FormField>
              <div><SubmitButton>Save & call</SubmitButton></div>
            </ActionForm>
          )}
        </Modal>
      )}
      {err && <span role="alert" className="max-w-xs text-xs font-medium text-danger">{err}</span>}
      {callId && <CallHud slug={slug} callId={callId} contactName={contactName} sandbox={calling.sandbox} onClose={() => setCallId(null)} />}
    </span>
  );
}

/** Ask the AI voice agent to call this lead (qualify + offer a consultation). */
export function AiCallButton({
  slug,
  contactKey,
  contactName,
  voice,
}: {
  slug: string;
  contactKey: string;
  contactName: string;
  voice: { sandbox: boolean; name: string; personas: { id: string; label: string }[] } | null;
}) {
  const [callId, setCallId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [persona, setPersona] = useState(voice?.personas[0]?.id ?? '');
  if (!voice) return null;
  const place = () =>
    start(async () => {
      const r = await startAiCallAction(slug, contactKey, voice.sandbox ? persona : undefined);
      if (r.ok && r.data) {
        setErr(null);
        setCallId(r.data);
      } else if (!r.ok) setErr(r.error);
    });
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Modal
        title={`AI call to ${contactName}`}
        trigger={(open) => (
          <Button disabled={pending || Boolean(callId)} onClick={open}>
            <Bot size={15} /> AI call
          </Button>
        )}
      >
        {(close) => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              {voice.name}, your AI agent, calls {contactName}, says it's an AI and that the call is recorded, asks your qualification questions, saves the answers and offers a free consultation. Outside calling hours it waits for the next slot.
            </p>
            {voice.sandbox && (
              <FormField label="Sandbox caller" name="persona">
                <Select name="persona" value={persona} onChange={(e) => setPersona(e.target.value)}>
                  {voice.personas.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </FormField>
            )}
            <div>
              <Button variant="primary" onClick={() => { close(); place(); }}>
                <Bot size={15} /> Start AI call
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {err && <span role="alert" className="max-w-xs text-xs font-medium text-danger">{err}</span>}
      {callId && <CallHud slug={slug} callId={callId} contactName={contactName} sandbox={voice.sandbox} onClose={() => setCallId(null)} />}
    </span>
  );
}

const ENDED = ['COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'];
const LABEL: Record<string, string> = { NO_ANSWER: 'No answer', BUSY: 'Busy', FAILED: 'Call failed', CANCELED: 'Cancelled' };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function CallHud({ slug, callId, contactName, sandbox, onClose }: { slug: string; callId: string; contactName: string; sandbox: boolean; onClose: () => void }) {
  const router = useRouter();
  const [live, setLive] = useState<Live | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);

  // An AI call queued for later calling hours: nothing more to watch.
  const scheduled = Boolean(live?.status === 'QUEUED' && live.scheduledAt && new Date(live.scheduledAt).getTime() - Date.now() > 60_000);
  const ended = live ? ENDED.includes(live.status) : false;
  const settled = scheduled || (ended && (live!.status !== 'COMPLETED' || !live!.hasRecording || ['done', 'failed', 'skipped'].includes(live!.aiStatus ?? '')));
  const waitingForRecording = ended && live!.status === 'COMPLETED' && !live!.hasRecording;

  useEffect(() => {
    if (settled) {
      if (!refreshed.current) {
        refreshed.current = true;
        router.refresh();
      }
      return;
    }
    let stop = false;
    let polls = 0;
    const tick = async () => {
      const s = await callStatusAction(slug, callId);
      if (stop) return;
      if (s) setLive(s);
      polls++;
      // A completed call without a recording (recording off) settles after a few polls.
      if (s && ENDED.includes(s.status) && !s.hasRecording && polls > 10) setLive({ ...s, aiStatus: 'skipped' });
    };
    void tick();
    const id = setInterval(tick, 1200);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [slug, callId, settled, router]);

  useEffect(() => {
    if (ended) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ended]);

  const talking = live?.status === 'IN_PROGRESS';
  const elapsed = live?.answeredAt ? (now - new Date(live.answeredAt).getTime()) / 1000 : 0;
  const ai = Boolean(live?.aiAgent);
  const status = !live
    ? 'Connecting…'
    : scheduled
      ? `AI call scheduled for ${new Date(live.scheduledAt!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (calling hours)`
      : live.status === 'QUEUED' || live.status === 'RINGING'
        ? ai ? 'AI agent is dialling…' : sandbox ? 'Ringing (sandbox)…' : 'Ringing your phone…'
        : talking
          ? `${ai ? 'AI agent talking · ' : ''}${clock(elapsed)}`
        : live.status === 'COMPLETED'
          ? `Call ended · ${clock(live.durationSec ?? 0)}`
          : (LABEL[live.status] ?? live.status);
  const writing = ended && live?.status === 'COMPLETED' && (live.aiStatus === 'pending' || (live.hasRecording && !live.aiStatus) || waitingForRecording);

  return (
    <div role="status" aria-live="polite" aria-label="Call in progress" className="pop-in fixed right-4 bottom-4 z-50 w-[min(380px,calc(100vw-32px))] rounded-[22px] bg-ink p-4 text-paper shadow-[var(--shadow-pop)]">
      <div className="flex items-center gap-3">
        <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', ended ? 'bg-paper/10' : 'bg-lime text-ink')}>
          {ended ? <PhoneOff size={17} /> : <Phone size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{contactName}</div>
          <div className="text-xs text-paper/70 tabular-nums">{status}</div>
        </div>
        <div className={clsx('wave flex h-6 items-center gap-[3px]', !talking && 'idle')} aria-hidden>
          <span /><span /><span /><span /><span />
        </div>
        {settled && (
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-paper/70 hover:bg-paper/10 hover:text-paper">
            <X size={16} />
          </button>
        )}
      </div>
      {writing && (
        <div className="mt-3 flex items-center gap-2 rounded-[14px] bg-paper/10 px-3 py-2.5 text-xs text-paper/80">
          <Sparkles size={14} className="text-lime" /> {ai ? 'Saving what they said and writing call notes…' : 'Transcribing and writing call notes…'}
        </div>
      )}
      {settled && live?.summary && (
        <div className="mt-3 rounded-[14px] bg-paper/10 px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-lime uppercase">
            <Sparkles size={12} /> Call notes by {AI_SHORT}
          </div>
          <p className="text-[13px] leading-relaxed text-paper/90">{live.summary}</p>
        </div>
      )}
      {settled && live?.aiError && !live.summary && <p className="mt-3 text-xs text-paper/70">{live.aiError}</p>}
      {settled && (
        <Link href={`/${slug}/calls/${callId}`} className="mt-3 inline-flex text-[13px] font-bold text-lime hover:underline">
          Open call →
        </Link>
      )}
    </div>
  );
}
