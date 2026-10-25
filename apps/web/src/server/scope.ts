import 'server-only';
import { withTenant, type Prisma, type Tx } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import type { Ctx } from '@/lib/tenant';

/** What domain services need: works for signed-in staff and public endpoints. */
export type Scope = {
  tenantId: string;
  slug: string;
  country: string;
  timezone: string;
  settings: TenantSettings;
  actorId: string | null;
  /** Staff on a lapsed subscription: every write is refused by Postgres. */
  readOnly?: boolean;
};

export function scopeOf(ctx: Ctx): Scope {
  return {
    tenantId: ctx.tenant.id,
    slug: ctx.tenant.slug,
    country: ctx.tenant.country,
    timezone: ctx.tenant.timezone,
    settings: ctx.tenant.settings,
    actorId: ctx.user.id,
    readOnly: ctx.access !== 'full',
  };
}

/** Scope for system work (webhooks, jobs, public endpoints): no signed-in actor. */
export function systemScope(t: { id: string; slug: string; country: string; timezone: string; settings: unknown }): Scope {
  return { tenantId: t.id, slug: t.slug, country: t.country, timezone: t.timezone, settings: t.settings as TenantSettings, actorId: null };
}

export function inTenant<T>(scope: Scope, fn: (tx: Tx) => Promise<T>) {
  return withTenant(scope.tenantId, fn, { readOnly: scope.readOnly });
}

export async function logActivity(
  tx: Tx,
  scope: Scope,
  a: {
    type: string;
    summary: string;
    leadId?: string | null;
    clientId?: string | null;
    caseId?: string | null;
    data?: Prisma.InputJsonValue;
  },
) {
  await tx.activity.create({
    data: {
      tenantId: scope.tenantId,
      actorId: scope.actorId,
      type: a.type,
      summary: a.summary,
      leadId: a.leadId ?? null,
      clientId: a.clientId ?? null,
      caseId: a.caseId ?? null,
      data: a.data,
    },
  });
}

/** A problem the user can fix. Pass `field` to show it under that form input. */
export class UserError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
  }
}
