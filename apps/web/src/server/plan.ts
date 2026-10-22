import 'server-only';
import { cache } from 'react';
import { Prisma, prisma, withTenant, type Subscription, type Tx } from '@kicko/db';
import type { TenantSettings } from '@kicko/db/provision';
import { llmFor, platformBilling, type AiTask } from '@/integrations/core/platform';
import { ProviderError } from '@/integrations/core/types';
import type { BillingEvent } from '@/integrations/platform-billing/port';
import {
  access,
  CREDIT_COST,
  FEATURE_LABEL,
  hasAi,
  hasFeature,
  monthlyAllowance,
  nextStatus,
  planFor,
  PLANS,
  quote,
  TOP_UP,
  type CreditAction,
  type Feature,
  type Interval,
  type PlanId,
} from '@/lib/plans';
import { financialYear } from './billing';
import { sendEmail } from './email';
import { audit } from './audit';
import { UserError, type Scope } from './scope';

// Kicko subscriptions: entitlements, seats, AI credits, checkout and the lifecycle.

export const getSubscription = cache(async (tenantId: string) => {
  const s = await withTenant(tenantId, (tx) => tx.subscription.findUnique({ where: { tenantId } }));
  if (!s) throw new Error(`No subscription for tenant ${tenantId}`);
  return s;
});

export class PlanError extends UserError {}

export async function requireFeature(tenantId: string, feature: Feature) {
  const s = await getSubscription(tenantId);
  if (!hasFeature(s, feature)) {
    throw new PlanError(`${FEATURE_LABEL[feature]} is part of the ${PLANS[planFor(feature)].name} plan. Upgrade in Settings → Plan & billing.`);
  }
}

export async function featureOn(tenantId: string, feature: Feature) {
  return hasFeature(await getSubscription(tenantId), feature);
}

// ── Seats ───────────────────────────────────────────────────────────────────

export async function assertSeatAvailable(tx: Tx, tenantId: string) {
  const s = await tx.subscription.findUnique({ where: { tenantId } });
  if (!s) return;
  const [members, invites] = await Promise.all([
    tx.membership.count({ where: { active: true } }),
    tx.invite.count({ where: { acceptedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  if (members + invites >= s.seats) {
    throw new UserError(`All ${s.seats} seats are in use (including pending invites). Add seats in Settings → Plan & billing.`);
  }
}

// ── AI credits ──────────────────────────────────────────────────────────────

const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export async function creditSummary(tenantId: string) {
  const s = await getSubscription(tenantId);
  const usage = await withTenant(tenantId, (tx) =>
    tx.creditEntry.aggregate({ where: { kind: 'usage', createdAt: { gte: monthStart() } }, _sum: { credits: true, fromTopUp: true } }),
  );
  const allowance = monthlyAllowance(s);
  const used = (usage._sum.credits ?? 0) - (usage._sum.fromTopUp ?? 0);
  return { allowance, used, topUp: s.topUpCredits, remaining: Math.max(0, allowance - used) + s.topUpCredits };
}

/**
 * Spend credits for one AI action. The monthly allowance goes first, then purchased
 * credits. Returns false when there aren't enough (callers skip the AI step).
 * Nothing is charged when no real model is configured (sandbox).
 */
const TASK_OF: Record<CreditAction, AiTask> = { call_notes: 'call_notes', voice_notes: 'call_notes', wa_reply: 'whatsapp_reply', doc_check: 'document_check', brief: 'copilot_brief' };

export async function consumeCredits(tenantId: string, action: CreditAction, meta?: Record<string, string>) {
  if (llmFor(TASK_OF[action]).sandbox) return true;
  const cost = CREDIT_COST[action];
  return withTenant(tenantId, async (tx) => {
    const s = await tx.subscription.findUnique({ where: { tenantId } });
    if (!s) return false;
    const usage = await tx.creditEntry.aggregate({ where: { kind: 'usage', createdAt: { gte: monthStart() } }, _sum: { credits: true, fromTopUp: true } });
    const usedAllowance = (usage._sum.credits ?? 0) - (usage._sum.fromTopUp ?? 0);
    const fromAllowance = Math.min(cost, Math.max(0, monthlyAllowance(s) - usedAllowance));
    const fromTopUp = cost - fromAllowance;
    if (fromTopUp > s.topUpCredits) return false;
    if (fromTopUp) await tx.subscription.update({ where: { tenantId }, data: { topUpCredits: { decrement: fromTopUp } } });
    await tx.creditEntry.create({ data: { tenantId, kind: 'usage', action, credits: cost, fromTopUp, meta } });
    return true;
  });
}

export const NO_CREDITS = 'AI credits are used up for this month. Buy more in Settings → Plan & billing.';

// ── Checkout ────────────────────────────────────────────────────────────────

async function customerOf(scope: Scope) {
  const [tenant, owner] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } }),
    scope.actorId ? prisma.user.findUnique({ where: { id: scope.actorId } }) : null,
  ]);
  return { name: (tenant.settings as TenantSettings).billing?.legalName || tenant.name, email: owner?.email ?? '', currency: (tenant.country === 'IN' ? 'INR' : 'USD') as 'INR' | 'USD' };
}

export async function startCheckout(scope: Scope, input: { plan: PlanId; interval: Interval; seats: number }) {
  if (!PLANS[input.plan]) throw new UserError('Pick a plan');
  if (input.seats < 1 || input.seats > 500) throw new UserError('Seats must be between 1 and 500');
  const members = await withTenant(scope.tenantId, (tx) => tx.membership.count({ where: { active: true } }));
  if (input.seats < members) throw new UserError(`You have ${members} active team members: choose at least ${members} seats, or deactivate members first.`);
  const s = await getSubscription(scope.tenantId);
  const c = await customerOf(scope);
  const q = quote(input.plan, input.interval, input.seats, c.currency, s.discountPct);
  const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } })).slug;
  let res;
  try {
    res = await platformBilling().startSubscription({ tenantId: scope.tenantId, slug, ...input, currency: c.currency, perPeriod: q.total, customer: c });
  } catch (err) {
    throw new UserError(err instanceof ProviderError ? `Billing: ${err.message}` : 'Could not start checkout. Please try again.');
  }
  await withTenant(scope.tenantId, (tx) =>
    tx.subscription.update({ where: { tenantId: scope.tenantId }, data: { pendingChange: { ...input, providerSubscriptionId: res.providerSubscriptionId } } }),
  );
  await audit(scope, 'billing.checkout', `Started checkout: ${PLANS[input.plan].name}, ${input.seats} users, ${input.interval === 'year' ? 'yearly' : 'monthly'}`);
  return res.checkoutUrl;
}

export async function buyCredits(scope: Scope) {
  if (!hasAi(await getSubscription(scope.tenantId))) throw new PlanError('AI features start on the Growth plan. Upgrade first, then credits can be added.');
  const c = await customerOf(scope);
  const subtotal = TOP_UP.price[c.currency];
  const amount = c.currency === 'INR' ? Math.round(subtotal * 1.18) : subtotal;
  const slug = (await prisma.tenant.findUniqueOrThrow({ where: { id: scope.tenantId } })).slug;
  const link = await platformBilling().createTopUpLink({ tenantId: scope.tenantId, slug, amount, currency: c.currency, credits: TOP_UP.credits, customer: c });
  return link.url;
}

export async function setCancelAtPeriodEnd(scope: Scope, cancel: boolean) {
  const s = await getSubscription(scope.tenantId);
  if (s.status !== 'active' || !s.providerSubscriptionId) throw new UserError('There is no active paid subscription to change');
  if (s.provider !== 'manual') {
    if (cancel) await platformBilling().cancelSubscription(s.providerSubscriptionId, true);
    else throw new UserError('To resume, choose a plan again: a new subscription starts when the current one ends.');
  }
  await withTenant(scope.tenantId, (tx) => tx.subscription.update({ where: { tenantId: scope.tenantId }, data: { cancelAtPeriodEnd: cancel } }));
  await audit(scope, 'billing.cancel', cancel ? 'Cancelled the subscription at the end of the period' : 'Resumed the subscription');
}

// ── Payment events ──────────────────────────────────────────────────────────

const KICKO = () => ({
  legalName: process.env.KICKO_LEGAL_NAME ?? 'Kicko (legal name not set)',
  address: process.env.KICKO_ADDRESS ?? '',
  gstin: process.env.KICKO_GSTIN ?? '',
  state: (process.env.KICKO_GSTIN ?? '33').slice(0, 2), // GST state code (33 = Tamil Nadu)
});

async function nextInvoiceNumber(at: Date) {
  const fy = financialYear(at, 'Asia/Kolkata');
  const row = await prisma.platformCounter.upsert({ where: { key: `invoice-${fy}` }, create: { key: `invoice-${fy}`, value: 1 }, update: { value: { increment: 1 } } });
  return `KCK/${fy}/${String(row.value).padStart(4, '0')}`;
}

/** Tax invoice for a payment received (amount includes GST for INR). */
async function recordInvoice(tenantId: string, payment: { id: string; amount: number; currency: string }, description: string) {
  const existing = await withTenant(tenantId, (tx) => tx.platformInvoice.findUnique({ where: { providerPaymentId: payment.id } }));
  if (existing) return existing;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const buyerGstin = (tenant.settings as TenantSettings).billing?.gstin ?? '';
  let subtotal = payment.amount;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (payment.currency === 'INR') {
    subtotal = Math.round(payment.amount / 1.18);
    const tax = payment.amount - subtotal;
    // Interstate supply (buyer registered in another state) → IGST, otherwise CGST + SGST.
    if (buyerGstin && buyerGstin.slice(0, 2) !== KICKO().state) igst = tax;
    else {
      cgst = Math.floor(tax / 2);
      sgst = tax - cgst;
    }
  }
  const number = await nextInvoiceNumber(new Date());
  return withTenant(tenantId, (tx) =>
    tx.platformInvoice.create({ data: { tenantId, number, description, subtotal, cgst, sgst, igst, total: payment.amount, currency: payment.currency, providerPaymentId: payment.id } }),
  );
}

async function notifyOwners(tenantId: string, subject: string, text: string) {
  const owners = await withTenant(tenantId, (tx) => tx.membership.findMany({ where: { active: true, role: { in: ['OWNER', 'ADMIN'] } } }));
  const users = await prisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } } });
  for (const u of users) await sendEmail({ to: u.email, subject, text }, tenantId).catch(() => {});
}

export async function processBillingEvents(events: BillingEvent[]) {
  for (const e of events) {
    const tenant = await prisma.tenant.findUnique({ where: { id: e.tenantId } });
    if (!tenant) continue;
    const billing = platformBilling();
    if (e.type === 'subscription.activated' || e.type === 'subscription.charged') {
      const s = await withTenant(e.tenantId, (tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: e.tenantId } }));
      const pending = s.pendingChange as { plan: PlanId; interval: Interval; seats: number; providerSubscriptionId: string } | null;
      const switching = pending?.providerSubscriptionId === e.providerSubscriptionId;
      if (!switching && s.providerSubscriptionId !== e.providerSubscriptionId) continue; // not this workspace's subscription
      const old = switching && s.providerSubscriptionId && s.providerSubscriptionId !== e.providerSubscriptionId ? s.providerSubscriptionId : null;
      await withTenant(e.tenantId, (tx) =>
        tx.subscription.update({
          where: { tenantId: e.tenantId },
          data: {
            ...(switching ? { plan: pending!.plan, interval: pending!.interval, seats: pending!.seats, pendingChange: Prisma.DbNull } : {}),
            status: 'active',
            statusSince: s.status === 'active' ? s.statusSince : new Date(),
            currentPeriodEnd: e.periodEnd,
            cancelAtPeriodEnd: false,
            provider: billing.id,
            providerSubscriptionId: e.providerSubscriptionId,
            trialEndsAt: null,
          },
        }),
      );
      // A plan change replaces the previous subscription.
      if (old && s.provider !== 'manual') await billing.cancelSubscription(old, false).catch((err) => console.error('cancel old subscription', err));
      if (e.payment) {
        const plan = switching ? pending!.plan : (s.plan as PlanId);
        const seats = switching ? pending!.seats : s.seats;
        const interval = switching ? pending!.interval : s.interval;
        await recordInvoice(e.tenantId, e.payment, `Kicko ${PLANS[plan].name}, ${seats} user${seats > 1 ? 's' : ''}, ${interval === 'year' ? 'annual' : 'monthly'} subscription`);
      }
    } else if (e.type === 'subscription.halted') {
      await withTenant(e.tenantId, (tx) =>
        tx.subscription.updateMany({ where: { tenantId: e.tenantId, providerSubscriptionId: e.providerSubscriptionId, status: 'active' }, data: { status: 'past_due', statusSince: new Date() } }),
      );
      await notifyOwners(e.tenantId, 'Kicko: payment failed', `We couldn't charge your Kicko subscription. Please update your payment method in Settings → Plan & billing within 7 days to keep editing your workspace.`);
    } else if (e.type === 'subscription.cancelled') {
      await withTenant(e.tenantId, (tx) =>
        tx.subscription.updateMany({ where: { tenantId: e.tenantId, providerSubscriptionId: e.providerSubscriptionId }, data: { cancelAtPeriodEnd: true } }),
      );
    } else if (e.type === 'topup.paid') {
      const inv = await withTenant(e.tenantId, (tx) => tx.platformInvoice.findUnique({ where: { providerPaymentId: e.paymentId } }));
      if (inv) continue; // retried webhook
      await withTenant(e.tenantId, async (tx) => {
        await tx.subscription.update({ where: { tenantId: e.tenantId }, data: { topUpCredits: { increment: e.credits } } });
        await tx.creditEntry.create({ data: { tenantId: e.tenantId, kind: 'top_up', credits: e.credits, meta: { paymentId: e.paymentId } } });
      });
      await recordInvoice(e.tenantId, { id: e.paymentId, amount: e.amount, currency: e.currency }, `Kicko AI credits (${e.credits.toLocaleString('en-IN')})`);
    }
  }
}

// ── Lifecycle (daily cron) ──────────────────────────────────────────────────

const MESSAGES: Record<string, [string, string]> = {
  past_due: ['Kicko: renewal due', 'Your Kicko subscription has ended and needs renewing. Renew within 7 days to keep editing your workspace.'],
  read_only: ['Kicko: your workspace is read-only', 'Your Kicko workspace is now read-only: your team can view and export everything, but not make changes. Choose a plan in Settings → Plan & billing to continue. After 30 days the workspace will be suspended.'],
  suspended: ['Kicko: workspace suspended', 'Your Kicko workspace has been suspended. Your data is kept for 90 days; choose a plan to restore access immediately.'],
};

export async function runBillingLifecycle(now = new Date()) {
  const tenants = await prisma.tenant.findMany();
  const changed: Record<string, string> = {};
  for (const t of tenants) {
    const s = await withTenant(t.id, (tx) => tx.subscription.findUnique({ where: { tenantId: t.id } }));
    if (!s) continue;
    // Trial reminder three days before it ends.
    if (s.status === 'trialing' && s.trialEndsAt) {
      const days = Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / 86400_000);
      if (days === 3) await notifyOwners(t.id, 'Kicko: 3 days left in your trial', 'Your Kicko trial ends in 3 days. Choose a plan in Settings → Plan & billing to keep everything running.');
    }
    const next = nextStatus(s, now);
    if (!next) continue;
    await withTenant(t.id, (tx) => tx.subscription.update({ where: { tenantId: t.id }, data: { status: next, statusSince: now } }));
    changed[t.slug] = next;
    const m = MESSAGES[next];
    if (m) await notifyOwners(t.id, m[0], m[1]);
  }
  return changed;
}

export function accessOf(s: Pick<Subscription, 'status'>) {
  return access(s.status);
}
