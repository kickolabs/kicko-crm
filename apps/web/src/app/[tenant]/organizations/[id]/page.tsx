import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { countryName } from '@/lib/countries';
import { QUALIFICATIONS } from '@/lib/matching';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { packForm, tenantPack } from '@/server/library';
import type { OpeningData } from '@/server/organizations';
import { listProducts } from '@/server/queries';
import { scopeOf } from '@/server/scope';
import { NewOpeningButton } from '../new-organization-button';
import { OrganizationForm, type OrgValues } from '../org-forms';

const STATUS_TONE = { open: 'ok', on_hold: 'warn', filled: 'info', closed: 'neutral' } as const;

export default async function OrganizationPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  const scope = scopeOf(ctx);
  const org = await db(ctx, (tx) =>
    tx.organization.findUnique({ where: { id }, include: { openings: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { candidates: true } } } } } }),
  );
  if (!org) notFound();
  const [{ pack }, form, products] = await Promise.all([tenantPack(scope), packForm(scope, 'clients'), listProducts(ctx)]);
  const word = pack.labels.organization ?? 'Organisation';
  const words = pack.labels.organizations ?? 'Organisations';
  const openingWord = pack.labels.opening ?? 'Opening';
  const countries = form.regionType ? (form.lookups[form.regionType] ?? []) : [];
  const occupations = (form.lookups.occupation ?? []).map((o) => ({ ...o, group: o.group ? (form.groupLabels.occupation?.[o.group] ?? o.group) : undefined }));
  const occName = new Map(occupations.map((o) => [o.key, o.name]));
  const canWrite = can(ctx.role, 'organization.write');
  const productOpts = products.map((p) => ({ id: p.id, label: `${countryName(p.country)} · ${p.name}`, country: p.country }));

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/organizations`} className="hover:text-ink">{words}</Link> <span className="text-faint">/</span> <span className="text-ink">{org.name}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em]">{org.name}</h1>
          <p className="mt-2 text-sm text-muted">{[org.industry, [org.city, org.country && countryName(org.country)].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
        </div>
        {canWrite && (
          <NewOpeningButton slug={slug} organizationId={org.id} countries={countries} occupations={occupations} products={productOpts} qualifications={QUALIFICATIONS} word={openingWord} />
        )}
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card>
          <CardHeader title={pack.labels.openings ?? 'Openings'} />
          {org.openings.length === 0 ? (
            <EmptyState title={`No ${(pack.labels.openings ?? 'openings').toLowerCase()} yet`} body="Add the roles this employer is hiring for, then shortlist applicants who fit." />
          ) : (
            <ul className="divide-y divide-line">
              {org.openings.map((o) => {
                const d = o.data as OpeningData;
                return (
                  <li key={o.id}>
                    <Link href={`/${slug}/organizations/openings/${o.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-paper-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{o.title}</span>
                        <span className="text-xs text-muted">
                          {[d.occupation && occName.get(d.occupation), d.country && countryName(d.country), d.positions && `${d.positions} positions`, d.salaryMin && `${d.currency ?? ''} ${d.salaryMin.toLocaleString('en-IN')}${d.salaryMax ? `–${d.salaryMax.toLocaleString('en-IN')}` : ''}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="text-xs text-muted">{o._count.candidates} candidates</span>
                      <Badge tone={STATUS_TONE[o.status as keyof typeof STATUS_TONE] ?? 'neutral'}>{o.status.replace('_', ' ')}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="self-start p-5">
          <h2 className="mb-4 text-base font-bold">{word} details</h2>
          {canWrite ? (
            <OrganizationForm slug={slug} org={{ ...(org as unknown as OrgValues), id: org.id }} countries={countries} word={word} />
          ) : (
            <p className="text-sm text-muted">{org.notes ?? '—'}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
