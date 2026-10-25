import clsx from 'clsx';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar, Badge, Card, CardHeader, LinkButton } from '@/components/ui';
import { formatMoney } from '@/lib/money';
import { listInvoicesFor } from '@/server/queries2';
import { InvoiceBadge } from '../../billing/invoice-badge';
import { COUNTRIES } from '@/lib/constants';
import { fmtDate, fullName, relative } from '@/lib/format';
import { connectionSummary } from '@/integrations/core/connections';
import { buildThread } from '@/server/thread-view';
import { Conversation } from '../../_components/conversation';
import { PortalAccessCard } from '../../_components/messaging';
import { CallButton } from '../../_components/calls';
import { CallsPanel } from '../../_components/calls-panel';
import { callingFor } from '@/server/calls/view';
import { prefill } from '@/server/eligibility';
import { db } from '@/lib/tenant';
import { fmtDateTime } from '@/lib/format';
import { UpgradeCard } from '@/components/upgrade';
import { hasFeature } from '@/lib/plans';
import { EligibilityPanel } from './eligibility-panel';
import { FormSheetView } from './form-sheet';
import { clientSheet, formsOverview } from '@/server/forms';
import { formById, sheetText } from '@/lib/forms/sheet';
import { QUESTIONS, type AnswerKey, type Answers, type Question } from '@/lib/forms/questions';
import { scopeOf } from '@/server/scope';
import { can } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { CustomFieldsPanel } from '../../_components/custom-fields-panel';
import { stagesOf } from '@/server/cases';
import { getClient, listProducts } from '@/server/queries';
import { AppointmentsPanel, NoteBox, TasksPanel } from '../../_components/work-panels';
import { Timeline } from '../../_components/timeline';
import { FamilyPanel, OpenCaseButton, ProfileForm, RepeaterEditor } from './client-forms';
import { EDU_COLUMNS, TEST_COLUMNS, WORK_COLUMNS } from './columns';

const TABS = ['overview', 'messages', 'profile', 'background', 'eligibility', 'forms', 'family', 'billing'] as const;

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ tab?: string; form?: string }>;
}) {
  const { tenant: slug, id } = await params;
  const { tab: rawTab, form: formParam } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? '') ? rawTab! : 'overview';
  const ctx = await getCtx(slug);
  const [client, team, products, calling] = await Promise.all([getClient(ctx, id), getTeam(ctx), listProducts(ctx), callingFor(ctx)]);
  if (!client) notFound();
  const tz = ctx.tenant.timezone;
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const writable = can(ctx.role, 'client.write');
  const name = fullName(client);
  const passportSoon = client.passportExpiry && client.passportExpiry.getTime() < Date.now() + 180 * 86400_000;
  const tests = (client.tests as Record<string, string>[]) ?? [];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/clients`} className="hover:text-ink">Clients</Link> <span className="text-faint">/</span> <span className="text-ink">{client.ref}</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={name} size={60} tone="lime" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em] sm:text-[40px]">{name}</h1>
            <div className="flex flex-wrap gap-x-2 text-[13px] font-medium text-muted">
              <span>{client.ref}</span>
              {client.phone && <><span>·</span><a href={`tel:${client.phoneNormalized ?? client.phone}`} className="hover:text-ink">{client.phone}</a></>}
              {client.email && <><span>·</span><a href={`mailto:${client.email}`} className="hover:text-ink">{client.email}</a></>}
              {client.ownerId && <><span>·</span><span>Owner {names[client.ownerId]}</span></>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          {writable && client.phoneNormalized && <CallButton slug={slug} contactKey={`client:${client.id}`} contactName={name} calling={calling} />}
          <Fact label="Passport" value={client.passportNumber ?? '—'} sub={client.passportExpiry ? `exp. ${fmtDate(client.passportExpiry, 'UTC')}` : undefined} warn={Boolean(passportSoon)} />
          <Fact label="English" value={tests[0] ? `${tests[0].test} ${tests[0].overall}` : '—'} />
          <Fact label="Open cases" value={String(client.cases.filter((c) => c.status !== 'CLOSED').length)} />
        </div>
      </header>

      {passportSoon && (
        <div role="status" className="rounded-[14px] bg-warn-bg px-4 py-3 text-sm font-medium text-warn-ink">
          Passport expires {fmtDate(client.passportExpiry, 'UTC')}. Many visas need 6+ months of validity. Consider renewal before lodging.
        </div>
      )}

      <div role="tablist" aria-label="Client sections" className="flex gap-6 border-b border-line">
        {TABS.filter((t) => t !== 'billing' || can(ctx.role, 'billing.read')).map((t) => (
          <Link key={t} role="tab" aria-selected={tab === t} href={`?tab=${t}`} className={clsx('-mb-px border-b-[3px] py-2.5 text-sm font-semibold capitalize', tab === t ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {t}
          </Link>
        ))}
      </div>

      {tab === 'eligibility' && <EligibilityTab />}

      {tab === 'forms' && <FormsTab />}

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            <Card>
              <CardHeader
                title="Cases"
                action={can(ctx.role, 'case.write') && <OpenCaseButton slug={slug} clientId={client.id} products={products.map(({ id, name, country, category }) => ({ id, name, country, category }))} team={team} me={ctx.user.id} />}
              />
              <ul className="divide-y divide-line">
                {client.cases.length === 0 && <li className="px-5 py-5 text-sm text-muted">No cases yet. Open one to start tracking stages.</li>}
                {client.cases.map((c) => {
                  const stages = stagesOf(c.product);
                  const idx = stages.findIndex((s) => s.key === c.stageKey);
                  return (
                    <li key={c.id}>
                      <Link href={`/${slug}/cases/${c.id}`} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-paper-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">{COUNTRIES[c.product.country] ?? c.product.country} · {c.product.name}</div>
                          <div className="text-xs text-muted">{c.ref} · {stages[idx]?.name ?? c.stageKey}</div>
                        </div>
                        <div className="flex w-40 gap-0.5" aria-label={`Stage ${idx + 1} of ${stages.length}`}>
                          {stages.map((s, i) => <span key={s.key} className={clsx('h-1.5 flex-1 rounded-full', i <= idx ? 'bg-ink' : 'bg-paper-2', i === idx && 'bg-lime ring-1 ring-ink')} />)}
                        </div>
                        {c.status !== 'OPEN' && <Badge tone={c.outcome === 'APPROVED' ? 'ok' : c.outcome === 'REFUSED' ? 'danger' : 'neutral'}>{c.status === 'ON_HOLD' ? 'On hold' : (c.outcome ?? 'Closed').toLowerCase()}</Badge>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <CustomFieldsPanel ctx={ctx} entity="clients" recordId={client.id} values={client.customFields} canEdit={writable} />
            <Card>
              <CardHeader title="Notes & activity" />
              <div className="flex flex-col gap-5 px-5 py-4">
                <NoteBox slug={slug} links={{ clientId: client.id }} />
                <Timeline items={client.activities} tz={tz} people={names} />
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-5">
            <CallsPanel ctx={ctx} contact={{ kind: 'client', id: client.id }} />
            {writable && (
              <PortalAccessCard
                slug={slug}
                clientId={client.id}
                phone={client.phoneNormalized}
                email={client.email}
                invitedAt={client.portalInvitedAt?.toISOString() ?? null}
                lastSeen={client.portalLastSeen ? relative(client.portalLastSeen) : null}
                waConnected={Boolean(await connectionSummary(ctx.tenant.id, 'messaging'))}
              />
            )}
            <TasksPanel slug={slug} tasks={client.tasks} tz={tz} links={{ clientId: client.id }} team={team} me={ctx.user.id} />
            <AppointmentsPanel slug={slug} items={client.appointments} tz={tz} links={{ clientId: client.id }} team={team} me={ctx.user.id} canOverride={can(ctx.role, 'settings.manage')} />
            {client.lead && (
              <Link href={`/${slug}/leads/${client.lead.id}`} className="card px-5 py-4 text-sm hover:bg-paper-3">
                <span className="eyebrow block">Original lead</span>
                <span className="font-semibold">{client.lead.ref}</span> <span className="text-muted">· {fmtDate(client.lead.createdAt, tz)}</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {tab === 'profile' && (
        <Card className="p-5">{writable ? <ProfileForm slug={slug} client={client} team={team} /> : <p className="text-sm text-muted">You can view but not edit client profiles.</p>}</Card>
      )}

      {tab === 'background' && (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="English tests" sub="IELTS, PTE, TOEFL… used for eligibility" />
            <div className="p-5"><RepeaterEditor slug={slug} clientId={client.id} field="tests" initial={tests} columns={TEST_COLUMNS} blank={{ test: 'IELTS', overall: '', l: '', r: '', w: '', s: '', date: '' }} /></div>
          </Card>
          <Card>
            <CardHeader title="Education" />
            <div className="p-5"><RepeaterEditor slug={slug} clientId={client.id} field="education" initial={(client.education as Record<string, string>[]) ?? []} columns={EDU_COLUMNS} blank={{ level: "Bachelor's", institution: '', field: '', year: '', score: '' }} /></div>
          </Card>
          <Card>
            <CardHeader title="Work experience" />
            <div className="p-5"><RepeaterEditor slug={slug} clientId={client.id} field="work" initial={(client.work as Record<string, string>[]) ?? []} columns={WORK_COLUMNS} blank={{ employer: '', title: '', from: '', to: '', code: '' }} /></div>
          </Card>
        </div>
      )}

      {tab === 'messages' && <ClientMessages slug={slug} clientId={client.id} />}

      {tab === 'billing' && can(ctx.role, 'billing.read') && <ClientBilling slug={slug} clientId={client.id} canWrite={can(ctx.role, 'billing.write')} tz={tz} />}

      {tab === 'family' && (
        <Card>
          <CardHeader title="Family & dependants" />
          <div className="p-5"><FamilyPanel slug={slug} clientId={client.id} family={client.family} /></div>
        </Card>
      )}
    </div>
  );

  async function FormsTab() {
    if (!hasFeature(ctx.subscription!, 'forms')) return <UpgradeCard slug={slug} feature="forms" canManage={can(ctx.role, 'settings.manage')} />;
    const scope = scopeOf(ctx);
    const form = formParam ? formById(formParam) : null;
    if (!form) {
      const forms = await formsOverview(scope, client!.id);
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          {forms.map((f) => (
            <Link key={f.id} href={`?tab=forms&form=${f.id}`} className="card flex flex-col gap-2 p-5 hover:shadow-[var(--shadow-pop)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold tracking-wide text-muted uppercase">{f.authority}</span>
                {f.requested && <Badge tone="info">Waiting for client</Badge>}
              </div>
              <span className="font-bold">{f.title}</span>
              <span className="text-xs text-muted">{f.use}</span>
              <span className="mt-1 flex items-center gap-2 text-xs font-semibold">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2"><span className="block h-full bg-ink" style={{ width: `${Math.round((f.filled / f.total) * 100)}%` }} /></span>
                {f.filled}/{f.total}
              </span>
            </Link>
          ))}
        </div>
      );
    }
    const { sheet } = await clientSheet(scope, client!.id, form.id);
    const answers = client!.formAnswers as Answers;
    const keys = [...new Set(sheet.sections.flatMap((s) => s.rows.map((r) => r.ask).filter(Boolean)))] as AnswerKey[];
    const requested = (await db(ctx, (tx) => tx.formRequest.count({ where: { clientId: client!.id, formId: form.id, status: 'OPEN' } }))) > 0;
    return (
      <div className="flex flex-col gap-3">
        <Link href="?tab=forms" className="text-[13px] font-semibold text-muted hover:text-ink">← All forms</Link>
        <FormSheetView
          slug={slug}
          clientId={client!.id}
          sheet={{ ...sheet, form: { id: form.id, title: form.title, authority: form.authority, use: form.use } }}
          text={sheetText(sheet, name)}
          canWrite={writable}
          requested={requested}
          answerFields={keys.map((k) => {
            const q: Question = QUESTIONS[k];
            return { key: k, label: q.label, type: q.type, hint: q.hint, details: q.details, value: answers[k]?.v ?? '', detailsValue: answers[`${k}.details`]?.v ?? '' };
          })}
        />
      </div>
    );
  }

  async function EligibilityTab() {
    if (!hasFeature(ctx.subscription!, 'eligibility')) return <UpgradeCard slug={slug} feature="eligibility" canManage={can(ctx.role, 'settings.manage')} />;
    const checks = await db(ctx, (tx) => tx.eligibilityCheck.findMany({ where: { clientId: client!.id }, orderBy: { createdAt: 'desc' }, take: 10 }));
    return (
      <EligibilityPanel
        slug={slug}
        clientId={client!.id}
        canWrite={writable}
        prefill={prefill(client!)}
        saved={checks.map((c) => ({
          id: c.id,
          kind: c.kind as 'CRS' | 'AU_POINTS',
          score: c.score,
          at: fmtDateTime(c.createdAt, tz),
          by: c.createdBy ? (names[c.createdBy] ?? null) : null,
          explanation: c.explanation as never,
        }))}
      />
    );
  }
}

async function ClientMessages({ slug, clientId }: { slug: string; clientId: string }) {
  const ctx = await getCtx(slug);
  const view = await buildThread(ctx, { kind: 'client', id: clientId });
  if (!view) return null;
  return (
    <Card className="flex h-[68vh] flex-col overflow-hidden">
      <Conversation slug={slug} view={view} />
    </Card>
  );
}

async function ClientBilling({ slug, clientId, canWrite, tz }: { slug: string; clientId: string; canWrite: boolean; tz: string }) {
  const ctx = await getCtx(slug);
  const invoices = await listInvoicesFor(ctx, { clientId });
  const billed = invoices.filter((i) => i.status !== 'VOID' && i.status !== 'DRAFT');
  const total = billed.reduce((a, i) => a + i.total, 0);
  const paid = billed.reduce((a, i) => a + i.amountPaid, 0);
  return (
    <Card>
      <CardHeader
        title="Invoices"
        sub={`${formatMoney(paid)} paid of ${formatMoney(total)} billed`}
        action={canWrite && <LinkButton size="sm" variant="primary" href={`/${slug}/billing/new?client=${clientId}`}>+ Invoice</LinkButton>}
      />
      <ul className="divide-y divide-line">
        {invoices.length === 0 && <li className="px-5 py-5 text-sm text-muted">No invoices yet.</li>}
        {invoices.map((inv) => (
          <li key={inv.id}>
            <Link href={`/${slug}/billing/${inv.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3.5 hover:bg-paper-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{inv.ref}</div>
                <div className="text-xs text-muted">{fmtDate(inv.issueDate, tz)}{inv.case ? ` · ${inv.case.ref}` : ''}</div>
              </div>
              <span className="text-sm"><span className="font-bold">{formatMoney(inv.amountPaid)}</span> <span className="text-muted">/ {formatMoney(inv.total)}</span></span>
              <InvoiceBadge status={inv.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Fact({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span className="text-xl font-extrabold tracking-tight">{value}</span>
      {sub && <span className={clsx('text-xs font-semibold', warn ? 'text-warn' : 'text-muted')}>{sub}</span>}
    </div>
  );
}
