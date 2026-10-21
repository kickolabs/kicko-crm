import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { withTenant } from '@kicko/db';
import { fullName } from '@/lib/format';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { getTenantBySlug } from '@/lib/tenant';
import { emailEnabled, sendEmail } from './email';
import { rateLimit } from './public';
import { logActivity, systemScope, UserError, type Scope } from './scope';

// Client portal authentication: one-time login links → long-lived session cookie.
// Separate from staff auth on purpose; a portal session can only ever see one client.

const COOKIE = 'kicko_portal';
const SESSION_DAYS = 30;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export type PortalCtx = {
  scope: Scope;
  slug: string;
  tenantName: string;
  client: { id: string; firstName: string; lastName: string | null; email: string | null; ownerId: string | null; ref: string };
};

const tenantScope = systemScope;

/** Create a one-time login link for a client (staff "send portal access"). */
export async function createLoginLink(scope: Scope, slug: string, clientId: string, ttlHours = 7 * 24) {
  const token = randomBytes(32).toString('base64url');
  await withTenant(scope.tenantId, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw new UserError('Client not found');
    await tx.portalToken.create({
      data: { tenantId: scope.tenantId, clientId, tokenHash: hash(token), expiresAt: new Date(Date.now() + ttlHours * 3600_000), createdBy: scope.actorId },
    });
    if (scope.actorId) {
      await tx.client.update({ where: { id: clientId }, data: { portalInvitedAt: new Date() } });
      await logActivity(tx, scope, { type: 'PORTAL', summary: 'Portal access link created', clientId });
    }
  });
  return `${appUrl()}/portal/${slug}/auth?t=${token}`;
}

/** Self-service "email me a link". Always answers the same way so emails can't be probed. */
export async function requestLoginLink(slug: string, rawEmail: string) {
  const tenant = await getTenantBySlug(slug);
  const email = normalizeEmail(rawEmail);
  if (!tenant || !email || !/^\S+@\S+\.\S+$/.test(email)) return;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`portal-link:${slug}:${ip}`, 5, 15 * 60_000) || !rateLimit(`portal-link:${slug}:${email}`, 3, 15 * 60_000)) return;
  const scope = tenantScope(tenant);
  const client = await withTenant(tenant.id, (tx) => tx.client.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } }));
  if (!client) return;
  const link = await createLoginLink(scope, slug, client.id, 1);
  await sendEmail({
    to: email,
    subject: `Your ${tenant.name} portal link`,
    text: `Hi ${client.firstName},\n\nUse this link to open your visa journey with ${tenant.name}. It works once and expires in 1 hour.\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
  // Only for local dev/E2E without an email provider: show the link on screen.
  const showLink = process.env.PORTAL_DEV_LINKS === '1' || (process.env.NODE_ENV !== 'production' && !emailEnabled());
  return showLink ? link : undefined;
}

/** Self-service via WhatsApp: the client asked for it, so the template is sent even without a recorded opt-in. */
export async function requestLoginLinkByPhone(slug: string, rawPhone: string) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return;
  const { messagingStatus, sendTemplate } = await import('./whatsapp/service');
  const wa = await messagingStatus({ tenantId: tenant.id, slug });
  if (!wa) return;
  const phone = normalizePhone(rawPhone, tenant.country);
  if (!phone || phone.replace(/\D/g, '').length < 8) return;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`portal-wa:${slug}:${ip}`, 5, 15 * 60_000) || !rateLimit(`portal-wa:${slug}:${phone}`, 3, 15 * 60_000)) return;
  const scope = tenantScope(tenant);
  const client = await withTenant(tenant.id, (tx) => tx.client.findFirst({ where: { phoneNormalized: phone }, orderBy: { createdAt: 'asc' } }));
  if (!client) return;
  const link = await createLoginLink(scope, slug, client.id, 1);
  await sendTemplate(scope, { kind: 'client', id: client.id }, 'portal_link', [client.firstName, link], { authorId: null, skipOptInCheck: true }).catch((e) =>
    console.error('portal link via whatsapp', e),
  );
  const showLink = process.env.PORTAL_DEV_LINKS === '1' || (process.env.NODE_ENV !== 'production' && wa.sandbox);
  return showLink ? link : undefined;
}

/** Exchange a one-time token for a session cookie (called from a POST, never on link prefetch). */
export async function redeemLoginToken(slug: string, token: string) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant || !token) throw new UserError('This link is not valid');
  const sessionToken = randomBytes(32).toString('base64url');
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  await withTenant(tenant.id, async (tx) => {
    const row = await tx.portalToken.findUnique({ where: { tokenHash: hash(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new UserError('This link has expired. Ask your consultant for a new one.');
    // Single use, guarded against double-submits by the usedAt condition.
    const claimed = await tx.portalToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new UserError('This link was already used.');
    await tx.portalSession.create({
      data: { tenantId: tenant.id, clientId: row.clientId, tokenHash: hash(sessionToken), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000), userAgent: ua },
    });
    await tx.client.update({ where: { id: row.clientId }, data: { portalLastSeen: new Date() } });
  });
  (await cookies()).set(COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/portal/${slug}`,
    maxAge: SESSION_DAYS * 86400,
  });
}

/** Current portal session for a workspace, or null. */
export const getPortal = cache(async (slug: string): Promise<PortalCtx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return null;
  const client = await withTenant(tenant.id, async (tx) => {
    const s = await tx.portalSession.findUnique({ where: { tokenHash: hash(token) } });
    if (!s || s.expiresAt < new Date()) return null;
    if (Date.now() - s.lastSeenAt.getTime() > 10 * 60_000) {
      await tx.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
      await tx.client.update({ where: { id: s.clientId }, data: { portalLastSeen: new Date() } });
    }
    return tx.client.findUnique({
      where: { id: s.clientId },
      select: { id: true, firstName: true, lastName: true, email: true, ownerId: true, ref: true },
    });
  });
  if (!client) return null;
  return { scope: tenantScope(tenant), slug, tenantName: tenant.name, client };
});

export async function requirePortal(slug: string) {
  const p = await getPortal(slug);
  if (!p) redirect(`/portal/${slug}/login`);
  return p;
}

export async function endPortalSession(slug: string) {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const tenant = await getTenantBySlug(slug);
  if (token && tenant) await withTenant(tenant.id, (tx) => tx.portalSession.deleteMany({ where: { tokenHash: hash(token) } }));
  jar.set(COOKIE, '', { path: `/portal/${slug}`, maxAge: 0 });
}

/** Staff: sign the client out everywhere and void unused links. */
export async function revokePortalAccess(scope: Scope, clientId: string) {
  return withTenant(scope.tenantId, async (tx) => {
    await tx.portalSession.deleteMany({ where: { clientId } });
    await tx.portalToken.deleteMany({ where: { clientId, usedAt: null } });
    await logActivity(tx, scope, { type: 'PORTAL', summary: 'Portal access revoked', clientId });
  });
}

export function portalDisplayName(c: PortalCtx['client']) {
  return fullName(c);
}
