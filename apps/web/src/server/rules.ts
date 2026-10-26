import 'server-only';
import type { Prisma, Tx } from '@kicko/db';
import { z } from 'zod';
import { countryName } from '@/lib/countries';
import { audit } from './audit';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// The rules engine: "when <trigger> and <conditions>, do <actions>". Rules run after the
// change that triggered them has committed (callers emit afterwards), so a failing action
// never undoes business data. Each run is logged with what every action did; an action
// is tried up to 3 times before it counts as failed.

export const TRIGGERS = {
  LEAD_CREATED: { label: 'A lead is created', record: 'lead', conditions: ['source', 'country', 'category'] },
  LEAD_STATUS: { label: 'A lead changes status', record: 'lead', conditions: ['status', 'country'] },
  CASE_OPENED: { label: 'A case is opened', record: 'case', conditions: ['country', 'category', 'productId'] },
  CASE_STAGE: { label: 'A case moves to a stage', record: 'case', conditions: ['stageKey', 'productId', 'country'] },
  CASE_STAGE_OVERDUE: { label: 'A case is past a stage deadline (daily)', record: 'case', conditions: ['stageKey', 'productId'] },
  DOC_UPLOADED: { label: 'A document is uploaded', record: 'case', conditions: [] },
  DOC_REJECTED: { label: 'A document is rejected', record: 'case', conditions: [] },
  DOC_EXPIRING: { label: 'A document expires within 30 days (daily)', record: 'case', conditions: [] },
  APPOINTMENT_BOOKED: { label: 'An appointment is booked', record: 'appointment', conditions: [] },
  APPOINTMENT_MISSED: { label: 'An appointment is marked no-show', record: 'appointment', conditions: [] },
  TASK_OVERDUE: { label: 'A task becomes overdue (daily)', record: 'task', conditions: [] },
  INVOICE_OVERDUE: { label: 'An invoice instalment is overdue (daily)', record: 'invoice', conditions: [] },
  CANDIDATE_STAGE: { label: 'A candidate moves stage on a vacancy', record: 'candidate', conditions: ['status'] },
} as const;
export type Trigger = keyof typeof TRIGGERS;

export const CONDITION_LABEL: Record<string, string> = {
  source: 'Lead source', country: 'Country', category: 'Visa type', status: 'Status', stageKey: 'Stage', productId: 'Workflow', branchId: 'Branch',
};

/** What happened, for conditions and for filling texts like "{{name}} moved to {{stage}}". */
export type Event = {
  recordType: string;
  recordId: string;
  leadId?: string | null;
  clientId?: string | null;
  caseId?: string | null;
  ownerId?: string | null;
  values: Record<string, string | null | undefined>;
  /** Words for texts: name, stage, document, workflow… */
  words?: Record<string, string | null | undefined>;
};

const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), title: z.string().trim().min(2).max(200), dueDays: z.coerce.number().int().min(0).max(365).default(1), assignTo: z.string().default('owner') }),
  z.object({ type: z.literal('assign_owner'), to: z.string().min(1) }), // 'least_loaded' | userId
  z.object({ type: z.literal('notify'), to: z.string().default('owner'), text: z.string().trim().min(2).max(300) }), // owner | admins | userId
  z.object({ type: z.literal('whatsapp'), template: z.string().trim().min(1).max(120), language: z.string().default('en') }),
  z.object({ type: z.literal('email'), subject: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(5000) }),
  z.object({ type: z.literal('set_status'), status: z.string().min(1) }),
]);
export type Action = z.infer<typeof action>;
export const ACTION_LABEL: Record<Action['type'], string> = {
  create_task: 'Create a task', assign_owner: 'Assign the owner', notify: 'Notify someone in the app', whatsapp: 'Send a WhatsApp template to the client',
  email: 'Email the client', set_status: 'Set the lead status',
};

export const ruleInput = z.object({
  name: z.string().trim().min(2, 'Name the rule').max(120),
  trigger: z.enum(Object.keys(TRIGGERS) as [Trigger, ...Trigger[]]),
  conditions: z.record(z.string(), z.string().trim().max(80)).default({}),
  actions: z.array(action).min(1, 'Add at least one action').max(5),
  active: z.boolean().default(true),
});

export async function saveRule(scope: Scope, id: string | null, raw: z.input<typeof ruleInput>) {
  const input = ruleInput.parse(raw);
  const conditions = Object.fromEntries(Object.entries(input.conditions).filter(([k, v]) => v && (TRIGGERS[input.trigger].conditions as readonly string[]).includes(k)));
  const data = { name: input.name, trigger: input.trigger, conditions, actions: input.actions as unknown as Prisma.InputJsonValue, active: input.active };
  const r = await inTenant(scope, (tx) => (id ? tx.rule.update({ where: { id }, data }) : tx.rule.create({ data: { tenantId: scope.tenantId, createdBy: scope.actorId, ...data } })));
  await audit(scope, 'settings.rule', `${id ? 'Updated' : 'Created'} automation "${input.name}"`);
  return r.id;
}

export const fill = (text: string, words: Event['words'] = {}) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => words?.[k] ?? '');

/** Does the event meet the rule's conditions? Empty conditions always match. */
export function conditionsMatch(conditions: Record<string, string>, values: Event['values']) {
  return Object.entries(conditions).every(([k, want]) => !want || (values[k] ?? '').toString().toLowerCase() === want.toLowerCase());
}

async function runAction(tx: Tx, scope: Scope, a: Action, e: Event): Promise<string> {
  const owner = e.ownerId ?? null;
  switch (a.type) {
    case 'create_task': {
      const assignee = a.assignTo === 'owner' ? owner : a.assignTo;
      await tx.task.create({ data: { tenantId: scope.tenantId, title: fill(a.title, e.words), dueAt: new Date(Date.now() + a.dueDays * 86_400_000), assigneeId: assignee, leadId: e.leadId ?? null, clientId: e.clientId ?? null, caseId: e.caseId ?? null } });
      return `Task "${fill(a.title, e.words)}"`;
    }
    case 'assign_owner': {
      if (!e.leadId && !e.caseId) return 'Nothing to assign';
      let to = a.to;
      if (to === 'least_loaded') {
        const { pickAssignee } = await import('./leads');
        to = (await pickAssignee(tx)) ?? '';
      }
      if (!to || !(await tx.membership.findFirst({ where: { userId: to, active: true } }))) throw new Error('That person is no longer on the team');
      if (e.recordType === 'lead' && e.leadId) await tx.lead.update({ where: { id: e.leadId }, data: { ownerId: to } });
      else if (e.caseId) await tx.case.update({ where: { id: e.caseId }, data: { ownerId: to } });
      await notifyTx(tx, scope, [to], { kind: 'assigned', text: `${e.words?.name ?? 'A record'} was assigned to you`, href: hrefOf(scope, e) });
      return 'Owner assigned';
    }
    case 'notify': {
      const users = a.to === 'owner' ? (owner ? [owner] : []) : a.to === 'admins' ? (await tx.membership.findMany({ where: { active: true, role: { in: ['OWNER', 'ADMIN'] } }, select: { userId: true } })).map((m) => m.userId) : [a.to];
      await notifyTx(tx, scope, users, { kind: 'rule', text: fill(a.text, e.words), href: hrefOf(scope, e) });
      return `Notified ${users.length}`;
    }
    case 'set_status': {
      if (!e.leadId) return 'Not a lead';
      await tx.lead.update({ where: { id: e.leadId }, data: { status: a.status as never } });
      return `Status set to ${a.status}`;
    }
    default:
      return 'Queued';
  }
}

/** Messages leave the transaction: sent after it commits. */
async function sendOutside(scope: Scope, a: Action, e: Event): Promise<string> {
  if (!e.clientId && !e.leadId) return 'No contact to message';
  if (a.type === 'whatsapp') {
    const { sendTemplate } = await import('./whatsapp/service');
    const contact = e.clientId ? { kind: 'client' as const, id: e.clientId } : { kind: 'lead' as const, id: e.leadId! };
    await sendTemplate(scope, contact, a.template, [e.words?.firstName ?? '', e.words?.stage ?? e.words?.document ?? '', e.words?.workflow ?? ''], { language: a.language, authorId: null, caseId: e.caseId });
    return `WhatsApp "${a.template}"`;
  }
  if (a.type === 'email') {
    const { sendEmail, textToHtml } = await import('./email');
    const to = await inTenant(scope, async (tx) => (e.clientId ? (await tx.client.findUnique({ where: { id: e.clientId } }))?.email : (await tx.lead.findUnique({ where: { id: e.leadId! } }))?.email));
    if (!to) throw new Error('No email address');
    const body = fill(a.body, e.words);
    const r = await sendEmail({ to, subject: fill(a.subject, e.words), text: body, html: textToHtml(body) }, scope.tenantId);
    return r.sent ? 'Email sent' : 'Email recorded (sending not set up)';
  }
  return '';
}

const hrefOf = (scope: Scope, e: Event) =>
  e.caseId ? `/${scope.slug}/cases/${e.caseId}` : e.leadId && e.recordType === 'lead' ? `/${scope.slug}/leads/${e.leadId}` : e.clientId ? `/${scope.slug}/clients/${e.clientId}` : null;

export async function notifyTx(tx: Tx, scope: Scope, userIds: (string | null | undefined)[], n: { kind: string; text: string; href?: string | null }) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== scope.actorId))];
  if (ids.length) await tx.notification.createMany({ data: ids.map((userId) => ({ tenantId: scope.tenantId, userId, kind: n.kind, text: n.text.slice(0, 300), href: n.href ?? null })) });
}

const OUTSIDE = new Set<Action['type']>(['whatsapp', 'email']);

/**
 * Run every active rule for `trigger` whose conditions match. Call after the change has
 * committed. Never throws.
 */
export async function emit(scope: Scope, trigger: Trigger, e: Event) {
  try {
    const rules = await inTenant(scope, (tx) => tx.rule.findMany({ where: { trigger, active: true }, orderBy: { createdAt: 'asc' } }));
    for (const rule of rules) {
      if (!conditionsMatch(rule.conditions as Record<string, string>, e.values)) continue;
      const results: { type: string; ok: boolean; detail: string }[] = [];
      let attempts = 1;
      for (const a of (rule.actions as Action[]) ?? []) {
        let done = false;
        for (let attempt = 1; attempt <= 3 && !done; attempt++) {
          attempts = Math.max(attempts, attempt);
          try {
            const detail = OUTSIDE.has(a.type) ? await sendOutside(scope, a, e) : await inTenant(scope, (tx) => runAction(tx, scope, a, e));
            results.push({ type: a.type, ok: true, detail });
            done = true;
          } catch (err) {
            if (attempt === 3) results.push({ type: a.type, ok: false, detail: err instanceof Error ? err.message.slice(0, 200) : 'error' });
          }
        }
      }
      const failed = results.filter((r) => !r.ok).length;
      await inTenant(scope, async (tx) => {
        await tx.automationRun.create({
          data: { tenantId: scope.tenantId, ruleId: rule.id, trigger, recordType: e.recordType, recordId: e.recordId, status: failed === 0 ? 'ok' : failed === results.length ? 'failed' : 'partial', attempts, results },
        });
        if (failed) await logActivity(tx, scope, { type: 'AUTOMATION', summary: `Automation "${rule.name}": ${failed} action${failed > 1 ? 's' : ''} failed`, leadId: e.leadId, clientId: e.clientId, caseId: e.caseId });
      });
    }
  } catch (err) {
    console.error('rules', trigger, err);
  }
}

export async function deleteRule(scope: Scope, id: string) {
  const r = await inTenant(scope, (tx) => tx.rule.findUnique({ where: { id } }));
  if (!r) throw new UserError('Not found');
  await inTenant(scope, (tx) => tx.rule.delete({ where: { id } }));
  await audit(scope, 'settings.rule', `Deleted automation "${r.name}"`);
}

/** Words for messages about a lead or case. */
export const leadWords = (l: { firstName: string; lastName?: string | null; interestCountry?: string | null }) => ({
  name: [l.firstName, l.lastName].filter(Boolean).join(' '), firstName: l.firstName, country: l.interestCountry ? countryName(l.interestCountry) : '',
});
