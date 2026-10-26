'use client';

import { useState } from 'react';
import { ActionButton, ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import { addOwnItemAction, saveTemplateAction, setFieldHiddenAction, setLibraryHiddenAction } from '../actions';

type Template = { id: string; name: string; kind: string; signature: boolean; body: string; active: boolean };

export function TemplateEditor({ slug, template, fields }: { slug: string; template?: Template; fields: [string, string][] }) {
  const [saved, setSaved] = useState(false);
  return (
    <ActionForm action={saveTemplateAction.bind(null, slug, template?.id ?? null)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4">
      {saved && <FormBanner tone="ok">Template saved. Documents already created keep their text.</FormBanner>}
      <div className="grid gap-3.5 sm:grid-cols-[2fr_1fr]">
        <FormField label="Name" name="name"><Input name="name" defaultValue={template?.name} required /></FormField>
        <FormField label="Kind" name="kind">
          <Select name="kind" defaultValue={template?.kind ?? 'letter'}>
            <option value="agreement">Agreement</option>
            <option value="letter">Letter</option>
            <option value="form">Form</option>
          </Select>
        </FormField>
      </div>
      <div className="flex flex-wrap gap-5 text-sm font-semibold">
        <label className="flex items-center gap-2"><input type="checkbox" name="signature" defaultChecked={template?.signature} className="size-4 accent-[var(--color-ink)]" /> Client signs it in the portal</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={template?.active ?? true} className="size-4 accent-[var(--color-ink)]" /> In use</label>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <FormField label="Text" name="body" hint="# Heading, ## Subheading, - list item, --- line, [signature] where the client signs, **bold**. Fields in {{double braces}}.">
          <Textarea name="body" defaultValue={template?.body} className="min-h-[460px] font-mono text-[13px]" required />
        </FormField>
        <div className="flex flex-col gap-1 text-xs">
          <span className="eyebrow mb-1">Fields you can use</span>
          {fields.map(([k, v]) => (
            <span key={k}><code className="font-mono text-ink-2">{`{{${k}}}`}</code> <span className="text-muted">{v}</span></span>
          ))}
        </div>
      </div>
      <div className="flex justify-end"><SubmitButton>Save template</SubmitButton></div>
    </ActionForm>
  );
}

export function OwnItemForm({ slug, type, groups }: { slug: string; type: string; groups?: [string, string][] }) {
  return (
    <ActionForm action={addOwnItemAction.bind(null, slug, type)} resetOnSuccess className="flex flex-wrap items-end gap-2.5">
      <FormField label="Add your own" name="name" className="min-w-56 flex-1"><Input name="name" placeholder="e.g. Tower crane operator" required /></FormField>
      {groups && (
        <FormField label="Group" name="group">
          <Select name="group">{groups.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </FormField>
      )}
      <SubmitButton variant="secondary">Add</SubmitButton>
    </ActionForm>
  );
}

export function HideToggle({ slug, type, itemKey, hidden }: { slug: string; type: string; itemKey: string; hidden: boolean }) {
  return (
    <ActionButton action={() => setLibraryHiddenAction(slug, type, itemKey, !hidden)} variant="ghost">
      {itemKey.startsWith('own_') ? 'Remove' : hidden ? 'Show' : 'Hide'}
    </ActionButton>
  );
}

export function FieldToggle({ slug, entity, fieldKey, hidden }: { slug: string; entity: 'leads' | 'clients' | 'cases'; fieldKey: string; hidden: boolean }) {
  return (
    <ActionButton action={() => setFieldHiddenAction(slug, entity, fieldKey, !hidden)} variant={hidden ? 'secondary' : 'ghost'}>
      {hidden ? 'Show on forms' : 'Hide'}
    </ActionButton>
  );
}

