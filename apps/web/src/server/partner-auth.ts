import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { withTenant } from '@kicko/db';
import { normalizeEmail } from '@/lib/phone';
import { getTenantBySlug } from '@/lib/tenant';
import { emailEnabled, sendEmail } from './email';
import { rateLimit } from './public';
import { systemScope, UserError, type Scope } from './scope';

// Partner (sub-agent) portal authentication: one-time links → session cookie scoped
// to /partner/{workspace}. Same model as the client portal, separate tables, so a
// partner session can never reach client data.

const COOKIE = 'kicko_partner';
const SESSION_DAYS = 30;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export type PartnerCtx = {
  scope: Scope;
  slug: string;
  tenantName: string;
  agent: { id: string; ref: string; name: string; company: string | null; email: string; commissionType: string; commissionValue: number };
};

/** Staff: create a sign-in link for a sub-agent. */
export async function createPartnerLink(scope: Scope, slug: string, subAgentId: string, ttlHours = 7 * 24) {
  const token = randomBytes(32).toString('base64url');
  await withTenant(scope.tenantId, async (tx) => {
    const agent = await tx.subAgent.findUnique({ where: { id: subAgentId } });
    if (!agent?.active) throw new UserError('This sub-agent is inactive');
    await tx.subAgentToken.create({ data: { tenantId: scope.tenantId, subAgentId, tokenHash: hash(token), expiresAt: new Date(Date.now() + ttlHours * 3600_000), createdBy: scope.actorId } });
  });
  return `${appUrl()}/partner/${slug}/auth?t=${token}`;
}

/** Self-service "email me a link". Same answer whether or not the email is known. */
export async function requestPartnerLink(slug: string, rawEmail: string) {
  const tenant = await getTenantBySlug(slug);
  const email = normalizeEmail(rawEmail);
  if (!tenant || !email) return;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (!rateLimit(`partner-link:${slug}:${ip}`, 5, 15 * 60_000) || !rateLimit(`partner-link:${slug}:${email}`, 3, 15 * 60_000)) return;
  const scope = systemScope(tenant);
  const agent = await withTenant(tenant.id, (tx) => tx.subAgent.findFirst({ where: { email, active: true } }));
  if (!agent) return;
  const link = await createPartnerLink(scope, slug, agent.id, 1);
  await sendEmail({
    to: email,
    subject: `Your ${tenant.name} partner portal link`,
    text: `Hi ${agent.name},\n\nUse this link to open your partner portal with ${tenant.name}. It works once and expires in 1 hour.\n\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
  }, tenant.id);
  const showLink = process.env.PORTAL_DEV_LINKS === '1' || (process.env.NODE_ENV !== 'production' && !emailEnabled());
  return showLink ? link : undefined;
}

export async function redeemPartnerToken(slug: string, token: string) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant || !token) throw new UserError('This link is not valid');
  const sessionToken = randomBytes(32).toString('base64url');
  const ua = (await headers()).get('user-agent')?.slice(0, 200) ?? null;
  await withTenant(tenant.id, async (tx) => {
    const row = await tx.subAgentToken.findUnique({ where: { tokenHash: hash(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new UserError('This link has expired. Ask the agency for a new one.');
    const claimed = await tx.subAgentToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new UserError('This link was already used.');
    const agent = await tx.subAgent.findUnique({ where: { id: row.subAgentId } });
    if (!agent?.active) throw new UserError('This partner account is inactive.');
    await tx.subAgentSession.create({ data: { tenantId: tenant.id, subAgentId: row.subAgentId, tokenHash: hash(sessionToken), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000), userAgent: ua } });
    await tx.subAgent.update({ where: { id: row.subAgentId }, data: { portalLastSeen: new Date() } });
  });
  (await cookies()).set(COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `/partner/${slug}`,
    maxAge: SESSION_DAYS * 86400,
  });
}

export const getPartner = cache(async (slug: string): Promise<PartnerCtx | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const tenant = await getTenantBySlug(slug);
  if (!tenant) return null;
  const agent = await withTenant(tenant.id, async (tx) => {
    const s = await tx.subAgentSession.findUnique({ where: { tokenHash: hash(token) } });
    if (!s || s.expiresAt < new Date()) return null;
    const a = await tx.subAgent.findUnique({ where: { id: s.subAgentId } });
    if (!a?.active) return null; // deactivating an agent ends their access immediately
    if (Date.now() - s.lastSeenAt.getTime() > 10 * 60_000) {
      await tx.subAgentSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
      await tx.subAgent.update({ where: { id: a.id }, data: { portalLastSeen: new Date() } });
    }
    return a;
  });
  if (!agent) return null;
  const { id, ref, name, company, email, commissionType, commissionValue } = agent;
  return { scope: systemScope(tenant), slug, tenantName: tenant.name, agent: { id, ref, name, company, email, commissionType, commissionValue } };
});

export async function requirePartner(slug: string) {
  const p = await getPartner(slug);
  if (!p) redirect(`/partner/${slug}/login`);
  return p;
}

export async function endPartnerSession(slug: string) {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const tenant = await getTenantBySlug(slug);
  if (token && tenant) await withTenant(tenant.id, (tx) => tx.subAgentSession.deleteMany({ where: { tokenHash: hash(token) } }));
  jar.set(COOKIE, '', { path: `/partner/${slug}`, maxAge: 0 });
}

export async function revokePartnerAccess(scope: Scope, subAgentId: string) {
  await withTenant(scope.tenantId, async (tx) => {
    await tx.subAgentSession.deleteMany({ where: { subAgentId } });
    await tx.subAgentToken.deleteMany({ where: { subAgentId, usedAt: null } });
  });
}
