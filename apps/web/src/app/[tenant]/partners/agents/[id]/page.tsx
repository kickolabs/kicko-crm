import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader } from '@/components/ui';
import { LEAD_STATUS_LABEL, LEAD_STATUS_TONE } from '@/lib/constants';
import { fmtDate, fmtDateTime, fullName } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { commissionLabel } from '@/server/sub-agents';
import { AgentEditor, CommissionLedger, PartnerAccess } from '../agent-forms';

export const metadata = { title: 'Sub-agent' };

export default async function AgentPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  const agent = await db(ctx, (tx) =>
    tx.subAgent.findUnique({
      where: { id },
      include: {
        leads: { orderBy: { createdAt: 'desc' }, include: { client: true }, take: 200 },
        commissions: { orderBy: { createdAt: 'desc' }, take: 300 },
      },
    }),
  );
  if (!agent) notFound();
  const clients = await db(ctx, (tx) => tx.client.findMany({ where: { id: { in: [...new Set(agent.commissions.map((c) => c.clientId))] } } }));
  const names = new Map(clients.map((c) => [c.id, fullName(c)]));
  const tz = ctx.tenant.timezone;
  const sum = (s: string) => agent.commissions.filter((c) => c.status === s).reduce((x, c) => x + c.amount, 0);

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/partners`} className="hover:text-ink">Partners</Link> <span className="text-faint">/</span>{' '}
        <Link href={`/${slug}/partners/agents`} className="hover:text-ink">Sub-agents</Link> <span className="text-faint">/</span> <span className="text-ink">{agent.ref}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em] sm:text-[40px]">{agent.name}</h1>
          <div className="flex flex-wrap gap-x-2 text-[13px] font-medium text-muted">
            {agent.company && <><span>{agent.company}</span><span>·</span></>}
            <span>{agent.ref}</span><span>·</span><span>{agent.email}</span>
            {agent.phone && <><span>·</span><span>{agent.phone}</span></>}
            {agent.city && <><span>·</span><span>{agent.city}</span></>}
            <span>·</span><span>{commissionLabel(agent)}</span>
            {!agent.active && <Badge>Inactive</Badge>}
          </div>
        </div>
        {can(ctx.role, 'partners.manage') && <AgentEditor slug={slug} agent={agent} />}
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Referrals', String(agent.leads.length)],
          ['Became clients', String(agent.leads.filter((l) => l.clientId).length)],
          ['Commission due', formatMoney(sum('DUE'))],
          ['Commission paid', formatMoney(sum('PAID'))],
        ].map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-[11px] font-bold tracking-wide text-muted uppercase">{k}</div>
            <div className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{v}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Commission" sub="Added automatically when referred clients pay (or sign up, for fixed fees)" />
            <CommissionLedger
              slug={slug}
              agentId={agent.id}
              canPay={can(ctx.role, 'commission.manage')}
              rows={agent.commissions.map((c) => ({
                id: c.id, client: names.get(c.clientId) ?? 'Client', kind: c.kind, basis: c.basis, amount: c.amount, currency: c.currency,
                status: c.status, at: fmtDate(c.createdAt, tz), paidRef: c.paidRef,
              }))}
            />
          </Card>
          <Card>
            <CardHeader title="Referrals" />
            <ul className="divide-y divide-line">
              {agent.leads.length === 0 && <li className="px-5 py-5 text-sm text-muted">No referrals yet.</li>}
              {agent.leads.map((l) => (
                <li key={l.id}>
                  <Link href={l.client ? `/${slug}/clients/${l.client.id}` : `/${slug}/leads/${l.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{fullName(l)}</div>
                      <div className="text-xs text-muted">{l.ref} · {fmtDate(l.createdAt, tz)}</div>
                    </div>
                    <Badge tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {can(ctx.role, 'partners.manage') && (
          <Card>
            <CardHeader title="Partner portal access" />
            <div className="p-5"><PartnerAccess slug={slug} agentId={agent.id} lastSeen={agent.portalLastSeen ? fmtDateTime(agent.portalLastSeen, tz) : null} /></div>
          </Card>
        )}
      </div>
    </div>
  );
}
