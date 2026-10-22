'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { APIError } from 'better-auth/api';
import { z } from 'zod';
import { prisma } from '@kicko/db';
import { provisionTenant, RESERVED_SLUGS, slugify } from '@kicko/db/provision';
import { auth, getSession } from '@/lib/auth';
import { formObject, run, type ActionResult } from '@/lib/action';
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmail } from '@/lib/disposable-emails';
import { currentDevice } from '@/server/device';
import { sendEmail } from '@/server/email';
import { parseMobile, pendingCode, sendCode, verifyCode } from '@/server/phone-otp';
import { UserError } from '@/server/scope';
import { startTrial } from '@/server/trial';

const agency = {
  agencyName: z.string().trim().min(2, 'Agency name is too short').max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'At least 3 characters')
    .max(40)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only'),
};

const signUpSchema = z
  .object({
    name: z.string().trim().min(1, 'Your name is required').max(80),
    email: z.email('Enter a valid email').refine((e) => !isDisposableEmail(e), DISPOSABLE_EMAIL_MESSAGE),
    mobile: z.string().trim().min(1, 'Your mobile number is required'),
    password: z.string().min(8, 'At least 8 characters').max(128),
    confirmPassword: z.string(),
    ...agency,
  })
  .refine((x) => x.password === x.confirmPassword, { message: 'The passwords don’t match', path: ['confirmPassword'] });

async function assertSlugFree(slug: string) {
  if (RESERVED_SLUGS.has(slug)) throw new UserError('That address is reserved. Try another.');
  if (await prisma.tenant.findUnique({ where: { slug } })) throw new UserError('That address is taken. Try another.');
}

function authMessage(err: unknown) {
  if (err instanceof APIError) {
    const msg = String(err.body?.message ?? err.message);
    if (/already exists/i.test(msg)) return 'An account with this email already exists. Sign in instead.';
    if (/invalid email or password/i.test(msg)) return 'Wrong email or password.';
    return msg;
  }
  return null;
}

export async function signUpAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await getSession();
  const raw = formObject(fd);
  raw.slug = raw.slug || slugify(raw.agencyName ?? '');

  if (session) {
    // Already signed in: another agency workspace. It starts without a trial; only
    // someone who hasn't had one yet can start it (after verifying their mobile).
    const res = await run(async () => {
      const input = z.object(agency).parse(raw);
      await assertSlugFree(input.slug);
      await provisionTenant({ name: input.agencyName, slug: input.slug, ownerUserId: session.user.id, trial: false });
      const user = await prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { trialUsedAt: true, phoneNumberVerified: true } });
      if (user.trialUsedAt) return `/${input.slug}/settings?tab=plan`;
      if (user.phoneNumberVerified) {
        const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: input.slug } });
        const started = await startTrial(session.user.id, tenant.id, await currentDevice(raw.fp));
        if (started.ok) return `/${input.slug}`;
      }
      return `/verify-mobile?workspace=${input.slug}`;
    });
    if (res.ok) redirect(res.data!);
    return res;
  }

  const res = await run(async () => {
    const input = signUpSchema.parse(raw);
    const mobile = parseMobile(input.mobile);
    await assertSlugFree(input.slug);
    if (await prisma.user.findFirst({ where: { phoneNumber: mobile }, select: { id: true } })) {
      throw new UserError('This mobile number is already used by another Kicko account. Sign in instead.');
    }
    await currentDevice(raw.fp); // sets the device cookie before the trial is claimed
    try {
      const { user } = await auth.api.signUpEmail({
        body: { name: input.name, email: input.email.toLowerCase(), password: input.password },
        headers: await headers(),
      });
      const tenant = await provisionTenant({ name: input.agencyName, slug: input.slug, ownerUserId: user.id, trial: false });
      await sendCode(user.id, mobile);
      // Welcome email with the first steps (never blocks sign-up).
      const app = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      await sendEmail(
        {
          to: user.email,
          subject: `Welcome to Kicko, ${input.name.split(' ')[0]}`,
          text: `Your workspace ${input.agencyName} is ready: ${app}/${input.slug}

Verify your mobile to start your 14-day free trial (every feature included): ${app}/verify-mobile?workspace=${input.slug}

Three good first steps:

1. Bring in your leads from Excel or another CRM: ${app}/${input.slug}/import
2. Invite your team: ${app}/${input.slug}/settings?tab=team
3. Connect your WhatsApp number: ${app}/${input.slug}/settings?tab=whatsapp

Questions? Just reply to this email.

The Kicko team`,
        },
        tenant.id,
      ).catch(() => {});
    } catch (err) {
      const msg = authMessage(err);
      if (msg) throw new UserError(msg);
      throw err;
    }
    return input.slug;
  });
  if (res.ok) redirect(`/verify-mobile?workspace=${res.data}`);
  return res;
}

const signInSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
  next: z.string().optional(),
});

export async function signInAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => {
    const input = signInSchema.parse(formObject(fd));
    let twoStep = false;
    try {
      const r = await auth.api.signInEmail({
        body: { email: input.email.toLowerCase(), password: input.password },
        headers: await headers(),
      });
      twoStep = 'twoFactorRedirect' in r && Boolean(r.twoFactorRedirect);
    } catch (err) {
      const msg = authMessage(err);
      if (msg) throw new UserError(msg);
      throw err;
    }
    const next = safeNext(input.next);
    return twoStep ? `/login/verify?next=${encodeURIComponent(next)}` : next;
  });
  if (res.ok) redirect(res.data as string);
  return res;
}

/** Only same-site relative redirects. */
const safeNext = (n?: string) => (n && /^\/[\w\-/?=&%.]*$/.test(n) && !n.startsWith('//') ? n : '/');

/** Second step of sign-in: a code from the authenticator app, or a backup code. */
export async function verifySecondFactorAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => {
    const input = z
      .object({ code: z.string().trim().min(6, 'Enter the code').max(20), mode: z.enum(['totp', 'backup']), trust: z.string().optional(), next: z.string().optional() })
      .parse(formObject(fd));
    const body = { code: input.mode === 'totp' ? input.code.replace(/\s/g, '') : input.code, trustDevice: input.trust === 'on' };
    try {
      if (input.mode === 'totp') await auth.api.verifyTOTP({ body, headers: await headers() });
      else await auth.api.verifyBackupCode({ body, headers: await headers() });
    } catch (err) {
      if (err instanceof APIError) {
        const msg = String(err.body?.message ?? err.message);
        if (/locked|too many/i.test(msg)) throw new UserError('Too many wrong codes. Wait a few minutes, then sign in again.');
        if (/cookie|expired|not found/i.test(msg)) throw new UserError('This sign-in timed out. Go back and sign in again.');
        throw new UserError(input.mode === 'totp' ? 'That code didn’t work. Check the app shows Kicko and try the newest code.' : 'That backup code didn’t work.');
      }
      throw err;
    }
    return safeNext(input.next);
  });
  if (res.ok) redirect(res.data as string);
  return res;
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect('/login');
}

// ── Verify mobile → start the free trial ─────────────────────────────────────

async function ownedPending(slug: string) {
  const session = await getSession();
  if (!session) throw new UserError('Please sign in again.');
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new UserError('Workspace not found.');
  return { userId: session.user.id, tenantId: tenant.id };
}

const verifyPage = (slug: string) => `/verify-mobile?workspace=${encodeURIComponent(slug)}`;

/** Send (or re-send) the code, to a new number if one is given. */
export async function sendMobileCodeAction(slug: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => {
    const { userId } = await ownedPending(slug);
    const mobile = String(fd.get('mobile') ?? '');
    const last = mobile ? null : await pendingCode(userId);
    const phone = mobile || last?.phone;
    if (!phone) throw new UserError('Enter your mobile number.');
    await sendCode(userId, phone);
  });
  if (res.ok) redirect(verifyPage(slug));
  return res;
}

export async function verifyMobileAction(slug: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => {
    const { userId, tenantId } = await ownedPending(slug);
    await verifyCode(userId, String(fd.get('code') ?? ''));
    const started = await startTrial(userId, tenantId, await currentDevice(String(fd.get('fp') ?? '')));
    return started.ok ? `/${slug}` : verifyPage(slug);
  });
  if (res.ok) redirect(res.data!);
  return res;
}

export async function startTrialAction(slug: string, _: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await run(async () => {
    const { userId, tenantId } = await ownedPending(slug);
    const started = await startTrial(userId, tenantId, await currentDevice(String(fd.get('fp') ?? '')));
    return started.ok ? `/${slug}` : verifyPage(slug);
  });
  if (res.ok) redirect(res.data!);
  return res;
}
