'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formObject, run, type ActionResult } from '@/lib/action';
import * as portal from '@/server/portal';
import { endPortalSession, getPortal, redeemLoginToken, requestLoginLink, requestLoginLinkByPhone } from '@/server/portal-auth';
import { UserError } from '@/server/scope';
import { portalSaveAnswers } from '@/server/forms';

type Prev = ActionResult | null;

export async function portalAnswersAction(slug: string, _: Prev, fd: FormData) {
  const res = await run(async () => portalSaveAnswers(await session(slug), formObject(fd)), 'Thank you');
  revalidatePath(`/portal/${slug}`, 'layout');
  return res;
}

async function session(slug: string) {
  const p = await getPortal(slug);
  if (!p) throw new UserError('Your session has ended. Please sign in again.');
  return p;
}

export async function requestLinkAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult<{ devLink?: string; via: 'email' | 'whatsapp' }>> {
  return run(async () => {
    const phone = String(fd.get('phone') ?? '').trim();
    if (phone) return { devLink: await requestLoginLinkByPhone(slug, phone), via: 'whatsapp' as const };
    return { devLink: await requestLoginLink(slug, String(fd.get('email') ?? '')), via: 'email' as const };
  });
}

export async function redeemAction(slug: string, token: string): Promise<ActionResult> {
  const res = await run(() => redeemLoginToken(slug, token));
  if (res.ok) redirect(`/portal/${slug}`);
  return res;
}

/** Form version, so "Open my portal" works even before the page's JavaScript has loaded. */
export async function redeemFormAction(slug: string, token: string, _prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  return redeemAction(slug, token);
}

export async function logoutAction(slug: string) {
  await endPortalSession(slug);
  redirect(`/portal/${slug}/login`);
}

export async function portalStartUploadAction(slug: string, documentId: string, file: { fileName: string; contentType: string; size: number }) {
  return run(async () => portal.portalStartUpload(await session(slug), documentId, file));
}

export async function portalFinishUploadAction(slug: string, documentId: string, file: { key: string; fileName: string; contentType: string; size: number }) {
  const res = await run(async () => portal.portalFinishUpload(await session(slug), documentId, file));
  revalidatePath(`/portal/${slug}`);
  return res;
}

export async function portalFileUrlAction(slug: string, fileId: string) {
  return run(async () => portal.portalFileUrl(await session(slug), fileId));
}

export async function portalMessageAction(slug: string, _: Prev, fd: FormData) {
  const res = await run(async () => {
    await portal.portalSendMessage(await session(slug), formObject(fd));
  });
  revalidatePath(`/portal/${slug}/messages`);
  return res;
}

export async function portalPayAction(slug: string, invoiceId: string): Promise<ActionResult<string>> {
  return run(async () => portal.portalPayLink(await session(slug), invoiceId));
}

export async function portalBookAction(slug: string, _: Prev, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => portal.portalBook(await session(slug), formObject(fd)));
  if (res.ok) redirect(`/portal/${slug}?booked=1`);
  return res;
}

export async function portalCancelAction(slug: string, appointmentId: string) {
  const res = await run(async () => portal.portalCancelAppointment(await session(slug), appointmentId));
  revalidatePath(`/portal/${slug}`);
  return res;
}
