import { describe, expect, it } from 'vitest';
import { commissionLabel, paymentShare, subAgentInput } from './sub-agents';

describe('sub-agent commission', () => {
  it('takes the share before GST, pro rata for part payments', () => {
    // ₹50,000 + 18% GST = ₹59,000 invoice. Full payment at 10% → ₹5,000.
    expect(paymentShare(5_900_000, { subtotal: 5_000_000, total: 5_900_000 }, 1000)).toEqual({ basis: 5_000_000, amount: 500_000 });
    // First installment ₹29,500 → basis ₹25,000 → ₹2,500.
    expect(paymentShare(2_950_000, { subtotal: 5_000_000, total: 5_900_000 }, 1000)).toEqual({ basis: 2_500_000, amount: 250_000 });
    // No tax: the whole payment is the basis.
    expect(paymentShare(1_000_000, { subtotal: 1_000_000, total: 1_000_000 }, 750)).toEqual({ basis: 1_000_000, amount: 75_000 });
  });
  it('parses the rate from the form', () => {
    const base = { name: 'Ravi', email: 'ravi@agent.in', commissionType: 'PERCENT' as const };
    expect(subAgentInput.parse({ ...base, commission: '12.5' }).commissionValue).toBe(1250);
    expect(subAgentInput.parse({ ...base, commissionType: 'FIXED', commission: '5,000' }).commissionValue).toBe(500_000);
    expect(() => subAgentInput.parse({ ...base, commission: '80' })).toThrow();
  });
  it('describes the rate', () => {
    expect(commissionLabel({ commissionType: 'PERCENT', commissionValue: 1000 })).toBe('10% of payments');
    expect(commissionLabel({ commissionType: 'FIXED', commissionValue: 500_000 })).toBe('₹5,000 per client');
  });
});
