import { describe, expect, it } from 'vitest';
import { allocatePayment, buildInstallments, computeInvoice, formatMoney, parseMoney } from './money';
import { rupeesInWords } from './words';

describe('rupeesInWords', () => {
  it.each([
    [3_500_000, 'Rupees Thirty Five Thousand Only'],
    [3_500_050, 'Rupees Thirty Five Thousand and Fifty Paise Only'],
    [1_234_567_800, 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only'],
    [10_000, 'Rupees One Hundred Only'],
  ])('%s', (minor, words) => expect(rupeesInWords(minor)).toBe(words));
});

describe('parseMoney', () => {
  it.each([
    ['35000', 3_500_000],
    ['35,000.5', 3_500_050],
    ['₹ 1,20,000.75', 12_000_075],
    ['0.05', 5],
    ['', null],
    ['abc', null],
    ['1.234', null],
  ])('%s → %s', (input, expected) => expect(parseMoney(input)).toBe(expected));
});

describe('formatMoney', () => {
  it('formats rupees in Indian grouping', () => expect(formatMoney(12_000_000)).toBe('₹1,20,000'));
  it('keeps paise when present', () => expect(formatMoney(3_500_050)).toBe('₹35,000.50'));
  it('compacts lakhs', () => expect(formatMoney(184_000_000, 'INR', { compact: true })).toBe('₹18.4L'));
  it('handles foreign currency', () => expect(formatMoney(1_895_000, 'CAD')).toBe('CA$18,950'));
});

describe('computeInvoice', () => {
  const lines = [
    { description: 'Study abroad package', quantity: 1, unitPrice: 8_474_600, taxRate: 1800 },
    { description: 'Courier', quantity: 3, unitPrice: 33_333, taxRate: 1800 },
  ];
  it('splits intra-state GST into CGST + SGST that sum exactly', () => {
    const r = computeInvoice(lines, 'GST_INTRA');
    expect(r.subtotal).toBe(8_474_600 + 99_999);
    expect(r.cgst + r.sgst).toBe(r.taxTotal);
    expect(r.igst).toBe(0);
    expect(r.taxTotal).toBe(1_525_428 + 18_000);
    expect(r.total).toBe(r.subtotal + r.taxTotal);
  });
  it('uses IGST for inter-state', () => {
    const r = computeInvoice(lines, 'GST_INTER');
    expect(r.igst).toBe(r.taxTotal);
    expect(r.cgst + r.sgst).toBe(0);
  });
  it('no tax when exempt', () => expect(computeInvoice(lines, 'NONE').taxTotal).toBe(0));
});

describe('buildInstallments', () => {
  const day0 = new Date('2026-10-01T00:00:00Z');
  it('parts always sum to the total', () => {
    const parts = buildInstallments(10_000_001, [
      { label: 'Signing', percent: 33.33, dueDays: 0 },
      { label: 'Visa lodged', percent: 33.33, dueDays: 30 },
      { label: 'Decision', percent: 33.34, dueDays: 60 },
    ], day0);
    expect(parts.reduce((a, p) => a + p.amount, 0)).toBe(10_000_001);
    expect(parts[1]!.dueDate.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
  it('rejects plans that do not add up to 100%', () => {
    expect(() => buildInstallments(100, [{ label: 'x', percent: 60, dueDays: 0 }], day0)).toThrow();
  });
  it('defaults to a single full payment', () => {
    expect(buildInstallments(500, [], day0)).toEqual([{ label: 'Full payment', amount: 500, dueDate: day0, sortOrder: 0 }]);
  });
});

describe('allocatePayment', () => {
  const inst = [
    { id: 'b', amount: 3000, paidAmount: 0, dueDate: new Date('2026-11-01'), sortOrder: 1 },
    { id: 'a', amount: 3000, paidAmount: 1000, dueDate: new Date('2026-10-01'), sortOrder: 0 },
  ];
  it('pays the earliest due installment first', () => {
    const { updates, unapplied } = allocatePayment(inst, 2500);
    expect(updates.find((u) => u.id === 'a')).toEqual({ id: 'a', paidAmount: 3000, fullyPaid: true });
    expect(updates.find((u) => u.id === 'b')).toEqual({ id: 'b', paidAmount: 500, fullyPaid: false });
    expect(unapplied).toBe(0);
  });
  it('reports overpayment', () => {
    expect(allocatePayment(inst, 9000).unapplied).toBe(4000);
  });
});
