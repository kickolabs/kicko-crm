import clsx from 'clsx';
import Link from 'next/link';
import { countryName } from '@/lib/countries';
import type { ChecklistItem, Stage } from '@kicko/packs';
import { Badge, buttonCls, Card, CardHeader, EmptyState, inputCls, PageHeader } from '@/components/ui';
import { CATEGORY_LABEL } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { can, ROLE_LABEL } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { listInvites, listProducts } from '@/server/queries';
import { AdoptButton, CustomWorkflowForm, GeneralForm, InviteForm, LeadCapture, LibraryUpdateBanner, MemberControls, MemberHours, ProductEditor, RevokeInvite } from './settings-forms';
import { libraryPathways, libraryUpdates } from '@/server/workflows';
import { packForm } from '@/server/library';
import { checklistToText, stagesToText } from '@/lib/workflow-text';
import { PathwayInfo } from '../leads/pathway-info';
import { FieldToggle, HideToggle, OwnItemForm, TemplateEditor } from './pack-settings';
import { listTemplates } from '@/server/doc-templates';
import { ownItems } from '@/server/lists';
import { libraryList, tenantPack } from '@/server/library';
import { CORE_FIELDS } from '@/lib/merge';
import { RuleEditor } from './rules-editor';
import { ACTION_LABEL, CONDITION_LABEL, TRIGGERS } from '@/server/rules';
import { LEAD_SOURCE_LABEL, LEAD_SOURCES, LEAD_STATUS_LABEL, LEAD_STATUSES } from '@/lib/constants';
import { BillingDetailsForm, PackagesCard } from './billing-settings';
import { ConnectionCard } from './connection-card';
import { UpgradeCard } from '@/components/upgrade';
import { hasAi, hasFeature } from '@/lib/plans';
import { IntegrationsTab } from './integrations-tab';
import { CustomFieldsSettings } from './custom-fields-settings';
import { SecurityTab } from './security-settings';
import { listFields } from '@/server/custom-fields';
import { CreditsCard, CurrentPlan, PlanPicker } from './plan-settings';
import { creditSummary } from '@/server/plan';
import { formatMoney } from '@/lib/money';
import type { Interval, PlanId, SubStatus } from '@/lib/plans';
import { CallingPrefsCard, CallSimulatorCard, MyPhoneCard } from './calling-settings';
import { AssistantSettingsCard, KnowledgeCard, PlaygroundCard } from './assistant-settings';
import { assistantSettings } from '@/server/whatsapp/assistant';
import { VoiceAgentCard, VoiceQueueCard, VoiceSimulatorCard, VoiceSyncCard } from './voice-settings';
import { buildPrompt, QUESTIONS, syncStatus, TOOLS, voiceSettings } from '@/server/voice/agent';
import { PERSONAS } from '@/server/voice/personas';
import { scopeOf } from '@/server/scope';
import { agencyHours, parseHours } from '@/server/booking';
import { fullName } from '@/lib/format';
import { callingSettings } from '@/server/calls/service';
import { CALL_SCRIPTS } from '@/integrations/telephony/sandbox-scripts';
import { platformStatus } from '@/integrations/core/platform';
import { connectionSummary, providerOptions } from '@/integrations/core/connections';
import { PortalSettings } from './portal-settings';
import { AutomationsCard, SimulatorCard, TemplatesCard } from './whatsapp-settings';
import { SANDBOX_TEMPLATES } from '@/server/whatsapp/service';
import { TRIGGER_INFO } from '@/server/whatsapp/automations';
import { db } from '@/lib/tenant';
import { emailEnabled } from '@/server/email';
import { DEFAULT_PORTAL } from '@/server/portal';
import { listPackages } from '@/server/queries2';
import type { PlanStep } from '@/lib/money';
import { BranchSelect } from '../_components/branch-select';
import { setMemberBranchAction } from '../actions-branches';
import { BranchesTab } from './branches-tab';

export const metadata = { title: 'Settings' };
const TABS = [
  ['general', 'General'],
  ['plan', 'Plan & billing'],
  ['team', 'Team'],
  ['branches', 'Branches'],
  ['billing', 'Billing'],
  ['portal', 'Client portal'],
  ['whatsapp', 'WhatsApp'],
  ['assistant', 'AI assistant'],
  ['calling', 'Calling'],
  ['voice', 'AI voice agent'],
  ['integrations', 'Integrations'],
  ['fields', 'Custom fields'],
  ['security', 'Security'],
  ['capture', 'Lead capture'],
  ['workflows', 'Visa workflows'],
  ['templates', 'Agreements & letters'],
  ['automations', 'Automations'],
  ['lists', 'Lists & fields'],
] as const;

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ tab?: string; product?: string; country?: string; template?: string; list?: string; rule?: string; paid?: string; group?: string; person?: string; before?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await getCtx(slug);
  if (!can(ctx.role, 'settings.manage')) {
    return <Card><EmptyState title="Admins only" body="Ask an owner or admin to change agency settings." /></Card>;
  }
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'general';
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader title="Settings" sub={ctx.tenant.name} />
      <div role="tablist" className="flex flex-wrap gap-6 border-b border-line">
        {TABS.map(([k, label]) => (
          <Link key={k} role="tab" aria-selected={tab === k} href={`?tab=${k}`} className={clsx('-mb-px border-b-[3px] py-2.5 text-sm font-semibold', tab === k ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {label}
          </Link>
        ))}
      </div>

      {tab === 'general' && (
        <Card className="p-6">
          <GeneralForm slug={slug} name={ctx.tenant.name} timezone={ctx.tenant.timezone} assignment={ctx.tenant.settings.leadAssignment} />
        </Card>
      )}

      {tab === 'team' && <TeamTab slug={slug} ctxRole={ctx.role} me={ctx.user.id} />}

      {tab === 'branches' && <BranchesTab ctx={ctx} slug={slug} canManagePlan={can(ctx.role, 'settings.manage')} />}

      {tab === 'plan' && <PlanTab />}

      {tab === 'billing' && <BillingTab />}

      {tab === 'whatsapp' && <WhatsAppTab />}

      {tab === 'calling' && <CallingTab />}

      {tab === 'assistant' && <AssistantTab />}

      {tab === 'voice' && <VoiceTab />}

      {tab === 'integrations' && <IntegrationsTab tenantId={ctx.tenant.id} slug={slug} docChecks={ctx.tenant.settings.ai?.docChecks !== false} improve={ctx.tenant.settings.ai?.improve === true} />}

      {tab === 'portal' && (
        <PortalSettings
          slug={slug}
          loginUrl={`${base}/portal/${slug}/login`}
          emailOn={emailEnabled()}
          cfg={{ ...DEFAULT_PORTAL, ...ctx.tenant.settings.portal }}
        />
      )}

      {tab === 'capture' && (
        <LeadCapture
          slug={slug}
          formUrl={`${base}/f/${slug}/enquiry?k=${ctx.tenant.settings.formKey}`}
          kioskUrl={`${base}/f/${slug}/check-in?k=${ctx.tenant.settings.formKey}`}
          apiUrl={`${base}/api/public/${slug}/leads`}
          formKey={ctx.tenant.settings.formKey}
        />
      )}

      {tab === 'fields' && <FieldsTab />}
      {tab === 'templates' && <TemplatesTab slug={slug} ctx={ctx} templateId={sp.template} />}
      {tab === 'automations' && <AutomationsTab slug={slug} ctx={ctx} ruleId={sp.rule} />}
      {tab === 'lists' && <ListsTab slug={slug} ctx={ctx} list={sp.list} />}

      {tab === 'security' && <SecurityTab ctx={ctx} sp={sp} />}

      {tab === 'workflows' && <WorkflowsTab slug={slug} productId={sp.product} country={sp.country} ctx={ctx} />}
    </div>
  );

  async function FieldsTab() {
    if (!hasFeature(ctx.subscription!, 'custom_fields')) return <UpgradeCard slug={slug} feature="custom_fields" canManage />;
    const fields = await listFields(scopeOf(ctx), undefined, { archived: true });
    return <CustomFieldsSettings slug={slug} fields={fields} />;
  }

  async function WhatsAppTab() {
    const [w, templates, rules, products] = await Promise.all([
      connectionSummary(ctx.tenant.id, 'messaging'),
      db(ctx, (tx) => tx.whatsAppTemplate.findMany({ orderBy: { name: 'asc' } })),
      db(ctx, (tx) => tx.automation.findMany({ orderBy: { createdAt: 'asc' } })),
      listProducts(ctx),
    ]);
    const stageMap = new Map<string, string>();
    for (const p of products) for (const s of p.stages as Stage[]) if (!stageMap.has(s.key)) stageMap.set(s.key, s.name);
    const tpl = templates.map((t) => ({ value: `${t.name}|${t.language}`, name: t.name, language: t.language, category: t.category, status: t.status, body: t.body, variables: t.variables }));
    return (
      <div className="flex flex-col gap-5">
        <ConnectionCard
          slug={slug}
          tz={ctx.tenant.timezone}
          capability="messaging"
          title="WhatsApp Business number"
          sub="Each agency connects its own number. Start in the sandbox; go live when your Meta account is ready."
          providers={providerOptions('messaging')}
          conn={w}
          webhookBase={`${base}/api/webhooks/messaging`}
          sandboxNote="Sandbox mode: everything works inside Kicko (inbox, templates, automations, ticks), but nothing is sent to real phones. Use the simulator below to receive messages."
        />
        {w && (
          <>
            <TemplatesCard slug={slug} templates={tpl} live={!w.sandbox} suggestions={SANDBOX_TEMPLATES} />
            <AutomationsCard
              slug={slug}
              templates={tpl.filter((t) => t.status === 'APPROVED')}
              stages={[...stageMap.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))}
              triggers={Object.entries(TRIGGER_INFO).map(([value, i]) => ({ value, label: i.label, vars: i.vars }))}
              rules={rules.map((r) => ({
                id: r.id,
                trigger: r.trigger,
                triggerLabel: TRIGGER_INFO[r.trigger].label,
                stage: r.stageKey ? (stageMap.get(r.stageKey) ?? r.stageKey) : null,
                template: r.templateName,
                active: r.active,
              }))}
            />
            {w.sandbox && <SimulatorCard slug={slug} />}
          </>
        )}
      </div>
    );
  }

  async function PlanTab() {
    const s = ctx.subscription!;
    const [seatsUsed, credits, invoices] = await Promise.all([
      db(ctx, (tx) => tx.membership.count({ where: { active: true } })),
      creditSummary(ctx.tenant.id),
      db(ctx, (tx) => tx.platformInvoice.findMany({ orderBy: { paidAt: 'desc' }, take: 24 })),
    ]);
    const currency = ctx.tenant.country === 'IN' ? 'INR' : 'USD';
    const sub = {
      plan: s.plan as PlanId,
      interval: s.interval as Interval,
      status: s.status as SubStatus,
      seats: s.seats,
      seatsUsed,
      trialDaysLeft: s.trialEndsAt ? Math.max(0, Math.ceil((s.trialEndsAt.getTime() - Date.now()) / 86400_000)) : null,
      renews: s.currentPeriodEnd ? fmtDate(s.currentPeriodEnd, ctx.tenant.timezone) : null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      provider: s.provider,
      discountPct: s.discountPct,
      currency: currency as 'INR' | 'USD',
    };
    return (
      <div className="flex flex-col gap-5">
        <CurrentPlan slug={slug} sub={sub} paid={sp.paid === '1'} />
        <PlanPicker slug={slug} sub={sub} />
        {/* Plans without AI features have no credits to show or buy. */}
        {hasAi(s) && <CreditsCard slug={slug} credits={credits} currency={sub.currency} sandboxAi={!platformStatus().llm} />}
        <Card>
          <CardHeader title="Invoices from Kicko" sub="GST tax invoices for your subscription and credits" />
          <ul className="divide-y divide-line">
            {invoices.length === 0 && <li className="px-5 py-5 text-sm text-muted">No invoices yet.</li>}
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-mono text-xs">{i.number}</span>
                <span className="min-w-0 flex-1 text-ink-2">{i.description}</span>
                <span className="text-xs text-muted">{fmtDate(i.paidAt, ctx.tenant.timezone)}</span>
                <span className="font-bold tabular-nums">{formatMoney(i.total, i.currency)}</span>
                <a href={`/api/t/${slug}/kicko-invoices/${i.id}`} target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline underline-offset-4">PDF</a>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  async function VoiceTab() {
    if (!hasFeature(ctx.subscription!, 'voice_agent')) return <UpgradeCard slug={slug} feature="voice_agent" canManage={can(ctx.role, 'settings.manage')} />;
    const scope = scopeOf(ctx);
    const cfg = voiceSettings(ctx.tenant.settings);
    const [conn, status, { prompt }, queued] = await Promise.all([
      connectionSummary(ctx.tenant.id, 'voice_agent'),
      syncStatus(scope),
      buildPrompt(scope, cfg),
      db(ctx, (tx) => tx.call.findMany({ where: { aiAgent: true, status: 'QUEUED' }, include: { lead: true, client: true }, orderBy: { scheduledAt: 'asc' }, take: 20 })),
    ]);
    return (
      <div className="flex flex-col gap-5">
        <ConnectionCard
          slug={slug}
          tz={ctx.tenant.timezone}
          capability="voice_agent"
          title="AI voice agent provider"
          sub="The agent runs on your own provider account. Bolna for Indian languages, Retell elsewhere."
          providers={providerOptions('voice_agent')}
          conn={conn}
          webhookBase={`${base}/api/webhooks/voice_agent`}
          sandboxNote="Voice agent sandbox: no phones ring. Scripted callers talk to the agent, which uses the real tools (save details, book, callback), and notes are written as on a real call."
        />
        <VoiceAgentCard slug={slug} cfg={cfg} questions={Object.entries(QUESTIONS).map(([key, q]) => ({ key, label: q.label }))} connected={Boolean(conn)} />
        <VoiceSyncCard slug={slug} tz={ctx.tenant.timezone} status={status} prompt={prompt} tools={TOOLS.map(({ name, description }) => ({ name, description }))} />
        <VoiceQueueCard
          slug={slug}
          queued={queued.map((q) => ({ id: q.id, name: fullName((q.client ?? q.lead)!), when: q.scheduledAt ? fmtDate(q.scheduledAt, ctx.tenant.timezone, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '', attempt: q.attempt }))}
        />
        {conn?.sandbox && <VoiceSimulatorCard slug={slug} personas={PERSONAS.map(({ id, label }) => ({ id, label }))} />}
      </div>
    );
  }

  async function AssistantTab() {
    if (!hasFeature(ctx.subscription!, 'wa_assistant')) return <UpgradeCard slug={slug} feature="wa_assistant" canManage={can(ctx.role, 'settings.manage')} />;
    const [wa, items] = await Promise.all([
      connectionSummary(ctx.tenant.id, 'messaging'),
      db(ctx, (tx) => tx.knowledgeItem.findMany({ orderBy: { createdAt: 'asc' } })),
    ]);
    const cfg = assistantSettings(ctx.tenant.settings);
    return (
      <div className="flex flex-col gap-5">
        <AssistantSettingsCard slug={slug} cfg={cfg} connected={Boolean(wa)} />
        <div className="grid gap-5 lg:grid-cols-2">
          <KnowledgeCard slug={slug} items={items.map(({ id, question, answer, active }) => ({ id, question, answer, active }))} />
          <PlaygroundCard slug={slug} name={cfg.name} />
        </div>
      </div>
    );
  }

  async function CallingTab() {
    if (!hasFeature(ctx.subscription!, 'calling')) return <UpgradeCard slug={slug} feature="calling" canManage={can(ctx.role, 'settings.manage')} />;
    const [conn, team] = await Promise.all([connectionSummary(ctx.tenant.id, 'telephony'), getTeam(ctx)]);
    const me = team.find((m) => m.userId === ctx.user.id);
    const ai = platformStatus();
    return (
      <div className="flex flex-col gap-5">
        <ConnectionCard
          slug={slug}
          tz={ctx.tenant.timezone}
          capability="telephony"
          title="Phone calls"
          sub="Each agency uses its own calling account and numbers. Exotel for India, Twilio elsewhere."
          providers={providerOptions('telephony')}
          conn={conn}
          webhookBase={`${base}/api/webhooks/telephony`}
          sandboxNote="Calling sandbox: no phones ring. Calls play scripted conversations through the real webhooks, so routing, recordings, transcripts and AI notes all work."
        />
        <MyPhoneCard slug={slug} phone={me?.phone ?? null} />
        <CallingPrefsCard slug={slug} cfg={callingSettings(ctx.tenant.settings)} />
        <Card>
          <CardHeader title="Who gets incoming calls" sub="The client's owner if they have a phone set, otherwise everyone below" />
          <ul className="divide-y divide-line">
            {team.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1 text-sm font-semibold">{m.name}</span>
                {m.phone ? <span className="text-[13px] text-ink-2 tabular-nums">{m.phone}</span> : <Badge>No phone</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="AI services" sub="Run by Kicko, shared by all workspaces, metered per workspace" />
          <ul className="divide-y divide-line text-sm">
            <li className="flex flex-wrap items-center gap-3 px-5 py-3"><span className="flex-1 font-semibold">AI model (call notes)</span>{ai.llm ? <Badge tone="ok">{ai.llm}</Badge> : <Badge tone="ink">Sandbox · keyword rules</Badge>}</li>
            <li className="flex flex-wrap items-center gap-3 px-5 py-3"><span className="flex-1 font-semibold">Transcription</span>{ai.stt ? <Badge tone="ok">{ai.stt}</Badge> : <Badge tone="ink">Sandbox · scripted calls only</Badge>}</li>
          </ul>
        </Card>
        {conn?.sandbox && <CallSimulatorCard slug={slug} scripts={CALL_SCRIPTS.map(({ id, label }) => ({ id, label }))} />}
      </div>
    );
  }

  async function BillingTab() {
    const [packages, products, gateway] = await Promise.all([
      listPackages(ctx, { includeInactive: true }),
      listProducts(ctx),
      connectionSummary(ctx.tenant.id, 'payments'),
    ]);
    return (
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Invoice details" sub="Printed on every invoice and receipt" />
          <div className="p-5"><BillingDetailsForm slug={slug} billing={ctx.tenant.settings.billing} /></div>
        </Card>
        <PackagesCard
          slug={slug}
          products={products.map((p) => ({ id: p.id, label: `${countryName(p.country)} · ${p.name}` }))}
          packages={packages.map((p) => ({ id: p.id, name: p.name, description: p.description, productId: p.productId, price: p.price, taxRate: p.taxRate, plan: p.plan as PlanStep[], active: p.active }))}
        />
        <ConnectionCard
          slug={slug}
          tz={ctx.tenant.timezone}
          capability="payments"
          title="Online payment links"
          sub="Use your agency's own gateway account. Money goes straight to you."
          providers={providerOptions('payments')}
          conn={gateway}
          webhookBase={`${base}/api/webhooks/payments`}
          sandboxNote="Sandbox payments: links open a test checkout inside Kicko. Nothing is charged."
        />
      </div>
    );
  }

  async function TeamTab({ slug, ctxRole, me }: { slug: string; ctxRole: typeof ctx.role; me: string }) {
    const [team, invites, branches, homes] = await Promise.all([
      getTeam(ctx),
      listInvites(ctx),
      db(ctx, (tx) => tx.branch.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } })),
      db(ctx, (tx) => tx.membership.findMany({ where: { active: true }, select: { userId: true, branchId: true, hours: true } })),
    ]);
    const home = (userId: string) => homes.find((h) => h.userId === userId)?.branchId ?? null;
    const ownHours = (userId: string) => parseHours(homes.find((h) => h.userId === userId)?.hours);
    const office = agencyHours(scopeOf(ctx));
    return (
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Members" sub={`${team.length} active`} />
          <ul className="divide-y divide-line">
            {team.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{m.name} {m.userId === me && <span className="text-xs text-muted">(you)</span>}</div>
                  <div className="text-xs text-muted">{m.email}</div>
                </div>
                {branches.length > 1 && (
                  <BranchSelect id={`branch-${m.userId}`} value={home(m.userId)} branches={branches} save={setMemberBranchAction.bind(null, slug, m.userId)} label={`Branch for ${m.name}`} />
                )}
                <MemberHours slug={slug} userId={m.userId} name={m.name} hours={ownHours(m.userId)} agency={office} />
                <MemberControls slug={slug} userId={m.userId} role={m.role} isMe={m.userId === me} canMakeOwner={ctxRole === 'OWNER'} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Invite a teammate" sub="Share the link with them. It expires in 7 days." />
          <div className="p-5"><InviteForm slug={slug} /></div>
          {invites.length > 0 && (
            <ul className="divide-y divide-line border-t border-line">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1 text-sm"><span className="font-semibold">{i.email}</span> <span className="text-muted">· {ROLE_LABEL[i.role]} · expires {fmtDate(i.expiresAt, ctx.tenant.timezone)}</span></div>
                  <RevokeInvite slug={slug} id={i.id} link={`${base}/invite/${slug}/${i.token}`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }
}

async function WorkflowsTab({ slug, productId, country, ctx }: { slug: string; productId?: string; country?: string; ctx: Awaited<ReturnType<typeof getCtx>> }) {
  const scope = scopeOf(ctx);
  const [products, updates, form] = await Promise.all([listProducts(ctx, { includeInactive: true }), libraryUpdates(scope), packForm(scope, 'leads')]);
  const selected = products.find((p) => p.id === productId);
  const workflowWord = form.labels.workflows ?? 'Workflows';
  if (selected) {
    const checklistItems = selected.checklist as ChecklistItem[];
    const update = updates.get(selected.id);
    return (
      <div className="flex flex-col gap-5">
        {update && <LibraryUpdateBanner slug={slug} productId={selected.id} from={selected.libraryVersion ?? 1} to={update} />}
        <Card>
          <CardHeader
            title={`${countryName(selected.country)} · ${selected.name}`}
            sub={`${form.categories[selected.category] ?? selected.category} · ${selected.code}${selected.libraryKey ? ' · from the Kicko library' : ' · your own'}`}
            action={<Link href="?tab=workflows" className="text-[13px] font-semibold text-muted hover:text-ink">← All workflows</Link>}
          />
          <div className="p-5">
            <ProductEditor
              slug={slug}
              id={selected.id}
              name={selected.name}
              active={selected.active}
              stages={stagesToText(selected.stages as Stage[], checklistItems)}
              checklist={checklistToText(checklistItems)}
              groups={Object.entries(form.groupLabels.occupation ?? {})}
            />
          </div>
        </Card>
        {Object.keys((selected.info as object) ?? {}).length > 0 && (
          <Card>
            <CardHeader title="Reference info" sub="Shown on leads and cases. From the library, as published by the authority; not legal advice." />
            <div className="p-5 pt-1"><PathwayInfo info={selected.info} open /></div>
          </Card>
        )}
      </div>
    );
  }
  const countries = form.regionType ? (form.lookups[form.regionType] ?? []) : [];
  const pick = country && countries.some((c) => c.key === country) ? country : undefined;
  const pathways = pick ? await libraryPathways(scope, pick) : [];
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Add from the Kicko library" sub="Every country, with visa pathways checked against official sources. Adding one copies it into your workflows to edit." />
        <div className="flex flex-col gap-4 p-5">
          <form className="flex flex-wrap items-end gap-2.5">
            <input type="hidden" name="tab" value="workflows" />
            <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-[13px] font-semibold text-ink-2">
              Country
              <select name="country" defaultValue={pick ?? ''} className={inputCls}>
                <option value="">Choose a country</option>
                {countries.map((c) => (
                  <option key={c.key} value={c.key}>{c.name}{form.pathwayCount[c.key] ? ` (${form.pathwayCount[c.key]})` : ''}</option>
                ))}
              </select>
            </label>
            <button className={buttonCls('secondary')}>Show pathways</button>
          </form>
          {pick && (
            <ul className="divide-y divide-line rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line-2)]">
              {pathways.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted">No researched pathways for {countryName(pick)} yet. Create your own below from a starting template.</li>
              )}
              {pathways.map((p) => (
                <li key={p.key} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-24 text-xs font-bold text-muted uppercase">{form.categories[p.template.category] ?? p.template.category}</span>
                    <span className="min-w-0 flex-1 font-semibold">{p.name}</span>
                    <span className="text-xs text-muted">{p.template.stages.length} stages · {p.template.checklist.length} docs</span>
                    {p.unverified && <Badge tone="warn">Partly verified</Badge>}
                    {p.adoptedId ? (
                      <Link href={`?tab=workflows&product=${p.adoptedId}`} className={buttonCls('ghost', 'sm')}>Added · Edit</Link>
                    ) : (
                      <AdoptButton slug={slug} pathKey={p.key} name={p.name} />
                    )}
                  </div>
                  <PathwayInfo info={p.template.info} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Create your own" sub="For any country or service. Starts from a template you can edit." />
        <div className="p-5">
          <CustomWorkflowForm slug={slug} countries={countries.map((c) => ({ key: c.key, name: c.name }))} categories={Object.entries(form.categories)} defaultCountry={pick} />
        </div>
      </Card>
      <Card>
        <CardHeader title={`Your ${workflowWord.toLowerCase()}`} sub="Stages and document checklists. Edits shape new cases; open cases keep the workflow they started with." />
        <ul className="divide-y divide-line">
          {products.map((p) => (
            <li key={p.id}>
              <Link href={`?tab=workflows&product=${p.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
                <span className="w-28 text-xs font-bold text-muted uppercase">{form.categories[p.category] ?? p.category}</span>
                <span className="min-w-0 flex-1 font-semibold">{countryName(p.country)} · {p.name}</span>
                <span className="text-xs text-muted">{(p.stages as Stage[]).length} stages · {(p.checklist as ChecklistItem[]).length} docs</span>
                {updates.has(p.id) && <Badge tone="info">Update available</Badge>}
                {!p.active && <Badge>Hidden</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

async function TemplatesTab({ slug, ctx, templateId }: { slug: string; ctx: Awaited<ReturnType<typeof getCtx>>; templateId?: string }) {
  const templates = await listTemplates(scopeOf(ctx));
  const selected = templateId === 'new' ? null : templates.find((t) => t.id === templateId);
  if (selected || templateId === 'new') {
    return (
      <Card>
        <CardHeader title={selected?.name ?? 'New template'} action={<Link href="?tab=templates" className="text-[13px] font-semibold text-muted hover:text-ink">← All templates</Link>} />
        <div className="p-5"><TemplateEditor slug={slug} template={selected ?? undefined} fields={CORE_FIELDS} /></div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader
        title="Agreements & letters"
        sub="Created on a case from its details; agreements are signed by the client in the portal. Starting points only: have your lawyer review them."
        action={<Link href="?tab=templates&template=new" className={buttonCls('primary', 'sm')}>+ Template</Link>}
      />
      <ul className="divide-y divide-line">
        {templates.map((t) => (
          <li key={t.id}>
            <Link href={`?tab=templates&template=${t.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
              <span className="w-24 text-xs font-bold text-muted uppercase">{t.kind}</span>
              <span className="min-w-0 flex-1 font-semibold">{t.name}</span>
              {t.signature && <Badge tone="info">Signed by client</Badge>}
              {!t.active && <Badge>Not in use</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

async function ListsTab({ slug, ctx, list }: { slug: string; ctx: Awaited<ReturnType<typeof getCtx>>; list?: string }) {
  const scope = scopeOf(ctx);
  const { pack, settings } = await tenantPack(scope);
  const types = Object.entries(pack.libraryTypes).filter(([t]) => t !== pack.workflowType);
  const type = types.some(([t]) => t === list) ? list! : (types.find(([t]) => t === 'occupation')?.[0] ?? types[0]![0]);
  const [lib, own] = await Promise.all([libraryList(pack.id, type), ownItems(scope, pack.id, type)]);
  const hidden = new Set(own.filter((o) => o.hidden).map((o) => o.key));
  const mine = own.filter((o) => o.key.startsWith('own_'));
  const groupLabels = pack.groupLabels?.[type];
  const hiddenFields = new Set(settings.hiddenFields ?? []);
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Fields on your forms" sub={`Added by the ${pack.name} pack. Hide the ones you don't use; saved values are kept.`} />
        <ul className="divide-y divide-line">
          {pack.fields.map((f) => {
            const off = hiddenFields.has(`${f.entity}.${f.key}`);
            return (
              <li key={`${f.entity}.${f.key}`} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <span className="w-20 text-xs font-bold text-muted uppercase">{f.entity}</span>
                <span className={clsx('min-w-0 flex-1 text-sm font-semibold', off && 'text-muted line-through')}>{f.label}</span>
                <FieldToggle slug={slug} entity={f.entity} fieldKey={f.key} hidden={off} />
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Lists" sub="From the Kicko library. Add your own entries or hide ones you never use." />
        <div className="flex flex-wrap gap-2 px-5 pt-1">
          {types.map(([t, def]) => (
            <Link key={t} href={`?tab=lists&list=${t}`} className={clsx('rounded-full px-3 py-1.5 text-xs font-semibold', t === type ? 'bg-ink text-paper' : 'bg-paper-2 text-ink-2 hover:bg-paper-3')}>{def.plural}</Link>
          ))}
        </div>
        <div className="p-5"><OwnItemForm slug={slug} type={type} groups={groupLabels ? Object.entries(groupLabels) : undefined} /></div>
        <ul className="divide-y divide-line border-t border-line">
          {mine.map((o) => (
            <li key={o.key} className="flex items-center gap-3 px-5 py-2">
              <span className="min-w-0 flex-1 text-sm font-semibold">{o.name} <Badge className="ml-1">Yours</Badge></span>
              <HideToggle slug={slug} type={type} itemKey={o.key} hidden={false} />
            </li>
          ))}
          {lib.map((o) => (
            <li key={o.key} className="flex items-center gap-3 px-5 py-2">
              <span className={clsx('min-w-0 flex-1 text-sm', hidden.has(o.key) && 'text-muted line-through')}>
                {o.name}
                {o.group && <span className="ml-2 text-xs text-muted">{groupLabels?.[o.group] ?? o.group}</span>}
              </span>
              <HideToggle slug={slug} type={type} itemKey={o.key} hidden={hidden.has(o.key)} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

async function AutomationsTab({ slug, ctx, ruleId }: { slug: string; ctx: Awaited<ReturnType<typeof getCtx>>; ruleId?: string }) {
  const scope = scopeOf(ctx);
  const [rows, runs, team, products, form] = await Promise.all([
    db(ctx, (tx) => tx.rule.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { runs: true } } } })),
    db(ctx, (tx) => tx.automationRun.findMany({ orderBy: { at: 'desc' }, take: 25, include: { rule: { select: { name: true } } } })),
    getTeam(ctx),
    listProducts(ctx),
    packForm(scope, 'leads'),
  ]);
  const triggers = Object.entries(TRIGGERS).map(([key, t]) => ({ key, label: t.label, conditions: [...t.conditions] }));
  const countries = form.regionType ? (form.lookups[form.regionType] ?? []) : [];
  const choices: Record<string, [string, string][]> = {
    status: LEAD_STATUSES.map((x) => [x, LEAD_STATUS_LABEL[x]]),
    source: LEAD_SOURCES.map((x) => [x, LEAD_SOURCE_LABEL[x]]),
    country: countries.map((c) => [c.key, c.name]),
    category: Object.entries(form.categories),
    productId: products.map((p) => [p.id, `${countryName(p.country)} · ${p.name}`]),
  };
  const editorProps = { slug, triggers, actionTypes: Object.entries(ACTION_LABEL) as [string, string][], conditionLabels: CONDITION_LABEL, choices, team: team.map((m) => [m.userId, m.name] as [string, string]) };
  const selected = ruleId === 'new' ? null : rows.find((r) => r.id === ruleId);
  if (selected || ruleId === 'new') {
    return (
      <Card>
        <CardHeader title={selected?.name ?? 'New automation'} action={<Link href="?tab=automations" className="text-[13px] font-semibold text-muted hover:text-ink">← All automations</Link>} />
        <div className="p-5">
          <RuleEditor
            {...editorProps}
            rule={selected ? { id: selected.id, name: selected.name, trigger: selected.trigger, conditions: selected.conditions as Record<string, string>, actions: selected.actions as never, active: selected.active } : undefined}
          />
        </div>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Automations"
          sub="When something happens, Kicko creates tasks, assigns owners, notifies people or messages the client. Runs after the change is saved; each action is tried up to 3 times."
          action={<Link href="?tab=automations&rule=new" className={buttonCls('primary', 'sm')}>+ Automation</Link>}
        />
        <ul className="divide-y divide-line">
          {rows.length === 0 && <li className="px-5 py-4 text-sm text-muted">No automations yet. Examples: assign Gulf work-visa leads to your Gulf desk, or create a medical booking task when a case reaches Medical.</li>}
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`?tab=automations&rule=${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r.name}</span>
                  <span className="text-xs text-muted">{TRIGGERS[r.trigger as keyof typeof TRIGGERS]?.label ?? r.trigger} · {(r.actions as { type: keyof typeof ACTION_LABEL }[]).map((a) => ACTION_LABEL[a.type]).join(', ')}</span>
                </span>
                <span className="text-xs text-muted">{r._count.runs} runs</span>
                {!r.active && <Badge>Off</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Recent runs" />
        <ul className="divide-y divide-line">
          {runs.length === 0 && <li className="px-5 py-4 text-sm text-muted">Nothing has run yet.</li>}
          {runs.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
              <Badge tone={r.status === 'ok' ? 'ok' : r.status === 'partial' ? 'warn' : 'danger'}>{r.status}</Badge>
              <span className="min-w-0 flex-1 font-semibold">{r.rule.name}</span>
              <span className="text-xs text-muted">{(r.results as { detail: string }[]).map((x) => x.detail).join(' · ')}</span>
              <span className="text-xs text-faint">{fmtDate(r.at, ctx.tenant.timezone)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
