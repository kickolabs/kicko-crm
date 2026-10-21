'use server';

import { revalidatePath } from 'next/cache';
import { formObject, run, type ActionResult } from '@/lib/action';
import { can } from '@/lib/permissions';
import { assertCan, getCtx } from '@/lib/tenant';
import { createPartnerLink, revokePartnerAccess } from '@/server/partner-auth';
import { scopeOf, UserError } from '@/server/scope';
import { markCommissionsPaid, saveSubAgent, setLeadSubAgent, voidCommission } from '@/server/sub-agents';
import { requestAnswers, saveAnswers } from '@/server/forms';

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

export async function saveSubAgentAction(slug: string, id: string | null, _: Prev, fd: FormData): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'partners.manage');
    return saveSubAgent(scopeOf(ctx), id, formObject(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function partnerLinkAction(slug: string, subAgentId: string): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'partners.manage');
    return createPartnerLink(scopeOf(ctx), slug, subAgentId);
  });
}

export async function revokePartnerAction(slug: string, subAgentId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'partners.manage');
    await revokePartnerAccess(scopeOf(ctx), subAgentId);
  });
  refresh(slug);
  return res;
}

export async function markCommissionsPaidAction(slug: string, subAgentId: string, _: Prev, fd: FormData): Promise<ActionResult<number>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'commission.manage');
    return markCommissionsPaid(scopeOf(ctx), subAgentId, fd.getAll('ids').map(String), String(fd.get('paidRef') ?? ''));
  }, 'Marked as paid');
  refresh(slug);
  return res;
}

export async function voidCommissionAction(slug: string, id: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'commission.manage');
    await voidCommission(scopeOf(ctx), id);
  });
  refresh(slug);
  return res;
}

export async function setLeadSubAgentAction(slug: string, leadId: string, subAgentId: string | null) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    if (!can(ctx.role, 'lead.write')) throw new UserError("You don't have permission to edit leads");
    await setLeadSubAgent(scopeOf(ctx), leadId, subAgentId || null);
  });
  refresh(slug);
  return res;
}

// ─── Government form answers ────────────────────────────────────────────────

export async function saveFormAnswersAction(slug: string, clientId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await saveAnswers(scopeOf(ctx), clientId, formObject(fd));
  }, 'Saved');
  refresh(slug);
  return res;
}

export async function requestFormAnswersAction(slug: string, clientId: string, formId: string): Promise<ActionResult<number>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    return requestAnswers(scopeOf(ctx), clientId, formId);
  });
  refresh(slug);
  return res;
}
