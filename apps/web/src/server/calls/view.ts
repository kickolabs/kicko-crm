import 'server-only';
import { CALL_SCRIPTS } from '@/integrations/telephony/sandbox-scripts';
import { db, type Ctx } from '@/lib/tenant';
import { telephony } from './service';

/** What the call button needs, or null when no calling provider is connected. */
export async function callingFor(ctx: Ctx) {
  const t = await telephony({ tenantId: ctx.tenant.id, slug: ctx.tenant.slug });
  if (!t) return null;
  const me = await db(ctx, (tx) => tx.membership.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenant.id, userId: ctx.user.id } } }));
  return { sandbox: t.sandbox, myPhone: me?.phone ?? null, scripts: CALL_SCRIPTS.map(({ id, label }) => ({ id, label })) };
}
