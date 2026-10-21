import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { BillingEvent, PlatformBillingAdapter } from './port';

// Sandbox billing: checkout is a Kicko page where you "pay" with one click. It posts
// a signed webhook to the real endpoint, so subscriptions, renewals, failed payments
// and top-ups exercise the same code as Razorpay.

export const sandboxBillingSecret = () =>
  createHash('sha256').update(`billing-sandbox:${process.env.BETTER_AUTH_SECRET ?? 'dev'}`).digest('hex');
export const signSandboxBilling = (raw: string) => createHmac('sha256', sandboxBillingSecret()).update(raw).digest('hex');

/** Events as JSON (dates as ISO strings). */
export type SandboxBillingBody = { events: (Record<string, unknown> & { type: BillingEvent['type'] })[] };

export function billingSandbox(): PlatformBillingAdapter {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return {
    id: 'billing-sandbox',
    sandbox: true,
    async startSubscription(i) {
      const id = `sub_sbx_${randomBytes(8).toString('hex')}`;
      const q = new URLSearchParams({ sub: id, tenant: i.tenantId, slug: i.slug, amount: String(i.perPeriod), currency: i.currency, plan: i.plan, interval: i.interval, seats: String(i.seats) });
      return { providerSubscriptionId: id, checkoutUrl: `${appUrl}/checkout/sandbox?${q}` };
    },
    async cancelSubscription() {},
    async createTopUpLink(i) {
      const id = `plink_sbx_${randomBytes(8).toString('hex')}`;
      const q = new URLSearchParams({ topup: id, tenant: i.tenantId, slug: i.slug, amount: String(i.amount), currency: i.currency, credits: String(i.credits) });
      return { id, url: `${appUrl}/checkout/sandbox?${q}` };
    },
    parseWebhook(raw, headers) {
      const given = Buffer.from(headers.get('x-sandbox-signature') ?? '');
      const expected = Buffer.from(signSandboxBilling(raw));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      const b = JSON.parse(raw) as SandboxBillingBody;
      return b.events.map((e) => (typeof e.periodEnd === 'string' ? { ...e, periodEnd: new Date(e.periodEnd) } : e) as unknown as BillingEvent);
    },
  };
}
