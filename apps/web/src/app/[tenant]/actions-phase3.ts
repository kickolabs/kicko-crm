'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { can } from '@/lib/permissions';
import { assertCan, db, getCtx } from '@/lib/tenant';
import { emailEnabled, sendEmail } from '@/server/email';
import { markThreadRead, sendStaffMessage } from '@/server/messages';
import { createLoginLink, revokePortalAccess } from '@/server/portal-auth';
import { scopeOf, UserError } from '@/server/scope';

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

/** Create a portal login link; optionally email it. Staff can always copy it (e.g. to WhatsApp). */
export async function portalLinkAction(slug: string, clientId: string, email: boolean): Promise<ActionResult<{ link: string; emailed: boolean }>> {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    const link = await createLoginLink(scopeOf(ctx), slug, clientId);
    let emailed = false;
    if (email) {
      const client = await db(ctx, (tx) => tx.client.findUnique({ where: { id: clientId } }));
      if (!client?.email) throw new UserError('This client has no email address. Copy the link and send it on WhatsApp instead.');
      if (!emailEnabled()) throw new UserError('Email is not set up yet. Copy the link and send it on WhatsApp instead.');
      ({ sent: emailed } = await sendEmail({
        to: client.email,
        subject: `Your ${ctx.tenant.name} client portal`,
        text: `Hi ${client.firstName},\n\n${ctx.tenant.name} has set up your client portal. Track your visa journey, upload documents, pay fees and message your consultant in one place.\n\n${link}\n\nThis link works once and expires in 7 days.`,
        replyTo: ctx.user.email,
      }));
    }
    return { link, emailed };
  });
  refresh(slug);
  return res;
}

export async function revokePortalAction(slug: string, clientId: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'client.write');
    await revokePortalAccess(scopeOf(ctx), clientId);
  });
  refresh(slug);
  return res;
}

export async function staffMessageAction(slug: string, clientId: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    if (!can(ctx.role, 'client.write') && !can(ctx.role, 'billing.write')) throw new UserError("You don't have permission to message clients");
    await sendStaffMessage(scopeOf(ctx), slug, ctx.tenant.name, clientId, formObject(fd));
  });
  refresh(slug);
  return res;
}

export async function markReadAction(slug: string, clientId: string) {
  const ctx = await getCtx(slug);
  const res = await run(() => markThreadRead(scopeOf(ctx), { kind: 'client', id: clientId }));
  refresh(slug);
  return res;
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const portalSettingsInput = z
  .object({
    bookingEnabled: z.boolean(),
    days: z.array(z.coerce.number().int().min(0).max(6)).min(1, 'Pick at least one day'),
    start: time,
    end: time,
    slotMinutes: z.coerce.number().int().refine((n) => [15, 20, 30, 45, 60].includes(n), 'Pick a slot length'),
    welcome: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.start < v.end, { message: 'Closing time must be after opening time', path: ['end'] });

export async function savePortalSettingsAction(slug: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const raw = formObject(fd);
    const input = portalSettingsInput.parse({ ...raw, bookingEnabled: raw.bookingEnabled === 'on', days: fd.getAll('days') });
    const settings: TenantSettings = { ...ctx.tenant.settings, portal: { ...input, welcome: input.welcome || undefined } };
    await prisma.tenant.update({ where: { id: ctx.tenant.id }, data: { settings } });
  }, 'Portal settings saved');
  refresh(slug);
  return res;
}
