'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { buttonCls, Input } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { FEATURE_LABEL, PLAN_ORDER, PLANS, quote, type Feature, type Interval } from '@/lib/plans';

type Currency = 'INR' | 'USD';

// Included in every plan (listed once, at the top of the comparison).
const CORE = [
  'Leads, clients & visa cases',
  '25+ editable visa workflows',
  'Document checklists & client portal',
  'WhatsApp inbox, templates & automations',
  'Web enquiry form & walk-in kiosk',
  'GST invoices, receipts & instalments',
  'Ready-made reports & spreadsheet import',
  'Two-step sign-in, audit log & data export',
];
const EXTRA: Feature[] = ['payment_links', 'eligibility', 'forms', 'calling', 'call_notes', 'wa_assistant', 'voice_agent', 'doc_checks', 'sub_agents', 'custom_fields', 'api'];

export function PricingTable({ defaultCurrency }: { defaultCurrency: Currency }) {
  const [interval, setPeriod] = useState<Interval>('year');
  const [currency, setCurrency] = useState<Currency>(defaultCurrency);
  const [users, setUsers] = useState(5);
  const seats = Math.min(500, Math.max(1, Math.floor(users) || 1));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-center gap-4">
        <Toggle label="Billing" value={interval} onChange={setPeriod} options={[['year', 'Yearly · 2 months free'], ['month', 'Monthly']]} />
        <Toggle label="Currency" value={currency} onChange={setCurrency} options={[['INR', '₹ INR'], ['USD', '$ USD']]} />
        <label className="flex flex-col gap-1 text-[11px] font-bold tracking-wide text-muted uppercase">
          Users
          <Input type="number" min={1} max={500} value={users} onChange={(e) => setUsers(Number(e.target.value))} aria-label="Users" className="h-10 w-24" />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const q = quote(id, interval, seats, currency);
          const dark = id === 'growth';
          return (
            <section key={id} aria-label={`${p.name} plan`} className={clsx('flex flex-col gap-5 rounded-[22px] p-6', dark ? 'bg-ink text-paper shadow-[var(--shadow-pop)]' : 'card')}>
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-extrabold">{p.name}</h2>
                {dark && <span className="rounded-full bg-lime px-2.5 py-0.5 text-xs font-bold text-ink">Most popular</span>}
              </div>
              <div>
                <span className="text-[44px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{formatMoney(p.price[currency][interval], currency)}</span>
                <span className={clsx('text-sm', dark ? 'text-paper/60' : 'text-muted')}> per user / month</span>
                <div className={clsx('mt-2 text-sm', dark ? 'text-paper/70' : 'text-muted')} aria-label={`${p.name} total`}>
                  {seats} user{seats === 1 ? '' : 's'}: {formatMoney(Math.round(q.total / 100) * 100, currency)} {interval === 'year' ? 'per year' : 'per month'}
                  {currency === 'INR' ? ' incl. 18% GST' : ''}
                </div>
              </div>
              <p className={clsx('text-sm', dark ? 'text-paper/70' : 'text-muted')}>{p.tagline}</p>
              <ul className="flex flex-col gap-2 text-sm">
                {p.highlights.map((h) => <li key={h} className="flex gap-2"><Check size={15} className={clsx('mt-0.5 shrink-0', dark && 'text-lime')} />{h}</li>)}
                {p.creditsPerUser > 0 && <li className="flex gap-2"><Sparkles size={15} className={clsx('mt-0.5 shrink-0', dark && 'text-lime')} />{p.creditsPerUser.toLocaleString('en-IN')} AI credits per user each month</li>}
                <li className="flex gap-2"><Check size={15} className={clsx('mt-0.5 shrink-0', dark && 'text-lime')} />{p.storageGb} GB document storage</li>
              </ul>
              <Link href="/signup" className={clsx(buttonCls(dark ? 'lime' : 'secondary', 'lg'), 'mt-auto w-full')}>Start 14-day free trial</Link>
            </section>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted">
        Every trial includes every feature. Prices {currency === 'INR' ? 'exclude 18% GST, which invoices show separately' : 'are in US dollars for agencies outside India'}. Change plan or users any time.
      </p>

      <div className="overflow-x-auto rounded-[22px] bg-card shadow-[var(--shadow-card)]">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="px-6 pt-6 text-left text-lg font-extrabold">Compare plans</caption>
          <thead>
            <tr className="text-left text-xs text-muted uppercase">
              <th scope="col" className="px-6 py-3 font-bold">Feature</th>
              {PLAN_ORDER.map((id) => <th key={id} scope="col" className="w-32 px-4 py-3 text-center font-bold">{PLANS[id].name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {CORE.map((f) => (
              <tr key={f}>
                <th scope="row" className="px-6 py-2.5 text-left font-medium">{f}</th>
                {PLAN_ORDER.map((id) => <td key={id} className="text-center"><Check size={16} className="inline" aria-label="Included" /></td>)}
              </tr>
            ))}
            {EXTRA.map((f) => (
              <tr key={f}>
                <th scope="row" className="px-6 py-2.5 text-left font-medium">{FEATURE_LABEL[f]}</th>
                {PLAN_ORDER.map((id) => <td key={id} className="text-center">{PLANS[id].features.includes(f) && <Check size={16} className="inline" aria-label="Included" />}</td>)}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-6 py-2.5 text-left font-medium">AI credits per user each month</th>
              {PLAN_ORDER.map((id) => <td key={id} className="text-center tabular-nums">{PLANS[id].creditsPerUser ? PLANS[id].creditsPerUser.toLocaleString('en-IN') : ''}</td>)}
            </tr>
            <tr>
              <th scope="row" className="px-6 py-2.5 text-left font-medium">Document storage</th>
              {PLAN_ORDER.map((id) => <td key={id} className="text-center tabular-nums">{PLANS[id].storageGb} GB</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Toggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex flex-col gap-1 text-[11px] font-bold tracking-wide text-muted uppercase">
      {label}
      <div role="tablist" aria-label={label} className="flex gap-1 rounded-full bg-card p-1 shadow-[var(--shadow-card)]">
        {options.map(([v, text]) => (
          <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={clsx('rounded-full px-3.5 py-1.5 text-sm font-bold normal-case tracking-normal', value === v ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
