import clsx from 'clsx';
import Link from 'next/link';
import { Card, CardHeader, EmptyState, Input, LinkButton, PageHeader, Select, Stat, buttonCls } from '@/components/ui';
import { fmtDate, fullName } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { getBillingSummary, listInvoices, type InvoiceFilters } from '@/server/queries2';
import { InvoiceBadge } from './invoice-badge';

export const metadata = { title: 'Billing' };

const METHOD_LABEL: Record<string, string> = {
  UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', RAZORPAY: 'Razorpay', OTHER: 'Other',
};

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<InvoiceFilters>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'billing.read')) return <Card><EmptyState title="Billing is restricted" body="Ask an owner, admin or accounts user." /></Card>;
  const [summary, invoices] = await Promise.all([getBillingSummary(ctx), listInvoices(ctx, sp)]);
  const tz = ctx.tenant.timezone;
  const max = Math.max(1, ...summary.months.map((m) => m.total));
  const change = summary.lastMonth ? Math.round(((summary.thisMonth - summary.lastMonth) / summary.lastMonth) * 100) : null;
  const methodTotal = summary.byMethod.reduce((a, [, v]) => a + v, 0);
  const now = Date.now();

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Billing"
        sub="Invoices, installments and payments"
        actions={
          <>
            <LinkButton href={`/${slug}/partners/commissions`}>Commissions</LinkButton>
            {can(ctx.role, 'billing.write') && <LinkButton href={`/${slug}/billing/new`} variant="primary">+ New invoice</LinkButton>}
          </>
        }
      />

      <section aria-label="Revenue" className="card grid grid-cols-2 lg:grid-cols-4 [&>*:not(:last-child)]:border-r [&>*]:border-line">
        <Stat label="Collected this month" value={formatMoney(summary.thisMonth, 'INR', { compact: true })} sub={change === null ? undefined : `${change >= 0 ? '+' : ''}${change}% vs last month`} subTone={change !== null && change >= 0 ? 'ok' : undefined} />
        <Stat label="Outstanding" value={formatMoney(summary.outstanding, 'INR', { compact: true })} sub="on issued invoices" />
        <Stat label="Overdue" value={formatMoney(summary.overdue, 'INR', { compact: true })} sub={summary.overdue ? 'past due date' : 'nothing overdue'} subTone={summary.overdue ? 'warn' : 'ok'} />
        <Stat label="Last 12 months" value={formatMoney(summary.months.reduce((a, m) => a + m.total, 0), 'INR', { compact: true })} />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Collections" sub="Payments received per month" />
          <div className="flex h-56 items-end gap-2 px-5 pt-6 pb-4" role="img" aria-label="Monthly collections bar chart">
            {summary.months.map((m, i) => {
              const last = i === summary.months.length - 1;
              return (
                <div key={m.key} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[10px] font-bold text-muted opacity-0 transition-opacity group-hover:opacity-100">{m.total ? formatMoney(m.total, 'INR', { compact: true }) : ''}</span>
                  <div
                    className={clsx('w-full rounded-t-[6px]', last ? 'bg-lime shadow-[inset_0_0_0_1px_rgb(18_20_23/0.3)]' : 'bg-ink/80')}
                    style={{ height: `${Math.max(m.total ? 4 : 1, (m.total / max) * 100)}%` }}
                    title={`${m.label}: ${formatMoney(m.total)}`}
                  />
                  <span className={clsx('text-[11px]', last ? 'font-bold' : 'text-muted')}>{m.label}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHeader title="By payment method" sub="Last 12 months" />
          <ul className="flex flex-col gap-3 px-5 py-4">
            {summary.byMethod.length === 0 && <li className="text-sm text-muted">No payments yet.</li>}
            {summary.byMethod.map(([m, v]) => (
              <li key={m} className="flex flex-col gap-1 text-[13px]">
                <div className="flex justify-between"><span className="font-semibold">{METHOD_LABEL[m] ?? m}</span><span>{formatMoney(v, 'INR', { compact: true })}</span></div>
                <div className="h-2 rounded-full bg-paper-2"><div className="h-2 rounded-full bg-ink" style={{ width: `${(v / methodTotal) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <form className="flex flex-wrap items-end gap-2.5" role="search">
        <label className="sr-only" htmlFor="q">Search invoices</label>
        <Input name="q" defaultValue={sp.q} placeholder="Invoice no. or client" className="w-60" />
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className="w-40">
          <option value="">Any status</option>
          <option value="ISSUED">Unpaid</option>
          <option value="PARTIALLY_PAID">Part paid</option>
          <option value="PAID">Paid</option>
          <option value="DRAFT">Draft</option>
          <option value="VOID">Void</option>
        </Select>
        <label className="flex h-10 items-center gap-2 rounded-[11px] bg-card px-3 text-sm font-semibold shadow-[inset_0_0_0_1px_var(--color-line-2)]">
          <input type="checkbox" name="overdue" value="1" defaultChecked={Boolean(sp.overdue)} className="h-4 w-4 accent-[#121417]" /> Overdue only
        </label>
        <button className={buttonCls('secondary', 'md')}>Filter</button>
      </form>

      <Card className="overflow-hidden">
        {invoices.length === 0 ? (
          <EmptyState title="No invoices" body="Raise an invoice from a client or case, or start from a service package." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Invoice</th><th className="px-3 py-3">Client</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Next due</th><th className="px-3 py-3 text-right">Paid / total</th><th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const next = inv.installments.filter((i) => i.paidAmount < i.amount).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
                  const overdue = Boolean(next && next.dueDate.getTime() < now && inv.status !== 'VOID' && inv.status !== 'DRAFT');
                  return (
                    <tr key={inv.id} className="border-t border-line hover:bg-paper-3">
                      <td className="px-5 py-3"><Link href={`/${slug}/billing/${inv.id}`} className="font-bold hover:underline">{inv.ref}</Link>{inv.case && <div className="text-[11px] text-muted">{inv.case.ref}</div>}</td>
                      <td className="px-3 py-3"><Link href={`/${slug}/clients/${inv.clientId}`} className="font-medium hover:underline">{fullName(inv.client)}</Link></td>
                      <td className="px-3 py-3 text-ink-2">{fmtDate(inv.issueDate, tz)}</td>
                      <td className={clsx('px-3 py-3', overdue ? 'font-semibold text-danger' : 'text-ink-2')}>
                        {next && inv.status !== 'VOID' ? `${formatMoney(next.amount - next.paidAmount)} · ${fmtDate(next.dueDate, tz, { year: undefined })}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right"><span className="font-bold">{formatMoney(inv.amountPaid)}</span> <span className="text-muted">/ {formatMoney(inv.total)}</span></td>
                      <td className="px-5 py-3 text-right"><InvoiceBadge status={inv.status} overdue={overdue} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
