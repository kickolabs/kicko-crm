// Build the immigration pack's library.json from research files (JSON in the SPEC.md
// format). Later files override earlier ones key by key, so gap-*.json fill and correct
// the first pass. Every country an Indian passport holder can apply to gets an entry;
// countries not yet researched get a stub marked unverified, never guessed data.
//
//   node packages/packs/scripts/build-library.mjs <research-dir>

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2];
if (!dir) throw new Error('usage: build-library.mjs <research-dir>');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/immigration/library.json');

// UN member and observer states plus the territories Indian applicants commonly go to,
// by region. India is the origin country, so it is left out.
const REGIONS = {
  Africa: 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW',
  Americas: 'AG AR BS BB BZ BO BR CA CL CO CR CU DM DO EC SV GD GT GY HT HN JM MX NI PA PY PE KN LC VC SR TT US UY VE',
  Asia: 'AF BD BT BN KH CN HK MO ID JP KZ KG LA MY MV MN MM NP KP KR PK PH SG LK TW TJ TH TL TM UZ VN',
  Europe: 'AL AD AM AT AZ BY BE BA BG HR CY CZ DK EE FI FR GE DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA',
  'Middle East': 'BH IR IQ IL JO KW LB OM PS QA SA SY TR AE YE',
  Oceania: 'AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU',
};
const regionOf = Object.fromEntries(Object.entries(REGIONS).flatMap(([r, codes]) => codes.split(' ').map((c) => [c, r])));
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const NAME_FIX = { XK: 'Kosovo', PS: 'Palestine', TW: 'Taiwan', HK: 'Hong Kong', MO: 'Macao', VA: 'Vatican City', CI: "Côte d'Ivoire", CZ: 'Czechia' };
const nameOf = (c) => NAME_FIX[c] ?? names.of(c) ?? c;

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
// first pass first, gap-* last (they override)
files.sort((a, b) => Number(a.startsWith('gap-')) - Number(b.startsWith('gap-')) || a.localeCompare(b));

const items = new Map();
const put = (it) => {
  const id = `${it.type}:${it.key}`;
  const prev = items.get(id);
  // A basic re-check must not replace a fully researched country.
  if (prev && prev.coverage === 'full' && it.coverage === 'basic') {
    prev.sources = dedupe([...prev.sources, ...it.sources]);
    return;
  }
  items.set(id, prev ? { ...prev, ...it, data: { ...prev.data, ...it.data }, sources: dedupe([...(it.sources ?? []), ...(prev.sources ?? [])]) } : it);
};
const dedupe = (sources) => [...new Map((sources ?? []).filter((s) => s?.url).map((s) => [s.url, s])).values()];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const todo = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  for (const t of j.todo ?? []) todo.push(`${f}: ${typeof t === 'string' ? t : JSON.stringify(t)}`);
  for (const raw of j.items ?? []) {
    const { unverified, ...data } = raw.data ?? {};
    const it = {
      type: raw.type,
      key: raw.type === 'country' ? String(raw.key).toUpperCase() : String(raw.key),
      ...(raw.parent ? { parent: String(raw.parent).toUpperCase() } : {}),
      name: raw.name,
      ...(raw.coverage ? { coverage: raw.coverage } : raw.type === 'pathway' ? { coverage: 'full' } : {}),
      ...(raw.unverified || unverified ? { unverified: true } : {}),
      data,
      sources: dedupe(raw.sources),
    };
    if (it.type === 'pathway') {
      it.data.stages = (it.data.stages ?? []).map((s) => ({ key: s.key ?? slug(s.name), name: s.name }));
      it.data.documents = (it.data.documents ?? []).map((d) => ({ ...d, key: d.key ?? slug(`${d.group ?? 'General'}_${d.name}`) }));
    }
    put(it);
  }
  for (const d of j.documentTypes ?? []) put({ type: 'document_type', key: d.key, name: d.name, data: { group: d.group, hasExpiry: !!d.hasExpiry }, sources: [] });
  for (const t of j.testTypes ?? []) {
    const { key, name, url, verifiedAt, ...rest } = t;
    put({ type: 'test_type', key, name, data: { ...rest, url }, sources: url ? [{ url, title: name, official: true, verifiedAt }] : [] });
  }
}

// Every country gets an entry; unresearched ones are honest stubs.
for (const [code, region] of Object.entries(regionOf)) {
  const id = `country:${code}`;
  const c = items.get(id);
  if (!c) {
    items.set(id, { type: 'country', key: code, name: nameOf(code), coverage: 'basic', unverified: true, data: { region, notes: 'Not researched yet. Check the official sources before advising.' }, sources: [] });
  } else {
    c.data.region ??= region;
    c.coverage ??= 'basic';
  }
}

const order = { country: 0, pathway: 1, occupation: 2, document_type: 3, test_type: 4 };
const list = [...items.values()].sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.key.localeCompare(b.key));
writeFileSync(out, JSON.stringify({ pack: 'immigration', builtAt: new Date().toISOString().slice(0, 10), todo, items: list }, null, 1) + '\n');
const count = (t) => list.filter((i) => i.type === t).length;
console.log(`library.json: ${count('country')} countries (${list.filter((i) => i.type === 'country' && i.coverage === 'full').length} full, ${list.filter((i) => i.type === 'country' && i.unverified).length} with unverified parts), ${count('pathway')} pathways, ${count('occupation')} occupations, ${count('document_type')} document types, ${count('test_type')} tests; ${todo.length} todo notes`);
