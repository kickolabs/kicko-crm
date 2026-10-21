'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { ActionButton, ActionForm, FormField, Modal, SubmitButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input, Select, Textarea } from '@/components/ui';
import { CF_ENTITIES, CF_LIMIT, CF_TYPES, type CfEntity, type CfType } from '@/lib/custom-fields';
import { createFieldAction, editFieldAction, moveFieldAction, updateFieldAction } from '../actions-phase7';

type Field = { id: string; entity: CfEntity; key: string; label: string; type: CfType; options: string[]; archived: boolean };

const TYPE_LABEL = Object.fromEntries(CF_TYPES.map((t) => [t.id, t.label])) as Record<CfType, string>;

export function CustomFieldsSettings({ slug, fields }: { slug: string; fields: Field[] }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Add the details your agency tracks that Kicko doesn’t have out of the box, like intake, budget, IELTS band or referral partner. They appear under “Additional details” on each record, can be filled from an import, and can be used in reports.
      </p>
      {CF_ENTITIES.map((e) => (
        <EntityFields key={e.id} slug={slug} entity={e.id} title={e.label} one={e.one} fields={fields.filter((f) => f.entity === e.id)} />
      ))}
    </div>
  );
}

function EntityFields({ slug, entity, title, one, fields }: { slug: string; entity: CfEntity; title: string; one: string; fields: Field[] }) {
  const active = fields.filter((f) => !f.archived);
  const archived = fields.filter((f) => f.archived);
  return (
    <Card>
      <CardHeader title={`${title} fields`} sub={`${active.length} of ${CF_LIMIT}`} />
      <ul className="divide-y divide-line" aria-label={`${title} fields`}>
        {active.length === 0 && <li className="px-5 py-4 text-sm text-muted">No custom fields on {title.toLowerCase()} yet.</li>}
        {active.map((f, i) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-semibold"><span>{f.label}</span> <Badge>{TYPE_LABEL[f.type]}</Badge></div>
              {f.type === 'select' && <div className="truncate text-xs text-muted">{f.options.join(' · ')}</div>}
            </div>
            <div className="flex items-center gap-1">
              <ActionButton action={() => moveFieldAction(slug, f.id, -1)} variant="ghost" title={`Move ${f.label} up`} className={i === 0 ? 'invisible' : ''}><ArrowUp size={14} /></ActionButton>
              <ActionButton action={() => moveFieldAction(slug, f.id, 1)} variant="ghost" title={`Move ${f.label} down`} className={i === active.length - 1 ? 'invisible' : ''}><ArrowDown size={14} /></ActionButton>
              <Modal
                title={`Edit “${f.label}”`}
                trigger={(open) => <Button size="sm" variant="ghost" onClick={open}>Edit</Button>}
              >
                {(close) => (
                  <ActionForm action={editFieldAction.bind(null, slug, f.id)} onSuccess={close} className="flex flex-col gap-4">
                    <FormField label="Name" name="label"><Input id="label" name="label" defaultValue={f.label} /></FormField>
                    {f.type === 'select' && (
                      <FormField label="Options" name="options" hint="One per line. Records keep a removed option until changed.">
                        <Textarea id="options" name="options" rows={6} defaultValue={f.options.join('\n')} />
                      </FormField>
                    )}
                    <p className="text-xs text-muted">The type ({TYPE_LABEL[f.type]}) can’t be changed, because existing values might not fit.</p>
                    <SubmitButton>Save</SubmitButton>
                  </ActionForm>
                )}
              </Modal>
              <ActionButton action={() => updateFieldAction(slug, f.id, { archived: true })} variant="ghost" confirm={`Archive “${f.label}”? It disappears from forms; values already saved are kept and can be restored.`}>
                Archive
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
      {archived.length > 0 && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-muted">{archived.length} archived</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {archived.map((f) => (
              <li key={f.id} className="flex items-center gap-2">
                <span className="flex-1">{f.label} <span className="text-xs text-muted">({TYPE_LABEL[f.type]})</span></span>
                <ActionButton action={() => updateFieldAction(slug, f.id, { archived: false })} variant="ghost">Restore</ActionButton>
              </li>
            ))}
          </ul>
        </details>
      )}
      <AddField slug={slug} entity={entity} one={one} />
    </Card>
  );
}

function AddField({ slug, entity, one }: { slug: string; entity: CfEntity; one: string }) {
  const [type, setType] = useState<CfType>('text');
  const p = `${entity}-`; // ids are unique across the three forms on the page
  return (
    <ActionForm action={createFieldAction.bind(null, slug)} resetOnSuccess onSuccess={() => setType('text')} className="flex flex-col gap-3 border-t border-line bg-paper-3/50 px-5 py-4">
      <input type="hidden" name="entity" value={entity} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          New {one} field
          <Input name="label" placeholder="e.g. Intake" aria-label={`New ${one} field name`} id={`${p}label`} />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Type
          <Select name="type" value={type} onChange={(e) => setType(e.target.value as CfType)} aria-label={`New ${one} field type`} id={`${p}type`}>
            {CF_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </label>
        <SubmitButton size="md" variant="secondary">Add field</SubmitButton>
      </div>
      {type === 'select' && (
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
          Options
          <Textarea name="options" rows={3} placeholder={'Jan\nMay\nSept'} aria-label={`New ${one} field options`} id={`${p}options`} />
          <span className="text-xs font-normal text-muted">One per line</span>
        </label>
      )}
      <span className="text-xs text-muted">{CF_TYPES.find((t) => t.id === type)?.hint}</span>
    </ActionForm>
  );
}
