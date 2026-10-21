import clsx from 'clsx';
import Link from 'next/link';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { fmtDate, fullName } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { listClaims } from '@/server/queries2';
import { ClaimEditor } from './claim-editor';

export const metadata = { title: 'Commission claims' };

const TABS = [
  ['', 'All'],
  ['EXPECTED', 'Expected'],
  ['CLAIMED', 'Claimed'],
  ['RECEIVED', 'Received'],
  ['WRITTEN_OFF', 'Written off'],
] as const;

export default async function CommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { tenant: slug } = await params;
  const { status } = await searchParams;
  const ctx = await getCtx(slug);
  const claims = await listClaims(ctx, status);
  const tz = ctx.tenant.timezone;
  const canManage = can(ctx.role, 'commission.manage');

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/partners`} className="hover:text-ink">Partners</Link> <span className="text-faint">/</span> <span className="text-ink">Commissions</span>
      </nav>
      <PageHeader title="Commission claims" sub="Raised automatically when a student is marked Enrolled. Track them until the institution pays." />
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k ? `?status=${k}` : '?'} className={clsx('rounded-full px-3.5 py-1.5 text-[13px] font-semibold', (status ?? '') === k ? 'bg-ink text-paper' : 'bg-card text-muted shadow-[var(--shadow-card)] hover:text-ink')}>
            {label}
          </Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {claims.length === 0 ? (
          <EmptyState title="No claims here" body="When an application on a study case is marked Enrolled, its commission shows up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Student</th><th className="px-3 py-3">Institution</th><th className="px-3 py-3 text-right">Amount</th><th className="px-3 py-3">Due</th><th className="px-3 py-3">Status</th><th className="px-5 py-3 text-right" />
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => {
                  const late = c.status !== 'RECEIVED' && c.status !== 'WRITTEN_OFF' && c.dueDate && c.dueDate.getTime() < Date.now();
                  return (
                    <tr key={c.id} className="border-t border-line hover:bg-paper-3">
                      <td className="px-5 py-3"><Link href={`/${slug}/cases/${c.application.caseId}`} className="font-bold hover:underline">{fullName(c.application.case.client)}</Link><div className="text-[11px] text-muted">{c.application.course?.name ?? c.application.courseName}{c.application.intake ? ` · ${c.application.intake}` : ''}</div></td>
                      <td className="px-3 py-3"><Link href={`/${slug}/partners/${c.institutionId}`} className="font-medium hover:underline">{c.institution.name}</Link></td>
                      <td className="px-3 py-3 text-right font-bold">
                        {formatMoney(c.amount, c.currency)}
                        {c.status === 'RECEIVED' && c.receivedAmount != null && c.receivedAmount !== c.amount && <div className="text-[11px] font-medium text-warn">received {formatMoney(c.receivedAmount, c.currency)}</div>}
                      </td>
                      <td className={clsx('px-3 py-3', late ? 'font-semibold text-danger' : 'text-ink-2')}>{c.dueDate ? fmtDate(c.dueDate, tz) : '—'}</td>
                      <td className="px-3 py-3">
                        <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-bold', c.status === 'RECEIVED' ? 'bg-ok-bg text-ok' : c.status === 'CLAIMED' ? 'bg-info-bg text-info' : c.status === 'WRITTEN_OFF' ? 'bg-paper-2 text-muted' : 'bg-warn-bg text-warn-ink')}>
                          {c.status.toLowerCase().replace('_', ' ')}
                        </span>
                        {c.invoiceRef && <div className="mt-0.5 text-[11px] text-muted">{c.invoiceRef}</div>}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canManage && <ClaimEditor slug={slug} claim={{ id: c.id, status: c.status, amount: c.amount, currency: c.currency, invoiceRef: c.invoiceRef, receivedAmount: c.receivedAmount, notes: c.notes }} />}
                      </td>
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
