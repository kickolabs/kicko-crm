import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { commissionLabel } from '@/server/sub-agents';
import { AgentEditor } from './agent-forms';

export const metadata = { title: 'Sub-agents' };

export default async function AgentsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  const agents = await db(ctx, (tx) =>
    tx.subAgent.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { leads: true, clients: true } }, commissions: { where: { status: { in: ['DUE', 'PAID'] } }, select: { status: true, amount: true } } },
    }),
  );
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/partners`} className="hover:text-ink">Partners</Link> <span className="text-faint">/</span> <span className="text-ink">Sub-agents</span>
      </nav>
      <PageHeader
        title="Sub-agents"
        sub={<>Partner agents who refer clients for a commission. Their portal: <span className="font-mono text-xs">{base}/partner/{slug}</span></>}
        actions={can(ctx.role, 'partners.manage') && <AgentEditor slug={slug} />}
      />
      <Card className="overflow-hidden">
        {agents.length === 0 ? (
          <EmptyState title="No sub-agents yet" body="Add the agents and freelance counsellors who send you clients. They get their own portal to refer clients and track commission." />
        ) : (
          <ul className="divide-y divide-line">
            {agents.map((a) => {
              const sum = (s: string) => a.commissions.filter((c) => c.status === s).reduce((x, c) => x + c.amount, 0);
              return (
                <li key={a.id}>
                  <Link href={`/${slug}/partners/agents/${a.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-paper-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">
                        {a.name}{a.company ? <span className="font-medium text-muted"> · {a.company}</span> : null} {!a.active && <Badge>Inactive</Badge>}
                      </div>
                      <div className="text-xs text-muted">{a.ref}{a.city ? ` · ${a.city}` : ''} · {commissionLabel(a)}</div>
                    </div>
                    <div className="grid grid-cols-4 gap-5 text-right text-xs text-muted">
                      <div><div className="text-base font-extrabold text-ink tabular-nums">{a._count.leads}</div>referrals</div>
                      <div><div className="text-base font-extrabold text-ink tabular-nums">{a._count.clients}</div>clients</div>
                      <div><div className="text-base font-extrabold text-warn tabular-nums">{formatMoney(sum('DUE'), 'INR', { compact: true })}</div>due</div>
                      <div><div className="text-base font-extrabold text-ink tabular-nums">{formatMoney(sum('PAID'), 'INR', { compact: true })}</div>paid</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
