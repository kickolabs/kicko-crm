import clsx from 'clsx';
import Link from 'next/link';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { fmtTime, relative } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { listCheckIns } from '@/server/queries';
import { AutoRefresh, QueueActions, StaffCheckIn } from './queue-actions';

export const metadata = { title: 'Walk-ins' };
export const dynamic = 'force-dynamic';

export default async function WalkInsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  const [rows, team] = await Promise.all([listCheckIns(ctx), getTeam(ctx)]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const tz = ctx.tenant.timezone;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const kiosk = `${base}/f/${slug}/check-in?k=${ctx.tenant.settings.formKey}`;
  const waiting = rows.filter((r) => r.status === 'WAITING');
  const withStaff = rows.filter((r) => r.status === 'WITH_STAFF');
  const done = rows.filter((r) => r.status === 'DONE' || r.status === 'LEFT');

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <AutoRefresh />
      <PageHeader
        title="Walk-ins"
        sub="Today's reception queue. Visitors check in on the office tablet and become leads automatically."
        actions={
          <>
            <a href={kiosk} target="_blank" rel="noreferrer" className="rounded-[11px] px-4 py-2.5 text-sm font-semibold shadow-[inset_0_0_0_1px_var(--color-line-2)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]">
              Open kiosk screen ↗
            </a>
            <StaffCheckIn slug={slug} />
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        {[
          { title: 'Waiting', items: waiting, hot: true },
          { title: 'With a counsellor', items: withStaff },
          { title: 'Done today', items: done },
        ].map((col) => (
          <Card key={col.title} className={clsx(col.hot && col.items.length > 0 && 'shadow-[0_0_0_2px_var(--color-ink)]')}>
            <CardHeader title={col.title} action={<span className={clsx('rounded-full px-2 text-xs font-bold', col.hot && col.items.length ? 'bg-lime' : 'text-muted')}>{col.items.length}</span>} />
            {col.items.length === 0 ? (
              <EmptyState title="Nobody here" />
            ) : (
              <ul className="divide-y divide-line">
                {col.items.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 px-5 py-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold">{r.name}</div>
                        <div className="text-xs text-muted">{r.phone} · {r.purpose}</div>
                      </div>
                      <span className="text-xs font-semibold text-muted" title={fmtTime(r.createdAt, tz)}>{relative(r.createdAt)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.clientId && <Link href={`/${slug}/clients/${r.clientId}`}><Badge tone="ok">Existing client →</Badge></Link>}
                      {r.leadId && !r.clientId && <Link href={`/${slug}/leads/${r.leadId}`}><Badge tone="info">Lead →</Badge></Link>}
                      {r.assignedToId && <span className="text-xs text-muted">with {names[r.assignedToId]}</span>}
                      <span className="ml-auto"><QueueActions slug={slug} id={r.id} status={r.status} /></span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
