'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { ActionButton, ActionForm, SubmitButton } from '@/components/forms';
import { Input } from '@/components/ui';
import { addCallTaskAction, cancelQueuedCallAction, applyCallFieldsAction, recordingUrlAction, retryCallNotesAction, setCallOutcomeAction } from '../../actions-phase5';

export function RecordingPlayer({ slug, callId }: { slug: string; callId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void recordingUrlAction(slug, callId).then(setSrc);
  }, [slug, callId]);
  if (!src) return <div className="h-10 animate-pulse rounded-full bg-paper/10" aria-label="Loading recording" />;
  return <audio controls src={src} className="w-full" aria-label="Call recording" />;
}

export function AddTaskButton({ slug, callId, index, added }: { slug: string; callId: string; index: number; added: boolean }) {
  if (added) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-lime">
        <Check size={13} /> Added
      </span>
    );
  }
  return (
    <ActionButton action={() => addCallTaskAction(slug, callId, index)} size="sm" className="bg-paper/10 text-paper hover:bg-paper/20">
      <Plus size={13} /> Add task
    </ActionButton>
  );
}

export function ApplyFieldsButton({ slug, callId }: { slug: string; callId: string }) {
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs font-semibold text-ok">Applied to the record</span>;
  return (
    <ActionButton
      action={async () => {
        const r = await applyCallFieldsAction(slug, callId);
        if (r.ok) setDone(true);
        return r;
      }}
      variant="primary"
    >
      Apply to record
    </ActionButton>
  );
}

export function CancelQueued({ slug, callId }: { slug: string; callId: string }) {
  return <ActionButton action={() => cancelQueuedCallAction(slug, callId)} size="md" confirm="Cancel this scheduled AI call?">Cancel call</ActionButton>;
}

export function RetryNotes({ slug, callId }: { slug: string; callId: string }) {
  return <ActionButton action={() => retryCallNotesAction(slug, callId)} size="md">Try again</ActionButton>;
}

export function OutcomeForm({ slug, callId, outcome }: { slug: string; callId: string; outcome: string | null }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={setCallOutcomeAction.bind(null, slug, callId)} onSuccess={() => { setSaved(true); router.refresh(); }} className="flex flex-wrap items-center gap-2">
      <Input name="outcome" aria-label="Call outcome" defaultValue={outcome ?? ''} placeholder="e.g. Consultation booked, Not interested" className="min-w-0 flex-1" list="call-outcomes" />
      <datalist id="call-outcomes">
        {['Consultation booked', 'Call back later', 'Interested', 'Not interested', 'Wrong number', 'Payment promised'].map((o) => <option key={o} value={o} />)}
      </datalist>
      <SubmitButton variant="secondary">{saved ? 'Saved' : 'Save'}</SubmitButton>
    </ActionForm>
  );
}
