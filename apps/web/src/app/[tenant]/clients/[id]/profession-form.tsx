'use client';

import { useState } from 'react';
import { ActionForm, FormBanner, SubmitButton } from '@/components/forms';
import { PackFields } from '@/components/pack-fields';
import type { PackValues } from '@/lib/pack-fields';
import type { PackFormProps } from '@/server/library';
import { updateClientPackAction } from '../../actions';

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
