import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { countryName } from '@/lib/countries';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { packForm, tenantPack } from '@/server/library';
import { scopeOf } from '@/server/scope';
import { NewOrganizationButton } from './new-organization-button';

export const metadata = { title: 'Employers' };

export default async function OrganizationsPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ q?: string }> }) {
  const { tenant: slug } = await params;
  const { q } = await searchParams;
  const ctx = await getCtx(slug);
  const scope = scopeOf(ctx);
  const { pack } = await tenantPack(scope);
  const word = pack.labels.organization ?? 'Organisation';
  const words = pack.labels.organizations ?? 'Organisations';
  const openingsWord = (pack.labels.openings ?? 'Openings').toLowerCase();
  const [orgs, form] = await Promise.all([
    db(ctx, (tx) =>
      tx.organization.findMany({
        where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
        include: { openings: { select: { status: true, _count: { select: { candidates: true } } } } },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
      }),
    ),
    packForm(scope, 'leads'),
  ]);
  const countries = form.regionType ? (form.lookups[form.regionType] ?? []) : [];
  const canWrite = can(ctx.role, 'organization.write');

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title={words}
        sub={`Who you place applicants with, their ${openingsWord} and shortlists`}
        actions={canWrite && <NewOrganizationButton slug={slug} countries={countries} word={word} />}
      />
      <form className="flex gap-2.5" role="search">
        <input name="q" defaultValue={q ?? ''} placeholder={`Search ${words.toLowerCase()}`} aria-label={`Search ${words.toLowerCase()}`} className="h-10 w-full max-w-sm rounded-[12px] bg-card px-3 text-sm shadow-[inset_0_0_0_1px_var(--color-line-2)]" />
      </form>
      {orgs.length === 0 ? (
        <Card><EmptyState title={`No ${words.toLowerCase()} yet`} body={`Add the ${words.toLowerCase()} you recruit for, then their ${openingsWord}, and shortlist applicants who fit.`} /></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {orgs.map((o) => {
              const open = o.openings.filter((x) => x.status === 'open').length;
              const people = o.openings.reduce((n, x) => n + x._count.candidates, 0);
              return (
                <li key={o.id}>
                  <Link href={`/${slug}/organizations/${o.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-paper-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{o.name}</span>
                      <span className="text-xs text-muted">{[o.industry, [o.city, o.country && countryName(o.country)].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    <span className="text-xs text-muted">{open} open {openingsWord} · {people} candidates</span>
                    {!o.active && <Badge>Inactive</Badge>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
