import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { countryName } from '@/lib/countries';
import { fullName } from '@/lib/format';
import { QUALIFICATIONS } from '@/lib/matching';
import { can } from '@/lib/permissions';
import { db, getCtx } from '@/lib/tenant';
import { packForm, tenantPack } from '@/server/library';
import { suggestCandidates, type OpeningData } from '@/server/organizations';
import { listProducts } from '@/server/queries';
import { scopeOf } from '@/server/scope';
import { CandidateStage, OpeningForm, ShortlistButton, STAGE_LABEL, type OpeningValues } from '../../org-forms';

export default async function OpeningPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  const scope = scopeOf(ctx);
  const opening = await db(ctx, (tx) =>
    tx.opening.findUnique({
      where: { id },
      include: { organization: true, candidates: { include: { client: { select: { id: true, ref: true, firstName: true, lastName: true } } }, orderBy: [{ score: 'desc' }] } },
    }),
  );
  if (!opening) notFound();
  const canWrite = can(ctx.role, 'organization.write');
  const [{ pack }, form, products, suggestions] = await Promise.all([
    tenantPack(scope),
    packForm(scope, 'clients'),
    listProducts(ctx),
    canWrite && opening.status === 'open' ? suggestCandidates(scope, opening.id) : Promise.resolve([]),
  ]);
  const d = opening.data as OpeningData;
  const words = pack.labels.organizations ?? 'Organisations';
  const countries = form.regionType ? (form.lookups[form.regionType] ?? []) : [];
  const occupations = (form.lookups.occupation ?? []).map((o) => ({ ...o, group: o.group ? (form.groupLabels.occupation?.[o.group] ?? o.group) : undefined }));
  const product = products.find((p) => p.id === d.productId);
  const byStage = (s: string) => opening.candidates.filter((c) => c.stage === s);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/organizations`} className="hover:text-ink">{words}</Link> <span className="text-faint">/</span>{' '}
        <Link href={`/${slug}/organizations/${opening.organizationId}`} className="hover:text-ink">{opening.organization.name}</Link> <span className="text-faint">/</span> <span className="text-ink">{opening.title}</span>
      </nav>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em]">{opening.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {[opening.organization.name, d.country && countryName(d.country), product && product.name, d.positions && `${d.positions} positions`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(STAGE_LABEL).map((s) => (
            <span key={s} className="rounded-full bg-card px-3 py-1.5 text-xs font-semibold shadow-[var(--shadow-card)]">{STAGE_LABEL[s]} {byStage(s).length}</span>
          ))}
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Candidates" sub="Move people along as the employer responds. Hiring puts the offer on their case." />
            {opening.candidates.length === 0 ? (
              <EmptyState title="No one shortlisted yet" body="Pick from the suggested applicants below." />
            ) : (
              <ul className="divide-y divide-line">
                {opening.candidates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link href={`/${slug}/clients/${c.client.id}?tab=profession`} className="min-w-0 flex-1 font-semibold hover:underline">
                      {fullName(c.client)} <span className="text-xs font-normal text-muted">{c.client.ref}</span>
                    </Link>
                    {c.score != null && <Badge tone={c.score >= 75 ? 'ok' : c.score >= 50 ? 'info' : 'neutral'}>{c.score}% fit</Badge>}
                    {canWrite ? <CandidateStage slug={slug} id={c.id} stage={c.stage} /> : <span className="text-xs font-semibold text-muted">{STAGE_LABEL[c.stage]}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {canWrite && opening.status === 'open' && (
            <Card>
              <CardHeader title="Suggested applicants" sub="Ranked by occupation, experience, licences, destination and qualification. A guide, not a decision." />
              {suggestions.length === 0 ? (
                <EmptyState title="No close matches" body="Fill in applicants' professional profiles (occupation, experience, licences) to get suggestions." />
              ) : (
                <ul className="divide-y divide-line">
                  {suggestions.map(({ client, match }) => (
                    <li key={client.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <Link href={`/${slug}/clients/${client.id}?tab=profession`} className="font-semibold hover:underline">{fullName(client)}</Link>
                        <p className="text-xs text-muted">
                          {match.reasons.join(' · ')}
                          {match.gaps.length > 0 && <span className="text-warn-ink"> · {match.gaps.join(' · ')}</span>}
                        </p>
                      </div>
                      <Badge tone={match.score >= 75 ? 'ok' : match.score >= 50 ? 'info' : 'neutral'}>{match.score}% fit</Badge>
                      <ShortlistButton slug={slug} openingId={opening.id} clientId={client.id} name={fullName(client)} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
        <Card className="self-start p-5">
          <h2 className="mb-4 text-base font-bold">{pack.labels.opening ?? 'Opening'} details</h2>
          {canWrite ? (
            <OpeningForm
              slug={slug}
              opening={{ id: opening.id, title: opening.title, status: opening.status, closesAt: opening.closesAt?.toISOString() ?? null, data: d } satisfies OpeningValues}
              countries={countries}
              occupations={occupations}
              products={products.map((p) => ({ id: p.id, label: `${countryName(p.country)} · ${p.name}`, country: p.country }))}
              qualifications={QUALIFICATIONS}
              word={pack.labels.opening ?? 'Opening'}
            />
          ) : (
            <p className="text-sm text-muted">{d.description ?? '—'}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
