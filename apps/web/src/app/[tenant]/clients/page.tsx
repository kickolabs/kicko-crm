import Link from 'next/link';
import { Badge, Card, EmptyState, Input, PageHeader, buttonCls } from '@/components/ui';
import { fmtDate, fullName } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { listClients } from '@/server/queries';

export const metadata = { title: 'Clients' };

export default async function ClientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { tenant: slug } = await params;
  const { q } = await searchParams;
  const ctx = await getCtx(slug);
  const [clients, team] = await Promise.all([listClients(ctx, q), getTeam(ctx)]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const tz = ctx.tenant.timezone;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader title="Clients" sub="Clients are created by converting a lead." />
      <form className="flex gap-2.5" role="search">
        <label className="sr-only" htmlFor="q">Search clients</label>
        <Input name="q" defaultValue={q} placeholder="Name, phone, email, ref or passport no." className="w-80" />
        <button className={buttonCls('secondary', 'md')}>Search</button>
      </form>
      <Card className="overflow-hidden">
        {clients.length === 0 ? (
          <EmptyState
            title={q ? 'No clients match' : 'No clients yet'}
            body={q ? 'Try another search.' : 'Open a lead and press "Convert to client" when they sign up.'}
            action={!q && <Link href={`/${slug}/leads`} className={buttonCls('primary', 'md')}>Go to leads</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Client</th><th className="px-3 py-3">Contact</th><th className="px-3 py-3">Active cases</th><th className="px-3 py-3">Passport</th><th className="px-3 py-3">Owner</th><th className="px-5 py-3 text-right">Since</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const soon = c.passportExpiry && c.passportExpiry.getTime() < Date.now() + 180 * 86400_000;
                  return (
                    <tr key={c.id} className="border-t border-line hover:bg-paper-3">
                      <td className="px-5 py-3"><Link href={`/${slug}/clients/${c.id}`} className="font-bold hover:underline">{fullName(c)}</Link><div className="text-[11px] text-muted">{c.ref}</div></td>
                      <td className="px-3 py-3 text-ink-2">{c.phone ?? c.email ?? '—'}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {c.cases.length === 0 && <span className="text-muted">—</span>}
                          {c.cases.map((k) => <Badge key={k.id} tone="info">{k.product.country} · {k.product.name}</Badge>)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {c.passportExpiry ? <span className={soon ? 'font-semibold text-warn' : 'text-ink-2'}>exp. {fmtDate(c.passportExpiry, 'UTC')}</span> : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-3 text-ink-2">{c.ownerId ? names[c.ownerId] : '—'}</td>
                      <td className="px-5 py-3 text-right text-muted">{fmtDate(c.createdAt, tz)}</td>
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
