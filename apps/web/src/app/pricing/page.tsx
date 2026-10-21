import { headers } from 'next/headers';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/site-footer';
import { company } from '@/lib/company';
import { formatMoney } from '@/lib/money';
import { CREDIT_COST, TOP_UP } from '@/lib/plans';
import { PricingTable } from './pricing-table';

export const metadata = {
  title: 'Pricing',
  description: 'Kicko pricing for visa and immigration consultancies: Starter, Growth and Pro, per user per month. 14-day free trial with every feature.',
};

const FAQ: [q: string, a: string][] = [
  ['What counts as a user?', 'Each person on your team who signs in. Clients using the portal and sub-agents don’t need a user.'],
  ['What happens after the 14-day trial?', 'Choose a plan to keep going. If you don’t, the workspace becomes read-only (you can still view and export everything) until you do.'],
  ['Can I change plans or users later?', 'Yes, any time from Settings → Plan & billing. A new plan starts straight away.'],
  ['How does GST work?', 'Prices for Indian agencies exclude 18% GST. Your invoices show CGST and SGST, or IGST, and your GSTIN so you can claim input credit.'],
  ['What are AI credits?', `They pay for AI work: ${CREDIT_COST.call_notes} credits for AI call notes, ${CREDIT_COST.voice_notes} for voice agent notes, ${CREDIT_COST.wa_reply} per WhatsApp AI reply and ${CREDIT_COST.doc_check} per document check. Growth and Pro include a monthly allowance; extra packs of ${TOP_UP.credits.toLocaleString('en-IN')} cost ${formatMoney(TOP_UP.price.INR, 'INR')} and never expire.`],
  ['Can I cancel?', 'Yes. Your plan runs to the end of the period you paid for, and you can export all your data at any time.'],
];

export default async function PricingPage() {
  // Agencies outside India see US dollars first (they can switch).
  const country = (await headers()).get('x-vercel-ip-country');
  const c = company();
  return (
    <div className="min-h-dvh">
      <div className="dotgrid">
        <SiteHeader />
        <section className="mx-auto max-w-6xl px-6 pt-10 pb-16">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-[44px] leading-[1.05] font-extrabold tracking-[-0.045em] sm:text-[56px]">Simple pricing, per user.</h1>
            <p className="mt-4 text-lg text-ink-2">Every plan starts with a 14-day free trial of everything. No card needed.</p>
          </div>
          <div className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-[16px] bg-lime px-5 py-3 text-center text-sm text-ink">
            <strong>Founding agencies: 30% off.</strong>
            <span>The first 20 agencies get 30% off their plan. <a href={`mailto:${c.supportEmail}?subject=Founding%20agency%20offer`} className="font-semibold underline">Ask us</a> after you sign up.</span>
          </div>
          <div className="mt-10">
            <PricingTable defaultCurrency={country && country !== 'IN' ? 'USD' : 'INR'} />
          </div>
        </section>
      </div>
      <section className="mx-auto max-w-3xl px-6 pb-20">
        <h2 className="text-[28px] font-extrabold tracking-[-0.03em]">Pricing questions</h2>
        <div className="mt-6 divide-y divide-line rounded-[18px] bg-card shadow-[var(--shadow-card)]">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span className="text-xl leading-none text-muted transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
