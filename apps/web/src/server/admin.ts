import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { prisma, withTenant, type Prisma, type Subscription } from '@kicko/db';
import { getSession } from '@/lib/auth';
import { DAY, PLANS, quote, type Interval, type PlanId } from '@/lib/plans';
import { UserError } from './scope';

// Kicko's super-admin console: every agency, its plan and usage, and the few
// account changes Kicko staff make by hand. Every change is written to AdminAction.
//
// The app's database role is still bound by row-level security, so cross-agency
// numbers are gathered by visiting each agency inside its own tenant scope.

export const FOUNDING_SLOTS = 20;
export const FOUNDING_PCT = 30;

/**
 * Super-admins are listed in SUPER_ADMIN_EMAILS and must have a verified email.
 * Sign-up doesn't verify emails yet, so an account becomes verified only through
 * `npm run admin:grant -- <email>`: nobody can register an admin address and walk in.
 */
export function adminEmails() {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const getAdmin = cache(async () => {
  const session = await getSession();
  if (!session) return null;
  if (!adminEmails().includes(session.user.email.toLowerCase())) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, name: true, email: true, emailVerified: true } });
  return user?.emailVerified ? user : null;
});

/** Same 404 as any unknown page, so the console's existence isn't revealed. */
export async function requireAdmin() {
  const admin = await getAdmin();
  if (!admin) notFound();
  return admin;
}

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Monthly recurring revenue in minor units (before GST). Complimentary and trial accounts count as zero. */
export function mrrOf(s: Pick<Subscription, 'plan' | 'interval' | 'seats' | 'discountPct' | 'status' | 'provider'>, currency: 'INR' | 'USD') {
  if (s.status !== 'active' && s.status !== 'past_due') return 0;
  if (s.provider === 'manual' || !PLANS[s.plan as PlanId]) return 0;
  const q = quote(s.plan as PlanId, s.interval as Interval, s.seats, currency, s.discountPct);
  return Math.round(s.interval === 'year' ? q.subtotal / 12 : q.subtotal);
}

export type AgencyRow = Awaited<ReturnType<typeof agencySummary>>;

async function agencySummary(t: { id: string; name: string; slug: string; country: string; createdAt: Date }) {
  const since = monthStart();
  const data = await withTenant(t.id, async (tx) => {
    const [sub, members, leads, clients, cases, lastActivity, credits, revenue, revenueMonth, owner] = await Promise.all([
      tx.subscription.findUnique({ where: { tenantId: t.id } }),
      tx.membership.count({ where: { active: true } }),
      tx.lead.count(),
      tx.client.count(),
      tx.case.count(),
      tx.activity.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      tx.creditEntry.aggregate({ where: { kind: 'usage', createdAt: { gte: since } }, _sum: { credits: true } }),
      tx.platformInvoice.aggregate({ _sum: { total: true, subtotal: true } }),
      tx.platformInvoice.aggregate({ where: { paidAt: { gte: since } }, _sum: { subtotal: true } }),
      tx.membership.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { userId: true, phone: true } }),
    ]);
    return { sub, members, leads, clients, cases, lastActivity: lastActivity?.createdAt ?? null, creditsMonth: credits._sum.credits ?? 0, revenue: revenue._sum.subtotal ?? 0, revenueMonth: revenueMonth._sum.subtotal ?? 0, owner };
  });
  const ownerUser = data.owner ? await prisma.user.findUnique({ where: { id: data.owner.userId }, select: { name: true, email: true } }) : null;
  const currency = (t.country === 'IN' ? 'INR' : 'USD') as 'INR' | 'USD';
  return {
    ...t,
    currency,
    sub: data.sub,
    members: data.members,
    leads: data.leads,
    clients: data.clients,
    cases: data.cases,
    lastActivity: data.lastActivity,
    creditsMonth: data.creditsMonth,
    revenue: data.revenue,
    revenueMonth: data.revenueMonth,
    mrr: data.sub ? mrrOf(data.sub, currency) : 0,
    owner: ownerUser ? { ...ownerUser, phone: data.owner?.phone ?? null } : null,
  };
}

/** Visit agencies a few at a time so the connection pool isn't exhausted. */
async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function listAgencies() {
  const tenants = await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, slug: true, country: true, createdAt: true } });
  return inBatches(tenants, 5, agencySummary);
}

export function overview(rows: AgencyRow[], now = new Date()) {
  const by = (s: string) => rows.filter((r) => r.sub?.status === s).length;
  const paying = rows.filter((r) => r.mrr > 0);
  return {
    agencies: rows.length,
    trialing: by('trialing'),
    trialsEndingSoon: rows.filter((r) => r.sub?.status === 'trialing' && r.sub.trialEndsAt && r.sub.trialEndsAt.getTime() - now.getTime() < 7 * DAY).length,
    paying: paying.length,
    complimentary: rows.filter((r) => r.sub?.provider === 'manual' && r.sub.status === 'active').length,
    atRisk: by('past_due') + by('read_only'),
    suspended: by('suspended'),
    mrrInr: paying.filter((r) => r.currency === 'INR').reduce((a, r) => a + r.mrr, 0),
    mrrUsd: paying.filter((r) => r.currency === 'USD').reduce((a, r) => a + r.mrr, 0),
    revenueMonthInr: rows.filter((r) => r.currency === 'INR').reduce((a, r) => a + r.revenueMonth, 0),
    seats: rows.reduce((a, r) => a + r.members, 0),
    foundingUsed: rows.filter((r) => (r.sub?.discountPct ?? 0) >= FOUNDING_PCT).length,
  };
}

/** Founding-customer discounts in use (other than `exceptId`). */
export async function foundingTaken(exceptId?: string) {
  const tenants = await prisma.tenant.findMany({ where: exceptId ? { id: { not: exceptId } } : {}, select: { id: true } });
  const pcts = await inBatches(tenants, 10, (t) => withTenant(t.id, (tx) => tx.subscription.findUnique({ where: { tenantId: t.id }, select: { discountPct: true } })));
  return pcts.filter((p) => (p?.discountPct ?? 0) >= FOUNDING_PCT).length;
}

export async function agencyDetail(tenantId: string) {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, slug: true, country: true, createdAt: true, timezone: true } });
  if (!t) return null;
  const summary = await agencySummary(t);
  const since = monthStart();
  const extra = await withTenant(t.id, async (tx) => {
    const [team, invoices, creditsByAction, usage] = await Promise.all([
      tx.membership.findMany({ orderBy: { createdAt: 'asc' }, select: { userId: true, role: true, active: true, createdAt: true } }),
      tx.platformInvoice.findMany({ orderBy: { paidAt: 'desc' }, take: 24 }),
      tx.creditEntry.groupBy({ by: ['action'], where: { kind: 'usage', createdAt: { gte: since } }, _sum: { credits: true } }),
      tx.usageEvent.groupBy({ by: ['capability', 'unit'], where: { createdAt: { gte: since } }, _sum: { quantity: true } }),
    ]);
    return { team, invoices, creditsByAction, usage };
  });
  const users = await prisma.user.findMany({ where: { id: { in: extra.team.map((m) => m.userId) } }, select: { id: true, name: true, email: true } });
  const log = await prisma.adminAction.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    ...summary,
    timezone: t.timezone,
    team: extra.team.map((m) => ({ ...m, name: users.find((u) => u.id === m.userId)?.name ?? 'Unknown', email: users.find((u) => u.id === m.userId)?.email ?? '' })),
    invoices: extra.invoices,
    creditsByAction: extra.creditsByAction.map((c) => ({ action: c.action ?? 'other', credits: c._sum.credits ?? 0 })),
    usage: extra.usage.map((u) => ({ capability: u.capability, unit: u.unit, quantity: u._sum.quantity ?? 0 })),
    log,
  };
}

export const recentAdminActions = (take = 15) => prisma.adminAction.findMany({ orderBy: { createdAt: 'desc' }, take });

// ── Changes ─────────────────────────────────────────────────────────────────

type Admin = { email: string };

async function change(admin: Admin, tenantId: string, action: string, details: Prisma.InputJsonObject, fn: (s: Subscription) => Prisma.SubscriptionUpdateInput | Promise<Prisma.SubscriptionUpdateInput>) {
  await withTenant(tenantId, async (tx) => {
    const s = await tx.subscription.findUnique({ where: { tenantId } });
    if (!s) throw new UserError('This agency has no subscription record');
    const data = await fn(s);
    await tx.subscription.update({ where: { tenantId }, data });
  });
  await prisma.adminAction.create({ data: { actorEmail: admin.email, tenantId, action, details } });
}

const paidByCard = (s: Subscription) => s.provider && s.provider !== 'manual' && s.status === 'active' && !s.cancelAtPeriodEnd;

/** Extend (or restart) a trial. Lifts an expired trial out of read-only or suspension. */
export async function extendTrial(admin: Admin, tenantId: string, days: number, reason: string) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new UserError('Extend by 1 to 90 days');
  await change(admin, tenantId, 'extend_trial', { days, reason }, (s) => {
    if (s.status === 'active' || s.status === 'past_due') throw new UserError('This agency is on a paid plan. Trials can only be extended before the first payment.');
    const now = new Date();
    const from = s.status === 'trialing' && s.trialEndsAt && s.trialEndsAt > now ? s.trialEndsAt : now;
    return { status: 'trialing', statusSince: s.status === 'trialing' ? s.statusSince : now, trialEndsAt: new Date(from.getTime() + days * DAY) };
  });
}

/** Discount for the next checkout or renewal (founding customers get 30%). */
export async function setDiscount(admin: Admin, tenantId: string, pct: number, reason: string) {
  if (!Number.isInteger(pct) || pct < 0 || pct > 50) throw new UserError('Discount must be 0 to 50%');
  if (pct >= FOUNDING_PCT) {
    if ((await foundingTaken(tenantId)) >= FOUNDING_SLOTS) throw new UserError(`All ${FOUNDING_SLOTS} founding-customer discounts are taken`);
  }
  await change(admin, tenantId, 'set_discount', { pct, reason }, () => ({ discountPct: pct }));
}

/**
 * Put an agency on a plan Kicko manages by hand: complimentary accounts, or
 * agencies that paid by bank transfer. No card is charged; it renews only by
 * another manual change.
 */
export async function setManualPlan(admin: Admin, tenantId: string, input: { plan: PlanId; seats: number; months: number; reason: string }) {
  if (!PLANS[input.plan]) throw new UserError('Pick a plan');
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 500) throw new UserError('Seats must be 1 to 500');
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 36) throw new UserError('Months must be 1 to 36');
  await change(admin, tenantId, 'set_plan', { ...input }, (s) => {
    if (paidByCard(s)) throw new UserError('This agency has a live card subscription. Ask them to cancel it in Plan & billing first, so they are not charged twice.');
    return {
      plan: input.plan,
      seats: input.seats,
      interval: input.months >= 12 ? 'year' : 'month',
      status: 'active',
      statusSince: new Date(),
      trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() + input.months * 30 * DAY),
      cancelAtPeriodEnd: false,
      provider: 'manual',
      providerSubscriptionId: null,
    };
  });
}

export async function grantCredits(admin: Admin, tenantId: string, credits: number, reason: string) {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100_000) throw new UserError('Credits must be 1 to 100,000');
  await withTenant(tenantId, (tx) => tx.creditEntry.create({ data: { tenantId, kind: 'adjustment', credits, meta: { by: admin.email, reason } } }));
  await change(admin, tenantId, 'add_credits', { credits, reason }, () => ({ topUpCredits: { increment: credits } }));
}

export async function suspendAgency(admin: Admin, tenantId: string, reason: string) {
  await change(admin, tenantId, 'suspend', { reason }, (s) => {
    if (s.status === 'suspended') throw new UserError('Already suspended');
    return { status: 'suspended', statusSince: new Date() };
  });
}

/** Undo a suspension: back to the plan or trial that is still running, otherwise read-only. */
export async function reactivateAgency(admin: Admin, tenantId: string, reason: string) {
  let to = '';
  await change(admin, tenantId, 'reactivate', { reason }, (s) => {
    if (s.status !== 'suspended' && s.status !== 'read_only') throw new UserError('This agency is not suspended or read-only');
    const now = new Date();
    to = s.currentPeriodEnd && s.currentPeriodEnd > now ? 'active' : s.trialEndsAt && s.trialEndsAt > now ? 'trialing' : '';
    if (!to) throw new UserError('Nothing is paid or on trial to return to. Extend the trial or set a plan instead.');
    return { status: to, statusSince: now };
  });
  return to;
}

export async function addNote(admin: Admin, tenantId: string, note: string) {
  if (!note.trim()) throw new UserError('Write a note');
  await prisma.adminAction.create({ data: { actorEmail: admin.email, tenantId, action: 'note', details: { note: note.trim().slice(0, 2000) } } });
}
