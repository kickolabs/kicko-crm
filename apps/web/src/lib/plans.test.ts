import { describe, expect, it } from 'vitest';
import { access, DAY, hasAi, hasFeature, monthlyAllowance, nextStatus, planFor, quote, TRIAL_CREDITS } from './plans';

const now = new Date('2026-10-22T10:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const sub = (o: Partial<Parameters<typeof nextStatus>[0]>) => ({ status: 'active', statusSince: ago(1), trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, ...o });

describe('pricing', () => {
  it('yearly Growth for 5 users: ₹1,999 × 5 × 12 + 18% GST', () => {
    expect(quote('growth', 'year', 5, 'INR')).toEqual({ subtotal: 11_994_000, tax: 2_158_920, total: 14_152_920, perSeatMonth: 199_900 });
  });
  it('monthly Starter, 1 user; founding discount applies before tax; no GST in USD', () => {
    expect(quote('starter', 'month', 1, 'INR').total).toBe(Math.round(119_900 * 1.18));
    expect(quote('pro', 'year', 2, 'INR', 30).subtotal).toBe(Math.round(349_900 * 2 * 12 * 0.7));
    expect(quote('growth', 'month', 3, 'USD')).toMatchObject({ subtotal: 10_500, tax: 0, total: 10_500 });
  });
});

describe('entitlements', () => {
  it('each feature belongs to the lowest plan that includes it', () => {
    expect(planFor('call_notes')).toBe('growth');
    expect(planFor('voice_agent')).toBe('pro');
    expect(hasFeature({ plan: 'starter', status: 'active' }, 'calling')).toBe(false);
    expect(hasFeature({ plan: 'growth', status: 'active' }, 'calling')).toBe(true);
    expect(hasFeature({ plan: 'growth', status: 'active' }, 'sub_agents')).toBe(false);
  });
  it('trials include everything, with a small AI allowance', () => {
    expect(hasFeature({ plan: 'starter', status: 'trialing' }, 'voice_agent')).toBe(true);
    expect(monthlyAllowance({ plan: 'pro', status: 'trialing', seats: 10 })).toBe(TRIAL_CREDITS);
    expect(monthlyAllowance({ plan: 'growth', status: 'active', seats: 4 })).toBe(1200);
  });
  it('Starter has no AI features, so no credits', () => {
    expect(monthlyAllowance({ plan: 'starter', status: 'active', seats: 3 })).toBe(0);
    expect(hasAi({ plan: 'starter', status: 'active' })).toBe(false);
    expect(hasAi({ plan: 'starter', status: 'trialing' })).toBe(true);
    expect(hasAi({ plan: 'growth', status: 'active' })).toBe(true);
  });
});

describe('subscription lifecycle', () => {
  it('trial ends → read-only', () => {
    expect(nextStatus(sub({ status: 'trialing', trialEndsAt: ago(-2) }), now)).toBeNull();
    expect(nextStatus(sub({ status: 'trialing', trialEndsAt: ago(1) }), now)).toBe('read_only');
  });
  it('period ends unpaid → past due; cancelled → read-only', () => {
    expect(nextStatus(sub({ currentPeriodEnd: ago(-10) }), now)).toBeNull();
    expect(nextStatus(sub({ currentPeriodEnd: ago(1) }), now)).toBe('past_due');
    expect(nextStatus(sub({ currentPeriodEnd: ago(1), cancelAtPeriodEnd: true }), now)).toBe('read_only');
  });
  it('7 days past due → read-only; 30 days read-only → suspended', () => {
    expect(nextStatus(sub({ status: 'past_due', statusSince: ago(6) }), now)).toBeNull();
    expect(nextStatus(sub({ status: 'past_due', statusSince: ago(8) }), now)).toBe('read_only');
    expect(nextStatus(sub({ status: 'read_only', statusSince: ago(29) }), now)).toBeNull();
    expect(nextStatus(sub({ status: 'read_only', statusSince: ago(31) }), now)).toBe('suspended');
    expect(nextStatus(sub({ status: 'suspended', statusSince: ago(400) }), now)).toBeNull(); // deletion is a manual, warned step
  });
  it('maps status to what staff can do', () => {
    expect(['trialing', 'active', 'past_due'].map(access)).toEqual(['full', 'full', 'full']);
    expect(access('read_only')).toBe('read_only');
    expect(access('suspended')).toBe('suspended');
  });
});
