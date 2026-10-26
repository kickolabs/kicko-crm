import type { PackField } from '@kicko/packs';

// The core field engine for industry-pack fields (pure, so forms and the server share it).
// Values live in the record's `packData` JSON under the field key. Lookup values are
// library keys (occupation 'truck_driver', country 'DE'); the server passes the keys that
// exist, so a crafted request can't store something that isn't in the library.

export type PackValues = Record<string, unknown>;
export type RepeaterRow = Record<string, string>;
/** Library keys that exist, by library type. */
export type Allowed = Record<string, Set<string>>;

/** Form input name for a pack field. */
export const inputName = (key: string) => `pf_${key}`;

/** Read raw form values: repeated keys become arrays (multi lookups), repeaters are JSON. */
export function readPackForm(fields: PackField[], get: (name: string) => string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const f of fields) {
    const v = get(inputName(f.key));
    if (!v.length) continue;
    out[f.key] = f.type === 'multi_lookup' ? v : v[v.length - 1]!;
  }
  return out;
}

export class PackFieldError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
  }
}

/**
 * Validate raw values for `fields`. Only fields present in `raw` change; an empty value
 * clears the field. Throws PackFieldError with the input name for the form to show.
 */
export function cleanPackValues(fields: PackField[], raw: Record<string, unknown>, allowed: Allowed, prev: PackValues = {}): PackValues {
  const out: PackValues = { ...prev };
  for (const f of fields) {
    if (!(f.key in raw)) continue;
    const v = raw[f.key];
    const fail = (msg: string) => {
      throw new PackFieldError(inputName(f.key), `${f.label}: ${msg}`);
    };
    const str = typeof v === 'string' ? v.trim() : '';
    switch (f.type) {
      case 'text':
        if (str.length > 500) fail('keep it under 500 characters');
        set(out, f.key, str || null);
        break;
      case 'number': {
        if (!str) { set(out, f.key, null); break; }
        const n = Number(str);
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000) fail('enter a number');
        set(out, f.key, n);
        break;
      }
      case 'date':
        if (str && !/^\d{4}-\d{2}-\d{2}$/.test(str)) fail('use a valid date');
        set(out, f.key, str || null);
        break;
      case 'yesno':
        set(out, f.key, str === '' ? null : str === 'yes' || str === 'on' || str === 'true');
        break;
      case 'select':
        if (str && !f.options?.includes(str)) fail('pick one of the options');
        set(out, f.key, str || null);
        break;
      case 'lookup':
        if (str && !allowed[f.library!]?.has(str)) fail('pick from the list');
        set(out, f.key, str || null);
        break;
      case 'multi_lookup': {
        const list = (Array.isArray(v) ? v : str ? [str] : []).map(String).filter(Boolean);
        const bad = list.find((k) => !allowed[f.library!]?.has(k));
        if (bad) fail('pick from the list');
        set(out, f.key, list.length ? [...new Set(list)].slice(0, 20) : null);
        break;
      }
      case 'repeater': {
        let rows: unknown;
        try {
          rows = str ? JSON.parse(str) : [];
        } catch {
          fail('could not read the rows');
        }
        if (!Array.isArray(rows) || rows.length > 30) fail('too many rows');
        const cols = f.columns ?? [];
        const clean = (rows as unknown[])
          .map((r) => Object.fromEntries(cols.map((c) => [c.key, String((r as RepeaterRow)?.[c.key] ?? '').trim().slice(0, 200)])))
          .filter((r) => Object.values(r).some(Boolean));
        for (const r of clean) for (const c of cols) {
          if (c.type === 'select' && r[c.key] && !c.options?.includes(r[c.key]!)) fail(`${c.label}: pick one of the options`);
          if (c.type === 'date' && r[c.key] && !/^\d{4}-\d{2}-\d{2}$/.test(r[c.key]!)) fail(`${c.label}: use a valid date`);
        }
        set(out, f.key, clean.length ? clean : null);
        break;
      }
    }
  }
  return out;
}

function set(out: PackValues, key: string, v: unknown) {
  if (v === null || v === undefined) delete out[key];
  else out[key] = v;
}

/** Values to copy from a lead to a client/case on conversion: fields marked `carry` that the target also has. */
export function carryOver(from: PackField[], to: PackField[], values: PackValues): PackValues {
  const target = new Set(to.map((f) => f.key));
  return Object.fromEntries(from.filter((f) => f.carry && target.has(f.key) && values[f.key] != null).map((f) => [f.key, values[f.key]]));
}

/** A value as text, e.g. for detail grids and timelines. `name` resolves library keys. */
export function displayPackValue(f: PackField, v: unknown, name: (type: string, key: string) => string): string {
  if (v == null || v === '') return '—';
  switch (f.type) {
    case 'lookup':
      return name(f.library!, String(v));
    case 'multi_lookup':
      return (v as string[]).map((k) => name(f.library!, k)).join(', ');
    case 'yesno':
      return v ? 'Yes' : 'No';
    case 'repeater':
      return (v as RepeaterRow[]).map((r) => (f.columns ?? []).map((c) => r[c.key]).filter(Boolean).join(' · ')).join('; ');
    default:
      return String(v);
  }
}

/** Pack-field values from a submitted form, or undefined when the form had none. */
export function packRaw(fd: FormData): Record<string, string | string[]> | undefined {
  const out: Record<string, string | string[]> = {};
  for (const name of new Set([...fd.keys()])) {
    if (!name.startsWith('pf_') || name.endsWith('__add')) continue;
    const v = fd.getAll(name).filter((x): x is string => typeof x === 'string');
    out[name.slice(3)] = v.length > 1 ? v.filter(Boolean) : (v[0] ?? '');
  }
  return Object.keys(out).length ? out : undefined;
}
