import 'server-only';
import type { CaseStatus, LeadStatus, Prisma, VisaCategory } from '@kicko/db';
import { dayBounds } from '@/lib/format';
import { db, type Ctx } from '@/lib/tenant';
import { stagesOf } from './cases';

// Read models for pages. All run inside the tenant's RLS context.

export function getDashboard(ctx: Ctx) {
  const tz = ctx.tenant.timezone;
  const today = dayBounds(tz);
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const monthAgo = new Date(Date.now() - 30 * 86400_000);
  const stuckBefore = new Date(Date.now() - 14 * 86400_000);
  const monthStart = new Date(today.start);
  monthStart.setUTCDate(1);

  return db(ctx, async (tx) => {
    const [
      leadsByStatus, newLeads, won30, lost30, casesByCategory, activeCases, lodgedMonth,
      overdueTasks, todayTasks, unassigned, waiting, appointments, stuckCases, recent,
      docsToReview, collectedMonth, overdueInst,
    ] = await Promise.all([
      tx.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      tx.lead.count({ where: { createdAt: { gte: weekAgo } } }),
      tx.lead.count({ where: { status: 'WON', updatedAt: { gte: monthAgo } } }),
      tx.lead.count({ where: { status: 'LOST', updatedAt: { gte: monthAgo } } }),
      tx.case.findMany({ where: { status: { not: 'CLOSED' } }, select: { product: { select: { category: true } } } }),
      tx.case.count({ where: { status: 'OPEN' } }),
      tx.case.count({ where: { lodgedAt: { gte: monthStart } } }),
      tx.task.findMany({
        where: { done: false, dueAt: { lt: today.start }, assigneeId: ctx.user.id },
        orderBy: { dueAt: 'asc' },
        take: 8,
        include: { lead: true, client: true, case: true },
      }),
      tx.task.findMany({
        where: { done: false, dueAt: { gte: today.start, lt: today.end }, assigneeId: ctx.user.id },
        orderBy: { dueAt: 'asc' },
        include: { lead: true, client: true, case: true },
      }),
      tx.lead.findMany({ where: { ownerId: null, status: { notIn: ['WON', 'LOST'] } }, orderBy: { createdAt: 'desc' }, take: 6 }),
      tx.checkIn.count({ where: { status: 'WAITING' } }),
      tx.appointment.findMany({
        where: { startsAt: { gte: today.start, lt: today.end }, status: 'SCHEDULED' },
        orderBy: { startsAt: 'asc' },
        include: { lead: true, client: true },
      }),
      tx.case.findMany({
        where: { status: 'OPEN', stageSince: { lt: stuckBefore } },
        orderBy: { stageSince: 'asc' },
        take: 6,
        include: { client: true, product: true },
      }),
      tx.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 10, include: { lead: true, client: true, case: true } }),
      tx.document.findMany({ where: { status: 'UPLOADED' }, orderBy: { updatedAt: 'asc' }, take: 6, include: { case: true, client: true } }),
      tx.payment.aggregate({ where: { paidAt: { gte: monthStart } }, _sum: { amount: true } }),
      tx.installment.findMany({
        where: { dueDate: { lt: today.start }, invoice: { status: { in: ['ISSUED', 'PARTIALLY_PAID'] } } },
        include: { invoice: { include: { client: true } } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);
    const overduePayments = overdueInst.filter((i) => i.paidAmount < i.amount);

    const byCategory = new Map<VisaCategory, number>();
    for (const c of casesByCategory) byCategory.set(c.product.category, (byCategory.get(c.product.category) ?? 0) + 1);

    return {
      leadsByStatus: Object.fromEntries(leadsByStatus.map((g) => [g.status, g._count._all])) as Partial<Record<LeadStatus, number>>,
      newLeads,
      conversion: won30 + lost30 ? Math.round((won30 / (won30 + lost30)) * 100) : null,
      casesByCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
      activeCases,
      lodgedMonth,
      overdueTasks,
      todayTasks,
      unassigned,
      waiting,
      appointments,
      stuckCases: stuckCases.map((c) => ({ ...c, stageName: stagesOf(c.product).find((s) => s.key === c.stageKey)?.name ?? c.stageKey })),
      recent,
      docsToReview,
      collectedMonth: collectedMonth._sum.amount ?? 0,
      overduePayments: overduePayments.slice(0, 6),
      overdueAmount: overduePayments.reduce((a, i) => a + i.amount - i.paidAmount, 0),
    };
  });
}

export type LeadFilters = { q?: string; status?: string; source?: string; owner?: string; category?: string; branch?: string };

export function listLeads(ctx: Ctx, f: LeadFilters) {
  const where: Prisma.LeadWhereInput = {};
  if (f.status) where.status = f.status as LeadStatus;
  if (f.source) where.source = f.source as Prisma.EnumLeadSourceFilter['equals'];
  if (f.category) where.interestCategory = f.category as VisaCategory;
  if (f.owner === 'me') where.ownerId = ctx.user.id;
  else if (f.owner === 'none') where.ownerId = null;
  else if (f.owner) where.ownerId = f.owner;
  if (f.branch) where.branchId = f.branch === 'none' ? null : f.branch;
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { ref: { contains: q, mode: 'insensitive' } },
    ];
  }
  return db(ctx, (tx) =>
    tx.lead.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300, include: { product: true } }),
  );
}

export function getLead(ctx: Ctx, id: string) {
  return db(ctx, async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id },
      include: {
        product: true,
        client: true,
        tasks: { orderBy: [{ done: 'asc' }, { dueAt: 'asc' }] },
        appointments: { orderBy: { startsAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
        notes: { orderBy: { createdAt: 'desc' } },
      },
    });
    return lead;
  });
}

export function listClients(ctx: Ctx, q?: string) {
  const where: Prisma.ClientWhereInput = q
    ? {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { ref: { contains: q, mode: 'insensitive' } },
          { passportNumber: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};
  return db(ctx, (tx) =>
    tx.client.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { cases: { where: { status: { not: 'CLOSED' } }, include: { product: true } } },
    }),
  );
}

export function getClient(ctx: Ctx, id: string) {
  return db(ctx, (tx) =>
    tx.client.findUnique({
      where: { id },
      include: {
        lead: true,
        family: { orderBy: { createdAt: 'asc' } },
        cases: { orderBy: { createdAt: 'desc' }, include: { product: true } },
        tasks: { orderBy: [{ done: 'asc' }, { dueAt: 'asc' }] },
        appointments: { orderBy: { startsAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 60 },
      },
    }),
  );
}

export type CaseFilters = { q?: string; status?: string; category?: string; product?: string; owner?: string; branch?: string };

export function listCases(ctx: Ctx, f: CaseFilters) {
  const where: Prisma.CaseWhereInput = { status: (f.status as CaseStatus) || { not: 'CLOSED' } };
  if (f.status === 'ALL') delete where.status;
  if (f.category) where.product = { category: f.category as VisaCategory };
  if (f.product) where.productId = f.product;
  if (f.owner === 'me') where.ownerId = ctx.user.id;
  if (f.branch) where.branchId = f.branch === 'none' ? null : f.branch;
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { ref: { contains: q, mode: 'insensitive' } },
      { client: { firstName: { contains: q, mode: 'insensitive' } } },
      { client: { lastName: { contains: q, mode: 'insensitive' } } },
    ];
  }
  return db(ctx, (tx) =>
    tx.case.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 300, include: { client: true, product: true } }),
  );
}

export function getCase(ctx: Ctx, id: string) {
  return db(ctx, (tx) =>
    tx.case.findUnique({
      where: { id },
      include: {
        client: { include: { family: true } },
        product: true,
        branch: true,
        history: { orderBy: { at: 'asc' } },
        tasks: { orderBy: [{ done: 'asc' }, { dueAt: 'asc' }] },
        appointments: { orderBy: { startsAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 60 },
      },
    }),
  );
}

export function listProducts(ctx: Ctx, opts: { includeInactive?: boolean } = {}) {
  return db(ctx, (tx) =>
    tx.visaProduct.findMany({
      where: opts.includeInactive ? {} : { active: true },
      orderBy: [{ category: 'asc' }, { country: 'asc' }, { name: 'asc' }],
    }),
  );
}

export function listTasks(ctx: Ctx, f: { scope: 'mine' | 'all'; show: 'open' | 'done' }) {
  return db(ctx, (tx) =>
    tx.task.findMany({
      where: { done: f.show === 'done', ...(f.scope === 'mine' ? { assigneeId: ctx.user.id } : {}) },
      orderBy: f.show === 'done' ? { doneAt: 'desc' } : [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'asc' }],
      take: 300,
      include: { lead: true, client: true, case: true },
    }),
  );
}

export function listAppointments(ctx: Ctx, from: Date, to: Date) {
  return db(ctx, (tx) =>
    tx.appointment.findMany({
      where: { startsAt: { gte: from, lt: to } },
      orderBy: { startsAt: 'asc' },
      include: { lead: true, client: true, case: true },
    }),
  );
}

export function listCheckIns(ctx: Ctx) {
  const today = dayBounds(ctx.tenant.timezone);
  return db(ctx, (tx) =>
    tx.checkIn.findMany({ where: { createdAt: { gte: today.start } }, orderBy: { createdAt: 'asc' } }),
  );
}

export function listInvites(ctx: Ctx) {
  return db(ctx, (tx) =>
    tx.invite.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
  );
}

/** ⌘K search across leads, clients and cases. */
export function search(ctx: Ctx, q: string) {
  const term = q.trim();
  if (term.length < 2) return Promise.resolve([]);
  const name = (field: 'firstName' | 'lastName') => ({ [field]: { contains: term, mode: 'insensitive' as const } });
  return db(ctx, async (tx) => {
    const [leads, clients, cases] = await Promise.all([
      tx.lead.findMany({
        where: { clientId: null, OR: [name('firstName'), name('lastName'), { phone: { contains: term } }, { email: { contains: term, mode: 'insensitive' } }, { ref: { contains: term, mode: 'insensitive' } }] },
        take: 5,
      }),
      tx.client.findMany({
        where: { OR: [name('firstName'), name('lastName'), { phone: { contains: term } }, { email: { contains: term, mode: 'insensitive' } }, { ref: { contains: term, mode: 'insensitive' } }, { passportNumber: { contains: term, mode: 'insensitive' } }] },
        take: 5,
      }),
      tx.case.findMany({
        where: { OR: [{ ref: { contains: term, mode: 'insensitive' } }, { client: name('firstName') }, { client: name('lastName') }] },
        take: 5,
        include: { client: true, product: true },
      }),
    ]);
    return [
      ...clients.map((c) => ({ kind: 'Client' as const, id: c.id, title: [c.firstName, c.lastName].filter(Boolean).join(' '), sub: `${c.ref}${c.phone ? ` · ${c.phone}` : ''}`, href: `/${ctx.tenant.slug}/clients/${c.id}` })),
      ...cases.map((c) => ({ kind: 'Case' as const, id: c.id, title: `${[c.client.firstName, c.client.lastName].filter(Boolean).join(' ')} · ${c.product.name}`, sub: c.ref, href: `/${ctx.tenant.slug}/cases/${c.id}` })),
      ...leads.map((l) => ({ kind: 'Lead' as const, id: l.id, title: [l.firstName, l.lastName].filter(Boolean).join(' '), sub: `${l.ref}${l.phone ? ` · ${l.phone}` : ''}`, href: `/${ctx.tenant.slug}/leads/${l.id}` })),
    ];
  });
}

/** Branches, for filters and pickers (shown only when there's more than one). */
export function listBranches(ctx: Ctx) {
  return db(ctx, (tx) => tx.branch.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } }));
}
