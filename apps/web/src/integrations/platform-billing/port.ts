import type { Interval, PlanId } from '@/lib/plans';

// Platform billing port: Kicko charging agencies for their subscription.
// Platform-owned (Kicko's account), unlike the agency's own payments connection.

export type Customer = { name: string; email: string; phone?: string | null };

export type BillingEvent =
  | {
      type: 'subscription.activated' | 'subscription.charged';
      tenantId: string;
      providerSubscriptionId: string;
      periodEnd: Date;
      payment?: { id: string; amount: number; currency: string };
    }
  | { type: 'subscription.halted' | 'subscription.cancelled'; tenantId: string; providerSubscriptionId: string }
  | { type: 'topup.paid'; tenantId: string; paymentId: string; amount: number; currency: string; credits: number };

export interface PlatformBillingAdapter {
  id: string;
  sandbox: boolean;
  /** Create a subscription; the agency authorises payment at checkoutUrl. */
  startSubscription(i: {
    tenantId: string;
    slug: string;
    plan: PlanId;
    interval: Interval;
    seats: number;
    currency: 'INR' | 'USD';
    perPeriod: number; // amount charged each period, incl. tax
    customer: Customer;
  }): Promise<{ providerSubscriptionId: string; checkoutUrl: string }>;
  cancelSubscription(providerSubscriptionId: string, atPeriodEnd: boolean): Promise<void>;
  createTopUpLink(i: { tenantId: string; slug: string; amount: number; currency: 'INR' | 'USD'; credits: number; customer: Customer }): Promise<{ id: string; url: string }>;
  /** Verify and translate a webhook. Null = invalid signature. */
  parseWebhook(rawBody: string, headers: Headers): BillingEvent[] | null;
}
