'use server';

import { revalidatePath } from 'next/cache';
import { removeConnection, saveConnection, testConnection } from '@/integrations/core/connections';
import { TENANT_CAPABILITIES } from '@/integrations/core/registry';
import type { Capability } from '@/integrations/core/types';
import { formObject, run, type ActionResult } from '@/lib/action';
import { assertCan, getCtx } from '@/lib/tenant';
import { scopeOf, UserError } from '@/server/scope';
import { connectMessaging } from '@/server/whatsapp/service';

// Generic provider connections (Settings → Integrations, WhatsApp, Billing).

type Prev = ActionResult | null;
const refresh = (slug: string) => revalidatePath(`/${slug}`, 'layout');

function capabilityOf(c: string): Capability {
  if (!TENANT_CAPABILITIES.includes(c as Capability)) throw new UserError('Unknown integration');
  return c as Capability;
}

export async function saveConnectionAction(slug: string, capability: string, provider: string, _: Prev, fd: FormData) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    const cap = capabilityOf(capability);
    const input = formObject(fd);
    // Messaging also seeds sandbox templates on connect.
    if (cap === 'messaging') await connectMessaging(scopeOf(ctx), provider, input);
    else await saveConnection(ctx.tenant.id, ctx.user.id, cap, provider, input);
  }, 'Connected');
  refresh(slug);
  return res;
}

export async function removeConnectionAction(slug: string, capability: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await removeConnection(ctx.tenant.id, capabilityOf(capability));
  });
  refresh(slug);
  return res;
}

export async function testConnectionAction(slug: string, capability: string) {
  const ctx = await getCtx(slug);
  const res = await run(async () => {
    assertCan(ctx, 'settings.manage');
    await testConnection(ctx.tenant.id, slug, capabilityOf(capability));
  }, 'Connection works');
  refresh(slug);
  return res;
}
