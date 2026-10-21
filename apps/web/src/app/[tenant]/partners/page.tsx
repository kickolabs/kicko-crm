import Link from 'next/link';
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat } from '@/components/ui';
import { COUNTRIES } from '@/lib/constants';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { listClaims, listInstitutions } from '@/server/queries2';

export const metadata = { title: 'Partners' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default async function PartnersPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await getCtx(slug);
  const [institutions, claims] = await Promise.all([listInstitutions(ctx, { includeInactive: true }), listClaims(ctx)]);
  const byCountry = new Map<string, typeof institutions>();
  for (const i of institutions) byCountry.set(i.country, [...(byCountry.get(i.country) ?? []), i]);

  // Commission totals per currency (no FX conversion; institutions pay in their own currency).
  const totals = new Map<string, { expected: number; claimed: number; received: number }>();
  for (const c of claims) {
    const t = totals.get(c.currency) ?? { expected: 0, claimed: 0, received: 0 };
    if (c.status === 'EXPECTED') t.expected += c.amount;
    if (c.status === 'CLAIMED') t.claimed += c.amount;
    if (c.status === 'RECEIVED') t.received += c.receivedAmount ?? c.amount;
    totals.set(c.currency, t);
  }
  const sum = (k: 'expected' | 'claimed' | 'received') =>
    [...totals.entries()].filter(([, t]) => t[k]).map(([cur, t]) => formatMoney(t[k], cur)).join(' + ') || '—';

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Partners"
        sub="Institutions you represent, their courses and commission agreements"
        actions={
          <>
            <LinkButton href={`/${slug}/partners/commissions`}>Commission claims</LinkButton>
            {can(ctx.role, 'partners.manage') && <LinkButton href={`/${slug}/partners/new`} variant="primary">+ Institution</LinkButton>}
          </>
        }
      />
      <section className="card grid grid-cols-1 sm:grid-cols-3 [&>*:not(:last-child)]:border-r [&>*]:border-line">
        <Stat label="Expected (enrolled)" value={<span className="text-xl">{sum('expected')}</span>} />
        <Stat label="Claimed, awaiting payment" value={<span className="text-xl">{sum('claimed')}</span>} />
        <Stat label="Received" value={<span className="text-xl">{sum('received')}</span>} subTone="ok" />
      </section>

      {institutions.length === 0 ? (
        <Card><EmptyState title="No partner institutions yet" body="Add the universities and colleges you work with to track applications and commissions." action={can(ctx.role, 'partners.manage') && <LinkButton href={`/${slug}/partners/new`} variant="primary">Add institution</LinkButton>} /></Card>
      ) : (
        [...byCountry.entries()].map(([country, list]) => (
          <Card key={country}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="text-sm font-bold">{COUNTRIES[country] ?? country}</h2>
              <span className="text-xs font-semibold text-muted">{list.length}</span>
            </div>
            <ul className="divide-y divide-line">
              {list.map((i) => {
                const expiring = i.agreementUntil && i.agreementUntil.getTime() < Date.now() + 60 * 86400_000;
                return (
                  <li key={i.id}>
                    <Link href={`/${slug}/partners/${i.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-paper-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{i.name}</div>
                        <div className="text-xs text-muted">{[i.city, plural(i.courses.length, 'course'), plural(i._count.applications, 'application')].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className="text-sm font-semibold">
                        {i.commissionType === 'PERCENT' ? `${i.commissionValue / 100}%` : formatMoney(i.commissionValue, i.currency)}
                        <span className="ml-1 text-xs font-medium text-muted">{i.commissionBasis}</span>
                      </span>
                      {expiring && <Badge tone="warn">Agreement {i.agreementUntil! < new Date() ? 'expired' : 'expiring'}</Badge>}
                      {!i.active && <Badge>Inactive</Badge>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
