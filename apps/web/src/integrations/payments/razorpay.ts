import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ProviderError, type ProviderDescriptor } from '../core/types';
import type { PaymentEvent, PaymentsAdapter } from './port';

// Razorpay Payment Links. Each agency uses its own Razorpay account.

const API = 'https://api.razorpay.com/v1';

/** X-Razorpay-Signature = hex(HMAC-SHA256(rawBody, webhookSecret)). */
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type PaidEvent = {
  event: string;
  payload?: {
    payment_link?: { entity: { id: string } };
    payment?: { entity: { id: string; amount: number; method?: string; created_at: number } };
  };
};

export const razorpay: ProviderDescriptor<PaymentsAdapter> = {
  id: 'razorpay',
  capability: 'payments',
  name: 'Razorpay',
  description: 'UPI, cards and netbanking via Razorpay Payment Links. Money settles to your Razorpay account.',
  docsUrl: 'https://razorpay.com/docs/payments/payment-links/',
  webhookPath: true,
  guide: [
    'Razorpay Dashboard → Account & Settings → API keys: generate a key pair.',
    'Settings → Webhooks: add the webhook URL shown here, choose the event payment_link.paid, and set a secret.',
    'Paste the same webhook secret below. Payments then mark invoices paid and issue receipts automatically.',
  ],
  features: { currencies: ['INR'], partialPayments: false, notifiesCustomer: true },
  fields: [
    { key: 'keyId', label: 'Key ID', required: true, pattern: '^rzp_(test|live)_[A-Za-z0-9]+$', placeholder: 'rzp_live_…', hint: 'Dashboard → Account & Settings → API keys' },
    { key: 'keySecret', label: 'Key secret', secret: true, required: true },
    { key: 'webhookSecret', label: 'Webhook secret', secret: true, hint: 'Set the same secret on the Razorpay webhook (event: payment_link.paid)' },
  ],
  create(cfg): PaymentsAdapter {
    const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
    const call = async <T>(path: string, init?: RequestInit) => {
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
      if (!res.ok) throw new ProviderError(body.error?.description ?? `Razorpay error ${res.status}`, 'razorpay');
      return body;
    };
    return {
      async createLink(i) {
        const r = await call<{ id: string; short_url: string }>('/payment_links', {
          method: 'POST',
          body: JSON.stringify({
            amount: i.amount,
            currency: i.currency,
            accept_partial: false,
            reference_id: i.referenceId.slice(0, 40),
            description: i.description.slice(0, 2048),
            customer: { name: i.customer.name, ...(i.customer.contact ? { contact: i.customer.contact } : {}), ...(i.customer.email ? { email: i.customer.email } : {}) },
            notify: { sms: Boolean(i.customer.contact), email: Boolean(i.customer.email) },
            reminder_enable: true,
            notes: i.notes,
            ...(i.callbackUrl ? { callback_url: i.callbackUrl, callback_method: 'get' } : {}),
          }),
        });
        return { id: r.id, url: r.short_url };
      },
      parseWebhook(raw, headers) {
        if (!cfg.webhookSecret || !verifyRazorpaySignature(raw, headers.get('x-razorpay-signature'), cfg.webhookSecret)) return null;
        const e = JSON.parse(raw) as PaidEvent;
        if (e.event !== 'payment_link.paid' || !e.payload?.payment_link || !e.payload.payment) return [];
        const p = e.payload.payment.entity;
        const ev: PaymentEvent = {
          type: 'payment.succeeded',
          linkId: e.payload.payment_link.entity.id,
          paymentId: p.id,
          amount: p.amount,
          method: p.method,
          paidAt: new Date(p.created_at * 1000),
        };
        return [ev];
      },
      async healthCheck() {
        await call('/payment_links?count=1');
      },
    };
  },
};
