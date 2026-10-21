'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formObject, run, type ActionResult } from '@/lib/action';
import { submitReferral } from '@/server/partner';
import { endPartnerSession, redeemPartnerToken, requestPartnerLink, requirePartner } from '@/server/partner-auth';
import type { ReferralResult } from '@/server/sub-agents';

type Prev = ActionResult | null;

export async function requestPartnerLinkAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult<{ devLink?: string }>> {
  return run(async () => ({ devLink: await requestPartnerLink(slug, String(fd.get('email') ?? '')) }));
}

export async function redeemPartnerAction(slug: string, token: string): Promise<ActionResult> {
  const res = await run(() => redeemPartnerToken(slug, token));
  if (res.ok) redirect(`/partner/${slug}`);
  return res;
}

export async function partnerLogoutAction(slug: string) {
  await endPartnerSession(slug);
  redirect(`/partner/${slug}/login`);
}

export async function referAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult<ReferralResult>> {
  const res = await run(async () => submitReferral(await requirePartner(slug), formObject(fd)));
  revalidatePath(`/partner/${slug}`);
  return res;
}
