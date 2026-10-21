// Payments port: collect money into the agency's own gateway account.

export type CreateLinkInput = {
  amount: number; // minor units (paise)
  currency: string;
  referenceId: string; // unique per agency, ≤40 chars
  description: string;
  customer: { name: string; contact?: string | null; email?: string | null };
  notes: Record<string, string>;
  callbackUrl?: string;
};

/** Normalised gateway events; adapters translate their webhook payloads into these. */
export type PaymentEvent = {
  type: 'payment.succeeded';
  linkId: string; // provider id of the payment link
  paymentId: string; // provider payment id (idempotency key)
  amount: number;
  method?: string;
  paidAt: Date;
};

export interface PaymentsAdapter {
  createLink(input: CreateLinkInput): Promise<{ id: string; url: string }>;
  /** Verify the signature and translate the payload. Returns null when the signature is invalid. */
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent[] | null;
  healthCheck(): Promise<void>;
}
