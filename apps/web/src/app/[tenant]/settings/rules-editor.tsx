'use client';

import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ActionButton, ActionForm, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Input, Select, Textarea } from '@/components/ui';
import { deleteRuleAction, saveRuleAction } from '../actions';

type Opt = [string, string];
type Action = { type: string } & Record<string, string | number>;
export type RuleEditorProps = {
  slug: string;
  rule?: { id: string; name: string; trigger: string; conditions: Record<string, string>; actions: Action[]; active: boolean };
  triggers: { key: string; label: string; conditions: string[] }[];
  actionTypes: Opt[];
  conditionLabels: Record<string, string>;
  /** Choices for condition fields that have a fixed list (status, source, country…). */
  choices: Record<string, Opt[]>;
  team: Opt[];
};

const blank = (type: string): Action =>
  type === 'create_task' ? { type, title: '', dueDays: 1, assignTo: 'owner' }
  : type === 'assign_owner' ? { type, to: 'least_loaded' }
  : type === 'notify' ? { type, to: 'owner', text: '' }
  : type === 'whatsapp' ? { type, template: '', language: 'en' }
  : type === 'email' ? { type, subject: '', body: '' }
  : { type, status: 'CONTACTED' };

/** "When … and …, do …": up to five actions. Texts can use {{name}}, {{firstName}}, {{stage}}, {{document}}, {{workflow}}. */
export function RuleEditor({ slug, rule, triggers, actionTypes, conditionLabels, choices, team }: RuleEditorProps) {
  const [trigger, setTrigger] = useState(rule?.trigger ?? triggers[0]!.key);
  const [conditions, setConditions] = useState<Record<string, string>>(rule?.conditions ?? {});
  const [actions, setActions] = useState<Action[]>(rule?.actions ?? [blank('create_task')]);
  const [saved, setSaved] = useState(false);
  const t = triggers.find((x) => x.key === trigger)!;
  const set = (i: number, patch: Record<string, string | number>) => setActions(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const people: Opt[] = [['owner', 'The record owner'], ...team];
  return (
    <ActionForm action={saveRuleAction.bind(null, slug, rule?.id ?? null)} onSuccess={() => setSaved(true)} className="flex flex-col gap-4">
      {saved && <FormBanner tone="ok">Automation saved.</FormBanner>}
      <input type="hidden" name="conditions" value={JSON.stringify(Object.fromEntries(Object.entries(conditions).filter(([k]) => t.conditions.includes(k))))} />
      <input type="hidden" name="actions" value={JSON.stringify(actions)} />
      <div className="grid gap-3.5 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
        <FormField label="Name" name="name"><Input name="name" defaultValue={rule?.name} placeholder="e.g. Gulf leads go to Rahul" required /></FormField>
        <FormField label="When" name="trigger">
          <Select name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
            {triggers.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </Select>
        </FormField>
        <label className="flex h-10 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="active" defaultChecked={rule?.active ?? true} className="size-4 accent-[var(--color-ink)]" /> On</label>
      </div>
      {t.conditions.length > 0 && (
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="eyebrow mb-1.5">Only when (leave empty for any)</legend>
          {t.conditions.map((c) => (
            <label key={c} className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              {conditionLabels[c] ?? c}
              {choices[c] ? (
                <Select value={conditions[c] ?? ''} onChange={(e) => setConditions({ ...conditions, [c]: e.target.value })}>
                  <option value="">Any</option>
                  {choices[c]!.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              ) : (
                <Input value={conditions[c] ?? ''} onChange={(e) => setConditions({ ...conditions, [c]: e.target.value })} placeholder="Any" />
              )}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="flex flex-col gap-2.5">
        <legend className="eyebrow mb-1.5">Do</legend>
        {actions.map((a, i) => (
          <div key={i} className="grid gap-2.5 rounded-[14px] p-3 shadow-[inset_0_0_0_1px_var(--color-line-2)] sm:grid-cols-[200px_1fr_auto]">
            <Select aria-label={`Action ${i + 1}`} value={a.type} onChange={(e) => setActions(actions.map((x, j) => (j === i ? blank(e.target.value) : x)))}>
              {actionTypes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <div className="grid gap-2 sm:grid-cols-2">
              {a.type === 'create_task' && (
                <>
                  <Input aria-label="Task title" value={String(a.title)} onChange={(e) => set(i, { title: e.target.value })} placeholder="Call {{name}} about {{stage}}" />
                  <div className="flex gap-2">
                    <Input aria-label="Due in days" type="number" min={0} value={String(a.dueDays)} onChange={(e) => set(i, { dueDays: Number(e.target.value) })} className="w-20" />
                    <Select aria-label="Assign to" value={String(a.assignTo)} onChange={(e) => set(i, { assignTo: e.target.value })}>{people.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  </div>
                </>
              )}
              {a.type === 'assign_owner' && (
                <Select aria-label="Assign to" value={String(a.to)} onChange={(e) => set(i, { to: e.target.value })}>
                  <option value="least_loaded">Whoever has the fewest open leads</option>
                  {team.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              )}
              {a.type === 'notify' && (
                <>
                  <Select aria-label="Notify" value={String(a.to)} onChange={(e) => set(i, { to: e.target.value })}>
                    {[...people, ['admins', 'Owners and admins'] as Opt].map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                  <Input aria-label="Message" value={String(a.text)} onChange={(e) => set(i, { text: e.target.value })} placeholder="{{name}} moved to {{stage}}" />
                </>
              )}
              {a.type === 'whatsapp' && <Input aria-label="Approved template name" value={String(a.template)} onChange={(e) => set(i, { template: e.target.value })} placeholder="Approved template name" />}
              {a.type === 'email' && (
                <>
                  <Input aria-label="Email subject" value={String(a.subject)} onChange={(e) => set(i, { subject: e.target.value })} placeholder="Subject" />
                  <Textarea aria-label="Email text" value={String(a.body)} onChange={(e) => set(i, { body: e.target.value })} placeholder="Dear {{firstName}}, …" className="min-h-16 sm:col-span-2" />
                </>
              )}
              {a.type === 'set_status' && (
                <Select aria-label="Status" value={String(a.status)} onChange={(e) => set(i, { status: e.target.value })}>
                  {(choices.status ?? []).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              )}
            </div>
            <button type="button" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label={`Remove action ${i + 1}`} disabled={actions.length === 1} className="grid size-10 place-items-center rounded-[10px] text-muted hover:bg-paper-2 disabled:opacity-40"><X size={15} /></button>
          </div>
        ))}
        {actions.length < 5 && (
          <button type="button" onClick={() => setActions([...actions, blank('notify')])} className="inline-flex w-fit items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-sm font-semibold text-ink-2 hover:bg-paper-2">
            <Plus size={14} /> Add an action
          </button>
        )}
      </fieldset>
      <div className="flex justify-between gap-2">
        {rule ? <ActionButton action={() => deleteRuleAction(slug, rule.id)} variant="danger" confirm="Delete this automation?">Delete</ActionButton> : <span />}
        <SubmitButton>Save automation</SubmitButton>
      </div>
    </ActionForm>
  );
}
