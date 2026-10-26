import clsx from 'clsx';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui';
import { countryName } from '@/lib/countries';
import { fmtDate, fullName, toLocalInput } from '@/lib/format';
import { computeInvoice, formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { resolve } from '@/integrations/core/connections';
import { getInvoice } from '@/server/queries2';
import { InvoiceBadge } from '../invoice-badge';
import { InvoiceActions, RecordPayment } from './invoice-actions';

const METHOD: Record<string, string> = {
  UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', RAZORPAY: 'Razorpay', OTHER: 'Other',
};

export default async function InvoicePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'billing.read')) notFound();
  const inv = await getInvoice(ctx, id);
  if (!inv) notFound();
  const tz = ctx.tenant.timezone;
  const totals = computeInvoice(inv.items, inv.taxMode);
  const balance = inv.total - inv.amountPaid;
  const writable = can(ctx.role, 'billing.write');
  const collectable = writable && (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID');
  const now = Date.now();
  const overdue = inv.installments.some((i) => i.paidAmount < i.amount && i.dueDate.getTime() < now);
  const pdf = `/api/t/${slug}/billing/invoices/${inv.id}/pdf`;
  const gateway = await resolve(ctx.tenant.id, slug, 'payments');

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/billing`} className="hover:text-ink">Billing</Link> <span className="text-faint">/</span> <span className="text-ink">{inv.ref}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em] sm:text-[40px]">{inv.ref}</h1>
            <InvoiceBadge status={inv.status} overdue={overdue} />
          </div>
          <div className="flex flex-wrap gap-x-2 text-[13px] font-medium text-muted">
            <Link href={`/${slug}/clients/${inv.clientId}`} className="font-semibold text-ink hover:underline">{fullName(inv.client)}</Link>
            {inv.case && <><span>·</span><Link href={`/${slug}/cases/${inv.case.id}`} className="hover:text-ink">{inv.case.ref} · {countryName(inv.case.product.country)} {inv.case.product.name}</Link></>}
            <span>·</span><span>{fmtDate(inv.issueDate, tz)}</span>
          </div>
        </div>
        <InvoiceActions
          slug={slug}
          invoiceId={inv.id}
          status={inv.status}
          pdfUrl={pdf}
          canWrite={writable}
          canVoid={inv.amountPaid === 0}
          gateway={gateway ? { name: gateway.descriptor.name, notifies: Boolean(gateway.descriptor.features.notifiesCustomer) } : null}
          openLink={inv.links.find((l) => l.status === 'created')?.url ?? null}
        />
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="overflow-hidden">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-paper-3 text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Item</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3 text-right">Rate</th><th className="px-3 py-3 text-right">GST</th><th className="px-5 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((it) => (
                  <tr key={it.id} className="border-t border-line">
                    <td className="px-5 py-3 font-medium">{it.description}</td>
                    <td className="px-3 py-3 text-right">{it.quantity}</td>
                    <td className="px-3 py-3 text-right">{formatMoney(it.unitPrice)}</td>
                    <td className="px-3 py-3 text-right text-muted">{inv.taxMode === 'NONE' ? '—' : `${it.taxRate / 100}%`}</td>
                    <td className="px-5 py-3 text-right font-bold">{formatMoney(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ml-auto flex w-full max-w-xs flex-col gap-1.5 border-t border-line px-5 py-4 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(totals.subtotal)}</dd></div>
              {inv.taxMode === 'GST_INTRA' && <><div className="flex justify-between"><dt className="text-muted">CGST</dt><dd>{formatMoney(totals.cgst)}</dd></div><div className="flex justify-between"><dt className="text-muted">SGST</dt><dd>{formatMoney(totals.sgst)}</dd></div></>}
              {inv.taxMode === 'GST_INTER' && <div className="flex justify-between"><dt className="text-muted">IGST</dt><dd>{formatMoney(totals.igst)}</dd></div>}
              <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-extrabold"><dt>Total</dt><dd>{formatMoney(inv.total)}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Payments" sub={inv.payments.length ? `${inv.payments.length} received` : undefined} />
            <ul className="divide-y divide-line">
              {inv.payments.length === 0 && <li className="px-5 py-5 text-sm text-muted">No payments yet.</li>}
              {inv.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{formatMoney(p.amount)} <span className="font-medium text-muted">· {METHOD[p.method]}</span></div>
                    <div className="text-xs text-muted">{fmtDate(p.paidAt, tz)} · {p.receiptRef}{p.reference ? ` · ${p.reference}` : ''}</div>
                  </div>
                  <a href={`/api/t/${slug}/billing/payments/${p.id}/receipt`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline decoration-ink/30 underline-offset-4 hover:decoration-ink">Receipt PDF</a>
                </li>
              ))}
            </ul>
          </Card>
          {inv.notes && <Card className="p-5"><span className="eyebrow">Notes</span><p className="mt-1 text-sm whitespace-pre-line text-ink-2">{inv.notes}</p></Card>}
        </div>

        <aside className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-card)] bg-ink p-5 text-paper">
            <span className="text-[11px] font-bold tracking-wider text-[#A9AFB7] uppercase">Balance due</span>
            <div className={clsx('mt-1 text-[36px] leading-none font-extrabold tracking-[-0.04em]', balance > 0 ? 'text-lime' : 'text-paper')}>{formatMoney(balance)}</div>
            <div className="mt-3 h-2 rounded-full bg-white/10"><div className="h-2 rounded-full bg-lime" style={{ width: `${inv.total ? (inv.amountPaid / inv.total) * 100 : 0}%` }} /></div>
            <div className="mt-2 text-xs text-[#A9AFB7]">{formatMoney(inv.amountPaid)} of {formatMoney(inv.total)} received</div>
            {collectable && balance > 0 && <div className="mt-4"><RecordPayment slug={slug} invoiceId={inv.id} balance={balance} today={toLocalInput(new Date(), tz, true)} /></div>}
          </section>
          <Card>
            <CardHeader title="Schedule" />
            <ol className="flex flex-col gap-0 px-5 py-3">
              {inv.installments.map((s) => {
                const paid = s.paidAmount >= s.amount;
                const late = !paid && s.dueDate.getTime() < now && inv.status !== 'VOID';
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <span className={clsx('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', paid ? 'bg-lime text-ink' : late ? 'bg-danger-bg text-danger' : 'bg-paper-2 text-muted')}>{paid ? '✓' : '•'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{s.label}</div>
                      <div className={clsx('text-xs', late ? 'font-semibold text-danger' : 'text-muted')}>
                        {paid ? `Paid ${s.paidAt ? fmtDate(s.paidAt, tz) : ''}` : `${late ? 'Overdue · was due' : 'Due'} ${fmtDate(s.dueDate, tz)}`}
                        {!paid && s.paidAmount > 0 && ` · ${formatMoney(s.paidAmount)} paid`}
                      </div>
                    </div>
                    <span className="text-sm font-bold">{formatMoney(s.amount)}</span>
                  </li>
                );
              })}
            </ol>
          </Card>
          {inv.links.length > 0 && (
            <Card>
              <CardHeader title="Payment links" />
              <ul className="divide-y divide-line px-5">
                {inv.links.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                    <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold underline underline-offset-4">{l.url.replace(/^https?:\/\//, '')}</a>
                    <span className="text-muted">{formatMoney(l.amount)} · {l.status}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
