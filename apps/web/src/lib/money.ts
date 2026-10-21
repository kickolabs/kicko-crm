// Money is always integer minor units (paise, cents). Never floats in storage.

export const CURRENCIES = ['INR', 'CAD', 'AUD', 'GBP', 'USD', 'NZD', 'EUR', 'AED', 'SGD'] as const;

export function formatMoney(minor: number, currency = 'INR', opts: { compact?: boolean } = {}) {
  const value = minor / 100;
  if (opts.compact && currency === 'INR' && Math.abs(value) >= 100_000) {
    // Indian compact: lakh / crore
    if (Math.abs(value) >= 10_000_000) return `₹${trim(value / 10_000_000)}Cr`;
    return `₹${trim(value / 100_000)}L`;
  }
  return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

const trim = (n: number) => (Math.round(n * 10) / 10).toString();

/** "35,000.50" / "35000" / "₹ 35,000" → 3500050 minor units. Returns null when not a valid amount. */
export function parseMoney(input: string | null | undefined): number | null {
  if (input == null) return null;
  const clean = String(input).replace(/[^\d.-]/g, '');
  if (!clean || !/^-?\d*(\.\d{0,2})?$/.test(clean)) return null;
  const [whole, frac = ''] = clean.split('.');
  const sign = whole!.startsWith('-') ? -1 : 1;
  const w = Number(whole!.replace('-', '') || '0');
  const f = Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(w)) return null;
  return sign * (w * 100 + f);
}

/** Minor units → plain input value ("35000" or "35000.50"). */
export function toInputAmount(minor: number | null | undefined) {
  if (minor == null) return '';
  return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2);
}

export type TaxMode = 'NONE' | 'GST_INTRA' | 'GST_INTER';
export type LineInput = { description: string; quantity: number; unitPrice: number; taxRate: number };

/** Basis points of an amount, rounded half-up to the nearest minor unit. */
export const bp = (amount: number, basisPoints: number) => Math.round((amount * basisPoints) / 10_000);

/**
 * Invoice totals. GST is computed per line; intra-state splits each line's tax
 * into equal CGST and SGST halves (odd paise go to SGST so halves always sum to the line tax).
 */
export function computeInvoice(lines: LineInput[], taxMode: TaxMode) {
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  const items = lines.map((l) => {
    const amount = l.quantity * l.unitPrice;
    const tax = taxMode === 'NONE' ? 0 : bp(amount, l.taxRate);
    subtotal += amount;
    if (taxMode === 'GST_INTRA') {
      const half = Math.floor(tax / 2);
      cgst += half;
      sgst += tax - half;
    } else if (taxMode === 'GST_INTER') igst += tax;
    return { ...l, amount, tax };
  });
  const taxTotal = cgst + sgst + igst;
  return { items, subtotal, cgst, sgst, igst, taxTotal, total: subtotal + taxTotal };
}

export type PlanStep = { label: string; percent: number; dueDays: number };

/** Split a total across a plan. The last step absorbs rounding so the parts always sum to the total. */
export function buildInstallments(total: number, plan: PlanStep[], issueDate: Date) {
  const steps = plan.length ? plan : [{ label: 'Full payment', percent: 100, dueDays: 0 }];
  const sumPct = steps.reduce((a, s) => a + s.percent, 0);
  if (Math.abs(sumPct - 100) > 0.001) throw new Error('Installment percentages must add up to 100');
  let allocated = 0;
  return steps.map((s, i) => {
    const amount = i === steps.length - 1 ? total - allocated : Math.round((total * s.percent) / 100);
    allocated += amount;
    return {
      label: s.label,
      amount,
      dueDate: new Date(issueDate.getTime() + s.dueDays * 86400_000),
      sortOrder: i,
    };
  });
}

/** Apply a payment to installments in due-date order. Returns the new paidAmount per installment id. */
export function allocatePayment<T extends { id: string; amount: number; paidAmount: number; dueDate: Date; sortOrder: number }>(
  installments: T[],
  payment: number,
) {
  let left = payment;
  const out: { id: string; paidAmount: number; fullyPaid: boolean }[] = [];
  for (const inst of [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.sortOrder - b.sortOrder)) {
    const due = inst.amount - inst.paidAmount;
    const apply = Math.max(0, Math.min(due, left));
    left -= apply;
    out.push({ id: inst.id, paidAmount: inst.paidAmount + apply, fullyPaid: inst.paidAmount + apply >= inst.amount });
  }
  return { updates: out, unapplied: left };
}
