import Link from 'next/link';
import { ArrowRight, Building2, CalendarCheck, FileCheck2, IndianRupee, Landmark, Lock, MessageCircle, PhoneCall, ShieldCheck, Sparkles, UserCheck, Users } from 'lucide-react';
import { LinkButton } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { PLAN_ORDER, PLANS } from '@/lib/plans';
import { CallShot, ChatShot, DocCheckShot, InvoiceShot, JourneyShot } from './product-shots';
import { SiteHeader } from './site-header';
import { SiteFooter } from '@/components/site-footer';

const JOURNEY: [icon: typeof Users, title: string, body: string][] = [
  [MessageCircle, 'Enquiry', 'WhatsApp, website form, walk-in kiosk or a call. Every one lands in Kicko, duplicates caught.'],
  [Sparkles, 'Qualified', 'The AI assistant answers questions and books a consultation, day or night.'],
  [UserCheck, 'Client', 'One click from lead to client, with family, education, tests and work history.'],
  [FileCheck2, 'Documents', 'Checklists per visa, uploads from the client portal, AI checks for expiry and mismatches.'],
  [IndianRupee, 'Paid', 'GST invoices, instalments and UPI payment links, with reminders that send themselves.'],
  [Landmark, 'Decision', 'Every stage, date and outcome tracked, so you know your approval rate by visa.'],
];

const FAQ: [q: string, a: string][] = [
  ['Do I need a credit card for the trial?', 'No. The 14-day trial includes every feature. Choose a plan when you’re ready; your data stays exactly as it is.'],
  ['Can I bring my leads from Excel or Zoho?', 'Yes. Upload a CSV or Excel file, match the columns, check the preview, and import. Every import can be undone.'],
  ['Does it work with our WhatsApp number?', 'Yes. Connect your WhatsApp Business number and your whole team shares one inbox, with templates, automations and an optional AI assistant.'],
  ['Where is our data stored?', 'In India (Mumbai) wherever our providers offer it. Each agency is sealed off at the database level, and you can export everything at any time.'],
  ['Is Kicko only for study visas?', 'No. Study, PR and skilled migration, work, visit and family visas for Canada, Australia, the UK, the US, New Zealand, Europe and more, with 25+ ready workflows you can edit.'],
  ['Can our sub-agents use it?', 'Yes, on Pro. Sub-agents get their own portal to refer clients and track their commission, without seeing the rest of your CRM.'],
];

export function MarketingHome() {
  const starter = PLANS.starter.price.INR.year;
  return (
    <div className="min-h-dvh">
      <div className="dotgrid">
        <SiteHeader />
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-10 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1 text-xs font-bold shadow-[var(--shadow-card)]">
              <span className="live-dot h-2 w-2 rounded-full bg-[#8DC21F]" />
              The CRM for visa & immigration consultancies
            </span>
            <h1 className="mt-6 text-[44px] leading-[1.02] font-extrabold tracking-[-0.045em] sm:text-[68px]">
              Every enquiry, case and deadline. <span className="text-faint">One calm console.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              Kicko takes a student or applicant from the first WhatsApp message to the visa decision: leads, cases, documents, payments, calls and an AI
              assistant, built for how Indian agencies actually work.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/signup" variant="primary" size="lg">Start your 14-day free trial <ArrowRight size={16} /></LinkButton>
              <LinkButton href="/pricing" variant="secondary" size="lg">See pricing</LinkButton>
            </div>
            <p className="mt-4 text-sm text-muted">No card needed · Set up in minutes · Import from Excel or Zoho</p>
          </div>
          <div className="relative flex flex-col gap-4" aria-label="Kicko screens">
            <JourneyShot />
            {/* The WhatsApp chat has its own section below; here it would be too narrow. */}
            <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
              <DocCheckShot />
              <CallShot />
            </div>
          </div>
        </section>
      </div>

      <section id="product" className="mx-auto max-w-6xl px-6 py-20">
        <span className="eyebrow">From first message to visa decision</span>
        <h2 className="mt-2 max-w-2xl text-[34px] leading-tight font-extrabold tracking-[-0.035em] sm:text-[44px]">One journey, not six spreadsheets.</h2>
        <ol className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-6">
          {JOURNEY.map(([Icon, title, body], i) => (
            <li key={title} className="relative flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className={`grid size-9 place-items-center rounded-[12px] ${i === JOURNEY.length - 1 ? 'bg-lime text-ink' : 'bg-ink text-paper'}`}><Icon size={17} /></span>
                {i < JOURNEY.length - 1 && <span className="hidden h-px flex-1 bg-line-2 lg:block" aria-hidden="true" />}
              </div>
              <h3 className="mt-1 font-bold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <Feature
        eyebrow="Leads & WhatsApp"
        title="Never let an enquiry go cold."
        points={[
          'One shared WhatsApp inbox for the whole team, with templates and automations.',
          'An AI assistant that answers in your words, collects details and books consultations, and hands over to a person when asked.',
          'Website enquiry form, walk-in kiosk and a lead API. Duplicates are caught by phone and email.',
          'Fair auto-assignment, so every counsellor gets their share.',
        ]}
        shot={<ChatShot />}
      />
      <Feature
        eyebrow="Cases & documents"
        title="Cases that move, documents that check themselves."
        points={[
          '25+ visa workflows (study, PR, work, visit, family) with stages and checklists you can edit.',
          'Clients upload through their own portal. AI flags expired passports, name mismatches and blurry scans.',
          'CRS and Australian points calculators, and answer sheets for government forms.',
          'Every date, from offer letter to biometrics and decision, on one timeline.',
        ]}
        shot={<div className="flex flex-col gap-4"><JourneyShot /><DocCheckShot /></div>}
        flip
      />
      <Feature
        eyebrow="Billing"
        title="Get paid without chasing."
        points={[
          'GST-ready invoices and receipts, with CGST/SGST or IGST worked out for you.',
          'Instalment plans and UPI payment links. Payments mark the invoice paid automatically.',
          'Overdue reminders, and commission tracking for institutions and sub-agents.',
        ]}
        shot={<InvoiceShot />}
      />
      <Feature
        eyebrow="Calls"
        title="Calls that write their own notes."
        points={[
          'Click to call from any lead or client, recorded with consent.',
          'AI call notes: a summary, next steps and the details mentioned, filled into the record.',
          'An AI voice agent that calls new enquiries within minutes to qualify them.',
        ]}
        shot={<div className="flex flex-col gap-4"><CallShot /><div className="card p-4 text-[13px]"><div className="eyebrow mb-2">AI call notes</div><p className="leading-relaxed text-ink-2">Ravi wants a Canada study permit for Jan intake with his wife as dependant. IELTS 6.5 done. <strong>Next:</strong> send the document checklist; follow up Friday.</p></div></div>}
        flip
      />

      <section className="mx-auto max-w-6xl px-6 py-20">
        <span className="eyebrow">Made for agencies in India</span>
        <h2 className="mt-2 max-w-2xl text-[34px] leading-tight font-extrabold tracking-[-0.035em]">The details that generic CRMs miss.</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [IndianRupee, 'GST & UPI', 'Tax invoices with GSTIN, instalments and UPI payment links via Razorpay.'],
            [MessageCircle, 'WhatsApp-first', 'Your clients live on WhatsApp. So does your inbox, your reminders and your AI assistant.'],
            [PhoneCall, 'Indian numbers', 'Calling through Exotel with Indian virtual numbers, or Twilio for overseas offices.'],
            [Building2, 'Data in India', 'Hosted in Mumbai where our providers offer it, under India’s DPDP Act.'],
          ].map(([Icon, t, b]) => {
            const I = Icon as typeof Users;
            return (
              <div key={t as string} className="rounded-[18px] bg-paper-2 p-5">
                <I size={20} />
                <h3 className="mt-3 font-bold">{t as string}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{b as string}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-ink text-paper">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <span className="text-[11px] font-bold tracking-[0.08em] text-paper/50 uppercase">Security</span>
            <h2 className="mt-2 text-[34px] leading-tight font-extrabold tracking-[-0.035em]">Passports deserve better than a shared spreadsheet.</h2>
            <Link href="/security" className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-lime hover:underline">How we protect your data <ArrowRight size={14} /></Link>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2">
            {[
              [Lock, 'Sealed per agency', 'Each agency’s data is separated in the database itself, and tested on every release.'],
              [ShieldCheck, 'Two-step sign-in', 'Authenticator-app codes, and you can require them for your whole team.'],
              [FileCheck2, 'Audit log', 'See who signed in, changed settings, exported data or opened a client’s passport.'],
              [CalendarCheck, 'Yours to take', 'Export everything as CSV at any time. Backups every day.'],
            ].map(([Icon, t, b]) => {
              const I = Icon as typeof Users;
              return (
                <li key={t as string} className="flex flex-col gap-1.5">
                  <I size={20} className="text-lime" />
                  <h3 className="font-bold">{t as string}</h3>
                  <p className="text-sm leading-relaxed text-paper/65">{b as string}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="eyebrow">Pricing</span>
            <h2 className="mt-2 text-[34px] leading-tight font-extrabold tracking-[-0.035em]">From {formatMoney(starter, 'INR')} per user a month.</h2>
            <p className="mt-2 text-muted">Billed yearly, plus GST. Every plan starts with a free 14-day trial of everything.</p>
          </div>
          <LinkButton href="/pricing" variant="secondary">Compare plans <ArrowRight size={15} /></LinkButton>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const p = PLANS[id];
            return (
              <Link key={id} href="/pricing" className={`flex flex-col gap-2 rounded-[18px] p-5 transition-shadow ${id === 'growth' ? 'bg-ink text-paper' : 'card hover:shadow-[var(--shadow-pop)]'}`}>
                <span className="text-lg font-extrabold">{p.name}</span>
                <span className="text-3xl font-extrabold tracking-tight tabular-nums">{formatMoney(p.price.INR.year, 'INR')}<span className={`text-xs font-semibold ${id === 'growth' ? 'text-paper/60' : 'text-muted'}`}> /user/mo</span></span>
                <span className={`text-sm ${id === 'growth' ? 'text-paper/70' : 'text-muted'}`}>{p.tagline}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-20">
        <h2 className="text-[28px] font-extrabold tracking-[-0.03em]">Questions</h2>
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

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="flex flex-col items-start gap-5 rounded-[28px] bg-lime px-8 py-12 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[30px] leading-tight font-extrabold tracking-[-0.035em] text-ink">Run your next intake from one place.</h2>
            <p className="mt-1 text-ink/70">14 days free. Bring your leads with you.</p>
          </div>
          <LinkButton href="/signup" variant="primary" size="lg">Create your workspace <ArrowRight size={16} /></LinkButton>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

function Feature({ eyebrow, title, points, shot, flip }: { eyebrow: string; title: string; points: string[]; shot: React.ReactNode; flip?: boolean }) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-2">
      <div className={flip ? 'lg:order-2' : ''}>
        <span className="eyebrow">{eyebrow}</span>
        <h2 className="mt-2 text-[30px] leading-tight font-extrabold tracking-[-0.035em] sm:text-[36px]">{title}</h2>
        <ul className="mt-5 flex flex-col gap-3">
          {points.map((p) => (
            <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-ink-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink" aria-hidden="true" />
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className={`rounded-[28px] bg-paper-2 p-6 sm:p-10 ${flip ? 'lg:order-1' : ''}`}>{shot}</div>
    </section>
  );
}
