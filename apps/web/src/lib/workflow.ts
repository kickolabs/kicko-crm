import type { ChecklistItem, Rule, Stage } from '@kicko/packs';

// The core workflow engine (pure). A case runs on a snapshot of its workflow taken when
// it opened: only the stages and documents whose conditions match the applicant, so a
// truck driver's case asks for a driving licence and a nurse's for a council registration.

export type RuleContext = {
  occupationGroup?: string | null;
  hasEmployer?: boolean;
  hasDependants?: boolean;
  /** Field values the rule may test (pack fields, by key). */
  fields?: Record<string, unknown>;
};

export type WorkflowSnapshot = { stages: Stage[]; checklist: ChecklistItem[]; productName?: string; version?: number | null };

export function ruleMatches(rule: Rule | undefined, ctx: RuleContext): boolean {
  if (!rule) return true;
  if (rule.occupationGroups?.length && !(ctx.occupationGroup && rule.occupationGroups.includes(ctx.occupationGroup))) return false;
  if (rule.hasEmployer !== undefined && !!ctx.hasEmployer !== rule.hasEmployer) return false;
  if (rule.hasDependants !== undefined && !!ctx.hasDependants !== rule.hasDependants) return false;
  if (rule.field) {
    const v = ctx.fields?.[rule.field.key];
    const values = (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).toLowerCase());
    if (!rule.field.in.some((want) => values.includes(want.toLowerCase()))) return false;
  }
  return true;
}

/** The workflow a new case runs on, for this applicant. */
export function snapshotFor(
  product: { name: string; stages: unknown; checklist: unknown; libraryVersion?: number | null },
  ctx: RuleContext,
): WorkflowSnapshot {
  const stages = (Array.isArray(product.stages) ? (product.stages as Stage[]) : []).filter((s) => ruleMatches(s.when, ctx));
  const checklist = (Array.isArray(product.checklist) ? (product.checklist as ChecklistItem[]) : []).filter((c) => ruleMatches(c.when, ctx));
  return { stages, checklist, productName: product.name, version: product.libraryVersion ?? null };
}

/** A case's stages: its snapshot, or (for older data) the product's current stages. */
export function stagesOf(x: { workflow?: unknown; stages?: unknown; product?: { stages: unknown } | null }): Stage[] {
  const snap = x.workflow as WorkflowSnapshot | null | undefined;
  if (snap && Array.isArray(snap.stages) && snap.stages.length) return snap.stages;
  const s = x.stages ?? x.product?.stages;
  return Array.isArray(s) ? (s as Stage[]) : [];
}

export function checklistOf(x: { workflow?: unknown; product?: { checklist: unknown } | null }): ChecklistItem[] {
  const snap = x.workflow as WorkflowSnapshot | null | undefined;
  if (snap && Array.isArray(snap.checklist)) return snap.checklist;
  const c = x.product?.checklist;
  return Array.isArray(c) ? (c as ChecklistItem[]) : [];
}

/** Main-journey stages (side tracks such as medical or police clearance run beside them). */
export const mainStages = (stages: Stage[]) => stages.filter((s) => !s.track);
export const trackStages = (stages: Stage[]) => stages.filter((s) => s.track);

/**
 * What's stopping a case from moving past `stage` (its gate), as plain sentences.
 * `docs` maps checklist keys to document status.
 */
export function gateProblems(
  stage: Stage | undefined,
  o: { docs: Record<string, string>; fields?: Record<string, unknown>; hasFollowUp?: boolean; docName?: (key: string) => string; fieldName?: (key: string) => string },
): string[] {
  const req = stage?.requires;
  if (!req) return [];
  const out: string[] = [];
  for (const key of req.documents ?? []) {
    const st = o.docs[key];
    if (st !== 'VERIFIED' && st !== 'NOT_APPLICABLE') out.push(`${o.docName?.(key) ?? key} is not verified yet`);
  }
  for (const key of req.fields ?? []) {
    const v = o.fields?.[key];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) out.push(`${o.fieldName?.(key) ?? key} is missing`);
  }
  if (req.followUp && !o.hasFollowUp) out.push('Schedule a follow-up first');
  return out;
}

/** Is `key` the lodged stage, or after it? Stages flag it; older workflows fall back to the name. */
const LODGED = /lodged|submitted|petition_filed/;
export function lodgedBy(stages: { key: string; lodged?: boolean }[], key: string) {
  const flagged = stages.findIndex((s) => s.lodged);
  const at = flagged >= 0 ? flagged : stages.findIndex((s) => LODGED.test(s.key));
  const idx = stages.findIndex((s) => s.key === key);
  return at >= 0 && idx >= at;
}

/** Days a case has been in its current stage beyond the stage's deadline (0 = on time). */
export function overdueDays(stage: Stage | undefined, since: Date, now = new Date()) {
  if (!stage?.deadlineDays) return 0;
  const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
  return Math.max(0, days - stage.deadlineDays);
}
