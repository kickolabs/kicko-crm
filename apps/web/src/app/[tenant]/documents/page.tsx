import clsx from 'clsx';
import Link from 'next/link';
import { Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { fmtDate, fullName, relative } from '@/lib/format';
import { db, getCtx } from '@/lib/tenant';
import { getDocumentQueue } from '@/server/queries2';

export const metadata = { title: 'Documents' };

export default async function DocumentsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  const in60 = new Date(Date.now() + 60 * 86400_000);
  const [queue, expiring, rejected] = await Promise.all([
    getDocumentQueue(ctx),
    db(ctx, (tx) =>
      tx.document.findMany({
        where: { expiresAt: { lt: in60 }, status: { in: ['VERIFIED', 'UPLOADED'] }, case: { status: { not: 'CLOSED' } } },
        orderBy: { expiresAt: 'asc' },
        take: 50,
        include: { case: true, client: true },
      }),
    ),
    db(ctx, (tx) =>
      tx.document.findMany({
        where: { status: 'REJECTED', case: { status: { not: 'CLOSED' } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: { case: true, client: true },
      }),
    ),
  ]);

  const Row = ({ d, right, tone }: { d: (typeof queue)[number]; right: React.ReactNode; tone?: 'danger' | 'warn' }) => (
    <li>
      <Link href={`/${slug}/cases/${d.caseId}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{d.name}</div>
          <div className="text-xs text-muted">{fullName(d.client)} · {d.case.ref}</div>
        </div>
        <span className={clsx('text-xs font-semibold', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-muted')}>{right}</span>
      </Link>
    </li>
  );

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <PageHeader title="Documents" sub="Uploads waiting for review, rejections, and anything expiring soon" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="To review" sub={`${queue.length} uploaded, oldest first`} />
          {queue.length === 0 ? (
            <EmptyState title="All caught up" body="New uploads appear here for verification." />
          ) : (
            <ul className="divide-y divide-line">{queue.map((d) => <Row key={d.id} d={d} right={`uploaded ${relative(d.updatedAt)}`} />)}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Expiring within 60 days" />
          <ul className="divide-y divide-line">
            {expiring.length === 0 && <li className="px-5 py-5 text-sm text-muted">Nothing expiring.</li>}
            {expiring.map((d) => {
              const past = d.expiresAt! < new Date();
              return <Row key={d.id} d={d} right={`${past ? 'expired' : 'expires'} ${fmtDate(d.expiresAt, 'UTC')}`} tone={past ? 'danger' : 'warn'} />;
            })}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Rejected, waiting for the client" />
          <ul className="divide-y divide-line">
            {rejected.length === 0 && <li className="px-5 py-5 text-sm text-muted">No rejections pending.</li>}
            {rejected.map((d) => <Row key={d.id} d={d} right={d.rejectionReason ?? 'rejected'} tone="warn" />)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
