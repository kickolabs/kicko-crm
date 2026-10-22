import Link from 'next/link';
import clsx from 'clsx';
import { Card, EmptyState, Input, PageHeader, Select, buttonCls, Badge } from '@/components/ui';
import { CATEGORY_LABEL, CATEGORIES, COUNTRIES, LEAD_SOURCE_LABEL, LEAD_SOURCES, LEAD_STATUS_LABEL, LEAD_STATUS_TONE, LEAD_STATUSES } from '@/lib/constants';
import { fmtDate, fullName } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { listLeads, listProducts, type LeadFilters, listBranches } from '@/server/queries';
import { LeadBoard } from './board';
import { NewLeadButton } from './new-lead-button';

export const metadata = { title: 'Leads' };

export default async function LeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<LeadFilters & { view?: string; new?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  const view = sp.view === 'table' ? 'table' : 'board';
  const [leads, team, products, branches] = await Promise.all([
    listLeads(ctx, view === 'board' ? { ...sp, status: undefined } : sp),
    getTeam(ctx),
    listProducts(ctx),
    listBranches(ctx),
  ]);
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const tz = ctx.tenant.timezone;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, new: undefined, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Leads"
        sub={`${leads.length} shown · drag cards between stages`}
        actions={
          <>
            <div className="flex rounded-[12px] bg-card p-1 shadow-[var(--shadow-card)]" role="tablist" aria-label="View">
              {(['board', 'table'] as const).map((v) => (
                <Link key={v} role="tab" aria-selected={view === v} href={qs({ view: v === 'board' ? undefined : v })} className={clsx('rounded-[9px] px-3 py-1.5 text-[13px] font-semibold capitalize', view === v ? 'bg-ink text-paper' : 'text-muted hover:text-ink')}>
                  {v}
                </Link>
              ))}
            </div>
            {can(ctx.role, 'settings.manage') && (
              <Link href={`/${slug}/import`} className={buttonCls('secondary')}>Import</Link>
            )}
            {can(ctx.role, 'lead.write') && (
              <NewLeadButton
                slug={slug}
                products={products.map(({ id, name, country, category }) => ({ id, name, country, category }))}
                team={team}
                autoAssign={ctx.tenant.settings.leadAssignment === 'round_robin'}
                openInitially={sp.new === '1'}
              />
            )}
          </>
        }
      />

      <form className="flex flex-wrap items-end gap-2.5" role="search">
        {view === 'table' && <input type="hidden" name="view" value="table" />}
        <label className="sr-only" htmlFor="q">Search leads</label>
        <Input name="q" defaultValue={sp.q} placeholder="Name, phone, email or ref" className="w-64" />
        {view === 'table' && (
          <Select name="status" defaultValue={sp.status ?? ''} aria-label="Status" className="w-40">
            <option value="">Any status</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </Select>
        )}
        <Select name="source" defaultValue={sp.source ?? ''} aria-label="Source" className="w-36">
          <option value="">Any source</option>
          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s]}</option>)}
        </Select>
        <Select name="category" defaultValue={sp.category ?? ''} aria-label="Visa type" className="w-36">
          <option value="">Any visa type</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
        <Select name="owner" defaultValue={sp.owner ?? ''} aria-label="Owner" className="w-40">
          <option value="">Anyone</option>
          <option value="me">Mine</option>
          <option value="none">Unassigned</option>
          {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
        </Select>
        {branches.length > 1 && (
          <Select name="branch" defaultValue={sp.branch ?? ''} aria-label="Branch" className="w-40">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="none">No branch</option>
          </Select>
        )}
        <button className={buttonCls('secondary', 'md')}>Filter</button>
        {(sp.q || sp.status || sp.source || sp.owner || sp.category || sp.branch) && (
          <Link href={view === 'table' ? '?view=table' : '?'} className="px-2 text-[13px] font-semibold text-muted hover:text-ink">Clear</Link>
        )}
      </form>

      {view === 'board' ? (
        <LeadBoard
          slug={slug}
          leads={leads
            .filter((l) => l.status !== 'WON' && l.status !== 'LOST')
            .map((l) => ({
              id: l.id,
              ref: l.ref,
              name: fullName(l),
              status: l.status,
              source: l.source,
              product: l.product ? `${COUNTRIES[l.product.country] ?? l.product.country} · ${l.product.name}` : l.interestCategory ? CATEGORY_LABEL[l.interestCategory] : null,
              owner: l.ownerId ? (names[l.ownerId] ?? null) : null,
              createdAt: l.createdAt.toISOString(),
            }))}
        />
      ) : (
        <Card className="overflow-hidden">
          {leads.length === 0 ? (
            <EmptyState title="No leads match" body="Try different filters, or add your first lead." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-bold tracking-wider text-muted uppercase">
                    <th className="px-5 py-3">Lead</th><th className="px-3 py-3">Contact</th><th className="px-3 py-3">Interest</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Source</th><th className="px-3 py-3">Owner</th><th className="px-5 py-3 text-right">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id} className="border-t border-line hover:bg-paper-3">
                      <td className="px-5 py-3"><Link href={`/${slug}/leads/${l.id}`} className="font-bold hover:underline">{fullName(l)}</Link><div className="text-[11px] text-muted">{l.ref}</div></td>
                      <td className="px-3 py-3 text-ink-2">{l.phone ?? l.email ?? '—'}</td>
                      <td className="px-3 py-3 text-ink-2">{l.product ? `${l.product.country} · ${l.product.name}` : l.interestCategory ? CATEGORY_LABEL[l.interestCategory] : '—'}</td>
                      <td className="px-3 py-3"><Badge tone={LEAD_STATUS_TONE[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Badge></td>
                      <td className="px-3 py-3 text-ink-2">{LEAD_SOURCE_LABEL[l.source]}</td>
                      <td className="px-3 py-3 text-ink-2">{l.ownerId ? names[l.ownerId] : <span className="font-semibold text-warn">Unassigned</span>}</td>
                      <td className="px-5 py-3 text-right text-muted">{fmtDate(l.createdAt, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
