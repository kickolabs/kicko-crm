'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { addNote, clearAgencyCache,extendTrial, grantCredits, reactivateAgency, requireAdmin, setDiscount, setManualPlan, suspendAgency } from '@/server/admin';

const reason = z.string().trim().min(3, 'Say why (at least 3 characters)').max(500);
const int = (min: number, max: number) => z.coerce.number().int('Whole numbers only').min(min).max(max);

function act(fn: (admin: { email: string }, input: Record<string, string>) => Promise<unknown>, message: string) {
  return async (_prev: ActionResult | null, fd: FormData): Promise<ActionResult> => {
    const admin = await requireAdmin();
    return run(async () => {
      await fn(admin, formObject(fd));
      clearAgencyCache();
      revalidatePath('/admin', 'layout');
    }, message);
  };
}

export async function extendTrialAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => {
    const v = z.object({ days: int(1, 90), reason }).parse(i);
    return extendTrial(a, tenantId, v.days, v.reason);
  }, 'Trial extended')(prev, fd);
}

export async function setDiscountAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => {
    const v = z.object({ pct: int(0, 50), reason }).parse(i);
    return setDiscount(a, tenantId, v.pct, v.reason);
  }, 'Discount saved')(prev, fd);
}

export async function setPlanAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => {
    const v = z.object({ plan: z.enum(['starter', 'growth', 'pro']), seats: int(1, 500), months: int(1, 36), reason }).parse(i);
    return setManualPlan(a, tenantId, v);
  }, 'Plan updated')(prev, fd);
}

export async function grantCreditsAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => {
    const v = z.object({ credits: int(1, 100_000), reason }).parse(i);
    return grantCredits(a, tenantId, v.credits, v.reason);
  }, 'Credits added')(prev, fd);
}

export async function suspendAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => suspendAgency(a, tenantId, reason.parse(i.reason)), 'Agency suspended')(prev, fd);
}

export async function reactivateAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => reactivateAgency(a, tenantId, reason.parse(i.reason)), 'Agency reactivated')(prev, fd);
}

export async function noteAction(tenantId: string, prev: ActionResult | null, fd: FormData) {
  return act((a, i) => addNote(a, tenantId, z.string().max(2000).parse(i.note ?? '')), 'Note saved')(prev, fd);
}
