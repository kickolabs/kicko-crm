'use client';

import { useState } from 'react';
import { ActionButton, ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import { createLibraryItemAction, importLibraryAction, markVerifiedAction, saveLibraryItemAction, setLibraryStatusAction } from '../actions';

export function LibraryItemForm({ id, name, parentKey, coverage, unverified, data, sources, parentType }: { id: string; name: string; parentKey: string | null; coverage: string | null; unverified: boolean; data: string; sources: string; parentType?: string }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  return (
    <ActionForm action={saveLibraryItemAction.bind(null, id)} onSuccess={(r) => setSaved(Boolean((r as { data?: boolean } | undefined)?.data ?? true))} className="flex flex-col gap-4">
      {saved !== null && <FormBanner tone="ok">{saved ? 'Saved as a new version. Agencies using it will see an update.' : 'No changes.'}</FormBanner>}
      <div className="grid gap-3.5 sm:grid-cols-3">
        <FormField label="Name" name="name" className="sm:col-span-2"><Input name="name" defaultValue={name} required /></FormField>
        {parentType && <FormField label={`Parent (${parentType} key)`} name="parentKey"><Input name="parentKey" defaultValue={parentKey ?? ''} /></FormField>}
        <FormField label="Coverage" name="coverage">
          <Select name="coverage" defaultValue={coverage ?? ''}>
            <option value="">—</option>
            <option value="basic">Basic</option>
            <option value="full">Full</option>
          </Select>
        </FormField>
        <label className="flex h-10 items-center gap-2 self-end text-sm font-semibold">
          <input type="checkbox" name="unverified" defaultChecked={unverified} className="size-4 accent-[var(--color-ink)]" /> Some details not verified
        </label>
      </div>
      <FormField label="Data (JSON)" name="data" hint="Pathways: summary, eligibility[], steps[], documents[], stages[], fees[], processing, portalUrl, occupations[{ group, eligibility }]…">
        <Textarea name="data" defaultValue={data} className="min-h-[420px] font-mono text-[12px]" spellCheck={false} />
      </FormField>
      <FormField label="Sources (JSON)" name="sources" hint={'[{ "url", "title", "publisher", "official": true, "verifiedAt": "YYYY-MM-DD" }]: official pages first'}>
        <Textarea name="sources" defaultValue={sources} className="min-h-40 font-mono text-[12px]" spellCheck={false} />
      </FormField>
      <div className="flex justify-end"><SubmitButton>Save new version</SubmitButton></div>
    </ActionForm>
  );
}

export function VerifyForm({ id }: { id: string }) {
  const [done, setDone] = useState(false);
  return (
    <ActionForm action={markVerifiedAction.bind(null, id)} onSuccess={() => setDone(true)} className="flex flex-col gap-3">
      {done && <FormBanner tone="ok">Marked as verified today.</FormBanner>}
      <FormField label="What did you check?" name="note"><Input name="note" placeholder="e.g. Fees and documents against the embassy page" /></FormField>
      <SubmitButton variant="secondary">Mark verified</SubmitButton>
    </ActionForm>
  );
}

export function StatusButton({ id, status }: { id: string; status: string }) {
  return status === 'archived' ? (
    <ActionButton action={() => setLibraryStatusAction(id, 'published')}>Publish again</ActionButton>
  ) : (
    <ActionButton action={() => setLibraryStatusAction(id, 'archived')} variant="danger" confirm="Archive this item? Agencies can no longer add it; existing workflows keep their copy.">Archive</ActionButton>
  );
}

export function NewItemForm({ pack, types }: { pack: string; types: [string, string][] }) {
  return (
    <ActionForm action={createLibraryItemAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_1.5fr_1fr_auto] sm:items-end">
      <input type="hidden" name="pack" value={pack} />
      <FormField label="Type" name="type">
        <Select name="type">{types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
      </FormField>
      <FormField label="Key" name="key"><Input name="key" placeholder="e.g. DE_PFLEGE" required /></FormField>
      <FormField label="Name" name="name"><Input name="name" required /></FormField>
      <FormField label="Parent key" name="parentKey"><Input name="parentKey" placeholder="e.g. DE" /></FormField>
      <SubmitButton>Add</SubmitButton>
    </ActionForm>
  );
}

export function ImportForm({ pack }: { pack: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <ActionForm
      action={importLibraryAction.bind(null, pack)}
      onSuccess={(r) => {
        const d = (r as { data?: { created: number; updated: number; unchanged: number } })?.data;
        if (d) setMsg(`${d.created} added, ${d.updated} updated (new versions), ${d.unchanged} unchanged.`);
      }}
      className="flex flex-wrap items-end gap-3"
    >
      {msg && <div className="w-full"><FormBanner tone="ok">{msg}</FormBanner></div>}
      <FormField label="Import library.json" name="file" className="min-w-64 flex-1"><Input name="file" type="file" accept="application/json,.json" required /></FormField>
      <SubmitButton variant="secondary">Import</SubmitButton>
    </ActionForm>
  );
}
