// The contract between Kicko's industry-neutral core and an industry pack.
// A pack brings the industry's knowledge (reference lists, workflow templates, fields,
// words); the core brings the engines that run them. Nothing in here may import the core.

/** When a stage or checklist item applies, judged against the record's field values. */
export type Rule = {
  /** Applies only if the applicant's occupation group is one of these. */
  occupationGroups?: string[];
  /** Applies only when the case has (true) / has no (false) employer linked. */
  hasEmployer?: boolean;
  /** Applies only when dependants are included (true) / none (false). */
  hasDependants?: boolean;
  /** Applies only when field `key` has one of `in` (strings compared case-insensitively). */
  field?: { key: string; in: string[] };
};

export type Stage = {
  key: string;
  name: string;
  /** May be skipped. */
  optional?: boolean;
  /** Reaching this stage means the application was lodged / submitted. */
  lodged?: boolean;
  /** Shown as a milestone on the journey. */
  milestone?: boolean;
  /** Only part of this case's journey when the rule matches. */
  when?: Rule;
  /** Can't move past this stage until these are in place. */
  requires?: { documents?: string[]; fields?: string[]; followUp?: boolean };
  /** Expected days to complete this stage; overdue stages escalate. */
  deadlineDays?: number;
  /** A side track that runs beside the main stages (e.g. medical, police clearance). */
  track?: string;
  /** Tasks created when the case enters this stage. */
  tasks?: { title: string; dueDays?: number }[];
};

export type ChecklistItem = {
  key: string;
  name: string;
  required: boolean;
  group: string;
  when?: Rule;
  /** Library document type, e.g. 'passport'. */
  docType?: string;
  /** This document expires (passport, PCC, medical...). */
  expires?: boolean;
};

/** A workflow an agency can run cases on (a visa pathway, in the immigration pack). */
export type WorkflowTemplate = {
  code: string;
  /** Library parent (country) key, or '' for a generic template. */
  country: string;
  category: string;
  name: string;
  kind?: string;
  stages: Stage[];
  checklist: ChecklistItem[];
  info?: Record<string, unknown>;
};

export type Source = { url: string; title?: string; publisher?: string; official?: boolean; verifiedAt?: string };

/** A reference-library entry as shipped in a pack's library.json. */
export type LibrarySeedItem = {
  type: string;
  key: string;
  parent?: string;
  name: string;
  coverage?: 'basic' | 'full';
  unverified?: boolean;
  data: Record<string, unknown>;
  sources: Source[];
};

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'yesno' | 'lookup' | 'multi_lookup' | 'repeater';

/** A field a pack adds to leads, clients or cases. Rendered and validated by the core field engine. */
export type PackField = {
  entity: 'leads' | 'clients' | 'cases';
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  hint?: string;
  /** lookup / multi_lookup: which library type; dependsOn: another field whose value is the parent key. */
  library?: string;
  dependsOn?: string;
  /** repeater: its columns. */
  columns?: { key: string; label: string; type: 'text' | 'number' | 'date' | 'select' | 'month'; options?: string[] }[];
  /** Copied lead → client/case on conversion when the target has a field with the same key. */
  carry?: boolean;
  /** Group heading in forms. */
  section?: string;
};

export type PackManifest = {
  id: string;
  name: string;
  /** Bumped when the pack's shipped content changes. */
  version: number;
  description: string;
  /** Industry words for core concepts, e.g. { organization: 'Employer', opening: 'Vacancy' }. */
  labels: Record<string, string>;
  /** Library types this pack defines, with their parent type (pathway → country). */
  libraryTypes: Record<string, { label: string; plural: string; parent?: string }>;
  /** Labels for the groups a library type's items fall into (occupation groups...). */
  groupLabels?: Record<string, Record<string, string>>;
  /** The library type that cases are run on (pathways), and the one it hangs off (countries). */
  workflowType: string;
  regionType?: string;
  fields: PackField[];
  /** Workflow categories the pack uses, with labels (Study, Work...). */
  categories: Record<string, string>;
  /** Workflows a new workspace starts with. */
  starterWorkflows: () => WorkflowTemplate[];
  /** Generic workflows for library parents that have no researched pathway yet. */
  genericWorkflows: () => WorkflowTemplate[];
  /** Build a workflow template from a library pathway item. */
  workflowFromLibrary: (item: LibrarySeedItem) => WorkflowTemplate;
};
