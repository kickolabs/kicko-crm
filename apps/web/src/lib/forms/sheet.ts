import { detailsKey, QUESTIONS, type AnswerKey, type Answers } from './questions';

// Government form answer sheets: each form's questions in its own order, filled
// from the client profile or from stored answers, in the form's date format.
// Official IRCC PDFs are locked (XFA) and ImmiAccount / DS-160 are online-only,
// so a copy-ready sheet is what consultants actually need.

export type SheetClient = {
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null; // YYYY-MM-DD
  gender: string | null;
  nationality: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  maritalStatus: string | null;
  address: string | null;
  education: { level?: string; institution?: string; field?: string; year?: string; score?: string }[];
  tests: { test?: string; overall?: string; l?: string; r?: string; w?: string; s?: string; date?: string }[];
  work: { employer?: string; title?: string; from?: string; to?: string; code?: string }[];
  family: { relation: string; name: string; dob: string | null; passportNumber: string | null }[];
};

type DateFormat = 'iso' | 'dmy-mon' | 'd-mon-y';
type Ctx = { c: SheetClient; date: (d: string | null | undefined) => string | null; answer: (k: AnswerKey) => string | null };
type Field = { label: string; value?: (x: Ctx) => string | null; ask?: AnswerKey };
type Section = { title: string; fields: Field[] };
export type FormTemplate = { id: string; title: string; authority: string; country: string; use: string; dateFormat: DateFormat; sections: Section[] };

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function formatDate(iso: string | null | undefined, f: DateFormat) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (f === 'iso') return `${y}-${m}-${d}`;
  if (f === 'dmy-mon') return `${d}-${MON[Number(m) - 1]}-${y}`;
  return `${d} ${MON[Number(m) - 1]!.charAt(0)}${MON[Number(m) - 1]!.slice(1).toLowerCase()} ${y}`;
}

// ── Profile pieces reused across forms ──────────────────────────────────────

const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const family = (x: Ctx, rel: string) => x.c.family.filter((f) => f.relation === rel);
const spouse = (x: Ctx) => family(x, 'SPOUSE')[0];
const lines = (rows: (string | null | false | undefined)[]) => v(rows.filter(Boolean).join('\n'));
const month = (m?: string) => (m ? m.slice(0, 7) : '');
const educationList = (x: Ctx) =>
  lines(x.c.education.map((e) => [e.level, e.field && `in ${e.field}`, e.institution && `· ${e.institution}`, e.year && `(${e.year})`].filter(Boolean).join(' ')));
const workList = (x: Ctx, years = 10) => {
  const since = new Date().getFullYear() - years;
  return lines(
    x.c.work
      .filter((w) => !w.to || Number(w.to.slice(0, 4)) >= since)
      .map((w) => `${month(w.from)} to ${w.to ? month(w.to) : 'present'}: ${w.title ?? ''}${w.employer ? `, ${w.employer}` : ''}${w.code ? ` (${w.code})` : ''}`),
  );
};
const currentJob = (x: Ctx) => x.c.work.find((w) => !w.to) ?? null;
const english = (x: Ctx) => {
  const t = x.c.tests[0];
  return t ? `${t.test} ${t.overall ?? ''} (L ${t.l ?? '-'} R ${t.r ?? '-'} W ${t.w ?? '-'} S ${t.s ?? '-'})${t.date ? `, ${t.date}` : ''}` : null;
};
const sex = (x: Ctx) => v(x.c.gender);
const marital = (x: Ctx) => v(x.c.maritalStatus);
const familyList = (x: Ctx, rel: string) => lines(family(x, rel).map((f) => `${f.name}${f.dob ? `, born ${x.date(f.dob)}` : ''}`));
/** Yes/no questions: "No", or "Yes: details". */
const yesNo = (k: AnswerKey) => (x: Ctx) => {
  const a = x.answer(k);
  if (!a) return null;
  const d = x.answer(detailsKey(k) as AnswerKey);
  return a === 'Yes' ? `Yes${d ? `: ${d}` : ''}` : a;
};

const background: Field[] = [
  { label: 'Refused a visa or entry, or removed, from any country?', value: yesNo('refused'), ask: 'refused' },
  { label: 'Overstayed or worked without permission?', value: yesNo('overstay'), ask: 'overstay' },
  { label: 'Arrested, charged or convicted of any offence?', value: yesNo('criminal'), ask: 'criminal' },
  { label: 'Tuberculosis or serious medical condition (last 2 years)?', value: yesNo('medical'), ask: 'medical' },
  { label: 'Military, police or security service?', value: yesNo('military'), ask: 'military' },
];

const parent = (who: 'father' | 'mother'): Field[] => [
  { label: 'Full name', ask: `${who}.name` },
  { label: 'Date of birth', value: (x) => x.date(x.answer(`${who}.dob`)), ask: `${who}.dob` },
  { label: 'Place of birth', ask: `${who}.birthplace` },
  { label: 'Occupation', ask: `${who}.occupation` },
  { label: 'Address (or date of death)', ask: `${who}.address` },
];

// ── The forms ───────────────────────────────────────────────────────────────

export const FORMS: FormTemplate[] = [
  {
    id: 'ca-personal',
    title: 'Canada · Personal details & background',
    authority: 'IRCC',
    country: 'CA',
    use: 'IRCC online portal: study permit, visitor visa, work permit (IMM 5257 / IMM 1294 / IMM 0008 sections)',
    dateFormat: 'iso',
    sections: [
      {
        title: 'Personal details',
        fields: [
          { label: 'Family name(s)', value: (x) => v(x.c.lastName) },
          { label: 'Given name(s)', value: (x) => v(x.c.firstName) },
          { label: 'Other names used', ask: 'other_names' },
          { label: 'Sex', value: sex },
          { label: 'Date of birth', value: (x) => x.date(x.c.dob) },
          { label: 'City/town of birth', ask: 'birth.city' },
          { label: 'Country of birth', ask: 'birth.country' },
          { label: 'Citizenship', value: (x) => v(x.c.nationality) },
          { label: 'Current marital status', value: marital },
          { label: 'Date of marriage', value: (x) => x.date(x.answer('marriage.date')), ask: 'marriage.date' },
          { label: "Spouse's name", value: (x) => v(spouse(x)?.name) },
        ],
      },
      {
        title: 'Passport',
        fields: [
          { label: 'Passport number', value: (x) => v(x.c.passportNumber) },
          { label: 'Country or territory of issue', value: (x) => v(x.c.nationality) },
          { label: 'Issue date', value: (x) => x.date(x.answer('passport.issue_date')), ask: 'passport.issue_date' },
          { label: 'Expiry date', value: (x) => x.date(x.c.passportExpiry) },
          { label: 'National identity document number', ask: 'national_id' },
        ],
      },
      {
        title: 'Contact & language',
        fields: [
          { label: 'Current mailing address', value: (x) => v(x.c.address) },
          { label: 'Telephone', value: (x) => v(x.c.phone) },
          { label: 'Email', value: (x) => v(x.c.email) },
          { label: 'Native language', ask: 'native_language' },
          { label: 'English test', value: english },
        ],
      },
      {
        title: 'Education & employment',
        fields: [
          { label: 'Education (highest first)', value: educationList },
          { label: 'Employment, last 10 years', value: (x) => workList(x, 10) },
          { label: 'Duties in current or last job', ask: 'employment.duties' },
          { label: 'Who is paying for the stay', ask: 'funding' },
        ],
      },
      { title: 'Background', fields: background },
    ],
  },
  {
    id: 'ca-family',
    title: 'Canada · Family information (IMM 5645)',
    authority: 'IRCC',
    country: 'CA',
    use: 'IMM 5645 Family Information, required with most Canadian applications',
    dateFormat: 'iso',
    sections: [
      {
        title: 'Applicant',
        fields: [
          { label: 'Name', value: (x) => v([x.c.firstName, x.c.lastName].filter(Boolean).join(' ')) },
          { label: 'Date of birth', value: (x) => x.date(x.c.dob) },
          { label: 'Country of birth', ask: 'birth.country' },
          { label: 'Marital status', value: marital },
          { label: 'Present address', value: (x) => v(x.c.address) },
        ],
      },
      {
        title: 'Spouse or common-law partner',
        fields: [
          { label: 'Name', value: (x) => v(spouse(x)?.name) },
          { label: 'Date of birth', value: (x) => x.date(spouse(x)?.dob) },
          { label: 'Place of birth', ask: 'spouse.birthplace' },
          { label: 'Occupation', ask: 'spouse.occupation' },
        ],
      },
      { title: 'Mother', fields: parent('mother') },
      { title: 'Father', fields: parent('father') },
      {
        title: 'Children and siblings',
        fields: [
          { label: 'Children (name, date of birth)', value: (x) => familyList(x, 'CHILD') ?? (marital(x) === 'Single' ? 'None' : null) },
          { label: 'Brothers and sisters (name, date of birth)', value: (x) => familyList(x, 'SIBLING') },
        ],
      },
    ],
  },
  {
    id: 'au-immi',
    title: 'Australia · ImmiAccount personal particulars',
    authority: 'Home Affairs',
    country: 'AU',
    use: 'ImmiAccount online application: student (500), skilled (189/190/491), visitor (600); core of Form 80',
    dateFormat: 'd-mon-y',
    sections: [
      {
        title: 'Applicant',
        fields: [
          { label: 'Family name', value: (x) => v(x.c.lastName) },
          { label: 'Given names', value: (x) => v(x.c.firstName) },
          { label: 'Sex', value: sex },
          { label: 'Date of birth', value: (x) => x.date(x.c.dob) },
          { label: 'Town/city of birth', ask: 'birth.city' },
          { label: 'Country of birth', ask: 'birth.country' },
          { label: 'Relationship status', value: marital },
          { label: 'Other names or spellings', ask: 'other_names' },
          { label: 'Citizenship', value: (x) => v(x.c.nationality) },
          { label: 'National identity card number', ask: 'national_id' },
        ],
      },
      {
        title: 'Passport',
        fields: [
          { label: 'Passport number', value: (x) => v(x.c.passportNumber) },
          { label: 'Country of passport', value: (x) => v(x.c.nationality) },
          { label: 'Date of issue', value: (x) => x.date(x.answer('passport.issue_date')), ask: 'passport.issue_date' },
          { label: 'Date of expiry', value: (x) => x.date(x.c.passportExpiry) },
          { label: 'Place of issue', ask: 'passport.place' },
        ],
      },
      {
        title: 'Contact',
        fields: [
          { label: 'Residential address', value: (x) => v(x.c.address) },
          { label: 'Mobile phone', value: (x) => v(x.c.phone) },
          { label: 'Email', value: (x) => v(x.c.email) },
          { label: 'Address history (last 10 years)', ask: 'address.history' },
        ],
      },
      {
        title: 'Education, employment & English',
        fields: [
          { label: 'Qualifications', value: educationList },
          { label: 'Employment history (last 10 years)', value: (x) => workList(x, 10) },
          { label: 'English test', value: english },
        ],
      },
      {
        title: 'Travel, health & character',
        fields: [
          { label: 'Countries visited (last 10 years)', ask: 'travel.history' },
          { label: 'Previous visits to Australia', ask: 'previous_visits' },
          ...background,
        ],
      },
    ],
  },
  {
    id: 'us-ds160',
    title: 'USA · DS-160 nonimmigrant visa',
    authority: 'US Department of State',
    country: 'US',
    use: 'DS-160 online form: visitor (B1/B2) and student (F-1) visas',
    dateFormat: 'dmy-mon',
    sections: [
      {
        title: 'Personal',
        fields: [
          { label: 'Surnames', value: (x) => v(x.c.lastName?.toUpperCase()) },
          { label: 'Given names', value: (x) => v(x.c.firstName.toUpperCase()) },
          { label: 'Other names used', ask: 'other_names' },
          { label: 'Sex', value: sex },
          { label: 'Marital status', value: marital },
          { label: 'Date of birth', value: (x) => x.date(x.c.dob) },
          { label: 'City of birth', ask: 'birth.city' },
          { label: 'Country/region of birth', ask: 'birth.country' },
          { label: 'Nationality', value: (x) => v(x.c.nationality) },
          { label: 'National identification number', ask: 'national_id' },
        ],
      },
      {
        title: 'Travel',
        fields: [
          { label: 'Purpose of trip', ask: 'trip.purpose' },
          { label: 'Intended date of arrival', value: (x) => x.date(x.answer('trip.arrival')), ask: 'trip.arrival' },
          { label: 'Intended length of stay', ask: 'trip.length' },
          { label: 'Address where you will stay', ask: 'trip.address' },
          { label: 'Person/entity paying for your trip', ask: 'funding' },
          { label: 'U.S. point of contact', ask: 'trip.contact' },
          { label: 'Previous U.S. travel', ask: 'previous_visits' },
          { label: 'Countries visited in the last 5 years', ask: 'travel.history' },
        ],
      },
      {
        title: 'Address, phone & social media',
        fields: [
          { label: 'Home address', value: (x) => v(x.c.address) },
          { label: 'Primary phone number', value: (x) => v(x.c.phone) },
          { label: 'Email address', value: (x) => v(x.c.email) },
          { label: 'Social media (platform: identifier)', ask: 'social_media' },
        ],
      },
      {
        title: 'Passport',
        fields: [
          { label: 'Passport number', value: (x) => v(x.c.passportNumber) },
          { label: 'Issuance date', value: (x) => x.date(x.answer('passport.issue_date')), ask: 'passport.issue_date' },
          { label: 'Expiration date', value: (x) => x.date(x.c.passportExpiry) },
          { label: 'Where was it issued (city)', ask: 'passport.place' },
        ],
      },
      {
        title: 'Family',
        fields: [
          { label: "Father's full name", ask: 'father.name' },
          { label: "Father's date of birth", value: (x) => x.date(x.answer('father.dob')), ask: 'father.dob' },
          { label: "Mother's full name", ask: 'mother.name' },
          { label: "Mother's date of birth", value: (x) => x.date(x.answer('mother.dob')), ask: 'mother.dob' },
          { label: "Spouse's full name", value: (x) => v(spouse(x)?.name) },
          { label: "Spouse's date of birth", value: (x) => x.date(spouse(x)?.dob) },
        ],
      },
      {
        title: 'Work, education & training',
        fields: [
          { label: 'Present employer or school', value: (x) => { const j = currentJob(x); return j ? `${j.employer ?? ''}${j.title ? ` (${j.title})` : ''}, since ${month(j.from)}` : null; } },
          { label: 'Duties', ask: 'employment.duties' },
          { label: 'Previous employment (last 5 years)', value: (x) => workList(x, 5) },
          { label: 'Education (secondary level and above)', value: educationList },
          { label: 'Military service', value: yesNo('military'), ask: 'military' },
        ],
      },
      { title: 'Security and background', fields: background.filter((f) => f.ask !== 'military') },
    ],
  },
];

export const formById = (id: string) => FORMS.find((f) => f.id === id);

// ── Building a sheet ────────────────────────────────────────────────────────

export type SheetRow = { label: string; value: string | null; source: 'profile' | 'client' | 'staff' | 'missing'; ask?: AnswerKey; question?: string };
export type Sheet = {
  form: FormTemplate;
  sections: { title: string; rows: SheetRow[] }[];
  total: number;
  filled: number;
  /** Answer keys still needed (the client can be asked for these). */
  missingAsk: AnswerKey[];
  /** Missing values that belong in the profile (fix on the client record). */
  missingProfile: string[];
};

export function buildSheet(form: FormTemplate, c: SheetClient, answers: Answers): Sheet {
  const answer = (k: AnswerKey) => v(answers[k]?.v);
  const x: Ctx = { c, answer, date: (d) => formatDate(d, form.dateFormat) };
  const missingAsk = new Set<AnswerKey>();
  const missingProfile: string[] = [];
  let total = 0;
  let filled = 0;
  const sections = form.sections.map((s) => ({
    title: s.title,
    rows: s.fields.map((f): SheetRow => {
      total++;
      // A field with a question takes its value from the stored answer (formatted by
      // value() when given, e.g. dates or yes/no + details); others come from the profile.
      const value = f.ask ? (f.value ? f.value(x) : answer(f.ask)) : (f.value?.(x) ?? null);
      if (value) filled++;
      else if (f.ask) missingAsk.add(f.ask);
      else missingProfile.push(`${s.title}: ${f.label}`);
      const source: SheetRow['source'] = !value ? 'missing' : f.ask ? (answers[f.ask]?.by ?? 'staff') : 'profile';
      return { label: f.label, value, source, ...(f.ask ? { ask: f.ask, question: QUESTIONS[f.ask].label } : {}) };
    }),
  }));
  return { form, sections, total, filled, missingAsk: [...missingAsk], missingProfile };
}

/** Plain text of a whole sheet, for "copy all". */
export function sheetText(s: Sheet, clientName: string) {
  return [
    `${s.form.title} · ${clientName}`,
    ...s.sections.flatMap((sec) => ['', sec.title.toUpperCase(), ...sec.rows.map((r) => `${r.label}: ${r.value ?? '[missing]'}`)]),
  ].join('\n');
}
