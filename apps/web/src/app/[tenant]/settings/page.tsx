import clsx from 'clsx';
import Link from 'next/link';
import type { ChecklistItem, Stage } from '@kicko/db/visa-catalog';
import { Badge, Card, CardHeader, EmptyState, PageHeader } from '@/components/ui';
import { CATEGORY_LABEL, COUNTRIES } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { can, ROLE_LABEL } from '@/lib/permissions';
import { getCtx, getTeam } from '@/lib/tenant';
import { listInvites, listProducts } from '@/server/queries';
import { GeneralForm, InviteForm, LeadCapture, MemberControls, ProductEditor, RevokeInvite } from './settings-forms';
import { BillingDetailsForm, PackagesCard } from './billing-settings';
import { ConnectionCard } from './connection-card';
import { UpgradeCard } from '@/components/upgrade';
import { hasFeature } from '@/lib/plans';
import { IntegrationsTab } from './integrations-tab';
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

export const metadata = { title: 'Settings' };
const TABS = [
  ['general', 'General'],
  ['plan', 'Plan & billing'],
  ['team', 'Team'],
  ['billing', 'Billing'],
  ['portal', 'Client portal'],
  ['whatsapp', 'WhatsApp'],
  ['assistant', 'AI assistant'],
  ['calling', 'Calling'],
  ['voice', 'AI voice agent'],
  ['integrations', 'Integrations'],
  ['capture', 'Lead capture'],
  ['workflows', 'Visa workflows'],
] as const;

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ tab?: string; product?: string; paid?: string }>;
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

      {tab === 'plan' && <PlanTab />}

      {tab === 'billing' && <BillingTab />}

      {tab === 'whatsapp' && <WhatsAppTab />}

      {tab === 'calling' && <CallingTab />}

      {tab === 'assistant' && <AssistantTab />}

      {tab === 'voice' && <VoiceTab />}

      {tab === 'integrations' && <IntegrationsTab tenantId={ctx.tenant.id} slug={slug} docChecks={ctx.tenant.settings.ai?.docChecks !== false} />}

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

      {tab === 'workflows' && <WorkflowsTab slug={slug} productId={sp.product} ctx={ctx} />}
    </div>
  );

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
        <CreditsCard slug={slug} credits={credits} currency={sub.currency} sandboxAi={!platformStatus().llm} />
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
          products={products.map((p) => ({ id: p.id, label: `${COUNTRIES[p.country] ?? p.country} · ${p.name}` }))}
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
    const [team, invites] = await Promise.all([getTeam(ctx), listInvites(ctx)]);
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

async function WorkflowsTab({ slug, productId, ctx }: { slug: string; productId?: string; ctx: Awaited<ReturnType<typeof getCtx>> }) {
  const products = await listProducts(ctx, { includeInactive: true });
  const selected = products.find((p) => p.id === productId);
  if (selected) {
    const stages = (selected.stages as Stage[]).map((s) => s.name).join('\n');
    const checklist = (selected.checklist as ChecklistItem[]).map((i) => `${i.group}: ${i.name}${i.required ? '' : ' (optional)'}`).join('\n');
    return (
      <Card>
        <CardHeader title={`${COUNTRIES[selected.country] ?? selected.country} · ${selected.name}`} sub={`${CATEGORY_LABEL[selected.category]} · ${selected.code}`} action={<Link href="?tab=workflows" className="text-[13px] font-semibold text-muted hover:text-ink">← All workflows</Link>} />
        <div className="p-5"><ProductEditor slug={slug} id={selected.id} name={selected.name} active={selected.active} stages={stages} checklist={checklist} /></div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Visa workflows" sub="Stages and document checklists for each visa product. Changes apply to new and existing cases." />
      <ul className="divide-y divide-line">
        {products.map((p) => (
          <li key={p.id}>
            <Link href={`?tab=workflows&product=${p.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper-3">
              <span className="w-28 text-xs font-bold text-muted uppercase">{CATEGORY_LABEL[p.category]}</span>
              <span className="min-w-0 flex-1 font-semibold">{COUNTRIES[p.country] ?? p.country} · {p.name}</span>
              <span className="text-xs text-muted">{(p.stages as Stage[]).length} stages · {(p.checklist as ChecklistItem[]).length} docs</span>
              {!p.active && <Badge>Hidden</Badge>}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
