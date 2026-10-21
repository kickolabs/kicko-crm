'use client';

import { useState } from 'react';
import { ActionForm, FormField, SubmitButton } from '@/components/forms';
import { Button, Input, Select } from '@/components/ui';
import { cfDisplay, type CfDef, type CfEntity, type CfValues } from '@/lib/custom-fields';
import { setCustomValuesAction } from '../actions-phase7';

export function CustomFieldsForm({ slug, entity, recordId, defs, values, editable }: { slug: string; entity: CfEntity; recordId: string; defs: CfDef[]; values: CfValues; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const filled = defs.filter((d) => values[d.key] !== undefined && values[d.key] !== '');

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        {filled.length ? (
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            {filled.map((d) => (
              <div key={d.key} className="flex flex-col gap-0.5">
                <dt className="text-xs font-semibold text-muted">{d.label}</dt>
                <dd>{cfDisplay(d, values[d.key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">Nothing filled in yet.</p>
        )}
        {editable && <Button size="sm" className="self-start" onClick={() => setEditing(true)}>Edit details</Button>}
      </div>
    );
  }

  return (
    <ActionForm action={setCustomValuesAction.bind(null, slug, entity, recordId)} onSuccess={() => setEditing(false)} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((d) => {
          const v = values[d.key];
          return (
            <FormField key={d.key} label={d.label} name={d.key}>
              {d.type === 'select' ? (
                <Select id={d.key} name={d.key} defaultValue={typeof v === 'string' ? v : ''}>
                  <option value="">—</option>
                  {d.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  {typeof v === 'string' && v && !d.options.includes(v) && <option value={v}>{v}</option>}
                </Select>
              ) : d.type === 'yesno' ? (
                <Select id={d.key} name={d.key} defaultValue={v === true ? 'yes' : v === false ? 'no' : ''}>
                  <option value="">—</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              ) : (
                <Input
                  id={d.key}
                  name={d.key}
                  type={d.type === 'date' ? 'date' : 'text'}
                  inputMode={d.type === 'number' ? 'decimal' : undefined}
                  defaultValue={v === undefined ? '' : String(v)}
                />
              )}
            </FormField>
          );
        })}
      </div>
      <div className="flex gap-2">
        <SubmitButton size="sm">Save details</SubmitButton>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </ActionForm>
  );
}
