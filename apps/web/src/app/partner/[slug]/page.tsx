import clsx from 'clsx';
import { LogoMark } from '@/components/logo';
import { Badge, Card, CardHeader } from '@/components/ui';
import { CATEGORY_LABEL, COUNTRIES } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { getPartnerHome } from '@/server/partner';
import { requirePartner } from '@/server/partner-auth';
import { commissionLabel } from '@/server/sub-agents';
import { partnerLogoutAction } from './actions';
import { ReferralForm } from './referral-form';

export const metadata = { title: 'Partner portal', robots: { index: false } };

export default async function PartnerHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await requirePartner(slug);
  const home = await getPartnerHome(p);
  const tz = p.scope.timezone;

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-paper-2">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <LogoMark size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-extrabold">{p.tenantName}</div>
            <div className="text-[11px] font-semibold text-muted">Partner portal · {p.agent.name}{p.agent.company ? `, ${p.agent.company}` : ''} · {p.agent.ref}</div>
          </div>
          <form action={partnerLogoutAction.bind(null, slug)}>
            <button type="submit" className="text-[13px] font-semibold text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
        <section aria-label="Summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Referrals', String(home.totals.referrals)],
            ['Became clients', String(home.totals.converted)],
            ['Commission due', formatMoney(home.totals.due)],
            ['Commission paid', formatMoney(home.totals.paid)],
          ].map(([k, v], i) => (
            <div key={k} className={clsx('rounded-[var(--radius-card)] p-4', i === 2 ? 'bg-ink text-paper' : 'card')}>
              <div className={clsx('text-[11px] font-bold tracking-wide uppercase', i === 2 ? 'text-paper/60' : 'text-muted')}>{k}</div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{v}</div>
            </div>
          ))}
        </section>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader title="My referrals" sub="Progress only. The agency keeps client documents and conversations private." />
            <ul className="divide-y divide-line">
              {home.referrals.length === 0 && <li className="px-5 py-6 text-sm text-muted">No referrals yet. Use the form to refer your first client.</li>}
              {home.referrals.map((r) => (
                <li key={r.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{r.name} <span className="text-xs font-medium text-muted">{r.ref} · {fmtDate(r.createdAt, tz)}</span></div>
                    {r.interest && <div className="text-xs text-muted">{r.interest}</div>}
                    {r.stage && <div className="mt-0.5 text-[13px] text-ink-2">{r.stage}</div>}
                  </div>
                  <Badge tone={r.converted ? 'ok' : r.status === 'Lost' ? 'danger' : 'info'}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Refer a client" />
              <div className="p-5">
                <ReferralForm slug={slug} countries={Object.entries(COUNTRIES)} categories={Object.entries(CATEGORY_LABEL)} />
              </div>
            </Card>
            <Card>
              <CardHeader title="My commission" sub={`Your rate: ${commissionLabel(p.agent)}`} />
              <ul className="divide-y divide-line">
                {home.commissions.length === 0 && <li className="px-5 py-5 text-sm text-muted">Commission appears here as your clients pay.</li>}
                {home.commissions.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{c.clientName}</div>
                      <div className="text-xs text-muted">
                        {c.kind === 'REFERRAL_FEE' ? 'Referral fee' : `Share of a ${formatMoney(c.basis, c.currency)} payment`} · {fmtDate(c.createdAt, tz)}
                        {c.status === 'PAID' && c.paidRef ? ` · paid ${c.paidAt ? fmtDate(c.paidAt, tz) : ''} (${c.paidRef})` : ''}
                      </div>
                    </div>
                    <span className="font-bold tabular-nums">{formatMoney(c.amount, c.currency)}</span>
                    <Badge tone={c.status === 'PAID' ? 'ok' : 'warn'}>{c.status === 'PAID' ? 'Paid' : 'Due'}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
