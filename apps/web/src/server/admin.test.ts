import { afterEach, describe, expect, it } from 'vitest';
import { adminEmails, mrrOf, overview, type AgencyRow } from './admin';

const sub = (o: Record<string, unknown>) => ({ plan: 'growth', interval: 'year', seats: 5, discountPct: 0, status: 'active', provider: 'razorpay', ...o });

describe('MRR', () => {
  it('yearly plans count a twelfth of the year, before GST', () => {
    expect(mrrOf(sub({}), 'INR')).toBe(199_900 * 5); // ₹1,999 × 5 users
    expect(mrrOf(sub({ interval: 'month' }), 'INR')).toBe(239_900 * 5);
    expect(mrrOf(sub({ discountPct: 30 }), 'INR')).toBe(Math.round(199_900 * 5 * 0.7));
  });
  it('trials, complimentary and lapsed accounts bring in nothing', () => {
    expect(mrrOf(sub({ status: 'trialing' }), 'INR')).toBe(0);
    expect(mrrOf(sub({ provider: 'manual' }), 'INR')).toBe(0);
    expect(mrrOf(sub({ status: 'read_only' }), 'INR')).toBe(0);
    expect(mrrOf(sub({ status: 'past_due' }), 'INR')).toBe(199_900 * 5); // still billed, retrying
  });
});

describe('overview', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const row = (s: Record<string, unknown> | null, extra: Partial<AgencyRow> = {}) =>
    ({ id: Math.random().toString(36), currency: 'INR', members: 2, revenueMonth: 0, mrr: s ? mrrOf(sub(s), 'INR') : 0, sub: s && sub(s), ...extra }) as unknown as AgencyRow;
  it('counts agencies by state', () => {
    const o = overview(
      [
        row({ status: 'trialing', trialEndsAt: new Date('2026-10-25T00:00:00Z') }),
        row({ status: 'trialing', trialEndsAt: new Date('2026-11-30T00:00:00Z') }),
        row({}, { revenueMonth: 1_000_000 }),
        row({ discountPct: 30 }),
        row({ provider: 'manual' }),
        row({ status: 'past_due' }),
        row({ status: 'suspended' }),
      ],
      now,
    );
    expect(o).toMatchObject({ agencies: 7, trialing: 2, trialsEndingSoon: 1, paying: 3, complimentary: 1, atRisk: 1, suspended: 1, foundingUsed: 1, revenueMonthInr: 1_000_000, seats: 14 });
    expect(o.mrrInr).toBe(199_900 * 5 * 2 + Math.round(199_900 * 5 * 0.7));
  });
});

describe('admin allowlist', () => {
  const saved = process.env.SUPER_ADMIN_EMAILS;
  afterEach(() => void (process.env.SUPER_ADMIN_EMAILS = saved));
  it('is case-insensitive and empty by default', () => {
    process.env.SUPER_ADMIN_EMAILS = ' Admin@Kicko.in, ops@kicko.in ,';
    expect(adminEmails()).toEqual(['admin@kicko.in', 'ops@kicko.in']);
    delete process.env.SUPER_ADMIN_EMAILS;
    expect(adminEmails()).toEqual([]);
  });
});
