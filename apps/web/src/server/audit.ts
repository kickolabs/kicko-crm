import 'server-only';
import { headers } from 'next/headers';
import { prisma, withTenant, type Prisma } from '@kicko/db';
import { tenantsForUser } from '@kicko/db/provision';

// Agency audit log: who did what, from where. Append-only (the database refuses
// updates and deletes). Writing never breaks the action being audited.

export type AuditMeta = { ip?: string | null; userAgent?: string | null };

async function requestMeta(): Promise<AuditMeta> {
  try {
    const h = await headers();
    return { ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip'), userAgent: h.get('user-agent') };
  } catch {
    return {}; // outside a request (cron, scripts)
  }
}

async function emailOf(userId: string | null | undefined) {
  if (!userId) return null;
  return (await prisma.user.findUnique({ where: { id: userId }, select: { email: true } }))?.email ?? null;
}

export async function audit(
  who: { tenantId: string; actorId?: string | null },
  action: string,
  summary: string,
  details?: Prisma.InputJsonObject,
  meta?: AuditMeta,
) {
  try {
    const m = meta ?? (await requestMeta());
    const actorEmail = await emailOf(who.actorId);
    await withTenant(who.tenantId, (tx) =>
      tx.auditEvent.create({
        data: { tenantId: who.tenantId, actorId: who.actorId ?? null, actorEmail, action, summary: summary.slice(0, 300), details, ip: m.ip?.slice(0, 100) ?? null, userAgent: m.userAgent?.slice(0, 300) ?? null },
      }),
    );
  } catch (err) {
    console.error('audit', action, err);
  }
}

/** Account-level events (sign-in, 2FA, password) go to every agency the person belongs to. */
export async function auditUser(userId: string, action: string, summary: string, details?: Prisma.InputJsonObject, meta?: AuditMeta) {
  try {
    const tenants = await tenantsForUser(userId);
    const m = meta ?? (await requestMeta());
    await Promise.all(tenants.map((t) => audit({ tenantId: t.id, actorId: userId }, action, summary, details, m)));
  } catch (err) {
    console.error('auditUser', action, err);
  }
}

export const AUDIT_GROUPS: { key: string; label: string }[] = [
  { key: 'auth', label: 'Sign-in & security' },
  { key: 'team', label: 'Team' },
  { key: 'settings', label: 'Settings' },
  { key: 'data', label: 'Exports & imports' },
  { key: 'document', label: 'Document views' },
  { key: 'billing', label: 'Plan & billing' },
];

export async function listAudit(tenantId: string, opts: { group?: string; actorId?: string; before?: Date; take?: number } = {}) {
  return withTenant(tenantId, (tx) =>
    tx.auditEvent.findMany({
      where: {
        ...(opts.group ? { action: { startsWith: `${opts.group}.` } } : {}),
        ...(opts.actorId ? { actorId: opts.actorId } : {}),
        ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take ?? 100,
    }),
  );
}

/** A short, readable device name from a user agent. */
export function deviceName(ua: string | null | undefined) {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
