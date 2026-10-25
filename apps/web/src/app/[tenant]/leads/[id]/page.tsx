import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardHeader } from '@/components/ui';
import { CATEGORY_LABEL, COUNTRIES, LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_TONE } from '@/lib/constants';
import { fmtDateTime, fullName } from '@/lib/format';
import { can } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { CustomFieldsPanel } from '../../_components/custom-fields-panel';
import { getLead, listProducts, listBranches } from '@/server/queries';
import { AppointmentsPanel, NoteBox, TasksPanel } from '../../_components/work-panels';
import { Timeline } from '../../_components/timeline';
import { LeadToolbar, StatusStepper } from './lead-actions';
import { buildThread } from '@/server/thread-view';
import { Conversation } from '../../_components/conversation';
import { AiCallButton, CallButton } from '../../_components/calls';
import { voiceFor } from '@/server/voice/view';
import { db } from '@/lib/tenant';
import { SubAgentPicker } from '../../partners/agents/agent-forms';
import { CallsPanel } from '../../_components/calls-panel';
import { callingFor } from '@/server/calls/view';
import { BranchSelect } from '../../_components/branch-select';
import { setRecordBranchAction } from '../../actions-branches';

export default async function LeadPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await getCtx(slug);
  const [lead, team, products, calling, branches] = await Promise.all([getLead(ctx, id), getTeam(ctx), listProducts(ctx), callingFor(ctx), listBranches(ctx)]);
  const voice = await voiceFor(ctx);
  const agents = await db(ctx, (tx) => tx.subAgent.findMany({ where: { OR: [{ active: true }, { id: lead?.subAgentId ?? '' }] }, orderBy: { name: 'asc' } }));
  const agent = agents.find((a) => a.id === lead?.subAgentId);
  if (!lead) notFound();
  // Converted leads continue the conversation on the client record.
  const thread = lead.clientId ? null : await buildThread(ctx, { kind: 'lead', id: lead.id });
  const tz = ctx.tenant.timezone;
  const names = Object.fromEntries(team.map((m) => [m.userId, m.name]));
  const writable = can(ctx.role, 'lead.write');
  const productOpts = products.map(({ id, name, country, category }) => ({ id, name, country, category }));

  const rows: [string, React.ReactNode][] = [
    ['Phone', lead.phone ? <a href={`tel:${lead.phoneNormalized ?? lead.phone}`} className="font-semibold underline decoration-ink/30 underline-offset-4">{lead.phone}</a> : '—'],
    ['WhatsApp', lead.phoneNormalized ? <a href={`https://wa.me/${lead.phoneNormalized.replace('+', '')}`} target="_blank" rel="noreferrer" className="font-semibold underline decoration-ink/30 underline-offset-4">Open chat ↗</a> : '—'],
    ['Email', lead.email ? <a href={`mailto:${lead.email}`} className="font-semibold underline decoration-ink/30 underline-offset-4">{lead.email}</a> : '—'],
    ['Interested in', [lead.interestCategory && CATEGORY_LABEL[lead.interestCategory], lead.interestCountry && (COUNTRIES[lead.interestCountry] ?? lead.interestCountry)].filter(Boolean).join(' · ') || '—'],
    ['Visa product', lead.product ? `${COUNTRIES[lead.product.country] ?? lead.product.country} · ${lead.product.name}` : '—'],
    ['Source', LEAD_SOURCE_LABEL[lead.source]],
    [
      'Referred by',
      writable && agents.length ? (
        <SubAgentPicker slug={slug} leadId={lead.id} value={lead.subAgentId} agents={agents.map((a) => ({ id: a.id, label: `${a.name}${a.company ? ` (${a.company})` : ''}` }))} />
      ) : agent ? (
        <Link href={`/${slug}/partners/agents/${agent.id}`} className="font-semibold underline decoration-ink/30 underline-offset-4">{agent.name}</Link>
      ) : (
        '—'
      ),
    ],
    ['Lead score', lead.score != null ? <span className="font-semibold tabular-nums">{lead.score}/100</span> : '—'],
    ['Owner', lead.ownerId ? (names[lead.ownerId] ?? '—') : <span className="font-semibold text-warn">Unassigned</span>],
    ...(branches.length > 1
      ? [[
          'Branch',
          writable ? (
            <BranchSelect key="branch" id="lead-branch" value={lead.branchId} branches={branches} save={setRecordBranchAction.bind(null, slug, 'lead', lead.id)} className="h-8 w-40" />
          ) : (
            (branches.find((b) => b.id === lead.branchId)?.name ?? '—')
          ),
        ] as [string, React.ReactNode]]
      : []),
    ['Created', fmtDateTime(lead.createdAt, tz)],
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <nav className="text-[13px] font-semibold text-muted">
        <Link href={`/${slug}/leads`} className="hover:text-ink">Leads</Link> <span className="text-faint">/</span> <span className="text-ink">{lead.ref}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[34px] leading-none font-extrabold tracking-[-0.04em] sm:text-[40px]">{fullName(lead)}</h1>
            <Badge tone={LEAD_STATUS_TONE[lead.status]}>{LEAD_STATUS_LABEL[lead.status]}</Badge>
          </div>
          {lead.status !== 'WON' && lead.status !== 'LOST' && <StatusStepper slug={slug} lead={lead} disabled={!writable} />}
          {lead.status === 'LOST' && lead.lostReason && <p className="text-sm text-muted">Lost · {lead.lostReason}</p>}
        </div>
        {writable && (
          <div className="flex flex-wrap items-start gap-2">
            {lead.phoneNormalized && !lead.clientId && <CallButton slug={slug} contactKey={`lead:${lead.id}`} contactName={fullName(lead)} calling={calling} />}
            {lead.phoneNormalized && !lead.clientId && <AiCallButton slug={slug} contactKey={`lead:${lead.id}`} contactName={fullName(lead)} voice={voice} />}
            <LeadToolbar slug={slug} lead={lead} products={productOpts} team={team} />
          </div>
        )}
      </header>

      {lead.client && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] bg-lime px-5 py-3.5">
          <span className="font-semibold">Converted to client {lead.client.ref}.</span>
          <Link href={`/${slug}/clients/${lead.client.id}`} className="font-bold underline underline-offset-4">Open client profile →</Link>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-[13px] sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5">
                  <dt className="text-xs font-semibold text-muted">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {lead.message && (
              <div className="border-t border-line px-5 py-4">
                <div className="mb-1 text-xs font-semibold text-muted">Enquiry</div>
                <p className="text-sm leading-relaxed whitespace-pre-line text-ink-2">{lead.message}</p>
              </div>
            )}
          </Card>
          <CustomFieldsPanel ctx={ctx} entity="leads" recordId={lead.id} values={lead.customFields} canEdit={can(ctx.role, 'lead.write')} />
          {thread && (thread.whatsapp || thread.messages.length > 0) && (
            <Card className="flex h-[60vh] flex-col overflow-hidden">
              <CardHeader title="WhatsApp" sub={thread.whatsapp?.optIn ? 'Opted in to WhatsApp updates' : undefined} />
              <div className="min-h-0 flex-1">
                <Conversation slug={slug} view={thread} />
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Notes & activity" />
            <div className="flex flex-col gap-5 px-5 py-4">
              <NoteBox slug={slug} links={{ leadId: lead.id }} />
              <Timeline items={lead.activities} tz={tz} people={names} />
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          {!lead.clientId && <CallsPanel ctx={ctx} contact={{ kind: 'lead', id: lead.id }} />}
          <TasksPanel slug={slug} tasks={lead.tasks} tz={tz} links={{ leadId: lead.id }} team={team} me={ctx.user.id} />
          <AppointmentsPanel slug={slug} items={lead.appointments} tz={tz} links={{ leadId: lead.id }} team={team} me={ctx.user.id} canOverride={can(ctx.role, 'settings.manage')} />
        </div>
      </div>
    </div>
  );
}
