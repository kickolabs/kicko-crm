import clsx from 'clsx';
import Link from 'next/link';
import { Badge, Card, EmptyState, Input, PageHeader, Select, buttonCls } from '@/components/ui';
import { CATEGORY_LABEL, CATEGORIES, COUNTRIES } from '@/lib/constants';
import { fullName, relative } from '@/lib/format';
import { getCtx, getTeam } from '@/lib/tenant';
import { stagesOf } from '@/server/cases';
import { listCases, listProducts, type CaseFilters, listBranches } from '@/server/queries';

export const metadata = { title: 'Cases' };

export default async function CasesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<CaseFilters>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  const [cases, team, products, branches] = await Promise.all([listCases(ctx, sp), getTeam(ctx), listProducts(ctx), listBranches(ctx)]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));

  const phase = ({ preparing: 'Preparing: not yet lodged', lodged: 'Lodged: waiting for a decision', decided: 'Decided in the last 90 days' } as Record<string, string>)[sp.phase ?? ''];
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader title="Cases" sub={`${cases.length} shown · open a case from a client's profile`} />
      {phase && (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="info">{phase}</Badge>
          <Link href={`/${slug}/cases`} className="font-semibold text-muted hover:text-ink">Show all cases</Link>
        </p>
      )}
      <form className="flex flex-wrap items-end gap-2.5" role="search">
        {sp.phase && <input type="hidden" name="phase" value={sp.phase} />}
        <label className="sr-only" htmlFor="q">Search cases</label>
        <Input name="q" defaultValue={sp.q} placeholder="Client name or case ref" className="w-60" />
        <Select name="category" defaultValue={sp.category ?? ''} aria-label="Visa type" className="w-36">
          <option value="">Any visa type</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
        <Select name="product" defaultValue={sp.product ?? ''} aria-label="Product" className="w-56">
          <option value="">Any product</option>
          {products.map((p) => <option key={p.id} value={p.id}>{COUNTRIES[p.country] ?? p.country} · {p.name}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className="w-36">
          <option value="">Active</option>
          <option value="OPEN">Open</option>
          <option value="ON_HOLD">On hold</option>
          <option value="CLOSED">Closed</option>
          <option value="ALL">All</option>
        </Select>
        <Select name="owner" defaultValue={sp.owner ?? ''} aria-label="Owner" className="w-32">
          <option value="">Anyone</option>
          <option value="me">Mine</option>
        </Select>
        {branches.length > 1 && (
          <Select name="branch" defaultValue={sp.branch ?? ''} aria-label="Branch" className="w-40">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="none">No branch</option>
          </Select>
        )}
        <button className={buttonCls('secondary', 'md')}>Filter</button>
      </form>

      <Card className="overflow-hidden">
        {cases.length === 0 ? (
          <EmptyState title="No cases here" body="Convert a lead with a visa product, or open a case from a client profile." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                  <th className="px-5 py-3">Client</th><th className="px-3 py-3">Corridor</th><th className="px-3 py-3">Stage</th><th className="px-3 py-3">Progress</th><th className="px-3 py-3">In stage</th><th className="px-5 py-3">Owner</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const stages = stagesOf(c.product);
                  const idx = stages.findIndex((s) => s.key === c.stageKey);
                  const days = Math.floor((Date.now() - c.stageSince.getTime()) / 86400_000);
                  return (
                    <tr key={c.id} className="border-t border-line hover:bg-paper-3">
                      <td className="px-5 py-3"><Link href={`/${slug}/cases/${c.id}`} className="font-bold hover:underline">{fullName(c.client)}</Link><div className="text-[11px] text-muted">{c.ref}</div></td>
                      <td className="px-3 py-3 font-medium">{c.product.country} · {c.product.name}</td>
                      <td className="px-3 py-3">
                        {c.status === 'OPEN' ? <Badge tone={idx === stages.length - 1 ? 'lime' : 'info'}>{stages[idx]?.name ?? c.stageKey}</Badge>
                          : c.status === 'ON_HOLD' ? <Badge tone="warn">On hold</Badge>
                          : <Badge tone={c.outcome === 'APPROVED' ? 'ok' : c.outcome === 'REFUSED' ? 'danger' : 'neutral'}>{(c.outcome ?? 'closed').toLowerCase()}</Badge>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex w-36 gap-0.5" aria-label={`Stage ${idx + 1} of ${stages.length}`}>
                          {stages.map((s, i) => <span key={s.key} className={clsx('h-1.5 flex-1 rounded-full', i < idx ? 'bg-ink' : i === idx ? 'bg-lime ring-1 ring-ink' : 'bg-paper-2')} />)}
                        </div>
                      </td>
                      <td className={clsx('px-3 py-3', days >= 14 && c.status === 'OPEN' ? 'font-semibold text-warn' : 'text-ink-2')}>{relative(c.stageSince).replace(' ago', '')}</td>
                      <td className="px-5 py-3 text-ink-2">{c.ownerId ? names[c.ownerId] : '—'}</td>
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
