'use client';

import { useState } from 'react';
import { ActionForm, FormBanner, SubmitButton } from '@/components/forms';
import { Card, CardHeader } from '@/components/ui';
import { AI_BRAND } from '@/lib/brand';
import { saveAiFeaturesAction } from '../actions-phase5';

export function AiFeaturesCard({ slug, docChecks, improve, shared }: { slug: string; docChecks: boolean; improve: boolean; shared: number }) {
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <CardHeader title={AI_BRAND} sub="Kicko's AI suggests; your team decides. Its results are always marked." />
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
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="improve" defaultChecked={improve} className="mt-0.5 h-4 w-4 accent-ink" />
          <span>
            <strong>Help improve {AI_BRAND}</strong>
            <br />
            <span className="text-muted">
              Share anonymised feedback: what {AI_BRAND} suggested and whether your team agreed (for example, a document it flagged that was verified anyway). Names, numbers, dates and files are never included. Off by default; turning it off deletes what was shared.
              {improve && shared > 0 && ` ${shared.toLocaleString('en-IN')} example${shared === 1 ? '' : 's'} shared so far.`}
            </span>
          </span>
        </label>
        <p className="text-xs text-muted">Call notes and the WhatsApp and voice assistants are switched on in their own tabs. Eligibility calculators are on each client's Eligibility tab.</p>
        <div><SubmitButton>Save</SubmitButton></div>
      </ActionForm>
    </Card>
  );
}
