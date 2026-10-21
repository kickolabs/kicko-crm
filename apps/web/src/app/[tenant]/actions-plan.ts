'use server';

import { revalidatePath } from 'next/cache';
import { run, type ActionResult } from '@/lib/action';
import type { Interval, PlanId } from '@/lib/plans';
import { assertCan, getCtx } from '@/lib/tenant';
import { buyCredits, setCancelAtPeriodEnd, startCheckout } from '@/server/plan';
import { systemScope } from '@/server/scope';

// Billing works even when the workspace is read-only or suspended (that's how you renew),
// so these use a system scope for the tenant rather than the staff scope.

export async function startCheckoutAction(slug: string, plan: PlanId, interval: Interval, seats: number): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    return startCheckout({ ...systemScope(ctx.tenant), actorId: ctx.user.id }, { plan, interval, seats: Math.floor(seats) });
  });
}

export async function buyCreditsAction(slug: string): Promise<ActionResult<string>> {
  const ctx = await getCtx(slug);
  return run(async () => {
    assertCan(ctx, 'settings.manage');
    return buyCredits({ ...systemScope(ctx.tenant), actorId: ctx.user.id });
  });
}

export async function cancelSubscriptionAction(slug: string, cancel: boolean) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await setCancelAtPeriodEnd({ ...systemScope(ctx.tenant), actorId: ctx.user.id }, cancel);
  });
  revalidatePath(`/${slug}`, 'layout');
  return res;
}
