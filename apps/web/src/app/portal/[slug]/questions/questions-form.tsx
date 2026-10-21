'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Textarea } from '@/components/ui';
import { portalAnswersAction } from '../actions';

type Q = { key: string; label: string; type: 'text' | 'date' | 'textarea' | 'yesno'; hint?: string; details?: string; value: string };

function YesNo({ q }: { q: Q & { detailsValue?: string } }) {
  const [v, setV] = useState(q.value);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[15px] font-semibold">{q.label}</legend>
      <div className="flex gap-2">
        {['No', 'Yes'].map((o) => (
          <label key={o} className={clsx('flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold', v === o ? 'bg-ink text-paper' : 'bg-paper-3')}>
            <input type="radio" name={q.key} value={o} checked={v === o} onChange={() => setV(o)} className="sr-only" />
            {o}
          </label>
        ))}
      </div>
      {v === 'Yes' && q.details && (
        <Textarea name={`${q.key}.details`} aria-label={`${q.label}: details`} placeholder={q.details} defaultValue={q.detailsValue} className="min-h-16" />
      )}
    </fieldset>
  );
}

export function QuestionsForm({ slug, questions }: { slug: string; questions: (Q & { details?: string })[] }) {
  const [done, setDone] = useState(false);
  return (
    <ActionForm action={portalAnswersAction.bind(null, slug)} onSuccess={() => setDone(true)} className="card flex flex-col gap-6 p-6">
      {done && <FormBanner tone="ok">Saved. Thank you! Your consultant can see your answers now.</FormBanner>}
      {questions.map((q) =>
        q.type === 'yesno' ? (
          <YesNo key={q.key} q={q} />
        ) : (
          <FormField key={q.key} label={q.label} name={q.key} hint={q.hint}>
            {q.type === 'textarea' ? (
              <Textarea name={q.key} defaultValue={q.value} className="min-h-20" />
            ) : (
              <Input name={q.key} type={q.type === 'date' ? 'date' : 'text'} defaultValue={q.value} />
            )}
          </FormField>
        ),
      )}
      <div><SubmitButton size="lg">Save answers</SubmitButton></div>
    </ActionForm>
  );
}
