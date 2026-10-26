import { describe, expect, it } from 'vitest';
import { blocksOf, renderTemplate } from '@/lib/merge';
import { feesOf } from './doc-templates';

const invoice = {
  total: 11_800_00, taxTotal: 1_800_00, amountPaid: 5_900_00, currency: 'INR',
  items: [{ description: 'Consultation', quantity: 1, amount: 2_000_00 }, { description: 'Visa filing', quantity: 2, amount: 8_000_00 }],
  installments: [
    { label: 'On signing', amount: 5_900_00, dueDate: new Date('2026-10-26T06:00:00Z') },
    { label: 'Visa lodged', amount: 5_900_00, dueDate: new Date('2026-11-25T06:00:00Z') },
  ],
};

describe('fees for agreements', () => {
  it('itemise the latest invoice, with GST, instalments, paid and balance', () => {
    const f = feesOf(invoice, null, 'Asia/Kolkata');
    expect(f.lines?.split('\n')).toEqual(['- Consultation: ₹2,000', '- Visa filing × 2: ₹8,000', '- GST: ₹1,800']);
    expect(f.instalments?.split('\n')).toHaveLength(2);
    expect(f.instalments).toContain('- On signing: ₹5,900, due');
    expect(f.balance).toBe('₹5,900');
  });

  it('fall back to the case package and its payment plan', () => {
    const f = feesOf(undefined, { name: 'Canada study', price: 50_000_00, taxRate: 1800, plan: [{ label: 'On signing', percent: 60, dueDays: 0 }, { label: 'Visa lodged', percent: 40, dueDays: 30 }] }, 'Asia/Kolkata');
    expect(f.total).toBe('₹59,000'); // price is before 18% GST
    expect(f.lines).toBe('- Canada study: ₹50,000\n- GST: ₹9,000');
    expect(f.instalments).toBe('- On signing: ₹35,400, on signing\n- Visa lodged: ₹23,600, due 30 days after signing');
    expect(feesOf(undefined, { name: 'Basic', price: 1000_00, plan: [] }, 'UTC').instalments).toBe('- In full on signing: ₹1,000');
  });

  it('a list field on its own line becomes list items in the document', () => {
    const { text, missing } = renderTemplate('## Service fees\n\n{{fees.lines}}\n\nTotal: {{fees.total}}', { fees: feesOf(invoice, null, 'UTC') });
    expect(missing).toEqual([]);
    expect(blocksOf(text).filter((b) => b.kind === 'li').map((b) => b.text)).toEqual(['Consultation: ₹2,000', 'Visa filing × 2: ₹8,000', 'GST: ₹1,800']);
  });

  it('nothing to bill yet leaves the fee fields blank', () => {
    expect(renderTemplate('{{fees.total}} {{fees.lines}}', { fees: feesOf(undefined, null, 'UTC') }).missing).toEqual(['fees.total', 'fees.lines']);
  });
});
