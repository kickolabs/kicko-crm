import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { prisma, withTenant, type Membership, type Role, type Subscription, type Tenant, type Tx } from '@kicko/db';
import { access } from './plans';
import type { TenantSettings } from '@kicko/db/provision';
import { getSession } from './auth';
import { can, type Permission } from './permissions';

export type Ctx = {
  tenant: Omit<Tenant, 'settings'> & { settings: TenantSettings };
  user: { id: string; name: string; email: string };
  membership: Membership;
  role: Role;
  subscription: Subscription | null;
  /** full · read_only (lapsed: staff can view and export, not edit) · suspended */
  access: 'full' | 'read_only' | 'suspended';
};

export const getTenantBySlug = cache(async (slug: string) => {
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  return tenant ? { ...tenant, settings: tenant.settings as TenantSettings } : null;
});

/**
 * Resolve the signed-in user's context for a workspace slug.
 * Redirects to login when signed out, 404s on unknown or foreign workspaces.
 */
export const getCtx = cache(async (slug: string): Promise<Ctx> => {
  const session = await getSession();
  if (!session) redirect(`/login?next=/${encodeURIComponent(slug)}`);
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();
  const [membership, subscription] = await withTenant(tenant.id, (tx) =>
    Promise.all([
      tx.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: session.user.id } } }),
      tx.subscription.findUnique({ where: { tenantId: tenant.id } }),
    ]),
  );
  // Same response as an unknown slug, so workspace names can't be probed.
  if (!membership || !membership.active) notFound();
  return {
    tenant,
    user: { id: session.user.id, name: session.user.name, email: session.user.email },
    membership,
    role: membership.role,
    subscription,
    access: subscription ? access(subscription.status) : 'full',
  };
});

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`You don't have permission to do that (${permission}).`);
  }
}

export function assertCan(ctx: Ctx, permission: Permission) {
  if (!can(ctx.role, permission)) throw new ForbiddenError(permission);
}

/** Tenant-bound transaction for the current context. */
export function db<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(ctx.tenant.id, fn, { readOnly: ctx.access !== 'full' });
}

/** Active team members with names, for owner pickers and assignment. */
export const getTeam = cache(async (ctx: Ctx) => {
  const members = await db(ctx, (tx) =>
    tx.membership.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } }),
  );
  const users = await prisma.user.findMany({
    where: { id: { in: members.map((m) => m.userId) } },
    select: { id: true, name: true, email: true },
  });
  return members.map((m) => {
    const u = users.find((x) => x.id === m.userId);
    return { userId: m.userId, role: m.role, name: u?.name ?? 'Unknown', email: u?.email ?? '', phone: m.phone };
  });
});
