'use client';

import { useState } from 'react';
import { ActionForm, FormBanner, SubmitButton } from '@/components/forms';
import { PackFields } from '@/components/pack-fields';
import type { PackValues } from '@/lib/pack-fields';
import type { PackFormProps } from '@/server/library';
import { ActionButton } from '@/components/forms';
import { sendQuestionnaireAction, updateClientPackAction } from '../../actions';

/** The professional profile: occupation, qualifications, licences, preferences, assessment. */
export function ProfessionForm({ slug, clientId, values, form }: { slug: string; clientId: string; values: PackValues; form: PackFormProps }) {
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={updateClientPackAction.bind(null, slug, clientId)} onSuccess={() => setSaved(true)} className="flex flex-col gap-5">
      {saved && <FormBanner tone="ok">Profile saved.</FormBanner>}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <PackFields fields={form.fields} values={values} lookups={form.lookups} groupLabels={form.groupLabels} />
      </div>
      <div className="flex justify-end">
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Ask the client to fill in a questionnaire in their portal, in their language. */
export function SendQuestionnaire({ slug, clientId, items }: { slug: string; clientId: string; items: { key: string; title: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-paper-2 px-4 py-3 text-sm">
      <span className="min-w-0 flex-1 text-ink-2">Let the client answer these in their portal, in their own language.</span>
      {items.map((q) => (
        <ActionButton key={q.key} action={() => sendQuestionnaireAction(slug, clientId, q.key)}>
          Send “{q.title}”
        </ActionButton>
      ))}
    </div>
  );
}
