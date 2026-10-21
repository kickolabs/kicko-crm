'use client';

import { useState } from 'react';
import { ActionForm, FormBanner, SubmitButton } from '@/components/forms';
import { Card, CardHeader } from '@/components/ui';
import { saveAiFeaturesAction } from '../actions-phase5';

export function AiFeaturesCard({ slug, docChecks }: { slug: string; docChecks: boolean }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title="AI features" sub="AI suggests; your team decides. Results are always marked as AI." />
      <ActionForm action={saveAiFeaturesAction.bind(null, slug)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4 p-5">
        {saved && <FormBanner tone="ok">Saved.</FormBanner>}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="docChecks" defaultChecked={docChecks} className="mt-0.5 h-4 w-4 accent-ink" />
          <span>
            <strong>Check uploaded documents</strong>
            <br />
            <span className="text-muted">Reads each upload: is it the right document, is it legible, do the name, date of birth and passport number match the client, and is it expired? Flags show on the checklist and in review.</span>
          </span>
        </label>
        <p className="text-xs text-muted">Call notes and the WhatsApp and voice assistants are switched on in their own tabs. Eligibility calculators are on each client's Eligibility tab.</p>
        <div><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}
