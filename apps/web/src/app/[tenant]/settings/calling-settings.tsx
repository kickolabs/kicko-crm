'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Card, CardHeader, Input, Select } from '@/components/ui';
import { saveCallingSettingsAction, setMyPhoneAction, simulateInboundCallAction } from '../actions-phase5';

export function MyPhoneCard({ slug, phone }: { slug: string; phone: string | null }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title="Your phone" sub="Click-to-call rings this number first, then connects the client. Incoming calls for your clients ring here too." />
      <ActionForm action={setMyPhoneAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-wrap items-end gap-3 p-5">
        {saved && <div className="w-full"><FormBanner tone="ok">Saved.</FormBanner></div>}
        <FormField label="Your mobile" name="phone" className="min-w-56 flex-1">
          <Input name="phone" type="tel" defaultValue={phone ?? ''} placeholder="+91 98765 43210" />
        </FormField>
        <SubmitButton>Save number</SubmitButton>
      </ActionForm>
    </Card>
  );
}

export function CallingPrefsCard({ slug, cfg }: { slug: string; cfg: { record: boolean; greeting?: string; aiNotes: boolean } }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title="Recording & AI notes" sub="Applies to every call in this workspace" />
      <ActionForm action={saveCallingSettingsAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4 p-5">
        {saved && <FormBanner tone="ok">Calling preferences saved.</FormBanner>}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="record" defaultChecked={cfg.record} className="mt-0.5 h-4 w-4 accent-ink" />
          <span><strong>Record calls</strong><br /><span className="text-muted">Both parties hear the announcement below first. Recording without consent isn't allowed in many countries.</span></span>
        </label>
        <FormField label="Recording announcement" name="greeting">
          <Input name="greeting" defaultValue={cfg.greeting ?? ''} maxLength={240} />
        </FormField>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="aiNotes" defaultChecked={cfg.aiNotes} className="mt-0.5 h-4 w-4 accent-ink" />
          <span><strong>AI call notes</strong><br /><span className="text-muted">Transcribe recorded calls and write a summary, next steps and suggested tasks.</span></span>
        </label>
        <div><SubmitButton>Save preferences</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

export function CallSimulatorCard({ slug, scripts }: { slug: string; scripts: { id: string; label: string }[] }) {
  const [callId, setCallId] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Call simulator" sub="Pretend a client calls your number. It's routed, recorded and summarised exactly like a real call." />
      <ActionForm
        action={simulateInboundCallAction.bind(null, slug)}
        onSuccess={(r) => setCallId(r.ok ? ((r.data as string | undefined) ?? null) : null)}
        className="flex flex-col gap-3.5 p-5"
      >
        {callId && (
          <FormBanner tone="ok">
            Incoming call received. <Link href={`/${slug}/calls/${callId}`} className="font-bold underline">Open call</Link>
          </FormBanner>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Caller's number" name="from"><Input name="from" type="tel" defaultValue="+91 98400 55667" required /></FormField>
          <FormField label="Conversation" name="script">
            <Select name="script">{scripts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          </FormField>
        </div>
        <div><SubmitButton>Simulate incoming call</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}
