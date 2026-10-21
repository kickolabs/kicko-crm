// Default visa products seeded into every new tenant. Tenants can edit stages
// and checklists afterwards. These are workflow templates, not legal advice —
// rules change, so agencies should review them.

export type Stage = { key: string; name: string };
export type ChecklistItem = { key: string; name: string; required: boolean; group: string };
export type CatalogProduct = {
  code: string;
  country: string;
  category: 'STUDY' | 'PR' | 'WORK' | 'VISIT' | 'FAMILY';
  name: string;
  stages: Stage[];
  checklist: ChecklistItem[];
};

export const COUNTRIES: Record<string, string> = {
  CA: 'Canada', AU: 'Australia', GB: 'United Kingdom', US: 'United States', NZ: 'New Zealand',
  DE: 'Germany', IE: 'Ireland', FR: 'France', SG: 'Singapore', AE: 'UAE', EU: 'Schengen',
};

export const CATEGORY_LABEL = {
  STUDY: 'Study', PR: 'PR / Skilled', WORK: 'Work', VISIT: 'Visit', FAMILY: 'Family',
} as const;

const s = (...names: string[]): Stage[] =>
  names.map((name) => ({ key: name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''), name }));

const item = (group: string, name: string, required = true): ChecklistItem => ({
  key: `${group}_${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
  name,
  required,
  group,
});

// Reusable checklist blocks
const identity = [
  item('Identity', 'Passport (all pages)'),
  item('Identity', 'Passport-size photographs'),
  item('Identity', 'National ID (Aadhaar / equivalent)', false),
];
const academics = [
  item('Academics', '10th & 12th marksheets'),
  item('Academics', 'Degree certificate & transcripts'),
  item('Academics', 'Backlog / gap explanation letter', false),
];
const english = [item('English', 'English test score report (IELTS/PTE/TOEFL)')];
const studyFunds = [
  item('Financials', 'Bank statements / education loan sanction'),
  item('Financials', 'Sponsor ITRs (2–3 years)'),
  item('Financials', 'Sponsor affidavit of support', false),
];
const work = [
  item('Employment', 'Experience / reference letters'),
  item('Employment', 'Payslips & Form 16 / tax records'),
  item('Employment', 'Updated CV'),
];
const character = [item('Character', 'Police clearance certificate')];
const relationship = [
  item('Relationship', 'Marriage certificate'),
  item('Relationship', 'Photos & proof of genuine relationship'),
  item('Relationship', 'Communication history / joint finances', false),
];
const visitBase = [
  ...identity,
  item('Financials', 'Bank statements (6 months)'),
  item('Financials', 'ITRs (2 years)'),
  item('Purpose', 'Travel itinerary & bookings', false),
  item('Purpose', 'Invitation letter', false),
  item('Ties', 'Employment / business proof & leave letter'),
];

export const VISA_CATALOG: CatalogProduct[] = [
  // ── Study ────────────────────────────────────────────────────────────────
  {
    code: 'CA_STUDY', country: 'CA', category: 'STUDY', name: 'Study Permit',
    stages: s('Counselling', 'Applications', 'Offer (LOA)', 'Tuition paid', 'PAL received', 'GIC', 'Medical', 'Lodged', 'Biometrics', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english, ...studyFunds,
      item('Admission', 'Letter of acceptance (LOA)'), item('Admission', 'Provincial attestation letter (PAL)'),
      item('Admission', 'Tuition fee receipt'), item('Financials', 'GIC certificate'),
      item('Application', 'Statement of purpose'), item('Application', 'Medical (IME) confirmation')],
  },
  {
    code: 'GB_STUDENT', country: 'GB', category: 'STUDY', name: 'Student Visa',
    stages: s('Counselling', 'Applications', 'Offer', 'Deposit paid', 'CAS issued', 'TB test', 'Funds (28 days)', 'Lodged', 'Biometrics', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english,
      item('Admission', 'Unconditional offer'), item('Admission', 'CAS statement'),
      item('Financials', 'Bank statement held 28 days'), item('Financials', 'Relationship proof for parent funds', false),
      item('Health', 'TB test certificate'), item('Application', 'IHS payment receipt')],
  },
  {
    code: 'AU_500', country: 'AU', category: 'STUDY', name: 'Student Visa (500)',
    stages: s('Counselling', 'Applications', 'Offer', 'GS assessment', 'CoE issued', 'OSHC', 'Lodged', 'Biometrics', 'Health exam', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english, ...studyFunds,
      item('Admission', 'Confirmation of Enrolment (CoE)'), item('Application', 'Genuine Student statement'),
      item('Insurance', 'OSHC policy'), item('Health', 'Health examination (HAP ID)')],
  },
  {
    code: 'US_F1', country: 'US', category: 'STUDY', name: 'F-1 Student Visa',
    stages: s('Counselling', 'Applications', 'Admit', 'I-20 issued', 'SEVIS fee', 'DS-160', 'Interview booked', 'Interview', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english, ...studyFunds,
      item('Admission', 'Form I-20'), item('Application', 'SEVIS I-901 receipt'),
      item('Application', 'DS-160 confirmation'), item('Application', 'Visa appointment letter')],
  },
  {
    code: 'NZ_STUDENT', country: 'NZ', category: 'STUDY', name: 'Fee Paying Student Visa',
    stages: s('Counselling', 'Applications', 'Offer', 'Fees paid', 'Lodged', 'Medical', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english, ...studyFunds, item('Admission', 'Offer of place'), item('Health', 'Medical & chest X-ray')],
  },
  {
    code: 'DE_STUDENT', country: 'DE', category: 'STUDY', name: 'National Visa (Study)',
    stages: s('Counselling', 'Applications', 'Admission', 'Blocked account', 'APS certificate', 'Appointment', 'Lodged', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english, item('Admission', 'Admission letter'),
      item('Financials', 'Blocked account confirmation'), item('Academics', 'APS certificate'), item('Insurance', 'Health insurance')],
  },
  {
    code: 'IE_STUDY', country: 'IE', category: 'STUDY', name: 'Study Visa (Stamp 2)',
    stages: s('Counselling', 'Applications', 'Offer', 'Fees paid', 'Lodged', 'Biometrics', 'Decision', 'Pre-departure'),
    checklist: [...identity, ...academics, ...english, ...studyFunds, item('Admission', 'Letter of acceptance'), item('Insurance', 'Private medical insurance')],
  },
  // ── PR / Skilled ─────────────────────────────────────────────────────────
  {
    code: 'CA_EE', country: 'CA', category: 'PR', name: 'Express Entry',
    stages: s('Assessment', 'ECA & language', 'Profile created', 'In pool', 'ITA received', 'eAPR documents', 'eAPR submitted', 'Biometrics & medical', 'Decision (COPR)', 'Landing'),
    checklist: [...identity, ...english, ...work, ...character,
      item('Academics', 'Educational Credential Assessment (ECA)'), item('Financials', 'Proof of funds'),
      item('Health', 'Medical exam'), item('Application', 'Job offer / LMIA', false)],
  },
  {
    code: 'CA_PNP', country: 'CA', category: 'PR', name: 'Provincial Nominee Program',
    stages: s('Assessment', 'EOI submitted', 'Invitation', 'Provincial application', 'Nomination', 'PR application', 'Biometrics & medical', 'Decision (COPR)', 'Landing'),
    checklist: [...identity, ...english, ...work, ...character, item('Academics', 'ECA report'), item('Financials', 'Settlement funds')],
  },
  {
    code: 'AU_189', country: 'AU', category: 'PR', name: 'Skilled Independent (189)',
    stages: s('Assessment', 'Skills assessment', 'English test', 'EOI submitted', 'Invitation', 'Lodged', 'Health & police', 'Decision'),
    checklist: [...identity, ...english, ...work, ...character, item('Skills', 'Skills assessment outcome'), item('Health', 'Health examination')],
  },
  {
    code: 'AU_190', country: 'AU', category: 'PR', name: 'Skilled Nominated (190)',
    stages: s('Assessment', 'Skills assessment', 'English test', 'EOI + state ROI', 'Nomination', 'Invitation', 'Lodged', 'Health & police', 'Decision'),
    checklist: [...identity, ...english, ...work, ...character, item('Skills', 'Skills assessment outcome'), item('Skills', 'State nomination approval'), item('Health', 'Health examination')],
  },
  {
    code: 'AU_491', country: 'AU', category: 'PR', name: 'Skilled Work Regional (491)',
    stages: s('Assessment', 'Skills assessment', 'English test', 'EOI submitted', 'Nomination / sponsorship', 'Invitation', 'Lodged', 'Health & police', 'Decision'),
    checklist: [...identity, ...english, ...work, ...character, item('Skills', 'Skills assessment outcome'), item('Skills', 'Regional nomination or family sponsorship')],
  },
  {
    code: 'NZ_SMC', country: 'NZ', category: 'PR', name: 'Skilled Migrant Category',
    stages: s('Assessment', 'Qualification recognition', 'EOI submitted', 'Invitation', 'Lodged', 'Medical & police', 'Decision'),
    checklist: [...identity, ...english, ...work, ...character, item('Employment', 'NZ job offer'), item('Academics', 'NZQA assessment', false)],
  },
  // ── Work ─────────────────────────────────────────────────────────────────
  {
    code: 'CA_WORK', country: 'CA', category: 'WORK', name: 'Work Permit (LMIA)',
    stages: s('Assessment', 'Job offer', 'LMIA', 'Documents', 'Lodged', 'Biometrics', 'Decision'),
    checklist: [...identity, ...work, item('Employment', 'Job offer letter'), item('Employment', 'Positive LMIA')],
  },
  {
    code: 'GB_SKILLED', country: 'GB', category: 'WORK', name: 'Skilled Worker Visa',
    stages: s('Assessment', 'Job offer', 'CoS issued', 'Documents', 'Lodged', 'Biometrics', 'Decision'),
    checklist: [...identity, ...english, ...work, item('Employment', 'Certificate of Sponsorship'), item('Health', 'TB test certificate'), item('Character', 'Criminal record certificate', false)],
  },
  {
    code: 'AU_482', country: 'AU', category: 'WORK', name: 'Skills in Demand (482)',
    stages: s('Assessment', 'Employer nomination', 'Documents', 'Lodged', 'Health & police', 'Decision'),
    checklist: [...identity, ...english, ...work, item('Employment', 'Approved nomination'), item('Skills', 'Skills assessment', false)],
  },
  {
    code: 'DE_BLUECARD', country: 'DE', category: 'WORK', name: 'EU Blue Card',
    stages: s('Assessment', 'Job contract', 'Degree recognition', 'Appointment', 'Lodged', 'Decision'),
    checklist: [...identity, ...work, item('Employment', 'Employment contract'), item('Academics', 'Anabin / ZAB recognition')],
  },
  {
    code: 'US_H1B', country: 'US', category: 'WORK', name: 'H-1B',
    stages: s('Assessment', 'Registration', 'Selected', 'Petition filed', 'Petition approved', 'DS-160', 'Interview', 'Decision'),
    checklist: [...identity, ...academics, ...work, item('Employment', 'I-797 approval notice'), item('Application', 'DS-160 confirmation')],
  },
  // ── Visit ────────────────────────────────────────────────────────────────
  { code: 'CA_TRV', country: 'CA', category: 'VISIT', name: 'Visitor Visa (TRV)', stages: s('Assessment', 'Documents', 'Lodged', 'Biometrics', 'Decision'), checklist: visitBase },
  { code: 'GB_VISIT', country: 'GB', category: 'VISIT', name: 'Standard Visitor', stages: s('Assessment', 'Documents', 'Lodged', 'Biometrics', 'Decision'), checklist: visitBase },
  { code: 'US_B1B2', country: 'US', category: 'VISIT', name: 'B1/B2 Visitor', stages: s('Assessment', 'DS-160', 'Interview booked', 'Interview', 'Decision'), checklist: [...visitBase, item('Application', 'DS-160 confirmation')] },
  { code: 'AU_600', country: 'AU', category: 'VISIT', name: 'Visitor (600)', stages: s('Assessment', 'Documents', 'Lodged', 'Biometrics', 'Decision'), checklist: visitBase },
  { code: 'EU_SCHENGEN', country: 'EU', category: 'VISIT', name: 'Schengen Visa', stages: s('Assessment', 'Documents', 'Appointment', 'Lodged', 'Decision'), checklist: [...visitBase, item('Insurance', 'Travel medical insurance')] },
  // ── Family ───────────────────────────────────────────────────────────────
  {
    code: 'CA_SPOUSAL', country: 'CA', category: 'FAMILY', name: 'Spousal Sponsorship',
    stages: s('Assessment', 'Documents', 'Lodged', 'Sponsor approval', 'Biometrics & medical', 'Decision'),
    checklist: [...identity, ...relationship, ...character, item('Sponsor', 'Sponsor PR card / citizenship proof'), item('Health', 'Medical exam')],
  },
  {
    code: 'CA_SUPER', country: 'CA', category: 'FAMILY', name: 'Parent & Grandparent Super Visa',
    stages: s('Assessment', 'Documents', 'Lodged', 'Biometrics', 'Medical', 'Decision'),
    checklist: [...identity, item('Sponsor', 'Invitation letter from child'), item('Sponsor', 'Child income proof (LICO)'), item('Insurance', 'Canadian medical insurance (1 year)'), item('Health', 'Medical exam')],
  },
  {
    code: 'GB_SPOUSE', country: 'GB', category: 'FAMILY', name: 'Spouse / Partner Visa',
    stages: s('Assessment', 'Documents', 'Lodged', 'Biometrics', 'Decision'),
    checklist: [...identity, ...relationship, ...english, item('Sponsor', 'Sponsor income evidence'), item('Sponsor', 'Accommodation proof'), item('Health', 'TB test certificate')],
  },
  {
    code: 'AU_PARTNER', country: 'AU', category: 'FAMILY', name: 'Partner Visa (820/309)',
    stages: s('Assessment', 'Documents', 'Lodged', 'Health & police', 'Temporary grant', 'Permanent stage'),
    checklist: [...identity, ...relationship, ...character, item('Sponsor', 'Sponsor citizenship / PR proof'), item('Relationship', 'Form 888 statutory declarations')],
  },
];
