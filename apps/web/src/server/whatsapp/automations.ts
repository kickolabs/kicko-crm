import 'server-only';
import type { AutomationTrigger } from '@kicko/db';
import { logActivity, inTenant, type Scope } from '../scope';
import { messagingStatus, sendTemplate } from './service';

// "When X happens, send WhatsApp template Y." Called after the triggering change
// has committed. Never throws: a failed WhatsApp send must not undo business data.

export const TRIGGER_INFO: Record<AutomationTrigger, { label: string; vars: string[] }> = {
  CASE_STAGE: { label: 'Case moves to a stage', vars: ['Client first name', 'Stage name', 'Visa product'] },
  DOC_REJECTED: { label: 'A document is rejected', vars: ['Client first name', 'Document name', 'Reason'] },
  INVOICE_ISSUED: { label: 'An invoice is issued', vars: ['Client first name', 'Invoice number', 'Amount'] },
  PAYMENT_OVERDUE: { label: 'A payment becomes overdue (daily)', vars: ['Client first name', 'Amount due', 'Due date'] },
  PAYMENT_RECEIVED: { label: 'A payment is received', vars: ['Client first name', 'Amount', 'Receipt number'] },
};

export async function fireAutomation(
  scope: Scope,
  trigger: AutomationTrigger,
  ctx: { clientId: string; caseId?: string | null; stageKey?: string; vars: string[] },
) {
  try {
    if (!(await messagingStatus(scope))) return 0;
    const rules = await inTenant(scope, (tx) =>
      tx.automation.findMany({
        where: { trigger, active: true, ...(trigger === 'CASE_STAGE' ? { OR: [{ stageKey: null }, { stageKey: ctx.stageKey }] } : {}) },
      }),
    );
    let sent = 0;
    for (const rule of rules) {
      try {
        await sendTemplate(scope, { kind: 'client', id: ctx.clientId }, rule.templateName, ctx.vars, {
          language: rule.language,
          authorId: null, // automation
          caseId: ctx.caseId,
        });
        sent++;
      } catch (err) {
        await inTenant(scope, (tx) =>
          logActivity(tx, scope, {
            type: 'WHATSAPP',
            summary: `Automation "${rule.templateName}" not sent: ${err instanceof Error ? err.message : 'error'}`,
            clientId: ctx.clientId,
            caseId: ctx.caseId,
          }),
        );
      }
    }
    return sent;
  } catch (err) {
    console.error('automation', trigger, err);
    return 0;
  }
}
