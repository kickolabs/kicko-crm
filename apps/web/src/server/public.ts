import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { getTenantBySlug } from '@/lib/tenant';
import { systemScope, type Scope } from './scope';

/** Resolve a tenant for a public channel and check its form key. */
export async function publicScope(slug: string, key: string | null | undefined): Promise<Scope | null> {
  const tenant = await getTenantBySlug(slug);
  if (!tenant || !key) return null;
  const a = Buffer.from(tenant.settings.formKey);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return systemScope(tenant);
}

// Simple fixed-window limiter per key. Fine for one instance; swap for
// Upstash Redis when running multiple serverless instances.
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(key: string, max = 10, windowMs = 60_000) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return true;
  }
  h.n += 1;
  return h.n <= max;
}
