import Link from 'next/link';
import { notFound } from 'next/navigation';
import { countryName } from '@/lib/countries';
import { docChecksOn } from '@/server/doc-checks';
import { Avatar, Badge, Card, CardHeader, LinkButton } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { getCaseApplications, getCaseDocuments, listInstitutions, listInvoicesFor } from '@/server/queries2';
import { InvoiceBadge } from '../../billing/invoice-badge';
import { ApplicationsPanel } from './applications-panel';
import { DocumentsPanel } from './documents-panel';
import { CATEGORY_LABEL } from '@/lib/constants';
import { fmtDate, fullName } from '@/lib/format';
import { can } from '@/lib/permissions';
import { hasFeature } from '@/lib/plans';
import { AI_SHORT } from '@/lib/brand';
import { db, getCtx, getTeam } from '@/lib/tenant';
import { CustomFieldsPanel } from '../../_components/custom-fields-panel';
import { stagesOf } from '@/server/cases';
import { getCase, listBranches } from '@/server/queries';
import { routeFor } from '@/lib/route';
import { AppointmentsPanel, NoteBox, TasksPanel } from '../../_components/work-panels';
import { Timeline } from '../../_components/timeline';
import { DetailsForm, Journey, StatusControls } from './case-controls';
import { NextActionCard, TracksCard } from './case-extras';
import { gateProblems, mainStages, overdueDays, trackStages } from '@/lib/workflow';
import { PathwayInfo } from '../../leads/pathway-info';

// Study applications that decide where the client is headed, best first.
const COLLEGE_RANK = ['ENROLLED', 'ACCEPTED', 'UNCONDITIONAL_OFFER', 'CONDITIONAL_OFFER'];

// Stage → the key date shown under it while it's still ahead.
const UPCOMING_DATES: [RegExp, string, string][] = [
  [/biometric/, 'biometrics', ''],
  [/medical|health|tb_test/, 'medical', ''],
  [/interview/, 'interview', ''],
  [/decision/, 'expected_decision', 'est. '],
  [/pre_departure|travel/, 'travel', 'flight '],
];

// Key dates tracked on every case; product-specific milestones live on the journey.
const DATE_FIELDS = [
  { key: 'intake', label: 'Intake / start' },
  { key: 'biometrics', label: 'Biometrics' },
  { key: 'medical', label: 'Medical' },
  { key: 'interview', label: 'Interview' },
  { key: 'expected_decision', label: 'Expected decision' },
  { key: 'travel', label: 'Travel' },
];

export default async function CasePage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  const [c, team, branches] = await Promise.all([getCase(ctx, id), getTeam(ctx), listBranches(ctx)]);
  if (!c) notFound();
  const isStudy = c.product.category === 'STUDY';
  const [docs, apps, institutions, invoices] = await Promise.all([
    getCaseDocuments(ctx, c.id),
    isStudy ? getCaseApplications(ctx, c.id) : Promise.resolve([]),
    isStudy ? listInstitutions(ctx) : Promise.resolve([]),
    can(ctx.role, 'billing.read') ? listInvoicesFor(ctx, { caseId: c.id }) : Promise.resolve(null),
  ]);
  const tz = ctx.tenant.timezone;
  // AI document checks: Pro (and trials), unless the agency turned them off.
  const checksOn = Boolean(ctx.subscription && hasFeature(ctx.subscription, 'doc_checks')) && docChecksOn(ctx.tenant.settings);
  const flagged = checksOn
    ? docs.filter((d) => {
        if (d.status === 'VERIFIED' || d.status === 'NOT_APPLICABLE') return false;
        const f = d.files[0];
        const issues = f?.aiStatus === 'done' ? ((f.aiCheck as { issues?: { severity: string }[] } | null)?.issues ?? []) : [];
        return issues.some((i) => i.severity !== 'low');
      }).length
    : null;
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const editable = can(ctx.role, 'case.write') && c.status !== 'CLOSED';
  const allStages = stagesOf(c);
  const stages = mainStages(allStages);
  const dates = (c.dates as Record<string, string>) ?? {};
  // Date each stage was reached, for the journey labels.
  const reached: Record<string, string> = {};
  for (const h of c.history) reached[h.toKey] = fmtDate(h.at, tz, { year: undefined });
  const name = fullName(c.client);
  // The journey's route line and the dates still ahead (appointments, estimated decision).
  const college = [...apps].sort((a, b) => COLLEGE_RANK.indexOf(a.status) - COLLEGE_RANK.indexOf(b.status)).find((a) => COLLEGE_RANK.includes(a.status) && a.institution.city);
  const homeBranch = c.branch ?? (await db(ctx, (tx) => tx.branch.findFirst({ orderBy: { createdAt: 'asc' } })));
  const route = routeFor({ fromCity: homeBranch?.city, toCity: college?.institution.city, toCountry: c.product.country, countryName: countryName(c.product.country) });
  const ahead: Record<string, string> = {};
  for (const s of stages) {
    const hit = UPCOMING_DATES.find(([re]) => re.test(s.key));
    const v = hit && dates[hit[1]];
    if (v && /^d{4}-d{2}-d{2}/.test(v)) ahead[s.key] = `${hit[2]}${fmtDate(new Date(`${v.slice(0, 10)}T00:00:00Z`), 'UTC', { year: undefined })}`;
  }
  const daysOpen = Math.max(0, Math.floor((Date.now() - c.createdAt.getTime()) / 86400_000));

  // What's in the way of the next step.
  const now = new Date();
  const current = stages.find((s) => s.key === c.stageKey);
  const blockers: { tone: 'danger' | 'warn'; text: string }[] = [];
  if (c.status === 'OPEN') {
    const missing = docs.filter((d) => d.required && d.status === 'PENDING');
    if (missing.length) blockers.push({ tone: 'warn', text: `${missing.length} required document${missing.length > 1 ? 's' : ''} not uploaded yet${missing.length <= 3 ? `: ${missing.map((d) => d.name).join(', ')}` : ''}` });
    for (const d of docs.filter((d) => d.status === 'REJECTED')) blockers.push({ tone: 'danger', text: `${d.name} was rejected${d.rejectionReason ? `: ${d.rejectionReason}` : ''}` });
    for (const d of docs.filter((d) => d.status === 'EXPIRED' || (d.expiresAt && d.expiresAt < now && d.status !== 'NOT_APPLICABLE'))) blockers.push({ tone: 'danger', text: `${d.name} has expired` });
    const overdue = c.tasks.filter((t) => !t.done && t.dueAt && t.dueAt < now).length;
    if (overdue) blockers.push({ tone: 'warn', text: `${overdue} overdue task${overdue > 1 ? 's' : ''}` });
    const late = overdueDays(current, c.stageSince, now);
    if (late) blockers.push({ tone: 'warn', text: `${current!.name} is ${late} day${late > 1 ? 's' : ''} past its expected time` });
    blockers.push(
      ...gateProblems(current, {
        docs: Object.fromEntries(docs.filter((d) => d.checklistKey).map((d) => [d.checklistKey!, d.status])),
        fields: { ...(c.client.packData as Record<string, unknown>), ...(c.packData as Record<string, unknown>) },
        hasFollowUp: c.tasks.some((t) => !t.done && t.dueAt && t.dueAt > now),
        docName: (k) => docs.find((d) => d.checklistKey === k)?.name ?? k,
      }).map((text) => ({ tone: 'warn' as const, text: `Before moving on: ${text}` })),
    );
  }
  const trackState = (c.tracks as Record<string, { status: 'todo' | 'in_progress' | 'done' | 'not_needed' }>) ?? {};
  const tracks = trackStages(allStages).map((s) => ({ key: s.key, name: s.name, status: trackState[s.key]?.status ?? 'todo' }));
  const dependants = c.client.family.filter((f) => f.included);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/cases`} className="hover:text-ink">Cases</Link> <span className="text-faint">/</span> <span className="text-ink">{c.ref}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        {/* Shrinks (the subtitle wraps) so the facts and buttons stay beside the name. */}
        <div className="flex min-w-0 flex-[1_1_360px] items-center gap-4">
          <Avatar name={name} size={60} tone="lime" />
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em] sm:text-[40px]">
                <Link href={`/${slug}/clients/${c.client.id}`} className="hover:underline">{name}</Link>
              </h1>
              {c.status === 'ON_HOLD' && <Badge tone="warn">On hold</Badge>}
              {c.status === 'CLOSED' && <Badge tone={c.outcome === 'APPROVED' ? 'ok' : c.outcome === 'REFUSED' ? 'danger' : 'neutral'}>{(c.outcome ?? 'closed').toLowerCase()}</Badge>}
            </div>
            <div className="flex flex-wrap gap-x-2 text-[13px] font-medium text-muted">
              <span>{countryName(c.product.country)} · {c.product.name}</span>
              <span>·</span><span>{CATEGORY_LABEL[c.product.category]}</span>
              <span>·</span><span>Owner {c.ownerId ? names[c.ownerId] : 'unassigned'}</span>
              {branches.length > 1 && (
                <>
                  <span>·</span>
                  <span>{branches.find((b) => b.id === c.branchId)?.name ?? 'No branch'}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-6 lg:ml-auto lg:shrink-0 lg:justify-end">
          <Fact label="Case" value={c.ref} />
          <Fact label="Days open" value={String(daysOpen)} />
          <Fact label="Lodged" value={c.lodgedAt ? fmtDate(c.lodgedAt, tz) : '—'} />
          {flagged !== null && (
            <a href="#documents" className="flex flex-col gap-0.5">
              <span className="eyebrow">{AI_SHORT} flags</span>
              <span className={`text-xl font-extrabold tracking-tight ${flagged ? 'text-warn-ink' : 'text-ok'}`}>{flagged ? `${flagged} doc${flagged === 1 ? '' : 's'}` : 'None'}</span>
            </a>
          )}
          {can(ctx.role, 'case.write') && <StatusControls slug={slug} caseId={c.id} status={c.status} />}
        </div>
      </header>

      <Journey slug={slug} caseId={c.id} stages={stages} current={c.stageKey} dates={reached} ahead={ahead} route={route} editable={editable} canOverride={can(ctx.role, 'settings.manage')} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <DocumentsPanel
            slug={slug}
            caseId={c.id}
            canWrite={can(ctx.role, 'document.write')}
            canVerify={can(ctx.role, 'document.verify')}
            aiChecks={checksOn}
            profile={{ fullName: name, dob: c.client.dob?.toISOString().slice(0, 10) ?? null, passportNumber: c.client.passportNumber }}
            docs={docs.map((d) => ({
              id: d.id,
              name: d.name,
              group: d.group,
              required: d.required,
              status: d.status,
              rejectionReason: d.rejectionReason,
              expiresAt: d.expiresAt?.toISOString() ?? null,
              files: d.files.map((f) => ({ id: f.id, fileName: f.fileName, contentType: f.contentType, size: f.size, createdAt: f.createdAt.toISOString(), ai: f.aiStatus
                  ? { status: f.aiStatus, ...(f.aiCheck as object) }
                  : // Just uploaded: the check starts in the background, so show it as pending (the panel polls).
                    checksOn && Date.now() - f.createdAt.getTime() < 60_000 ? { status: 'pending' } : null })),
            }))}
          />
          {isStudy && (
            <ApplicationsPanel
              slug={slug}
              caseId={c.id}
              country={c.product.country}
              canWrite={can(ctx.role, 'application.write')}
              institutions={institutions.map((i) => ({
                id: i.id,
                name: i.name,
                country: i.country,
                courses: i.courses.map((k) => ({ id: k.id, name: k.name, level: k.level, intakes: k.intakes, tuitionFee: k.tuitionFee })),
              }))}
              apps={apps.map((a) => ({
                id: a.id,
                institution: { id: a.institution.id, name: a.institution.name, country: a.institution.country },
                courseName: a.course?.name ?? a.courseName ?? '—',
                intake: a.intake,
                status: a.status,
                tuitionFee: a.tuitionFee,
                currency: a.currency,
                studentId: a.studentId,
                claim: a.claims[0] ? { amount: a.claims[0].amount, currency: a.claims[0].currency, status: a.claims[0].status } : null,
              }))}
            />
          )}
          <Card>
            <CardHeader title="Notes & activity" />
            <div className="flex flex-col gap-5 px-5 py-4">
              <NoteBox slug={slug} links={{ caseId: c.id }} />
              <Timeline items={c.activities} tz={tz} people={names} />
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <NextActionCard slug={slug} caseId={c.id} nextAction={c.nextAction} refs={(c.refs as { label: string; value: string }[]) ?? []} blockers={blockers} canEdit={editable} />
          <TracksCard slug={slug} caseId={c.id} tracks={tracks} canEdit={editable} />
          <TasksPanel slug={slug} tasks={c.tasks} tz={tz} links={{ caseId: c.id }} team={team} me={ctx.user.id} />
          {invoices && (
            <Card>
              <CardHeader
                title="Billing"
                action={can(ctx.role, 'billing.write') && <LinkButton size="sm" href={`/${slug}/billing/new?client=${c.client.id}&case=${c.id}`}>+ Invoice</LinkButton>}
              />
              <ul className="divide-y divide-line px-5">
                {invoices.length === 0 && <li className="py-4 text-sm text-muted">No invoices for this case.</li>}
                {invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link href={`/${slug}/billing/${inv.id}`} className="flex items-center gap-3 py-3 hover:underline">
                      <span className="min-w-0 flex-1 text-sm font-semibold">{inv.ref}</span>
                      <span className="text-xs text-muted">{formatMoney(inv.amountPaid)} / {formatMoney(inv.total)}</span>
                      <InvoiceBadge status={inv.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Case details" />
            <div className="p-5">
              {can(ctx.role, 'case.write') ? (
                <DetailsForm slug={slug} caseId={c.id} ownerId={c.ownerId} branchId={c.branchId} branches={branches} team={team} dateFields={DATE_FIELDS} dates={dates} />
              ) : (
                <dl className="grid grid-cols-2 gap-3 text-[13px]">
                  {DATE_FIELDS.map((f) => <div key={f.key}><dt className="text-xs text-muted">{f.label}</dt><dd className="font-semibold">{dates[f.key] ?? '—'}</dd></div>)}
                </dl>
              )}
            </div>
          </Card>
          <CustomFieldsPanel ctx={ctx} entity="cases" recordId={c.id} values={c.customFields} canEdit={can(ctx.role, 'case.write')} />
          {Object.keys((c.product.info as object) ?? {}).length > 0 && (
            <Card>
              <CardHeader title="About this pathway" sub="From the Kicko library, as published by the authority" />
              <div className="p-5 pt-1"><PathwayInfo info={c.product.info} /></div>
            </Card>
          )}
          <AppointmentsPanel slug={slug} items={c.appointments} tz={tz} links={{ caseId: c.id }} team={team} me={ctx.user.id} canOverride={can(ctx.role, 'settings.manage')} />
          {dependants.length > 0 && (
            <Card>
              <CardHeader title="Included dependants" />
              <ul className="divide-y divide-line px-5">
                {dependants.map((f) => <li key={f.id} className="py-2.5 text-sm"><span className="font-semibold">{f.name}</span> <span className="text-muted">· {f.relation.toLowerCase()}</span></li>)}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className="text-xl font-extrabold tracking-tight">{value}</span>
    </div>
  );
}
