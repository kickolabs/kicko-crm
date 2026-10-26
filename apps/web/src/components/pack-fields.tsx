'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { PackField } from '@kicko/packs';
import { FormField } from '@/components/forms';
import { Input, Select } from '@/components/ui';
import { inputName, type PackValues, type RepeaterRow } from '@/lib/pack-fields';

// Renders an industry pack's fields inside an ActionForm. The server reads them back with
// readPackForm() and validates them with cleanPackValues().

export type LookupOption = { key: string; name: string; group?: string };
export type Lookups = Record<string, LookupOption[]>;

function grouped(options: LookupOption[], labels?: Record<string, string>) {
  const groups = new Map<string, LookupOption[]>();
  for (const o of options) {
    const g = o.group ? (labels?.[o.group] ?? o.group) : '';
    groups.set(g, [...(groups.get(g) ?? []), o]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
}

function LookupSelect({ name, id, options, value, labels, placeholder, onChange }: { name: string; id?: string; options: LookupOption[]; value?: string; labels?: Record<string, string>; placeholder: string; onChange?: (v: string) => void }) {
  const groups = grouped(options, labels);
  return (
    <Select name={name} defaultValue={onChange ? undefined : (value ?? '')} value={onChange ? (value ?? '') : undefined} onChange={onChange ? (e) => onChange(e.target.value) : undefined} id={id ?? name}>
      <option value="">{placeholder}</option>
      {groups.length === 1 && groups[0]![0] === ''
        ? groups[0]![1].map((o) => <option key={o.key} value={o.key}>{o.name}</option>)
        : groups.map(([g, list]) => (
            <optgroup key={g || 'other'} label={g || 'Other'}>
              {list.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
            </optgroup>
          ))}
    </Select>
  );
}

/** Pick several items: a select to add, chips to remove. Each chip is a hidden input. */
function MultiLookup({ field, options, initial, labels }: { field: PackField; options: LookupOption[]; initial: string[]; labels?: Record<string, string> }) {
  const [keys, setKeys] = useState(initial);
  const name = inputName(field.key);
  const byKey = new Map(options.map((o) => [o.key, o.name]));
  return (
    <div className="flex flex-col gap-2">
      {/* An empty marker so clearing every chip still sends the field. */}
      {keys.length === 0 && <input type="hidden" name={name} value="" />}
      {keys.map((k) => <input key={k} type="hidden" name={name} value={k} />)}
      {keys.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keys.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-paper-2 py-1 pr-1 pl-2.5 text-xs font-semibold">
              {byKey.get(k) ?? k}
              <button type="button" onClick={() => setKeys(keys.filter((x) => x !== k))} aria-label={`Remove ${byKey.get(k) ?? k}`} className="grid size-5 place-items-center rounded-full hover:bg-paper-3">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <LookupSelect
        name={`${name}__add`}
        id={name}
        options={options.filter((o) => !keys.includes(o.key))}
        labels={labels}
        value=""
        placeholder="Add…"
        onChange={(v) => v && setKeys([...keys, v])}
      />
    </div>
  );
}

/** Rows of sub-fields (licences, certificates), sent as one JSON value. */
function Repeater({ field, initial }: { field: PackField; initial: RepeaterRow[] }) {
  const cols = field.columns ?? [];
  const blank = () => Object.fromEntries(cols.map((c) => [c.key, ''])) as RepeaterRow;
  const [rows, setRows] = useState<RepeaterRow[]>(initial.length ? initial : []);
  const update = (i: number, key: string, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={inputName(field.key)} value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div key={i} className="grid items-end gap-2 rounded-[12px] p-2.5 shadow-[inset_0_0_0_1px_var(--color-line-2)] sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))_auto]">
          {cols.map((c) => (
            <label key={c.key} className="flex min-w-0 flex-col gap-1 text-xs font-semibold text-muted">
              {c.label}
              {c.type === 'select' ? (
                <Select value={r[c.key] ?? ''} onChange={(e) => update(i, c.key, e.target.value)} aria-label={`${field.label} ${i + 1}: ${c.label}`}>
                  <option value="">—</option>
                  {c.options?.map((o) => <option key={o}>{o}</option>)}
                </Select>
              ) : (
                <Input
                  type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : c.type === 'month' ? 'month' : 'text'}
                  value={r[c.key] ?? ''}
                  onChange={(e) => update(i, c.key, e.target.value)}
                  aria-label={`${field.label} ${i + 1}: ${c.label}`}
                />
              )}
            </label>
          ))}
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove ${field.label} ${i + 1}`} className="grid size-9 place-items-center rounded-[10px] text-muted hover:bg-paper-2 hover:text-ink">
            <X size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows([...rows, blank()])} className="inline-flex w-fit items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm font-semibold text-ink-2 hover:bg-paper-2">
        <Plus size={14} /> Add {field.label.toLowerCase().replace(/s$/, '').replace(/ & .*$/, '')}
      </button>
    </div>
  );
}

export function PackFieldInput({ field, value, lookups, groupLabels }: { field: PackField; value: unknown; lookups: Lookups; groupLabels?: Record<string, Record<string, string>> }) {
  const name = inputName(field.key);
  const options = field.library ? (lookups[field.library] ?? []) : [];
  const labels = field.library ? groupLabels?.[field.library] : undefined;
  const wide = field.type === 'repeater' || field.type === 'multi_lookup';
  const input = (() => {
    switch (field.type) {
      case 'lookup':
        return <LookupSelect name={name} options={options} labels={labels} value={(value as string) ?? ''} placeholder="Not set" />;
      case 'multi_lookup':
        return <MultiLookup field={field} options={options} labels={labels} initial={(value as string[]) ?? []} />;
      case 'repeater':
        return <Repeater field={field} initial={(value as RepeaterRow[]) ?? []} />;
      case 'select':
        return (
          <Select name={name} defaultValue={(value as string) ?? ''}>
            <option value="">Not set</option>
            {field.options?.map((o) => <option key={o}>{o}</option>)}
          </Select>
        );
      case 'yesno':
        return (
          <Select name={name} defaultValue={value === true ? 'yes' : value === false ? 'no' : ''}>
            <option value="">Not set</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
        );
      case 'number':
        return <Input name={name} type="number" min={0} step="any" defaultValue={value == null ? '' : String(value)} />;
      case 'date':
        return <Input name={name} type="date" defaultValue={(value as string) ?? ''} />;
      default:
        return <Input name={name} defaultValue={(value as string) ?? ''} />;
    }
  })();
  return (
    <FormField label={field.label} name={name} hint={field.hint} className={wide ? 'sm:col-span-2' : undefined}>
      {input}
    </FormField>
  );
}

/** All of a pack's fields for one record, grouped under their section headings. */
export function PackFields({ fields, values, lookups, groupLabels }: { fields: PackField[]; values: PackValues; lookups: Lookups; groupLabels?: Record<string, Record<string, string>> }) {
  const sections = new Map<string, PackField[]>();
  for (const f of fields) sections.set(f.section ?? '', [...(sections.get(f.section ?? '') ?? []), f]);
  return (
    <>
      {[...sections.entries()].map(([title, list]) => (
        <fieldset key={title || 'fields'} className="grid gap-3.5 sm:col-span-2 sm:grid-cols-2">
          {title && <legend className="eyebrow mb-1 sm:col-span-2">{title}</legend>}
          {list.map((f) => <PackFieldInput key={f.key} field={f} value={values[f.key]} lookups={lookups} groupLabels={groupLabels} />)}
        </fieldset>
      ))}
    </>
  );
}
