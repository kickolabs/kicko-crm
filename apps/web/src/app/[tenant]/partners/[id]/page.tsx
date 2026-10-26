import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui';
import { countryName } from '@/lib/countries';
import { fullName } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/permissions';
import { getCtx } from '@/lib/tenant';
import { APPLICATION_LABEL } from '@/server/partners';
import { getInstitution } from '@/server/queries2';
import { CoursesPanel, InstitutionForm } from '../institution-form';
import { countryChoices } from '@/server/library';
import { scopeOf } from '@/server/scope';

export default async function InstitutionPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  const inst = await getInstitution(ctx, id);
  if (!inst) notFound();
  const canManage = can(ctx.role, 'partners.manage');
  const enrolled = inst.applications.filter((a) => a.status === 'ENROLLED').length;

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/partners`} className="hover:text-ink">Partners</Link> <span className="text-faint">/</span> <span className="text-ink">{inst.name}</span>
      </nav>
      <PageHeader
        title={inst.name}
        sub={`${[inst.city, countryName(inst.country)].filter(Boolean).join(', ')} · ${inst.applications.length} applications · ${enrolled} enrolled`}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Courses" />
            <CoursesPanel
              slug={slug}
              institutionId={inst.id}
              currency={inst.currency}
              canManage={canManage}
              courses={inst.courses.map((c) => ({ id: c.id, name: c.name, level: c.level, durationMonths: c.durationMonths, tuitionFee: c.tuitionFee, intakes: c.intakes }))}
            />
          </Card>
          <Card>
            <CardHeader title="Applications" />
            <ul className="divide-y divide-line">
              {inst.applications.length === 0 && <li className="px-5 py-4 text-sm text-muted">No applications yet. Add them from a study case.</li>}
              {inst.applications.map((a) => (
                <li key={a.id}>
                  <Link href={`/${slug}/cases/${a.caseId}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold">{fullName(a.case.client)}</div>
                      <div className="text-xs text-muted">{a.course?.name ?? a.courseName}{a.intake ? ` · ${a.intake}` : ''} · {a.case.ref}</div>
                    </div>
                    <Badge tone={a.status === 'ENROLLED' ? 'lime' : a.status === 'REJECTED' ? 'danger' : 'neutral'}>{APPLICATION_LABEL[a.status]}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {inst.claims.length > 0 && (
            <Card>
              <CardHeader title="Commission claims" action={<Link href={`/${slug}/partners/commissions`} className="text-xs font-semibold text-muted hover:text-ink">All claims →</Link>} />
              <ul className="divide-y divide-line">
                {inst.claims.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <span className="min-w-0 flex-1 font-semibold">{formatMoney(c.amount, c.currency)}</span>
                    <Badge tone={c.status === 'RECEIVED' ? 'ok' : c.status === 'CLAIMED' ? 'info' : c.status === 'WRITTEN_OFF' ? 'neutral' : 'warn'}>{c.status.toLowerCase().replace('_', ' ')}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <Card className="self-start p-5">
          <h2 className="mb-4 text-base font-bold">Agreement & details</h2>
          {canManage ? (
            <InstitutionForm
              slug={slug}
              inst={{ ...inst, agreementUntil: inst.agreementUntil?.toISOString() ?? null }}
              countries={await countryChoices(scopeOf(ctx)).then((c) => [...c.offered, ...c.others])}
            />
          ) : (
            <p className="text-sm text-muted">
              Commission: {inst.commissionType === 'PERCENT' ? `${inst.commissionValue / 100}%` : formatMoney(inst.commissionValue, inst.currency)} of {inst.commissionBasis.toLowerCase()}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
