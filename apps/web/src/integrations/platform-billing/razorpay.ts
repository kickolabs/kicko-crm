import 'server-only';
import { ProviderError } from '../core/types';
import { verifyRazorpaySignature } from '../payments/razorpay';
import type { BillingEvent, PlatformBillingAdapter } from './port';

// Razorpay Subscriptions on Kicko's own Razorpay account (UPI AutoPay, cards, e-mandates).
// Plans are created once in the Razorpay dashboard, one per plan × interval, priced
// per seat including GST; their ids come from env, e.g. RAZORPAY_PLAN_GROWTH_YEAR.

const API = 'https://api.razorpay.com/v1';

export function razorpayPlatform(keyId: string, keySecret: string, webhookSecret: string): PlatformBillingAdapter {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  const call = async <T>(path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) throw new ProviderError(json.error?.description ?? `Razorpay error ${res.status}`, 'razorpay');
    return json;
  };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return {
    id: 'razorpay',
    sandbox: false,
    async startSubscription(i) {
      const planId = process.env[`RAZORPAY_PLAN_${i.plan.toUpperCase()}_${i.interval.toUpperCase()}`];
      if (!planId) throw new ProviderError(`Billing isn't configured for ${i.plan} (${i.interval})`, 'razorpay');
      const r = await call<{ id: string; short_url: string }>('/subscriptions', {
        plan_id: planId,
        quantity: i.seats,
        total_count: i.interval === 'year' ? 10 : 120,
        customer_notify: 1,
        notes: { tenant_id: i.tenantId, slug: i.slug },
      });
      return { providerSubscriptionId: r.id, checkoutUrl: r.short_url };
    },
    async cancelSubscription(id, atPeriodEnd) {
      await call(`/subscriptions/${id}/cancel`, { cancel_at_cycle_end: atPeriodEnd ? 1 : 0 });
    },
    async createTopUpLink(i) {
      const r = await call<{ id: string; short_url: string }>('/payment_links', {
        amount: i.amount,
        currency: i.currency,
        description: `Kicko AI credits (${i.credits.toLocaleString('en-IN')})`,
        customer: { name: i.customer.name, email: i.customer.email },
        notify: { email: true },
        notes: { tenant_id: i.tenantId, kind: 'topup', credits: String(i.credits) },
        callback_url: `${appUrl}/${i.slug}/settings?tab=plan`,
        callback_method: 'get',
      });
      return { id: r.id, url: r.short_url };
    },
    parseWebhook(raw, headers) {
      if (!verifyRazorpaySignature(raw, headers.get('x-razorpay-signature'), webhookSecret)) return null;
      const e = JSON.parse(raw) as {
        event: string;
        payload: {
          subscription?: { entity: { id: string; current_end?: number; notes?: Record<string, string> } };
          payment?: { entity: { id: string; amount: number; currency: string; notes?: Record<string, string> } };
          payment_link?: { entity: { notes?: Record<string, string> } };
        };
      };
      const s = e.payload.subscription?.entity;
      const p = e.payload.payment?.entity;
      const tenantId = s?.notes?.tenant_id ?? e.payload.payment_link?.entity.notes?.tenant_id ?? p?.notes?.tenant_id;
      if (!tenantId) return [];
      const out: BillingEvent[] = [];
      if (s && (e.event === 'subscription.activated' || e.event === 'subscription.charged')) {
        out.push({
          type: e.event,
          tenantId,
          providerSubscriptionId: s.id,
          periodEnd: new Date((s.current_end ?? Date.now() / 1000) * 1000),
          payment: p ? { id: p.id, amount: p.amount, currency: p.currency } : undefined,
        });
      } else if (s && (e.event === 'subscription.halted' || e.event === 'subscription.pending')) {
        out.push({ type: 'subscription.halted', tenantId, providerSubscriptionId: s.id });
      } else if (s && e.event === 'subscription.cancelled') {
        out.push({ type: 'subscription.cancelled', tenantId, providerSubscriptionId: s.id });
      } else if (e.event === 'payment_link.paid' && p && e.payload.payment_link?.entity.notes?.kind === 'topup') {
        out.push({ type: 'topup.paid', tenantId, paymentId: p.id, amount: p.amount, currency: p.currency, credits: Number(e.payload.payment_link.entity.notes.credits ?? 0) });
      }
      return out;
    },
  };
}
