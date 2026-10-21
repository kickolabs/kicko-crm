// Agency-defined fields on leads, clients and cases. Pure: shared by the forms,
// the importer, the server and reports.

import { parseDate, type DateOrder } from './parse-date';

export type CfEntity = 'leads' | 'clients' | 'cases';
export type CfType = 'text' | 'number' | 'date' | 'select' | 'yesno';
export type CfDef = { key: string; label: string; type: CfType; options: string[]; archived?: boolean };
export type CfValue = string | number | boolean;
export type CfValues = Record<string, CfValue>;

export const CF_ENTITIES: { id: CfEntity; label: string; one: string }[] = [
  { id: 'leads', label: 'Leads', one: 'lead' },
  { id: 'clients', label: 'Clients', one: 'client' },
  { id: 'cases', label: 'Cases', one: 'case' },
];

export const CF_TYPES: { id: CfType; label: string; hint: string }[] = [
  { id: 'text', label: 'Text', hint: 'e.g. Referred by, Course name' },
  { id: 'number', label: 'Number', hint: 'e.g. Budget, IELTS band, Backlogs' },
  { id: 'date', label: 'Date', hint: 'e.g. Intake, Offer deadline' },
  { id: 'select', label: 'Dropdown', hint: 'Pick one of a list, e.g. Intake: Jan / May / Sept' },
  { id: 'yesno', label: 'Yes / No', hint: 'e.g. Has refusal history' },
];

export const CF_LIMIT = 30; // active fields per entity

/** Stable storage key from the label, e.g. "IELTS band" → "ielts_band" (unique among `taken`). */
export function cfKey(label: string, taken: string[]) {
  const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
  let key = base;
  for (let i = 2; taken.includes(key); i++) key = `${base}_${i}`;
  return key;
}

const YES = /^(y|yes|true|1|✓|x)$/i;
const NO = /^(n|no|false|0|-)$/i;

/**
 * Check one value. Empty input clears the field (value null). Dates are stored as
 * YYYY-MM-DD; numbers accept "1,20,000"; dropdowns must match an option (any case).
 */
export function cfClean(def: CfDef, raw: unknown, dateOrder: DateOrder = 'DMY'): { ok: true; value: CfValue | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'boolean' && def.type === 'yesno') return { ok: true, value: raw };
  const s = String(raw).trim();
  if (!s) return { ok: true, value: null };
  switch (def.type) {
    case 'text':
      return { ok: true, value: s.slice(0, 500) };
    case 'number': {
      const n = Number(s.replace(/[,\s₹$]/g, ''));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `${def.label}: “${s}” isn't a number` };
    }
    case 'date': {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? parseDate(s) : parseDate(s, dateOrder);
      return d ? { ok: true, value: d.toISOString().slice(0, 10) } : { ok: false, error: `${def.label}: “${s}” isn't a date` };
    }
    case 'select': {
      const hit = def.options.find((o) => o.toLowerCase() === s.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, error: `${def.label}: “${s}” isn't one of the options` };
    }
    case 'yesno':
      if (YES.test(s)) return { ok: true, value: true };
      if (NO.test(s)) return { ok: true, value: false };
      return { ok: false, error: `${def.label}: “${s}” isn't yes or no` };
  }
}

export function cfDisplay(def: Pick<CfDef, 'type'>, v: CfValue | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if (def.type === 'yesno') return v === true ? 'Yes' : 'No';
  if (def.type === 'number' && typeof v === 'number') return v.toLocaleString('en-IN');
  if (def.type === 'date' && typeof v === 'string') {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  return String(v);
}

/** Dropdown options from a textarea: one per line or comma-separated, trimmed, unique. */
export function parseOptions(text: string) {
  const parts = text.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  return [...new Map(parts.map((p) => [p.toLowerCase(), p.slice(0, 60)])).values()].slice(0, 50);
}
