import 'server-only';
import { withTenant } from '@kicko/db';
import type { Capability } from './types';

// Usage metering: every billable provider call records units per agency.
// Feeds cost tracking now and usage-based plans in Phase 7. Never throws.

export type Unit = 'message' | 'email' | 'minute' | 'input_token' | 'output_token' | 'byte' | 'link' | 'payment';

export async function meter(
  tenantId: string | null | undefined,
  capability: Capability,
  provider: string,
  unit: Unit,
  quantity = 1,
  meta?: Record<string, string | number | null>,
) {
  if (!tenantId || quantity <= 0) return;
  try {
    await withTenant(tenantId, (tx) =>
      tx.usageEvent.create({ data: { tenantId, capability, provider, unit, quantity: Math.round(quantity), meta: meta ?? undefined } }),
    );
  } catch (err) {
    console.error('usage meter', capability, err);
  }
}

/** Usage totals for the last `days` days, grouped by capability, provider and unit. */
export function usageSummary(tenantId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400_000);
  return withTenant(tenantId, (tx) =>
    tx.usageEvent.groupBy({
      by: ['capability', 'provider', 'unit'],
      where: { createdAt: { gte: since } },
      _sum: { quantity: true },
      orderBy: { capability: 'asc' },
    }),
  );
}
