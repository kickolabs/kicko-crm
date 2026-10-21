import 'server-only';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { headers } from 'next/headers';
import { cache } from 'react';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import { prisma } from '@kicko/db';
import { auditUser, deviceName } from '@/server/audit';

/**
 * Sign-ins for the agency audit log. This hook runs before the two-step plugin's,
 * so a correct password for someone with 2FA isn't a sign-in yet: that is logged
 * when the code is verified (the request then carries the pending two_factor cookie).
 */
const auditSignIns = createAuthMiddleware(async (ctx) => {
  const path = ctx.path;
  if (path !== '/sign-in/email' && path !== '/two-factor/verify-totp' && path !== '/two-factor/verify-backup-code') return;
  const meta = { ip: ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null, userAgent: ctx.headers?.get('user-agent') ?? null };
  const cookies = ctx.headers?.get('cookie') ?? '';
  const returned = ctx.context.returned;
  const session = ctx.context.newSession;
  if (path === '/sign-in/email') {
    if (isAPIError(returned)) {
      const email = String((ctx.body as { email?: string } | undefined)?.email ?? '').toLowerCase();
      const user = email ? await prisma.user.findUnique({ where: { email }, select: { id: true } }) : null;
      if (user) await auditUser(user.id, 'auth.sign_in_failed', `Failed sign-in (wrong password) from ${deviceName(meta.userAgent)}`, undefined, meta);
      return;
    }
    if (!session) return;
    const twoStep = (session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled;
    if (!twoStep) await auditUser(session.user.id, 'auth.sign_in', `Signed in from ${deviceName(meta.userAgent)}`, undefined, meta);
    else if (/trust_device=/.test(cookies)) await auditUser(session.user.id, 'auth.sign_in', `Signed in from ${deviceName(meta.userAgent)} (trusted browser)`, undefined, meta);
    return;
  }
  // Second step of a sign-in (not turning 2FA on, which happens while signed in).
  if (!session || isAPIError(returned) || !/two_factor=/.test(cookies)) return;
  await auditUser(
    session.user.id,
    'auth.sign_in',
    path.endsWith('backup-code') ? `Signed in from ${deviceName(meta.userAgent)} with a backup code` : `Signed in from ${deviceName(meta.userAgent)} with two-step code`,
    undefined,
    meta,
  );
});

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  hooks: { after: auditSignIns },
  // Two-step sign-in with an authenticator app (secrets and backup codes encrypted;
  // repeated wrong codes lock the account for a while). nextCookies lets Server
  // Actions set cookies; keep it last.
  plugins: [twoFactor({ issuer: 'Kicko' }), nextCookies()],
});

/** Current session (or null), memoised per request. */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));
