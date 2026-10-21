import clsx from 'clsx';
import Link from 'next/link';
import { COUNTRIES } from '@/lib/constants';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { stagesOf } from '@/server/cases';
import { getPortalHome } from '@/server/portal';
import { requirePortal } from '@/server/portal-auth';
import { connectionSummary } from '@/integrations/core/connections';
import { PortalShell } from './portal-shell';
import { CancelAppointment, CopyText, NeedItem, PayButton } from './portal-widgets';

export const metadata = { title: 'Your visa journey', robots: { index: false } };

export default async function PortalHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ booked?: string }> }) {
  const { slug } = await params;
  const { booked } = await searchParams;
  const p = await requirePortal(slug);
  const home = await getPortalHome(p);
  const tz = p.scope.timezone;
  const billing = p.scope.settings.billing ?? {};
  const canPayOnline = (await connectionSummary(p.scope.tenantId, 'payments'))?.status === 'active';
  const openCases = home.cases.filter((c) => c.status !== 'CLOSED');
  const needs = openCases.flatMap((c) =>
    c.documents
      .filter((d) => d.status === 'PENDING' || d.status === 'REJECTED' || d.status === 'UPLOADED')
      .map((d) => ({ ...d, caseRef: c.ref })),
  );
  const todo = needs.filter((d) => d.status !== 'UPLOADED' && d.required);
  const optional = needs.filter((d) => d.status !== 'UPLOADED' && !d.required);
  const checking = needs.filter((d) => d.status === 'UPLOADED');
  const dues = home.invoices.flatMap((inv) =>
    inv.installments.filter((i) => i.paidAmount < i.amount).map((i) => ({ ...i, invoice: inv })),
  );
  const nextDue = dues.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  const welcome = p.scope.settings.portal?.welcome;

  return (
    <PortalShell slug={slug} agency={p.tenantName} active="journey" unread={home.unread}>
      {booked && (
        <div role="status" className="rounded-[16px] bg-lime px-5 py-3.5 font-semibold">Booked. Your consultant has it in their calendar.</div>
      )}

      {openCases.length === 0 && (
        <section className="rounded-[24px] bg-ink p-8 text-paper">
          <h1 className="text-[40px] leading-tight font-extrabold tracking-[-0.04em]">Hi {p.client.firstName}.</h1>
          <p className="mt-2 text-[#C4CAD2]">{welcome ?? 'Your consultant will set up your case here shortly.'}</p>
        </section>
      )}

      {openCases.map((c) => {
        const stages = stagesOf(c.product);
        const idx = Math.max(0, stages.findIndex((s) => s.key === c.stageKey));
        const next = stages[idx + 1];
        const appt = home.appointments.find((a) => a.caseId === c.id) ?? home.appointments[0];
        return (
          <section key={c.id} aria-label={`${c.product.name} journey`} className="flex flex-wrap items-end justify-between gap-7 rounded-[24px] bg-ink p-7 text-paper sm:p-8">
            <div className="flex max-w-xl flex-col gap-3">
              <span className="text-xs font-semibold tracking-wider text-[#A9AFB7] uppercase">
                {COUNTRIES[c.product.country] ?? c.product.country} · {c.product.name} · {c.ref}
              </span>
              <h1 className="text-[36px] leading-[1.05] font-extrabold tracking-[-0.04em] sm:text-[48px]">
                {p.client.firstName}, you're <span className="text-lime">{idx + 1} of {stages.length}</span> steps to {COUNTRIES[c.product.country] ?? 'your destination'}.
              </h1>
              <p className="leading-relaxed text-[#C4CAD2]">
                Now: <strong className="text-paper">{stages[idx]?.name}</strong>.
                {next ? ` Next: ${next.name}.` : ' This is the final step.'}
                {appt && ` Your next meeting is ${fmtDateTime(appt.startsAt, tz)}.`}
              </p>
            </div>
            <div className="flex min-w-[240px] flex-1 flex-col gap-2.5 sm:max-w-[320px]">
              <div className="flex gap-1" aria-label={`Step ${idx + 1} of ${stages.length}`}>
                {stages.map((s, i) => (
                  <div key={s.key} title={s.name} className={clsx('h-2 flex-1 rounded-full', i < idx ? 'bg-lime' : i === idx ? 'bg-lime/40' : 'bg-white/15')} />
                ))}
              </div>
              <span className="text-xs font-semibold tracking-wide text-[#A9AFB7] uppercase">{c.status === 'ON_HOLD' ? 'On hold' : `${Math.round(((idx + 1) / stages.length) * 100)}% complete`}</span>
            </div>
          </section>
        );
      })}

      {/* Phone order: needs → payment & consultant → history. Desktop: two columns. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[auto_1fr]">
        <div className="order-1 flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
          {openCases.length > 0 && (
            <>
              <h2 className="text-[26px] font-extrabold tracking-[-0.035em]">
                {todo.length ? `${todo.length} thing${todo.length === 1 ? '' : 's'} we need from you` : 'Nothing needed from you right now'}
              </h2>
              {todo.map((d) => (
                <NeedItem key={d.id} slug={slug} doc={{ id: d.id, name: d.name, group: d.group, status: d.status, rejectionReason: d.rejectionReason }} />
              ))}
              {checking.length > 0 && (
                <div className="rounded-[16px] bg-card p-4 shadow-[var(--shadow-card)]">
                  <span className="eyebrow">Being checked</span>
                  <ul className="mt-2 flex flex-col gap-1.5 text-sm">
                    {checking.map((d) => <li key={d.id} className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#6B9BEA]" aria-hidden="true" />{d.name}</li>)}
                  </ul>
                </div>
              )}
              {optional.length > 0 && (
                <details className="rounded-[16px] bg-card p-4 shadow-[var(--shadow-card)]">
                  <summary className="cursor-pointer text-sm font-semibold">Optional documents ({optional.length})</summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {optional.map((d) => <NeedItem key={d.id} slug={slug} doc={{ id: d.id, name: d.name, group: d.group, status: d.status, rejectionReason: d.rejectionReason }} />)}
                  </div>
                </details>
              )}
            </>
          )}

        </div>
        <div className="order-3 flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-2">
          <h2 className="text-[26px] font-extrabold tracking-[-0.035em]">What's happened</h2>
          <ol className="card divide-y divide-line">
            {home.events.length === 0 && <li className="px-5 py-4 text-sm text-muted">Updates appear here as your case moves.</li>}
            {home.events.map((e, i) => (
              <li key={i} className="flex gap-4 px-5 py-3.5">
                <span className="w-16 shrink-0 text-xs font-semibold text-muted uppercase">{fmtDate(e.at, tz, { year: undefined })}</span>
                <span className={clsx('text-sm', e.tone === 'ok' && 'font-semibold', e.tone === 'warn' && 'font-semibold text-warn')}>{e.text}</span>
              </li>
            ))}
          </ol>
        </div>

        <aside className="order-2 flex flex-col gap-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          {nextDue && (
            <section aria-label="Payment" className="card flex flex-col gap-3 p-5">
              <span className="eyebrow">Next payment</span>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[30px] font-extrabold tracking-[-0.04em]">{formatMoney(nextDue.amount - nextDue.paidAmount, nextDue.invoice.currency)}</span>
                <span className={clsx('text-sm', nextDue.dueDate < new Date() ? 'font-bold text-danger' : 'text-muted')}>
                  {nextDue.dueDate < new Date() ? 'overdue · was due' : 'due'} {fmtDate(nextDue.dueDate, tz, { year: undefined })}
                </span>
              </div>
              <span className="text-sm text-muted">{nextDue.label} · {nextDue.invoice.ref}</span>
              {canPayOnline ? (
                <PayButton slug={slug} invoiceId={nextDue.invoice.id} />
              ) : (
                <div className="flex flex-col gap-2 rounded-[12px] bg-paper-3 p-3 text-sm">
                  {billing.upiId && <CopyText label="UPI" value={billing.upiId} />}
                  {billing.bankDetails && <p className="text-xs leading-relaxed whitespace-pre-line text-ink-2">{billing.bankDetails}</p>}
                  <p className="text-xs text-muted">After paying, send the reference in <Link href={`/portal/${slug}/messages`} className="font-semibold underline underline-offset-4">Messages</Link>.</p>
                </div>
              )}
            </section>
          )}

          <section aria-label="Your consultant" className="card flex flex-col gap-3 p-5">
            <span className="eyebrow">Your consultant</span>
            <span className="text-lg font-bold">{home.counsellor ?? p.tenantName}</span>
            <div className="flex flex-wrap gap-2">
              <Link href={`/portal/${slug}/messages`} className="flex h-10 flex-1 items-center justify-center rounded-[11px] font-semibold shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]">Message{home.unread ? ` (${home.unread})` : ''}</Link>
              <Link href={`/portal/${slug}/book`} className="flex h-10 flex-1 items-center justify-center rounded-[11px] bg-ink font-semibold text-paper">Book a meeting</Link>
            </div>
          </section>

          {home.appointments.length > 0 && (
            <section aria-label="Upcoming meetings" className="card flex flex-col gap-2 p-5">
              <span className="eyebrow">Upcoming</span>
              {home.appointments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 text-sm">
                  <span><strong>{fmtDateTime(a.startsAt, tz)}</strong> · {a.mode === 'IN_PERSON' ? 'at the office' : a.mode === 'VIDEO' ? 'video call' : 'phone call'}</span>
                  <CancelAppointment slug={slug} id={a.id} />
                </div>
              ))}
            </section>
          )}

          {home.invoices.length > 0 && (
            <section aria-label="Invoices" className="card flex flex-col p-5">
              <span className="eyebrow mb-2">Invoices & receipts</span>
              {home.invoices.map((inv) => (
                <div key={inv.id} className="flex flex-col gap-1 border-t border-line py-2.5 text-sm first-of-type:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <a href={`/portal/${slug}/files/invoice/${inv.id}`} target="_blank" rel="noreferrer" className="font-semibold underline decoration-ink/30 underline-offset-4">{inv.ref}</a>
                    <span>{formatMoney(inv.amountPaid, inv.currency)} <span className="text-muted">/ {formatMoney(inv.total, inv.currency)}</span></span>
                  </div>
                  {inv.payments.map((pay) => (
                    <a key={pay.id} href={`/portal/${slug}/files/receipt/${pay.id}`} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-4 hover:underline">
                      Receipt {pay.receiptRef} · {formatMoney(pay.amount, inv.currency)}
                    </a>
                  ))}
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </PortalShell>
  );
}
