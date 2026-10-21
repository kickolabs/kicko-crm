import 'server-only';
import type { Prisma } from '@kicko/db';
import { db, type Ctx } from '@/lib/tenant';
import type { Contact } from '../contacts';

export type CallFilter = 'all' | 'missed' | 'inbound' | 'outbound' | 'mine';

const FILTER: Record<CallFilter, (ctx: Ctx) => Prisma.CallWhereInput> = {
  all: () => ({}),
  missed: () => ({ direction: 'INBOUND', status: { in: ['NO_ANSWER', 'BUSY', 'FAILED', 'CANCELED'] } }),
  inbound: () => ({ direction: 'INBOUND' }),
  outbound: () => ({ direction: 'OUTBOUND' }),
  mine: (ctx) => ({ agentId: ctx.user.id }),
};

export function listCalls(ctx: Ctx, filter: CallFilter = 'all', take = 100) {
  return db(ctx, (tx) =>
    tx.call.findMany({
      where: FILTER[filter](ctx),
      include: { lead: { select: { id: true, firstName: true, lastName: true, ref: true } }, client: { select: { id: true, firstName: true, lastName: true, ref: true } } },
      orderBy: { startedAt: 'desc' },
      take,
    }),
  );
}

export function getCall(ctx: Ctx, id: string) {
  return db(ctx, (tx) => tx.call.findUnique({ where: { id }, include: { lead: true, client: true } }));
}

export function callsFor(ctx: Ctx, c: Contact, take = 5) {
  return db(ctx, (tx) =>
    tx.call.findMany({ where: c.kind === 'client' ? { clientId: c.id } : { leadId: c.id }, orderBy: { startedAt: 'desc' }, take }),
  );
}
