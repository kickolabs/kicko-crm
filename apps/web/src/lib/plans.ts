// Kicko's plans, what each includes, and the subscription lifecycle.
// Pure: used by the server for enforcement and by the UI for display.

export type PlanId = 'starter' | 'growth' | 'pro';
export type Interval = 'month' | 'year';
export type SubStatus = 'trialing' | 'active' | 'past_due' | 'read_only' | 'suspended' | 'canceled';

export type Feature =
  | 'payment_links'
  | 'eligibility'
  | 'forms'
  | 'calling'
  | 'call_notes'
  | 'wa_assistant'
  | 'copilot'
  | 'voice_agent'
  | 'sub_agents'
  | 'doc_checks'
  | 'custom_fields'
  | 'api';

export const PLAN_ORDER: PlanId[] = ['starter', 'growth', 'pro'];

export const PLANS: Record<PlanId, {
  name: string;
  tagline: string;
  /** Per user per month, in minor units, before GST. */
  price: { INR: { month: number; year: number }; USD: { month: number; year: number } };
  creditsPerUser: number;
  storageGb: number;
  features: Feature[];
  highlights: string[];
}> = {
  starter: {
    name: 'Starter',
    tagline: 'Small agencies, 1–3 counsellors',
    price: { INR: { month: 119_900, year: 99_900 }, USD: { month: 1_800, year: 1_500 } },
    creditsPerUser: 0, // no AI features on Starter, so no credits to spend
    storageGb: 10,
    features: [],
    highlights: ['Leads, clients, cases & documents', 'GST invoices & receipts', 'Client portal, web form & walk-in kiosk', 'WhatsApp inbox, templates & automations', 'Reports & spreadsheet import'],
  },
  growth: {
    name: 'Growth',
    tagline: 'Most agencies',
    price: { INR: { month: 239_900, year: 199_900 }, USD: { month: 3_500, year: 2_900 } },
    creditsPerUser: 300,
    storageGb: 50,
    features: ['payment_links', 'eligibility', 'forms', 'calling', 'call_notes', 'wa_assistant', 'copilot'],
    highlights: ['Everything in Starter', 'Calling with AI call notes', 'WhatsApp AI assistant', 'Kicko Yu daily brief', 'Payment links, eligibility calculators, form sheets'],
  },
  pro: {
    name: 'Pro',
    tagline: 'Multi-branch & high volume',
    price: { INR: { month: 419_900, year: 349_900 }, USD: { month: 5_900, year: 4_900 } },
    creditsPerUser: 1000,
    storageGb: 200,
    features: ['payment_links', 'eligibility', 'forms', 'calling', 'call_notes', 'wa_assistant', 'copilot', 'voice_agent', 'sub_agents', 'doc_checks', 'custom_fields', 'api'],
    highlights: ['Everything in Growth', 'AI voice agent', 'Sub-agent network', 'AI document checks & API', 'Custom fields & report builder'],
  },
};

export const FEATURE_LABEL: Record<Feature, string> = {
  payment_links: 'Online payment links',
  eligibility: 'Eligibility calculators',
  forms: 'Government form sheets',
  calling: 'Calling',
  call_notes: 'AI call notes',
  wa_assistant: 'WhatsApp AI assistant',
  copilot: 'Kicko Yu daily brief',
  voice_agent: 'AI voice agent',
  sub_agents: 'Sub-agent network',
  doc_checks: 'AI document checks',
  custom_fields: 'Custom fields & report builder',
  api: 'API access',
};

/** Credits per AI action (1 credit ≈ ₹1 of AI cost). Only charged when a real model runs. */
export const CREDIT_COST = { call_notes: 4, voice_notes: 2, wa_reply: 1, doc_check: 1, brief: 2 } as const;
export type CreditAction = keyof typeof CREDIT_COST;

/** Trials get every feature, with a small AI allowance. */
export const TRIAL_CREDITS = 200;
export const TOP_UP = { credits: 1000, price: { INR: 149_900, USD: 1_900 } };
export const GST_RATE = 0.18;

/** Features that spend AI credits. */
export const AI_FEATURES: Feature[] = ['call_notes', 'wa_assistant', 'copilot', 'voice_agent', 'doc_checks'];

/** Whether the plan has anything to spend AI credits on (trials do). */
export const hasAi = (sub: { plan: string; status: string }) => AI_FEATURES.some((f) => hasFeature(sub, f));

/** Lowest plan that includes a feature. */
export const planFor = (f: Feature) => PLAN_ORDER.find((p) => PLANS[p].features.includes(f))!;

export function hasFeature(sub: { plan: string; status: string }, f: Feature) {
  if (sub.status === 'trialing') return true;
  return (PLANS[sub.plan as PlanId]?.features ?? []).includes(f);
}

export function monthlyAllowance(sub: { plan: string; status: string; seats: number }) {
  if (sub.status === 'trialing') return TRIAL_CREDITS;
  return (PLANS[sub.plan as PlanId]?.creditsPerUser ?? 0) * sub.seats;
}

/** Amount to charge for a period: per-seat price × seats (× 12 for yearly), less discount, plus GST for INR. */
export function quote(plan: PlanId, interval: Interval, seats: number, currency: 'INR' | 'USD', discountPct = 0) {
  const perSeatMonth = PLANS[plan].price[currency][interval];
  const subtotal = Math.round(perSeatMonth * seats * (interval === 'year' ? 12 : 1) * (1 - discountPct / 100));
  const tax = currency === 'INR' ? Math.round(subtotal * GST_RATE) : 0;
  return { subtotal, tax, total: subtotal + tax, perSeatMonth };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export const GRACE_DAYS = 7; // past due → read-only
export const READ_ONLY_DAYS = 30; // read-only → suspended
export const DAY = 86400_000;

/**
 * Time-based transitions. Payment events (activated, charged, halted) are applied
 * separately from the provider's webhooks; this handles everything that happens
 * because time passed.
 */
export function nextStatus(
  s: { status: string; statusSince: Date; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean },
  now = new Date(),
): SubStatus | null {
  const since = now.getTime() - s.statusSince.getTime();
  switch (s.status) {
    case 'trialing':
      return s.trialEndsAt && now > s.trialEndsAt ? 'read_only' : null;
    case 'active':
      if (s.currentPeriodEnd && now > s.currentPeriodEnd) return s.cancelAtPeriodEnd ? 'read_only' : 'past_due';
      return null;
    case 'past_due':
      return since > GRACE_DAYS * DAY ? 'read_only' : null;
    case 'read_only':
      return since > READ_ONLY_DAYS * DAY ? 'suspended' : null;
    default:
      return null;
  }
}

/** What staff can do in each state. Clients' portal and incoming webhooks keep working throughout. */
export function access(status: string): 'full' | 'read_only' | 'suspended' {
  if (status === 'read_only' || status === 'canceled') return 'read_only';
  if (status === 'suspended') return 'suspended';
  return 'full';
}

export const STATUS_LABEL: Record<SubStatus, string> = {
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment due',
  read_only: 'Read-only',
  suspended: 'Suspended',
  canceled: 'Cancelled',
};
