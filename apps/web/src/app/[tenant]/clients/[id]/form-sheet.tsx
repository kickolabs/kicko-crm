'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Badge, Button, buttonCls, Card, CardHeader, Input, Select, Textarea } from '@/components/ui';
import type { FormTemplate, Sheet } from '@/lib/forms/sheet';

/** A sheet without the form's field functions (those can't be sent to the browser). */
export type SheetView = Omit<Sheet, 'form'> & { form: Pick<FormTemplate, 'id' | 'title' | 'authority' | 'use'> };
import { requestFormAnswersAction, saveFormAnswersAction } from '../../actions-phase6';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title="Copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-paper-2 hover:text-ink"
    >
      {done ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
    </button>
  );
}

const SOURCE: Record<string, { label: string; tone: 'neutral' | 'ok' | 'info' | 'warn' }> = {
  profile: { label: 'Profile', tone: 'neutral' },
  client: { label: 'Client answered', tone: 'ok' },
  staff: { label: 'Staff', tone: 'info' },
  missing: { label: 'Missing', tone: 'warn' },
};

export type AnswerField = { key: string; label: string; type: 'text' | 'date' | 'textarea' | 'yesno'; hint?: string; details?: string; value: string; detailsValue: string };

export function FormSheetView({
  slug,
  clientId,
  sheet,
  text,
  answerFields,
  canWrite,
  requested,
}: {
  slug: string;
  clientId: string;
  sheet: SheetView;
  text: string;
  answerFields: AnswerField[];
  canWrite: boolean;
  requested: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const pct = Math.round((sheet.filled / sheet.total) * 100);
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-ink p-5 text-paper">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold tracking-wide text-paper/60 uppercase">{sheet.form.authority}</div>
            <h2 className="text-xl font-extrabold tracking-tight">{sheet.form.title}</h2>
            <p className="text-xs text-paper/70">{sheet.form.use}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold tabular-nums">{sheet.filled}<span className="text-base text-paper/60">/{sheet.total}</span></div>
            <div className="text-xs text-paper/60">answers ready</div>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-paper/15" aria-hidden><div className="h-full bg-lime" style={{ width: `${pct}%` }} /></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="lime" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setMsg('Copied the whole sheet'); }}>
            <Copy size={14} /> Copy all
          </Button>
          <a href={`/api/t/${slug}/clients/${clientId}/forms/${sheet.form.id}`} target="_blank" rel="noreferrer" className={buttonCls('secondary', 'md')}>
            <Download size={14} /> PDF
          </a>
          {canWrite && sheet.missingAsk.length > 0 && (
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await requestFormAnswersAction(slug, clientId, sheet.form.id);
                  setMsg(r.ok ? `Asked the client for ${r.data} answers in their portal` : r.error);
                })
              }
            >
              {requested ? 'Update request to client' : `Ask client for ${sheet.missingAsk.length} answers`}
            </Button>
          )}
          {msg && <span role="status" className="self-center text-xs text-paper/80">{msg}</span>}
        </div>
        {requested && <p className="text-xs text-lime">Waiting for the client to answer in their portal.</p>}
        {sheet.missingProfile.length > 0 && (
          <p className="text-xs text-paper/70">
            Missing from the profile: {sheet.missingProfile.join(' · ')}. <Link href="?tab=profile" className="font-semibold text-lime underline">Complete the profile</Link>
          </p>
        )}
      </section>

      {sheet.sections.map((s) => (
        <Card key={s.title}>
          <CardHeader title={s.title} />
          <ul className="divide-y divide-line">
            {s.rows.map((r) => (
              <li key={r.label} className="flex flex-wrap items-start gap-3 px-5 py-2.5">
                <span className="w-56 shrink-0 text-[13px] text-muted">{r.label}</span>
                <span className={clsx('min-w-0 flex-1 text-sm whitespace-pre-line', r.value ? 'font-semibold' : 'text-faint')}>{r.value ?? '—'}</span>
                <Badge tone={SOURCE[r.source]!.tone}>{SOURCE[r.source]!.label}</Badge>
                {r.value && <CopyButton text={r.value} label={r.label} />}
              </li>
            ))}
          </ul>
        </Card>
      ))}

      {canWrite && answerFields.length > 0 && (
        <Card>
          <CardHeader title="Answers" sub="Fill in or correct answers. They're shared with every form for this client." />
          <ActionForm action={saveFormAnswersAction.bind(null, slug, clientId)} className="flex flex-col gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {answerFields.map((f) => (
                <div key={f.key} className={clsx('flex flex-col gap-2', f.type === 'textarea' && 'sm:col-span-2')}>
                  <FormField label={f.label} name={f.key} hint={f.hint}>
                    {f.type === 'textarea' ? (
                      <Textarea name={f.key} defaultValue={f.value} className="min-h-16" />
                    ) : f.type === 'yesno' ? (
                      <Select name={f.key} defaultValue={f.value}><option value="">Not answered</option><option value="No">No</option><option value="Yes">Yes</option></Select>
                    ) : (
                      <Input name={f.key} type={f.type === 'date' ? 'date' : 'text'} defaultValue={f.value} />
                    )}
                  </FormField>
                  {f.details && <Input name={`${f.key}.details`} aria-label={`${f.label}: details`} placeholder={`If yes: ${f.details}`} defaultValue={f.detailsValue} />}
                </div>
              ))}
            </div>
            <div><SubmitButton>Save answers</SubmitButton></div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
