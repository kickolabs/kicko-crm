// Document templates with merge fields (core, pure). A template is plain text with
// light formatting and {{fields}}:
//
//   # Retainer agreement
//   This agreement is between **{{agency.name}}** and {{client.fullName}} for {{case.workflow}}.
//   Fee: {{fees.total}}   Date: {{today}}
//
// Rendering reports fields that had no value, so staff can fill them in before sending.

export type MergeData = Record<string, unknown>;

const FIELD = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

/** Every field a template uses, in order of first use. */
export function fieldsOf(template: string): string[] {
  return [...new Set([...template.matchAll(FIELD)].map((m) => m[1]!))];
}

function lookup(data: MergeData, path: string): unknown {
  let v: unknown = data;
  for (const part of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

const text = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/** What a missing field renders as. */
export const BLANK = '________';

/** Fill the fields. Missing ones render as a visible blank and are listed. */
export function renderTemplate(template: string, data: MergeData): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = template.replace(FIELD, (_, path: string) => {
    const v = text(lookup(data, path)).trim();
    if (!v) {
      if (!missing.includes(path)) missing.push(path);
      return BLANK;
    }
    return v;
  });
  return { text: out, missing };
}

export type Block = { kind: 'h1' | 'h2' | 'p' | 'li' | 'hr' | 'sign'; text: string };

/**
 * The light formatting templates use: "# " and "## " headings, "- " list items, "---"
 * rules, "[signature]" where the client signs, blank lines between paragraphs. **bold**
 * is kept in the text for the renderer.
 */
export function blocksOf(rendered: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of rendered.split('\n')) {
    const line = raw.trim();
    if (!line) flush();
    else if (line.startsWith('## ')) (flush(), blocks.push({ kind: 'h2', text: line.slice(3) }));
    else if (line.startsWith('# ')) (flush(), blocks.push({ kind: 'h1', text: line.slice(2) }));
    else if (line.startsWith('- ')) (flush(), blocks.push({ kind: 'li', text: line.slice(2) }));
    else if (line === '---') (flush(), blocks.push({ kind: 'hr', text: '' }));
    else if (/^\[signature\]$/i.test(line)) (flush(), blocks.push({ kind: 'sign', text: '' }));
    else para.push(line);
  }
  flush();
  return blocks;
}

/** Split "**bold**" runs for renderers: [{ text, bold }]. */
export function runsOf(s: string): { text: string; bold: boolean }[] {
  return s.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
}

/** The fields core records offer every template (packs can add theirs under `client.` / `case.`). */
export const CORE_FIELDS: [string, string][] = [
  ['today', "Today's date"],
  ['agency.name', 'Agency name'],
  ['agency.address', 'Agency address'],
  ['agency.gstin', 'Agency GSTIN'],
  ['client.fullName', 'Client full name'],
  ['client.firstName', 'Client first name'],
  ['client.email', 'Client email'],
  ['client.phone', 'Client phone'],
  ['client.passportNumber', 'Passport number'],
  ['client.nationality', 'Nationality'],
  ['client.address', 'Client address'],
  ['case.ref', 'Case reference'],
  ['case.workflow', 'Visa / service'],
  ['case.country', 'Destination country'],
  ['case.owner', 'Case owner'],
  ['fees.total', 'Total fee (from the latest invoice)'],
  ['fees.package', 'Service package'],
  ['fees.lines', 'Fee breakdown, one line per item (put it on its own line)'],
  ['fees.instalments', 'Instalments with due dates (put it on its own line)'],
  ['fees.paid', 'Amount paid so far'],
  ['fees.balance', 'Balance still due'],
  ['documents.missing', 'Documents still needed'],
];
