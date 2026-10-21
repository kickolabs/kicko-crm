import { randomBytes } from 'node:crypto';
import { prisma, withTenant, type Role } from './index';
import { VISA_CATALOG } from './visa-catalog';

export const RESERVED_SLUGS = new Set([
  'api', 'app', 'login', 'logout', 'signup', 'invite', 'f', 'embed', 'static', 'assets',
  'admin', 'account', 'settings', 'terms', 'privacy', 'dpa', 'security', 'legal', 'pricing', 'features', 'blog', 'about', 'contact', 'sitemap', 'robots', 'portal', 'partner', 'checkout', 'www', 'help', 'docs', 'status', 'kicko', '_next', 'pay', 'webhooks',
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export type TenantSettings = {
  leadAssignment: 'round_robin' | 'manual';
  /** Public key for the embeddable web enquiry form and walk-in kiosk. */
  formKey: string;
  /** Shown on invoices and receipts. */
  billing?: {
    legalName?: string;
    address?: string;
    gstin?: string;
    pan?: string;
    invoicePrefix?: string; // default "INV"
    defaultTaxMode?: 'NONE' | 'GST_INTRA' | 'GST_INTER';
    bankDetails?: string;
    upiId?: string;
    terms?: string;
  };
  /** Client portal: self-service booking hours and welcome note. */
  portal?: {
    bookingEnabled: boolean;
    days: number[]; // 0 = Sunday … 6 = Saturday
    start: string; // "10:00"
    end: string; // "18:00"
    slotMinutes: number;
    welcome?: string;
  };
  /** AI features that work on agency data. */
  ai?: { docChecks: boolean };
  /** Owners can require two-step sign-in for everyone in the workspace. */
  security?: { require2fa?: boolean };
  /** The "Get started" checklist on the dashboard. */
  onboarding?: { dismissed?: boolean };
  /** WhatsApp AI assistant. */
  assistant?: {
    mode: 'off' | 'always' | 'after_hours';
    name: string;
    /** Office hours; with mode after_hours the assistant only replies outside them. */
    days: number[];
    start: string;
    end: string;
    booking: boolean;
  };
  /** AI voice agent: qualification calls and inbound receptionist. */
  voiceAgent?: {
    name: string;
    language: string; // BCP-47, e.g. en-IN, hi-IN, ta-IN
    voice: string; // provider voice id; blank = provider default
    questions: string[]; // qualification fields to ask about
    inbound: boolean;
    autoCall: boolean;
    autoCallDelayMin: number;
    autoCallSources: string[];
    days: number[];
    start: string;
    end: string;
    maxAttempts: number;
    /** Agent as created on the provider (non-sandbox). */
    remote?: { provider: string; agentId: string; llmId?: string; syncedAt: string; hash: string };
  };
  /** Calling: recording, consent greeting, AI call notes. */
  calling?: {
    record: boolean;
    greeting?: string;
    aiNotes: boolean;
  };
  // Provider connections (WhatsApp, payments, telephony…) live in the
  // ProviderConnection table, not here. See apps/web/src/integrations.
};

/** Create an agency: tenant row, owner membership, HQ branch, default visa catalog. */
export async function provisionTenant(input: { name: string; slug: string; ownerUserId: string }) {
  const settings: TenantSettings = {
    leadAssignment: 'round_robin',
    formKey: randomBytes(12).toString('base64url'),
  };
  const tenant = await prisma.tenant.create({
    data: { name: input.name, slug: input.slug, settings },
  });
  try {
    await withTenant(tenant.id, async (tx) => {
      await tx.membership.create({
        data: { tenantId: tenant.id, userId: input.ownerUserId, role: 'OWNER' satisfies Role },
      });
      await tx.branch.create({ data: { tenantId: tenant.id, name: 'Head office' } });
      // 14-day trial with every feature, so agencies see the whole product before choosing a plan.
      await tx.subscription.create({
        data: { tenantId: tenant.id, plan: 'pro', status: 'trialing', seats: 10, trialEndsAt: new Date(Date.now() + 14 * 86400_000) },
      });
      await tx.visaProduct.createMany({
        data: VISA_CATALOG.map((p) => ({
          tenantId: tenant.id,
          code: p.code,
          country: p.country,
          category: p.category,
          name: p.name,
          stages: p.stages,
          checklist: p.checklist,
        })),
      });
    });
  } catch (err) {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    throw err;
  }
  return tenant;
}

/** Tenants a user belongs to (uses the member_self_read RLS policy). */
export async function tenantsForUser(userId: string) {
  const memberships = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    return tx.membership.findMany({ where: { userId, active: true } });
  });
  if (!memberships.length) return [];
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: memberships.map((m) => m.tenantId) } },
    orderBy: { createdAt: 'asc' },
  });
  return tenants.map((t) => ({ ...t, role: memberships.find((m) => m.tenantId === t.id)!.role }));
}
