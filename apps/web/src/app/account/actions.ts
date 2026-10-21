'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { APIError } from 'better-auth/api';
import QRCode from 'qrcode';
import { z } from 'zod';
import { formObject, run, type ActionResult } from '@/lib/action';
import { auth, getSession } from '@/lib/auth';
import { auditUser } from '@/server/audit';
import { UserError } from '@/server/scope';

// "My account": two-step sign-in, password, signed-in devices. Account-level, so
// changes are recorded in the audit log of every agency the person belongs to.

async function me() {
  const s = await getSession();
  if (!s) throw new UserError('Sign in again');
  return s;
}

function friendly(err: unknown, fallback: string): never {
  if (err instanceof APIError) {
    const msg = String(err.body?.message ?? err.message);
    if (/password/i.test(msg)) throw new UserError('Wrong password.');
    if (/code|otp|totp/i.test(msg)) throw new UserError('That code didn’t work. Try the newest code in the app.');
    throw new UserError(msg || fallback);
  }
  throw err;
}

const password = z.string().min(1, 'Enter your password');

export type SetupData = { qr: string; secret: string; backupCodes: string[] };

/** Step 1: check the password, create the secret, return a QR code and backup codes (not active until step 2). */
export async function startTwoFactorAction(_: ActionResult<SetupData> | null, fd: FormData): Promise<ActionResult<SetupData>> {
  return run(async () => {
    await me();
    const pw = password.parse(formObject(fd).password);
    let r;
    try {
      r = await auth.api.enableTwoFactor({ body: { password: pw }, headers: await headers() });
    } catch (err) {
      friendly(err, 'Couldn’t start two-step sign-in');
    }
    if (!('totpURI' in r) || !r.totpURI) throw new UserError('Couldn’t start two-step sign-in');
    const svg = await QRCode.toString(r.totpURI, { type: 'svg', margin: 1, color: { dark: '#121417', light: '#ffffff' } });
    return {
      qr: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      secret: new URL(r.totpURI).searchParams.get('secret') ?? '',
      backupCodes: r.backupCodes ?? [],
    };
  });
}

/** Step 2: the first code from the app turns it on. */
export async function confirmTwoFactorAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const s = await me();
    const code = z.string().trim().min(6, 'Enter the 6-digit code').parse(formObject(fd).code).replace(/\s/g, '');
    try {
      await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
    } catch (err) {
      friendly(err, 'That code didn’t work');
    }
    await auditUser(s.user.id, 'auth.2fa_enabled', 'Turned on two-step sign-in');
    revalidatePath('/account');
  }, 'Two-step sign-in is on');
}

export async function disableTwoFactorAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const s = await me();
    try {
      await auth.api.disableTwoFactor({ body: { password: password.parse(formObject(fd).password) }, headers: await headers() });
    } catch (err) {
      friendly(err, 'Couldn’t turn it off');
    }
    await auditUser(s.user.id, 'auth.2fa_disabled', 'Turned off two-step sign-in');
    revalidatePath('/account');
  }, 'Two-step sign-in is off');
}

export async function newBackupCodesAction(_: ActionResult<string[]> | null, fd: FormData): Promise<ActionResult<string[]>> {
  return run(async () => {
    const s = await me();
    let r;
    try {
      r = await auth.api.generateBackupCodes({ body: { password: password.parse(formObject(fd).password) }, headers: await headers() });
    } catch (err) {
      friendly(err, 'Couldn’t create new codes');
    }
    await auditUser(s.user.id, 'auth.backup_codes', 'Created new backup codes (old ones stopped working)');
    return r.backupCodes;
  });
}

export async function changePasswordAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const s = await me();
    const v = z
      .object({ current: password, next: z.string().min(8, 'At least 8 characters').max(128), confirm: z.string() })
      .refine((x) => x.next === x.confirm, { message: 'The new passwords don’t match', path: ['confirm'] })
      .parse(formObject(fd));
    try {
      await auth.api.changePassword({ body: { currentPassword: v.current, newPassword: v.next, revokeOtherSessions: true }, headers: await headers() });
    } catch (err) {
      friendly(err, 'Couldn’t change the password');
    }
    await auditUser(s.user.id, 'auth.password_changed', 'Changed password (other devices signed out)');
    revalidatePath('/account');
  }, 'Password changed. Other devices were signed out.');
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return run(async () => {
    const s = await me();
    await auth.api.revokeOtherSessions({ headers: await headers() });
    await auditUser(s.user.id, 'auth.sessions_revoked', 'Signed out all other devices');
    revalidatePath('/account');
  }, 'Other devices signed out');
}
