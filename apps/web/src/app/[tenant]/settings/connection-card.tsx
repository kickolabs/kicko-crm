'use client';

import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { ActionButton, ActionForm, CopyField, FormBanner, FormField, SubmitButton } from '@/components/forms';
import { Badge, Button, Card, CardHeader, Input } from '@/components/ui';
import { fmtDateTime } from '@/lib/format';
import type { ConnectionSummary, ProviderOption } from '@/integrations/core/connections';
import { removeConnectionAction, saveConnectionAction, testConnectionAction } from '../actions-integrations';

// One card per capability, generated from the provider descriptors: adding a
// provider to the registry makes it appear here with its own connect form.

export function ConnectionCard({
  slug,
  capability,
  title,
  sub,
  providers,
  conn,
  webhookBase,
  sandboxNote,
  tz,
}: {
  slug: string;
  capability: string;
  title: string;
  sub: string;
  providers: ProviderOption[];
  conn: ConnectionSummary | null;
  /** `${appUrl}/api/webhooks/${capability}`; the provider id and workspace are appended. */
  webhookBase: string;
  sandboxNote?: string;
  /** Workspace timezone: dates must render the same on the server and in the browser. */
  tz: string;
}) {
  const [open, setOpen] = useState<string | null>(conn && !conn.sandbox ? conn.provider : null);
  const [saved, setSaved] = useState(false);
  const current = providers.find((p) => p.id === conn?.provider);

  return (
    <Card>
      <CardHeader title={title} sub={sub} action={<StatusBadge conn={conn} />} />
      <div className="flex flex-col gap-4 p-5">
        {saved && <FormBanner tone="ok">Saved.</FormBanner>}
        {conn?.sandbox && sandboxNote && <FormBanner tone="warn">{sandboxNote}</FormBanner>}
        {conn?.status === 'error' && conn.lastError && <FormBanner tone="error">Last check failed: {conn.lastError}</FormBanner>}

        {conn && current && (
          <div className="flex flex-col gap-3">
            <div className="text-[13px] text-ink-2">
              Using <strong>{current.name}</strong>
              {conn.lastCheckedAt && conn.status === 'active' && <span className="text-muted"> · checked {fmtDateTime(conn.lastCheckedAt, tz)}</span>}
            </div>
            {(current.webhook || current.fields.some((f) => f.generated && !f.secret)) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {current.webhook && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-ink-2">Webhook URL</span>
                    <CopyField value={`${webhookBase}/${current.id}/${slug}${suffix(current.webhookSuffix, conn.values)}`} label="Webhook URL" />
                  </div>
                )}
                {current.fields
                  .filter((f) => f.generated && !f.secret)
                  .map((f) => (
                    <div key={f.key} className="flex flex-col gap-1.5">
                      <span className="text-[13px] font-semibold text-ink-2">{f.label}</span>
                      <CopyField value={conn.values[f.key] ?? ''} label={f.label} />
                    </div>
                  ))}
              </div>
            )}
            <div className="flex flex-wrap items-start gap-2">
              <TestButton slug={slug} capability={capability} />
              <ActionButton
                action={() => removeConnectionAction(slug, capability)}
                variant="ghost"
                size="md"
                confirm={`Disconnect ${current.name}? History stays; new activity stops syncing.`}
              >
                Disconnect
              </ActionButton>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {conn && <span className="eyebrow">Providers</span>}
          {providers.map((p) => {
            const inputs = p.fields.filter((f) => !f.generated);
            const isCurrent = conn?.provider === p.id;
            const expanded = open === p.id;
            return (
              <div key={p.id} className={clsx('rounded-[14px] shadow-[inset_0_0_0_1px_var(--color-line)]', expanded && 'bg-paper-3')}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      {p.name}
                      {p.sandbox && <Badge tone="ink">No account needed</Badge>}
                      {isCurrent && <Badge tone="ok">In use</Badge>}
                    </div>
                    <div className="text-xs text-muted">{p.description}</div>
                  </div>
                  {inputs.length === 0 ? (
                    !isCurrent && (
                      <ActionForm action={saveConnectionAction.bind(null, slug, capability, p.id)} onSuccess={() => setSaved(false)}>
                        <SubmitButton variant={conn ? 'secondary' : 'primary'}>{p.connectLabel}</SubmitButton>
                      </ActionForm>
                    )
                  ) : (
                    <Button aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)}>
                      {isCurrent ? 'Edit' : 'Set up'} <ChevronDown size={14} className={clsx('transition-transform', expanded && 'rotate-180')} />
                    </Button>
                  )}
                </div>
                {expanded && inputs.length > 0 && (
                  <ActionForm
                    action={saveConnectionAction.bind(null, slug, capability, p.id)}
                    onSuccess={() => setSaved(true)}
                    className="flex flex-col gap-3.5 border-t border-line px-4 pt-3.5 pb-4"
                  >
                    {p.guide.length > 0 && (
                      <ol className="list-decimal pl-5 text-[13px] leading-relaxed text-ink-2">
                        {p.guide.map((g) => <li key={g}>{g}</li>)}
                      </ol>
                    )}
                    {p.webhook && !isCurrent && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[13px] font-semibold text-ink-2">Webhook URL for {p.name}</span>
                        <CopyField value={`${webhookBase}/${p.id}/${slug}`} label={`${p.name} webhook URL`} />
                      </div>
                    )}
                    <div className="grid gap-3 sm:grid-cols-3">
                      {inputs.map((f) => {
                        const kept = isCurrent && f.secret && conn?.secretsSet.includes(f.key);
                        return (
                          <FormField key={f.key} label={f.label} name={f.key} hint={kept ? 'Saved. Leave blank to keep' : (f.hint ?? undefined)}>
                            <Input
                              name={f.key}
                              type={f.secret ? 'password' : 'text'}
                              autoComplete="off"
                              placeholder={f.placeholder ?? undefined}
                              defaultValue={isCurrent && !f.secret ? (conn?.values[f.key] ?? '') : ''}
                              required={f.required && !kept}
                            />
                          </FormField>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <SubmitButton>{isCurrent ? 'Save changes' : p.connectLabel}</SubmitButton>
                      {p.docsUrl && (
                        <a href={p.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink">
                          Provider docs <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </ActionForm>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted">Keys are encrypted at rest (AES-256-GCM) and never shown again after saving.</p>
      </div>
    </Card>
  );
}

const suffix = (tpl: string, values: Record<string, string>) => tpl.replace(/{(w+)}/g, (_, k: string) => encodeURIComponent(values[k] ?? ''));

function StatusBadge({ conn }: { conn: ConnectionSummary | null }) {
  if (!conn) return <Badge>Not connected</Badge>;
  if (conn.status === 'error') return <Badge tone="danger">Check failed</Badge>;
  if (conn.sandbox) return <Badge tone="ink">Sandbox</Badge>;
  return <Badge tone="ok">Connected</Badge>;
}

function TestButton({ slug, capability }: { slug: string; capability: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await testConnectionAction(slug, capability);
            setMsg(r.ok ? { ok: true, text: 'Connection works' } : { ok: false, text: r.error });
            router.refresh();
          })
        }
      >
        {pending ? 'Testing…' : 'Test connection'}
      </Button>
      {msg && (
        <span role={msg.ok ? 'status' : 'alert'} className={clsx('text-xs font-medium', msg.ok ? 'text-ok' : 'text-danger')}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
