// Spreadsheet import: which Kicko fields can be filled, how columns are guessed
// from headers, and how each cell is cleaned. Pure: the browser uses it for the
// preview and the server runs it again before saving anything.

import { COUNTRIES } from '@/lib/constants';
import { normalizeEmail, normalizePhone } from '@/lib/phone';

export type Entity = 'leads' | 'clients';
export type DateOrder = 'DMY' | 'MDY';

type FieldDef = { key: string; label: string; hint?: string; synonyms: string[] };

const NAME: FieldDef[] = [
  { key: 'fullName', label: 'Full name', hint: 'Split into first and last name', synonyms: ['name', 'full name', 'student name', 'client name', 'customer name', 'lead name', 'contact name', 'applicant name', 'candidate name'] },
  { key: 'firstName', label: 'First name', synonyms: ['first name', 'given name', 'fname', 'forename'] },
  { key: 'lastName', label: 'Last name', synonyms: ['last name', 'surname', 'family name', 'lname'] },
  { key: 'phone', label: 'Phone / WhatsApp', synonyms: ['phone', 'mobile', 'mobile no', 'mobile number', 'phone number', 'phone no', 'contact number', 'contact no', 'whatsapp', 'whatsapp number', 'whatsapp no', 'cell', 'telephone', 'mob', 'mob no', 'contact'] },
  { key: 'email', label: 'Email', synonyms: ['email', 'e-mail', 'email address', 'mail id', 'email id', 'mail'] },
];
const OWNER: FieldDef = { key: 'owner', label: 'Owner', hint: 'Team member’s email or name', synonyms: ['owner', 'assigned to', 'counsellor', 'counselor', 'agent', 'staff', 'lead owner', 'assignee', 'handled by'] };

export const FIELDS: Record<Entity, FieldDef[]> = {
  leads: [
    ...NAME,
    { key: 'source', label: 'Source', hint: 'e.g. Facebook, Walk-in, Referral', synonyms: ['source', 'lead source', 'channel', 'how did you hear', 'enquiry source', 'medium'] },
    { key: 'status', label: 'Status', hint: 'e.g. New, Contacted, Converted, Lost', synonyms: ['status', 'lead status', 'stage', 'lead stage'] },
    { key: 'interestCountry', label: 'Country of interest', synonyms: ['country', 'interested country', 'destination', 'preferred country', 'country of interest', 'target country', 'destination country'] },
    { key: 'interestCategory', label: 'Visa type', hint: 'Study, PR, Work, Visit, Family', synonyms: ['visa type', 'visa category', 'service', 'interested in', 'program type', 'category', 'visa', 'service type', 'enquiry for'] },
    OWNER,
    { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'remarks', 'comments', 'comment', 'message', 'enquiry', 'query', 'description', 'requirement'] },
    { key: 'createdAt', label: 'Enquiry date', hint: 'Keeps the original date', synonyms: ['enquiry date', 'inquiry date', 'created', 'created at', 'created on', 'date', 'lead date', 'date added', 'created date'] },
  ],
  clients: [
    ...NAME,
    { key: 'dob', label: 'Date of birth', synonyms: ['dob', 'date of birth', 'birth date', 'birthday', 'd.o.b'] },
    { key: 'gender', label: 'Gender', synonyms: ['gender', 'sex'] },
    { key: 'nationality', label: 'Nationality', synonyms: ['nationality', 'citizenship', 'citizen of'] },
    { key: 'passportNumber', label: 'Passport number', synonyms: ['passport', 'passport no', 'passport number', 'passport #'] },
    { key: 'passportExpiry', label: 'Passport expiry', synonyms: ['passport expiry', 'passport expiry date', 'passport valid till', 'passport validity', 'expiry date', 'passport exp'] },
    { key: 'maritalStatus', label: 'Marital status', synonyms: ['marital status', 'married', 'marital'] },
    { key: 'address', label: 'Address', synonyms: ['address', 'residential address', 'home address', 'full address'] },
    OWNER,
    { key: 'notes', label: 'Notes', synonyms: ['notes', 'note', 'remarks', 'comments', 'comment', 'description'] },
    { key: 'createdAt', label: 'Client since', hint: 'Keeps the original date', synonyms: ['client since', 'created', 'created at', 'created on', 'date joined', 'registration date', 'date added', 'joined', 'date'] },
  ],
};

export const LIMITS = { rows: 20_000, chunk: 500, fileMb: 10 };

/** Field → column index (or -1 for "don't import"). */
export type Mapping = Record<string, number>;

const norm = (s: string) => s.toLowerCase().replace(/[_\-.:#()/]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Best guess of which column holds each field, from the header row. */
export function guessMapping(entity: Entity, headers: string[]): Mapping {
  const cols = headers.map(norm);
  const used = new Set<number>();
  const out: Mapping = {};
  // Exact synonym matches first, then "header contains synonym" (longest synonym wins).
  for (const pass of ['exact', 'contains'] as const) {
    for (const f of FIELDS[entity]) {
      if (out[f.key] !== undefined && out[f.key] !== -1) continue;
      let best = -1;
      let bestLen = 0;
      cols.forEach((c, i) => {
        if (used.has(i) || !c) return;
        for (const syn of f.synonyms.map(norm)) {
          const hit = pass === 'exact' ? c === syn : c.includes(syn) && syn.length >= 4;
          if (hit && syn.length > bestLen) {
            best = i;
            bestLen = syn.length;
          }
        }
      });
      if (best >= 0) used.add(best);
      out[f.key] = best;
    }
  }
  // A full-name column and separate first/last columns are alternatives.
  if (out.firstName! >= 0 && out.fullName! >= 0) out.fullName = -1;
  return out;
}

// ── Cell cleaning ───────────────────────────────────────────────────────────

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function ymd(y: number, m: number, d: number) {
  if (y < 100) y += y < 50 ? 2000 : 1900;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return dt;
}

/** Parse a date cell: ISO, 12/03/2024 (by `order`), 12-Mar-2024, Mar 12 2024, or an Excel serial number. */
export function parseDate(raw: string, order: DateOrder = 'DMY'): Date | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  if (m) return ymd(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?: .*)?$/);
  if (m) return order === 'DMY' ? ymd(+m[3]!, +m[2]!, +m[1]!) : ymd(+m[3]!, +m[1]!, +m[2]!);
  m = s.match(/^(\d{1,2})[-\s/]([a-z]{3})[a-z]*[-\s/,]+(\d{2,4})$/i);
  if (m && MONTHS.includes(m[2]!.toLowerCase())) return ymd(+m[3]!, MONTHS.indexOf(m[2]!.toLowerCase()) + 1, +m[1]!);
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m && MONTHS.includes(m[1]!.toLowerCase())) return ymd(+m[3]!, MONTHS.indexOf(m[1]!.toLowerCase()) + 1, +m[2]!);
  // Excel stores dates as days since 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20_000 && n < 80_000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400_000);
  }
  return null;
}

export function splitName(full: string): { firstName: string; lastName: string | null } {
  const parts = full.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? '', lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
}

const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'GB', 'u.k.': 'GB', england: 'GB', britain: 'GB', 'great britain': 'GB', scotland: 'GB',
  usa: 'US', 'u.s.a.': 'US', us: 'US', america: 'US', 'united states of america': 'US',
  aus: 'AU', oz: 'AU', can: 'CA', nz: 'NZ', 'new zealand': 'NZ', dubai: 'AE', 'united arab emirates': 'AE',
  europe: 'EU', schengen: 'EU',
};

/** Country name or code → ISO-2 code Kicko uses; unknown names are kept as typed. */
export function countryCode(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const k = s.toLowerCase();
  if (COUNTRY_ALIASES[k]) return COUNTRY_ALIASES[k]!;
  if (/^[a-z]{2}$/i.test(s) && COUNTRIES[s.toUpperCase()]) return s.toUpperCase();
  const hit = Object.entries(COUNTRIES).find(([, name]) => name.toLowerCase() === k);
  return hit ? hit[0] : s.slice(0, 60);
}

const pick = <T extends string>(raw: string, table: [RegExp, T][]): T | null => {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  return table.find(([re]) => re.test(s))?.[1] ?? null;
};

export const category = (raw: string) =>
  pick(raw, [
    [/stud|student|education|course|admission|college|universit|f-?1|tier 4|subclass 500/, 'STUDY'],
    [/skilled worker|work permit|h-?1b|482|lmia/, 'WORK'], // before PR: "Skilled Worker" is a UK work visa
    [/\bpr\b|permanent|skilled|express entry|migration|189|190|491|pnp|immigra/, 'PR'],
    [/work|job|employ/, 'WORK'],
    [/visit|tour|travel|b-?1|b-?2|600|holiday/, 'VISIT'],
    [/famil|spouse|partner|dependant|dependent|parent|child|marriage/, 'FAMILY'],
  ] as const);

export const source = (raw: string) =>
  pick(raw, [
    [/web|site|form|online|google form|landing/, 'WEB_FORM'],
    [/whats ?app|\bwa\b/, 'WHATSAPP'],
    [/call|phone|tele/, 'CALL'],
    [/walk|office|visit/, 'WALK_IN'],
    [/refer|friend|word of mouth|existing client/, 'REFERRAL'],
    [/sub.?agent|partner|associate/, 'SUB_AGENT'],
    [/ads?\b|facebook|\bfb\b|instagram|insta|google|meta|campaign|linkedin|youtube|justdial|sulekha/, 'ADS'],
  ] as const) ?? 'OTHER';

export const status = (raw: string) =>
  pick(raw, [
    // Order matters: "not interested" is Lost, not Qualified; "uncontacted" is New.
    [/lost|not interested|dead|junk|cold|dnd|invalid|wrong number|rejected/, 'LOST'],
    [/won|convert|enrolled|signed|registered|client/, 'WON'],
    [/^new|fresh|uncontacted|not contacted|open/, 'NEW'],
    [/consult|meeting|appointment|booked|counsel/, 'CONSULT_BOOKED'],
    [/qualif|interested|hot|warm/, 'QUALIFIED'],
    [/contacted|follow|in progress|call back|callback|attempted|pending|ringing/, 'CONTACTED'],
  ] as const);

// ── Rows ────────────────────────────────────────────────────────────────────

export type Cleaned = {
  firstName: string;
  lastName: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  email: string | null;
  owner: string | null;
  notes: string | null;
  createdAt: Date | null;
  // leads
  source?: string;
  status?: string | null;
  interestCountry?: string | null;
  interestCategory?: string | null;
  // clients
  dob?: Date | null;
  gender?: string | null;
  nationality?: string | null;
  passportNumber?: string | null;
  passportExpiry?: Date | null;
  maritalStatus?: string | null;
  address?: string | null;
};

export type RowResult = { ok: true; data: Cleaned; warnings: string[] } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cut = (v: string, n: number) => (v ? v.slice(0, n) : null);

/** Clean one spreadsheet row into a Kicko record, or explain why it can't be imported. */
export function cleanRow(entity: Entity, cells: string[], mapping: Mapping, opts: { country: string; dateOrder: DateOrder }): RowResult {
  const get = (k: string) => {
    const i = mapping[k];
    return i === undefined || i < 0 ? '' : String(cells[i] ?? '').trim();
  };
  const warnings: string[] = [];
  let firstName = get('firstName');
  let lastName: string | null = get('lastName') || null;
  if (!firstName && get('fullName')) ({ firstName, lastName } = splitName(get('fullName')));
  const rawEmail = get('email');
  const email = rawEmail && EMAIL.test(rawEmail) ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) warnings.push(`Email “${rawEmail}” isn't valid, left out`);
  const phone = get('phone').replace(/^'/, '') || null; // Excel text prefix
  const phoneNormalized = normalizePhone(phone, opts.country);
  if (phone && (!phoneNormalized || phoneNormalized.replace(/\D/g, '').length < 8)) return { ok: false, error: `Phone “${phone}” doesn't look like a number` };
  if (!firstName) firstName = email?.split('@')[0] ?? '';
  if (!firstName) return { ok: false, error: 'No name' };
  if (!phoneNormalized && !email) return { ok: false, error: 'No phone or email' };

  const date = (k: string, label: string) => {
    const v = get(k);
    if (!v) return null;
    const d = parseDate(v, opts.dateOrder);
    if (!d) warnings.push(`${label} “${v}” isn't a date, left out`);
    return d;
  };
  let createdAt = date('createdAt', entity === 'leads' ? 'Enquiry date' : 'Client since');
  if (createdAt && createdAt.getTime() > Date.now() + 86400_000) {
    warnings.push('Date is in the future, using today');
    createdAt = null;
  }
  const base: Cleaned = {
    firstName: firstName.slice(0, 80),
    lastName: lastName?.slice(0, 80) ?? null,
    phone,
    phoneNormalized,
    email,
    owner: get('owner') || null,
    notes: cut(get('notes'), 4000),
    createdAt,
  };
  if (entity === 'leads') {
    const st = get('status');
    const cat = get('interestCategory');
    const s = st ? status(st) : null;
    if (st && !s) warnings.push(`Status “${st}” not recognised, set to New`);
    const c = cat ? category(cat) : null;
    if (cat && !c) warnings.push(`Visa type “${cat}” not recognised, left out`);
    return {
      ok: true,
      warnings,
      data: { ...base, source: get('source') ? source(get('source')) : 'OTHER', status: s, interestCountry: countryCode(get('interestCountry')), interestCategory: c },
    };
  }
  return {
    ok: true,
    warnings,
    data: {
      ...base,
      dob: date('dob', 'Date of birth'),
      gender: cut(get('gender'), 30),
      nationality: get('nationality') ? countryCode(get('nationality')) : null,
      passportNumber: cut(get('passportNumber').toUpperCase().replace(/\s+/g, ''), 30),
      passportExpiry: date('passportExpiry', 'Passport expiry'),
      maritalStatus: cut(get('maritalStatus'), 30),
      address: cut(get('address'), 500),
    },
  };
}

/** Keys used to spot the same person twice: normalised phone and email. */
export const dupKeys = (d: Pick<Cleaned, 'phoneNormalized' | 'email'>) => [d.phoneNormalized && `p:${d.phoneNormalized}`, d.email && `e:${d.email}`].filter(Boolean) as string[];

export function sampleCsv(entity: Entity) {
  const head = FIELDS[entity].filter((f) => f.key !== 'firstName' && f.key !== 'lastName').map((f) => f.label);
  const row =
    entity === 'leads'
      ? ['Priya Sharma', '98400 12345', 'priya@example.com', 'Facebook', 'Contacted', 'Canada', 'Study', '', 'Wants Sept intake, IELTS 7', '12/03/2026']
      : ['Ravi Kumar', '+91 98400 54321', 'ravi@example.com', '14/08/1996', 'Male', 'India', 'N1234567', '30/06/2031', 'Single', 'Anna Nagar, Chennai', '', 'Paid in full', '01/02/2026'];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [head, row].map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
