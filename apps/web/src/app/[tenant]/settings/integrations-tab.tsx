import Link from 'next/link';
import { withTenant } from '@kicko/db';
import { Badge, Card, CardHeader } from '@/components/ui';
import { connectionSummary, providersFor } from '@/integrations/core/connections';
import { TENANT_CAPABILITIES } from '@/integrations/core/registry';
import { CAPABILITY_INFO, type Capability } from '@/integrations/core/types';
import { usageSummary } from '@/integrations/core/usage';
import { platformStatus } from '@/integrations/core/platform';
import { emailEnabled } from '@/server/email';
import { storageDriver } from '@/server/storage';
import { AiFeaturesCard } from './ai-features';

// Overview of every external service the workspace uses, and what it consumed.

const WHERE: Partial<Record<Capability, string>> = { messaging: 'whatsapp', payments: 'billing', telephony: 'calling', voice_agent: 'voice' };

const UNIT_LABEL: Record<string, string> = {
  message: 'messages',
  email: 'emails',
  link: 'payment links',
  payment: 'payments received',
  minute: 'minutes',
  input_token: 'input tokens',
  output_token: 'output tokens',
  byte: 'bytes',
};

export async function IntegrationsTab({ tenantId, slug, docChecks, improve }: { tenantId: string; slug: string; docChecks: boolean; improve: boolean }) {
  const [summaries, usage, shared] = await Promise.all([
    Promise.all(TENANT_CAPABILITIES.map(async (c) => [c, await connectionSummary(tenantId, c)] as const)),
    usageSummary(tenantId, 30),
    withTenant(tenantId, (tx) => tx.aiFeedback.count()),
  ]);
  const platform = [
    { cap: 'storage' as const, value: storageDriver === 's3' ? 'S3-compatible storage' : 'Local disk (development)' },
    { cap: 'email' as const, value: emailEnabled() ? 'Resend' : 'Not configured: links are shown to copy' },
    { cap: 'llm' as const, value: platformStatus().llm ?? 'Sandbox (keyword rules)' },
    { cap: 'stt' as const, value: platformStatus().stt ?? 'Sandbox (scripted calls only)' },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Your connections" sub="Each service uses your agency's own account. Providers can be switched at any time." />
        <ul className="divide-y divide-line">
          {summaries.map(([cap, s]) => {
            const info = CAPABILITY_INFO[cap];
            const providers = providersFor(cap);
            const where = WHERE[cap];
            return (
              <li key={cap} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold">{info.label}</div>
                  <div className="text-xs text-muted">
                    {info.description}
                    {providers.length > 0 && <> · {providers.map((p) => p.name).join(', ')}</>}
                  </div>
                </div>
                {providers.length === 0 ? (
                  <Badge>Coming in Phase 5</Badge>
                ) : (
                  <>
                    {s ? (
                      <Badge tone={s.status === 'error' ? 'danger' : s.sandbox ? 'ink' : 'ok'}>
                        {s.status === 'error' ? 'Check failed' : s.sandbox ? `Sandbox · ${s.providerName}` : s.providerName}
                      </Badge>
                    ) : (
                      <Badge>Not connected</Badge>
                    )}
                    {where && (
                      <Link href={`?tab=${where}`} className="text-[13px] font-semibold text-ink hover:underline">
                        {s ? 'Manage' : 'Connect'}
                      </Link>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <AiFeaturesCard slug={slug} docChecks={docChecks} improve={improve} shared={shared} />

      <Card>
        <CardHeader title="Usage" sub="Last 30 days, across all providers" />
        {usage.length === 0 ? (
          <p className="px-5 py-5 text-sm text-muted">Nothing used yet.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="px-5 py-2 font-semibold">Service</th>
                <th className="px-5 py-2 font-semibold">Provider</th>
                <th className="px-5 py-2 text-right font-semibold">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {usage.map((u) => (
                <tr key={`${u.capability}-${u.provider}-${u.unit}`}>
                  <td className="px-5 py-2.5 font-semibold">{CAPABILITY_INFO[u.capability as Capability]?.label ?? u.capability}</td>
                  <td className="px-5 py-2.5 text-ink-2">{u.provider}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    <strong>{(u._sum.quantity ?? 0).toLocaleString('en-IN')}</strong> {UNIT_LABEL[u.unit] ?? u.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <CardHeader title="Platform services" sub="Run by Kicko for every workspace" />
        <ul className="divide-y divide-line">
          {platform.map((p) => (
            <li key={p.cap} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{CAPABILITY_INFO[p.cap].label}</div>
                <div className="text-xs text-muted">{CAPABILITY_INFO[p.cap].description}</div>
              </div>
              <span className="text-[13px] text-ink-2">{p.value}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
