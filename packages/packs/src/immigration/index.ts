import type { ChecklistItem, LibrarySeedItem, PackManifest, Stage, WorkflowTemplate } from '../types';
import { CATEGORY_LABEL, VISA_CATALOG } from './catalog';
import { DOCUMENT_TEMPLATES } from './templates';

// The Immigration Consultancy pack: every destination country, visa pathways with
// eligibility, steps, documents and official sources, occupations, and the applicant
// fields consultancies need. Library content comes from library.json (see scripts/).

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const stages = (...names: string[]): Stage[] => names.map((name) => ({ key: slug(name), name }));
const LODGED = /lodg|submit|petition|application filed|apply online|visa application/i;

const OCCUPATION_GROUPS = [
  'drivers', 'education', 'healthcare', 'care', 'hospitality', 'construction_trades',
  'factory_logistics', 'agriculture', 'it', 'engineering', 'finance', 'other_professional',
];

const CATEGORY = { ...CATEGORY_LABEL } as Record<string, string>;

const OCCUPATION_GROUP_LABEL_MAP: Record<string, string> = {
  drivers: 'Drivers', education: 'Education', healthcare: 'Healthcare', care: 'Care & support', hospitality: 'Hospitality',
  construction_trades: 'Construction & trades', factory_logistics: 'Factory & logistics', agriculture: 'Agriculture',
  it: 'IT', engineering: 'Engineering', finance: 'Finance & accounting', other_professional: 'Other professional',
};

/** Starter checklist for a pathway with no researched document list. */
const BASE_DOCS: ChecklistItem[] = [
  { key: 'identity_passport', name: 'Passport (all pages)', required: true, group: 'Identity', docType: 'passport', expires: true },
  { key: 'identity_photos', name: 'Passport-size photographs', required: true, group: 'Identity', docType: 'photograph' },
  { key: 'character_pcc', name: 'Police clearance certificate', required: false, group: 'Character', docType: 'pcc', expires: true },
];

const GENERIC: Record<string, { name: string; stages: Stage[]; checklist: ChecklistItem[] }> = {
  STUDY: {
    name: 'Study visa',
    stages: stages('Counselling', 'Applications', 'Offer', 'Fees & funds', 'Documents', 'Lodged', 'Biometrics', 'Decision', 'Pre-departure'),
    checklist: [...BASE_DOCS, { key: 'admission_offer', name: 'Offer / admission letter', required: true, group: 'Admission' }, { key: 'financials_funds', name: 'Proof of funds', required: true, group: 'Financials' }],
  },
  WORK: {
    name: 'Work visa',
    stages: stages('Consultation', 'Profile & documents', 'Job offer', 'Work permit / sponsorship', 'Medical & police', 'Lodged', 'Decision', 'Pre-departure'),
    checklist: [...BASE_DOCS, { key: 'employment_offer', name: 'Job offer / employment contract', required: true, group: 'Employment' }, { key: 'employment_experience', name: 'Experience letters', required: true, group: 'Employment' }],
  },
  PR: {
    name: 'Permanent residence',
    stages: stages('Consultation', 'Eligibility assessment', 'Skills & language tests', 'Profile / expression of interest', 'Invitation', 'Documents', 'Lodged', 'Medical & police', 'Decision', 'Landing'),
    checklist: [...BASE_DOCS, { key: 'english_test', name: 'Language test result', required: true, group: 'English' }],
  },
  VISIT: {
    name: 'Visit visa',
    stages: stages('Consultation', 'Documents', 'Application form', 'Lodged', 'Biometrics', 'Decision'),
    checklist: [...BASE_DOCS, { key: 'financials_bank', name: 'Bank statements', required: true, group: 'Financials' }],
  },
  FAMILY: {
    name: 'Family / dependant visa',
    stages: stages('Consultation', 'Sponsor documents', 'Relationship evidence', 'Lodged', 'Biometrics', 'Decision'),
    checklist: [...BASE_DOCS, { key: 'relationship_proof', name: 'Proof of relationship', required: true, group: 'Relationship' }],
  },
  OTHER: {
    name: 'Visa application',
    stages: stages('Consultation', 'Documents', 'Lodged', 'Decision'),
    checklist: BASE_DOCS,
  },
};
for (const g of Object.values(GENERIC)) for (const s of g.stages) if (s.key === 'lodged') s.lodged = true;

const catalog = new Map(VISA_CATALOG.map((p) => [p.code, p]));

type PathwayData = {
  category?: string;
  kind?: string;
  summary?: string;
  stages?: { key?: string; name: string }[];
  documents?: { key: string; name: string; group?: string; required?: boolean; when?: string }[];
  [k: string]: unknown;
};

/** The reference info a workflow keeps from its library pathway (shown on lead and case pages). */
function infoOf(item: LibrarySeedItem) {
  const d = item.data as PathwayData;
  const { stages: _s, documents: _d, ...info } = d;
  return { ...info, sources: item.sources, unverified: item.unverified ?? false };
}

export const immigrationPack: PackManifest = {
  id: 'immigration',
  name: 'Immigration Consultancy',
  version: 1,
  description: 'Every destination country, visa pathways with official sources, occupations and applicant profiles.',
  labels: {
    workflow: 'Visa workflow',
    workflows: 'Visa workflows',
    region: 'Country',
    pathway: 'Visa pathway',
    organization: 'Employer',
    organizations: 'Employers',
    opening: 'Vacancy',
    openings: 'Vacancies',
    candidate: 'Candidate',
  },
  libraryTypes: {
    country: { label: 'Country', plural: 'Countries' },
    pathway: { label: 'Visa pathway', plural: 'Visa pathways', parent: 'country' },
    occupation: { label: 'Occupation', plural: 'Occupations' },
    document_type: { label: 'Document type', plural: 'Document types' },
    test_type: { label: 'Language test', plural: 'Language tests' },
  },
  groupLabels: { occupation: OCCUPATION_GROUP_LABEL_MAP },
  workflowType: 'pathway',
  regionType: 'country',
  categories: CATEGORY,
  fields: [
    // Leads: what the enquirer wants, captured before conversion.
    { entity: 'leads', key: 'occupation', label: 'Occupation', type: 'lookup', library: 'occupation', carry: true, section: 'Applicant' },
    { entity: 'leads', key: 'qualification', label: 'Highest qualification', type: 'select', options: ['10th', '12th', 'ITI / trade certificate', 'Diploma', "Bachelor's", "Master's", 'PhD'], carry: true, section: 'Applicant' },
    { entity: 'leads', key: 'experienceYears', label: 'Work experience (years)', type: 'number', carry: true, section: 'Applicant' },
    { entity: 'leads', key: 'alsoInterested', label: 'Other destinations', type: 'multi_lookup', library: 'country', hint: 'Countries they would also consider', carry: true, section: 'Destination' },
    { entity: 'leads', key: 'service', label: 'Service needed', type: 'select', options: ['Visa only', 'Admission + visa', 'Job placement + visa', 'Assessment only', 'Documentation only'], carry: true, section: 'Destination' },
    // Clients: the professional profile.
    { entity: 'clients', key: 'occupation', label: 'Occupation', type: 'lookup', library: 'occupation', section: 'Profession' },
    { entity: 'clients', key: 'qualification', label: 'Highest qualification', type: 'select', options: ['10th', '12th', 'ITI / trade certificate', 'Diploma', "Bachelor's", "Master's", 'PhD'], section: 'Profession' },
    { entity: 'clients', key: 'experienceYears', label: 'Work experience (years)', type: 'number', section: 'Profession' },
    { entity: 'clients', key: 'desiredRole', label: 'Desired job role', type: 'text', section: 'Profession' },
    { entity: 'clients', key: 'skills', label: 'Skills', type: 'text', hint: 'Comma-separated, e.g. forklift, HACCP, Excel', section: 'Profession' },
    {
      entity: 'clients', key: 'certifications', label: 'Certifications', type: 'repeater', section: 'Profession',
      columns: [
        { key: 'name', label: 'Certificate', type: 'text' },
        { key: 'issuer', label: 'Issued by', type: 'text' },
        { key: 'expires', label: 'Valid until', type: 'date' },
      ],
    },
    {
      entity: 'clients', key: 'licences', label: 'Licences & registrations', type: 'repeater', section: 'Profession',
      hint: 'Driving licences and professional registrations (nursing council, trade licences…)',
      columns: [
        { key: 'kind', label: 'Type', type: 'select', options: ['Driving licence', 'Professional registration', 'Trade licence', 'Other'] },
        { key: 'category', label: 'Category / class', type: 'text' },
        { key: 'number', label: 'Number', type: 'text' },
        { key: 'country', label: 'Issued in', type: 'text' },
        { key: 'expires', label: 'Valid until', type: 'date' },
      ],
    },
    { entity: 'clients', key: 'preferredCountries', label: 'Preferred countries', type: 'multi_lookup', library: 'country', section: 'Preferences' },
    { entity: 'clients', key: 'alsoInterested', label: 'Other destinations', type: 'multi_lookup', library: 'country', section: 'Preferences' },
    { entity: 'clients', key: 'salaryExpectation', label: 'Salary expectation', type: 'text', hint: 'e.g. AED 3,500 / month', section: 'Preferences' },
    { entity: 'clients', key: 'jobPreferences', label: 'Job preferences', type: 'text', hint: 'Shifts, accommodation, location…', section: 'Preferences' },
    { entity: 'clients', key: 'service', label: 'Service needed', type: 'select', options: ['Visa only', 'Admission + visa', 'Job placement + visa', 'Assessment only', 'Documentation only'], section: 'Preferences' },
    { entity: 'clients', key: 'assessment', label: 'Eligibility assessment', type: 'select', options: ['Not assessed', 'Eligible', 'Eligible with conditions', 'Not eligible yet', 'Not eligible'], section: 'Assessment' },
    { entity: 'clients', key: 'assessmentNotes', label: 'Consultant notes', type: 'text', section: 'Assessment' },
  ],
  starterWorkflows: () =>
    VISA_CATALOG.map((p) => ({ ...p, stages: p.stages.map((s) => (s.key === 'lodged' ? { ...s, lodged: true } : s)) })),
  documentTemplates: () => DOCUMENT_TEMPLATES,
  genericWorkflows: () =>
    Object.entries(GENERIC).map(([category, g]) => ({ code: `GENERIC_${category}`, country: '', category, name: g.name, stages: g.stages, checklist: g.checklist })),
  workflowFromLibrary(item) {
    const d = item.data as PathwayData;
    const category = d.category && d.category in CATEGORY ? d.category : 'OTHER';
    const base = catalog.get(item.key);
    // Proven starter workflows keep their stages and checklist; research adds the reference info.
    if (base) return { ...base, name: base.name, kind: d.kind, info: infoOf(item) };
    const researched = (d.stages ?? []).filter((s) => s.name).map((s) => ({ key: s.key ?? slug(s.name), name: s.name }));
    const st: Stage[] = researched.length >= 2 ? researched : GENERIC[category]!.stages;
    const lodgedAt = st.findIndex((s) => LODGED.test(s.name));
    const docs = (d.documents ?? []).filter((x) => x.name);
    const checklist: ChecklistItem[] = docs.length
      ? docs.map((x) => ({ key: x.key || slug(`${x.group ?? 'General'}_${x.name}`), name: x.name, group: x.group ?? 'General', required: x.required !== false && !x.when }))
      : GENERIC[category]!.checklist;
    return {
      code: item.key,
      country: item.parent ?? '',
      category,
      kind: d.kind,
      name: item.name,
      stages: st.map((s, i) => (i === lodgedAt ? { ...s, lodged: true } : s)),
      checklist: [...new Map(checklist.map((c) => [c.key, c])).values()],
      info: infoOf(item),
    };
  },
};

export { OCCUPATION_GROUPS };
export const OCCUPATION_GROUP_LABEL = OCCUPATION_GROUP_LABEL_MAP;
