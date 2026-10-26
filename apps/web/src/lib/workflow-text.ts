import type { ChecklistItem, Stage } from '@kicko/packs';

// Workflows are edited as text, one stage or document per line, with optional flags in
// square brackets. Plain names still work; flags add the configurable behaviour:
//
//   Lodged [lodged]                      the application is submitted here
//   Interview [optional]                 may be skipped
//   Medical [track]                      a side track beside the main stages
//   Biometrics [10d]                     expected to take 10 days; overdue escalates
//   Documents [requires: Passport, Police clearance certificate]   gate: verified first
//   Job offer [task: Chase employer for contract +3d]              task on entering
//   Licence check [when: drivers]        only for these occupation groups
//
// Checklist lines: "Group: Document", plus (optional), [expires], [when: groups].

export const keyOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const FLAGS = /\[([^\]]*)\]/g;

function flagsOf(line: string) {
  const flags: string[] = [];
  const name = line.replace(FLAGS, (_, f: string) => {
    flags.push(f.trim());
    return '';
  }).trim();
  return { name, flags };
}

const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

export class WorkflowTextError extends Error {}

export function parseStages(text: string, checklist: ChecklistItem[] = []): Stage[] {
  const byName = new Map(checklist.map((c) => [c.name.toLowerCase(), c.key]));
  const stages: Stage[] = [];
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const { name, flags } = flagsOf(line);
    if (!name) throw new WorkflowTextError(`Line ${i + 1}: add a stage name`);
    const s: Stage = { key: keyOf(name), name };
    for (const f of flags) {
      const [head, ...rest] = f.split(':');
      const arg = rest.join(':').trim();
      const h = head!.trim().toLowerCase();
      if (h === 'lodged') s.lodged = true;
      else if (h === 'optional') s.optional = true;
      else if (h === 'milestone') s.milestone = true;
      else if (h === 'track') s.track = keyOf(arg || name);
      else if (/^\d+\s*d(ays?)?$/.test(h)) s.deadlineDays = parseInt(h, 10);
      else if (h === 'requires') {
        const docs: string[] = [];
        let followUp = false;
        for (const item of list(arg)) {
          if (/^follow-?up$/i.test(item)) followUp = true;
          else docs.push(byName.get(item.toLowerCase()) ?? keyOf(item));
        }
        s.requires = { ...(docs.length ? { documents: docs } : {}), ...(followUp ? { followUp } : {}) };
      } else if (h === 'task') {
        const m = arg.match(/^(.*?)(?:\s*\+(\d+)\s*d)?$/);
        if (!m?.[1]) throw new WorkflowTextError(`Line ${i + 1}: give the task a title`);
        s.tasks = [...(s.tasks ?? []), { title: m[1].trim(), ...(m[2] ? { dueDays: Number(m[2]) } : {}) }];
      } else if (h === 'when') s.when = { occupationGroups: list(arg).map(keyOf) };
      else throw new WorkflowTextError(`Line ${i + 1}: unknown flag [${f}]`);
    }
    stages.push(s);
  }
  if (stages.filter((s) => !s.track).length < 2) throw new WorkflowTextError('Add at least two stages');
  if (new Set(stages.map((s) => s.key)).size !== stages.length) throw new WorkflowTextError('Stage names must be unique');
  return stages;
}

export function stagesToText(stages: Stage[], checklist: ChecklistItem[] = []): string {
  const nameOf = new Map(checklist.map((c) => [c.key, c.name]));
  return stages
    .map((s) => {
      const f: string[] = [];
      if (s.lodged) f.push('lodged');
      if (s.optional) f.push('optional');
      if (s.milestone) f.push('milestone');
      if (s.track) f.push(s.track === s.key ? 'track' : `track: ${s.track}`);
      if (s.deadlineDays) f.push(`${s.deadlineDays}d`);
      const req = [...(s.requires?.documents ?? []).map((k) => nameOf.get(k) ?? k), ...(s.requires?.followUp ? ['follow-up'] : [])];
      if (req.length) f.push(`requires: ${req.join(', ')}`);
      for (const t of s.tasks ?? []) f.push(`task: ${t.title}${t.dueDays != null ? ` +${t.dueDays}d` : ''}`);
      if (s.when?.occupationGroups?.length) f.push(`when: ${s.when.occupationGroups.join(', ')}`);
      return [s.name, ...f.map((x) => `[${x}]`)].join(' ');
    })
    .join('\n');
}

export function parseChecklist(text: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    const { name: rest, flags } = flagsOf(line);
    line = rest;
    const optional = /\(optional\)\s*$/i.test(line);
    const clean = line.replace(/\(optional\)\s*$/i, '').trim();
    const [group, ...names] = clean.includes(':') ? clean.split(':') : ['General', clean];
    const name = names.join(':').trim() || group!.trim();
    const item: ChecklistItem = { key: keyOf(`${group}_${name}`), name, group: group!.trim(), required: !optional };
    for (const f of flags) {
      const [head, ...a] = f.split(':');
      const h = head!.trim().toLowerCase();
      if (h === 'expires') item.expires = true;
      else if (h === 'when') item.when = { occupationGroups: list(a.join(':')).map(keyOf) };
      else throw new WorkflowTextError(`${name}: unknown flag [${f}]`);
    }
    items.push(item);
  }
  return [...new Map(items.map((i) => [i.key, i])).values()];
}

export function checklistToText(items: ChecklistItem[]): string {
  return items
    .map((i) => {
      const f = [i.expires ? '[expires]' : '', i.when?.occupationGroups?.length ? `[when: ${i.when.occupationGroups.join(', ')}]` : ''].filter(Boolean);
      return [`${i.group}: ${i.name}${i.required ? '' : ' (optional)'}`, ...f].join(' ');
    })
    .join('\n');
}
