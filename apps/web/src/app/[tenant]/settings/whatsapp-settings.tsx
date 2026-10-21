'use client';

import { useState, useTransition } from 'react';
import { ActionButton, ActionForm, CopyField, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input, Select, Textarea } from '@/components/ui';
import {
  deleteAutomationAction,
  sandboxOutboxAction,
  saveAutomationAction,
  simulateInboundAction,
  syncTemplatesAction,
  toggleAutomationAction,
} from '../actions-phase4';

type Tpl = { value: string; name: string; language: string; category: string; status: string; body: string; variables: number };
type Rule = { id: string; trigger: string; triggerLabel: string; stage: string | null; template: string; active: boolean };

export function TemplatesCard({ slug, templates, live, suggestions }: { slug: string; templates: Tpl[]; live: boolean; suggestions: { name: string; category: string; body: string }[] }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Message templates"
        sub="WhatsApp only lets you start a conversation, or reply after 24 hours, with templates Meta has approved."
        action={
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await syncTemplatesAction(slug);
                setMsg(r.ok ? `Synced ${r.data} templates` : r.error);
              })
            }
          >
            {pending ? 'Syncing…' : 'Sync from Meta'}
          </Button>
        }
      />
      {msg && <p className="px-5 pt-3 text-sm font-semibold">{msg}</p>}
      <ul className="divide-y divide-line">
        {templates.length === 0 && <li className="px-5 py-4 text-sm text-muted">No templates yet.</li>}
        {templates.map((t) => (
          <li key={t.value} className="flex flex-col gap-1 px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-bold">{t.name}</span>
              <span className="text-xs text-muted">{t.language} · {t.category.toLowerCase()} · {t.variables} field{t.variables === 1 ? '' : 's'}</span>
              <Badge tone={t.status === 'APPROVED' ? 'ok' : t.status === 'REJECTED' ? 'danger' : 'warn'}>{t.status.toLowerCase()}</Badge>
            </div>
            <p className="text-[13px] text-ink-2">{t.body}</p>
          </li>
        ))}
      </ul>
      {live && (
        <details className="border-t border-line px-5 py-4">
          <summary className="cursor-pointer text-sm font-semibold">Suggested templates to create in Meta Business Manager</summary>
          <p className="mt-2 text-xs text-muted">Create these (same names) so the built-in automations and portal-link sending work. Meta reviews them, usually within a day.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {suggestions.map((s) => (
              <li key={s.name} className="rounded-[10px] bg-paper-3 p-3 text-[13px]"><span className="font-mono font-bold">{s.name}</span> <span className="text-xs text-muted">({s.category.toLowerCase()})</span><br />{s.body}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

export function AutomationsCard({
  slug,
  rules,
  triggers,
  stages,
  templates,
}: {
  slug: string;
  rules: Rule[];
  triggers: { value: string; label: string; vars: string[] }[];
  stages: { key: string; name: string }[];
  templates: Tpl[];
}) {
  const [trigger, setTrigger] = useState(triggers[0]!.value);
  const info = triggers.find((t) => t.value === trigger)!;
  return (
    <Card>
      <CardHeader title="Automations" sub="Send a WhatsApp template automatically when something happens. Only to clients who opted in." />
      <ul className="divide-y divide-line">
        {rules.length === 0 && <li className="px-5 py-4 text-sm text-muted">No automations yet.</li>}
        {rules.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <strong>{r.triggerLabel}</strong>{r.stage ? `: ${r.stage}` : ''} → <span className="font-mono">{r.template}</span>
            </span>
            <ActionButton action={() => toggleAutomationAction(slug, r.id, !r.active)} variant={r.active ? 'secondary' : 'ghost'}>{r.active ? 'On' : 'Off'}</ActionButton>
            <ActionButton action={() => deleteAutomationAction(slug, r.id)} variant="ghost" confirm="Delete this automation?">Delete</ActionButton>
          </li>
        ))}
      </ul>
      <ActionForm action={saveAutomationAction.bind(null, slug)} resetOnSuccess className="flex flex-col gap-3 border-t border-line p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="When" name="trigger">
            <Select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {triggers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </FormField>
          {trigger === 'CASE_STAGE' && (
            <FormField label="Stage" name="stageKey">
              <Select name="stageKey" defaultValue="">
                <option value="">Any stage</option>
                {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </Select>
            </FormField>
          )}
          <FormField label="Send template" name="template">
            <Select name="template" defaultValue="">
              <option value="" disabled>Choose…</option>
              {templates.map((t) => <option key={t.value} value={t.value}>{t.name}</option>)}
            </Select>
          </FormField>
        </div>
        <p className="text-xs text-muted">Template fields are filled in order: {info.vars.map((v, i) => `{{${i + 1}}} ${v}`).join(' · ')}</p>
        <div><SubmitButton>Add automation</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}

export function SimulatorCard({ slug }: { slug: string }) {
  const [outbox, setOutbox] = useState<{ at: string; to: string; body: string }[] | null>(null);
  const [sent, setSent] = useState(0);
  const [aiNote, setAiNote] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Simulator" sub="Pretend to be a customer. Sends a real, signed Meta-format webhook to your endpoint." />
      <ActionForm action={simulateInboundAction.bind(null, slug)} onSuccess={(r) => { setSent((n) => n + 1); setAiNote(r.ok ? ((r.data as string | null | undefined) ?? null) : null); }} className="flex flex-col gap-3 p-5">
        {sent > 0 && <FormBanner tone="ok">Delivered to your webhook ({sent}). Check the Inbox.</FormBanner>}
        {sent > 0 && aiNote && <p role="status" className="-mt-1 text-[13px] text-ink-2">{aiNote}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Customer phone" name="from"><Input name="from" defaultValue="+91 98765 43210" /></FormField>
          <FormField label="WhatsApp profile name" name="name"><Input name="name" placeholder="e.g. Karthik S" /></FormField>
        </div>
        <FormField label="Message" name="text"><Textarea name="text" className="min-h-16" placeholder="Hi, I want to study in Canada…" /></FormField>
        <FormField label="Attach a file (optional)" name="file" hint="Arrives as a WhatsApp document">
          <input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" className="text-sm" />
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton>Send as customer</SubmitButton>
          <Button size="md" variant="ghost" onClick={async () => setOutbox(await sandboxOutboxAction(slug))}>Show what Kicko sent to Meta</Button>
        </div>
      </ActionForm>
      {outbox && (
        <div className="border-t border-line p-5">
          {outbox.length === 0 ? (
            <p className="text-sm text-muted">Nothing sent yet (since the server started).</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {outbox.map((o, i) => (
                <li key={i} className="rounded-[10px] bg-ink p-3 font-mono text-[11px] leading-relaxed break-all text-paper">
                  <span className="text-lime">POST /{'{phone-number-id}'}/messages</span> · {new Date(o.at).toLocaleTimeString()}<br />{o.body}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}
