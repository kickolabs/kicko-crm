import 'server-only';
import { audit } from '@/server/audit';
import { cache } from 'react';
import { withTenant } from '@kicko/db';
import { decryptSecret, encryptSecret } from '@/server/secrets';
import { UserError } from '@/server/scope';
import { descriptorFor, providersFor } from './registry';
import type { AdapterContext, Capability, ProviderDescriptor } from './types';

// Per-agency provider connections. One row per (agency, capability).

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export type Resolved<A> = {
  descriptor: ProviderDescriptor<A>;
  adapter: A;
  config: Record<string, string>;
  status: string;
};

function decryptConfig(d: ProviderDescriptor, stored: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored ?? {})) {
    const secret = d.fields.find((f) => f.key === k)?.secret;
    out[k] = secret ? (decryptSecret(v) ?? '') : v;
  }
  return out;
}

const loadRow = cache((tenantId: string, capability: Capability) =>
  withTenant(tenantId, (tx) => tx.providerConnection.findUnique({ where: { tenantId_capability: { tenantId, capability } } })),
);

/** The agency's adapter for a capability, or null when nothing is connected. */
export async function resolve<A>(tenantId: string, slug: string, capability: Capability): Promise<Resolved<A> | null> {
  const row = await loadRow(tenantId, capability);
  if (!row || row.status === 'disabled') return null;
  const descriptor = descriptorFor(capability, row.provider) as ProviderDescriptor<A> | undefined;
  if (!descriptor) return null; // provider removed from the codebase
  const config = decryptConfig(descriptor, row.config as Record<string, string>);
  const ctx: AdapterContext = { tenantId, slug, appUrl: appUrl() };
  return { descriptor, adapter: descriptor.create(config, ctx), config, status: row.status };
}

/** Public view of a connection for settings pages: secrets masked, never decrypted. */
export async function connectionSummary(tenantId: string, capability: Capability) {
  const row = await loadRow(tenantId, capability);
  if (!row) return null;
  const d = descriptorFor(capability, row.provider);
  const cfg = row.config as Record<string, string>;
  return {
    provider: row.provider,
    providerName: d?.name ?? row.provider,
    sandbox: Boolean(d?.sandbox),
    status: row.status,
    lastError: row.lastError,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    values: Object.fromEntries((d?.fields ?? []).filter((f) => !f.secret).map((f) => [f.key, cfg[f.key] ?? ''])),
    secretsSet: (d?.fields ?? []).filter((f) => f.secret && cfg[f.key]).map((f) => f.key),
  };
}

/**
 * Create or update a connection. Blank secret fields keep the stored value.
 * Switching provider replaces the connection (old config is discarded).
 */
export async function saveConnection(
  tenantId: string,
  actorId: string | null,
  capability: Capability,
  provider: string,
  input: Record<string, string>,
) {
  const d = descriptorFor(capability, provider);
  if (!d) throw new UserError('Unknown provider');
  const row = await loadRow(tenantId, capability);
  const prev = row && row.provider === provider ? (row.config as Record<string, string>) : null;
  const prevPlain = prev ? decryptConfig(d, prev) : null;

  const generated = d.setup?.(prevPlain) ?? {};
  const stored: Record<string, string> = {};
  for (const f of d.fields) {
    const typed = (input[f.key] ?? '').trim();
    // Generated fields keep their first value; blank secrets keep the stored one.
    const value = f.generated
      ? prevPlain?.[f.key] || generated[f.key] || ''
      : typed || (f.secret ? (prevPlain?.[f.key] ?? '') : '');
    if (f.required && !value) throw new UserError(`${f.label} is required`);
    if (value && f.pattern && !f.generated && !new RegExp(f.pattern).test(value)) throw new UserError(`${f.label} doesn't look right`);
    if (value) stored[f.key] = f.secret ? encryptSecret(value) : value;
  }

  await withTenant(tenantId, (tx) =>
    tx.providerConnection.upsert({
      where: { tenantId_capability: { tenantId, capability } },
      create: { tenantId, capability, provider, config: stored, createdBy: actorId },
      update: { provider, config: stored, status: 'active', lastError: null, lastCheckedAt: null },
    }),
  );
  // Never the keys themselves: only which provider was connected.
  await audit({ tenantId, actorId }, 'settings.integration_saved', `${prev ? 'Updated' : 'Connected'} ${provider} for ${capability.replace('_', ' ')}`);
}

export async function removeConnection(tenantId: string, capability: Capability, actorId: string | null = null) {
  await withTenant(tenantId, (tx) => tx.providerConnection.deleteMany({ where: { tenantId, capability } }));
  await audit({ tenantId, actorId }, 'settings.integration_removed', `Disconnected ${capability.replace('_', ' ')}`);
}

/** Run the adapter's health check and record the outcome. */
export async function testConnection(tenantId: string, slug: string, capability: Capability) {
  const r = await resolve<{ healthCheck?: () => Promise<void> }>(tenantId, slug, capability);
  if (!r) throw new UserError('Not connected');
  let error: string | null = null;
  try {
    await r.adapter.healthCheck?.();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Check failed';
  }
  await withTenant(tenantId, (tx) =>
    tx.providerConnection.update({
      where: { tenantId_capability: { tenantId, capability } },
      data: { status: error ? 'error' : 'active', lastError: error, lastCheckedAt: new Date() },
    }),
  );
  if (error) throw new UserError(`${r.descriptor.name}: ${error}`);
}

/** Serializable provider list for connect forms. */
export function providerOptions(capability: Capability) {
  return providersFor(capability).map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    sandbox: Boolean(d.sandbox),
    docsUrl: d.docsUrl ?? null,
    webhook: Boolean(d.webhookPath),
    webhookSuffix: d.webhookSuffix ?? '',
    guide: d.guide ?? [],
    connectLabel: d.connectLabel ?? `Connect ${d.name}`,
    fields: d.fields.map((f) => ({ key: f.key, label: f.label, secret: Boolean(f.secret), required: Boolean(f.required), hint: f.hint ?? null, placeholder: f.placeholder ?? null, generated: Boolean(f.generated) })),
  }));
}

export type ProviderOption = ReturnType<typeof providerOptions>[number];
export type ConnectionSummary = NonNullable<Awaited<ReturnType<typeof connectionSummary>>>;

export const webhookUrl = (capability: Capability, provider: string, slug: string) => `${appUrl()}/api/webhooks/${capability}/${provider}/${slug}`;

export { providersFor };
