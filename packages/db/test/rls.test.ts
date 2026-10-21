import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTenant } from '../src/index';
import { provisionTenant, tenantsForUser } from '../src/provision';

// Runs against the local database as the non-owner app role (DATABASE_URL),
// the same way the web app connects.

const run = randomUUID().slice(0, 8);
let a: { id: string };
let b: { id: string };
const userA = `test-user-a-${run}`;
const userB = `test-user-b-${run}`;

beforeAll(async () => {
  for (const id of [userA, userB]) {
    await prisma.user.create({ data: { id, name: id, email: `${id}@example.test` } });
  }
  a = await provisionTenant({ name: 'Agency A', slug: `a-${run}`, ownerUserId: userA });
  b = await provisionTenant({ name: 'Agency B', slug: `b-${run}`, ownerUserId: userB });
  await withTenant(a.id, (tx) =>
    tx.lead.create({ data: { tenantId: a.id, ref: 'L-1', firstName: 'Only-In-A' } }),
  );
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [a?.id, b?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await prisma.$disconnect();
});

describe('row-level security', () => {
  it('provisions the visa catalog per tenant', async () => {
    const count = await withTenant(a.id, (tx) => tx.visaProduct.count());
    expect(count).toBeGreaterThan(20);
  });

  it('a tenant sees its own rows', async () => {
    const leads = await withTenant(a.id, (tx) => tx.lead.findMany());
    expect(leads.map((l) => l.firstName)).toEqual(['Only-In-A']);
  });

  it('another tenant cannot read them', async () => {
    const leads = await withTenant(b.id, (tx) => tx.lead.findMany({ where: { firstName: 'Only-In-A' } }));
    expect(leads).toEqual([]);
  });

  it('another tenant cannot update or delete them', async () => {
    const res = await withTenant(b.id, (tx) =>
      tx.lead.updateMany({ where: { firstName: 'Only-In-A' }, data: { firstName: 'hacked' } }),
    );
    expect(res.count).toBe(0);
    const del = await withTenant(b.id, (tx) => tx.lead.deleteMany({}));
    expect(del.count).toBe(0);
    const still = await withTenant(a.id, (tx) => tx.lead.count());
    expect(still).toBe(1);
  });

  it('cannot write a row into another tenant', async () => {
    await expect(
      withTenant(b.id, (tx) => tx.lead.create({ data: { tenantId: a.id, ref: 'L-X', firstName: 'Smuggled' } })),
    ).rejects.toThrow();
  });

  it('without a tenant context nothing is visible', async () => {
    expect(await prisma.lead.count()).toBe(0);
    expect(await prisma.visaProduct.count()).toBe(0);
  });

  it('isolates documents, invoices and commission claims (Phase 2 tables)', async () => {
    await withTenant(a.id, async (tx) => {
      const product = await tx.visaProduct.findFirstOrThrow({ where: { code: 'CA_STUDY' } });
      const client = await tx.client.create({ data: { tenantId: a.id, ref: 'C-1', firstName: 'Doc' } });
      const c = await tx.case.create({ data: { tenantId: a.id, ref: 'K-1', clientId: client.id, productId: product.id, stageKey: 'counselling' } });
      const doc = await tx.document.create({ data: { tenantId: a.id, caseId: c.id, clientId: client.id, name: 'Passport' } });
      await tx.documentFile.create({ data: { tenantId: a.id, documentId: doc.id, storageKey: `tenants/${a.id}/documents/t-${run}.pdf`, fileName: 'p.pdf', contentType: 'application/pdf', size: 10 } });
      await tx.invoice.create({ data: { tenantId: a.id, ref: 'INV/1', clientId: client.id, total: 100 } });
      const inst = await tx.institution.create({ data: { tenantId: a.id, name: 'Seneca', country: 'CA' } });
      const app = await tx.application.create({ data: { tenantId: a.id, caseId: c.id, institutionId: inst.id, courseName: 'PGD' } });
      await tx.commissionClaim.create({ data: { tenantId: a.id, applicationId: app.id, institutionId: inst.id, amount: 1, currency: 'CAD' } });
    });
    const seenByB = await withTenant(b.id, async (tx) => [
      await tx.document.count(),
      await tx.documentFile.count(),
      await tx.invoice.count(),
      await tx.institution.count(),
      await tx.commissionClaim.count(),
    ]);
    expect(seenByB).toEqual([0, 0, 0, 0, 0]);
    const seenByA = await withTenant(a.id, async (tx) => [await tx.document.count(), await tx.invoice.count(), await tx.commissionClaim.count()]);
    expect(seenByA).toEqual([1, 1, 1]);
  });

  it('isolates messages and portal sessions (Phase 3 tables)', async () => {
    await withTenant(a.id, async (tx) => {
      const client = await tx.client.create({ data: { tenantId: a.id, ref: 'C-P3', firstName: 'Portal' } });
      await tx.message.create({ data: { tenantId: a.id, clientId: client.id, direction: 'INBOUND', body: 'hello' } });
      await tx.portalToken.create({ data: { tenantId: a.id, clientId: client.id, tokenHash: `t-${run}`, expiresAt: new Date(Date.now() + 60_000) } });
      await tx.portalSession.create({ data: { tenantId: a.id, clientId: client.id, tokenHash: `s-${run}`, expiresAt: new Date(Date.now() + 60_000) } });
    });
    const seenByB = await withTenant(b.id, async (tx) => [
      await tx.message.count(),
      await tx.portalToken.count(),
      // A stolen session token must not resolve under another tenant.
      await tx.portalSession.count({ where: { tokenHash: `s-${run}` } }),
    ]);
    expect(seenByB).toEqual([0, 0, 0]);
  });

  it('isolates WhatsApp templates, automations and lead conversations (Phase 4 tables)', async () => {
    await withTenant(a.id, async (tx) => {
      const lead = await tx.lead.findFirstOrThrow();
      await tx.message.create({ data: { tenantId: a.id, leadId: lead.id, channel: 'WHATSAPP', direction: 'INBOUND', body: 'hi', externalId: `wamid.${run}` } });
      await tx.whatsAppTemplate.create({ data: { tenantId: a.id, name: 'case_update', category: 'UTILITY', status: 'APPROVED', body: 'x' } });
      await tx.automation.create({ data: { tenantId: a.id, trigger: 'CASE_STAGE', templateName: 'case_update' } });
    });
    const seenByB = await withTenant(b.id, async (tx) => [
      await tx.message.count({ where: { externalId: `wamid.${run}` } }),
      await tx.whatsAppTemplate.count(),
      await tx.automation.count(),
    ]);
    expect(seenByB).toEqual([0, 0, 0]);
  });

  it('isolates provider connections and usage (Phase 4.5 tables)', async () => {
    await withTenant(a.id, async (tx) => {
      await tx.providerConnection.create({ data: { tenantId: a.id, capability: 'payments', provider: 'razorpay', config: { keySecret: 'v1.enc' } } });
      await tx.usageEvent.create({ data: { tenantId: a.id, capability: 'messaging', provider: 'whatsapp-sandbox', unit: 'message', quantity: 1 } });
    });
    const seenByB = await withTenant(b.id, async (tx) => [await tx.providerConnection.count(), await tx.usageEvent.count()]);
    expect(seenByB).toEqual([0, 0]);
    // B cannot plant a connection (e.g. its own webhook secret) on A's workspace.
    await expect(
      withTenant(b.id, (tx) => tx.providerConnection.create({ data: { tenantId: a.id, capability: 'messaging', provider: 'whatsapp-sandbox' } })),
    ).rejects.toThrow();
  });

  it('isolates calls, recordings and transcripts (Phase 5 tables)', async () => {
    await withTenant(a.id, async (tx) => {
      const lead = await tx.lead.findFirstOrThrow();
      await tx.call.create({
        data: { tenantId: a.id, provider: 'telephony-sandbox', providerCallId: `CA_${run}`, direction: 'INBOUND', contactPhone: '+919800000000', leadId: lead.id, transcript: [{ speaker: 'contact', text: 'secret' }] },
      });
    });
    const seenByB = await withTenant(b.id, (tx) => tx.call.count({ where: { providerCallId: `CA_${run}` } }));
    expect(seenByB).toBe(0);
    // A call must belong to a lead or a client.
    await expect(withTenant(a.id, (tx) => tx.call.create({ data: { tenantId: a.id, provider: 'x', direction: 'OUTBOUND', contactPhone: '+91' } }))).rejects.toThrow();
  });

  it('isolates the assistant knowledge base (Phase 5b)', async () => {
    await withTenant(a.id, (tx) => tx.knowledgeItem.create({ data: { tenantId: a.id, question: 'Fees?', answer: 'Our secret pricing' } }));
    expect(await withTenant(b.id, (tx) => tx.knowledgeItem.count())).toBe(0);
  });

  it('isolates eligibility checks (Phase 5d)', async () => {
    await withTenant(a.id, async (tx) => {
      const client = await tx.client.create({ data: { tenantId: a.id, ref: `C-${run}`, firstName: 'Elig' } });
      await tx.eligibilityCheck.create({ data: { tenantId: a.id, clientId: client.id, kind: 'CRS', inputs: {}, score: 469, breakdown: [] } });
    });
    expect(await withTenant(b.id, (tx) => tx.eligibilityCheck.count())).toBe(0);
  });

  it('isolates sub-agents, their commission and portal sessions (Phase 6a)', async () => {
    await withTenant(a.id, async (tx) => {
      const agent = await tx.subAgent.create({ data: { tenantId: a.id, ref: `SA-${run}`, name: 'Agent A', email: `agent-${run}@a.test` } });
      await tx.subAgentCommission.create({ data: { tenantId: a.id, subAgentId: agent.id, clientId: 'x', kind: 'REFERRAL_FEE', basis: 0, amount: 500000 } });
      await tx.subAgentSession.create({ data: { tenantId: a.id, subAgentId: agent.id, tokenHash: `s-sa-${run}`, expiresAt: new Date(Date.now() + 86400000) } });
    });
    const seenByB = await withTenant(b.id, async (tx) => [
      await tx.subAgent.count(),
      await tx.subAgentCommission.count(),
      // A stolen partner session token must not resolve under another tenant.
      await tx.subAgentSession.count({ where: { tokenHash: `s-sa-${run}` } }),
    ]);
    expect(seenByB).toEqual([0, 0, 0]);
  });

  it('isolates form answer requests (Phase 6b)', async () => {
    await withTenant(a.id, async (tx) => {
      const client = await tx.client.create({ data: { tenantId: a.id, ref: `C-F-${run}`, firstName: 'Forms', formAnswers: { 'birth.city': { v: 'Madurai', by: 'client', at: 'x' } } } });
      await tx.formRequest.create({ data: { tenantId: a.id, clientId: client.id, formId: 'us-ds160', keys: ['birth.country'] } });
    });
    expect(await withTenant(b.id, async (tx) => [await tx.formRequest.count(), await tx.client.count({ where: { ref: `C-F-${run}` } })])).toEqual([0, 0]);
  });

  it('new workspaces start a 14-day trial; billing data is isolated (Phase 7a)', async () => {
    const sub = await withTenant(a.id, (tx) => tx.subscription.findUnique({ where: { tenantId: a.id } }));
    expect(sub).toMatchObject({ status: 'trialing', plan: 'pro' });
    expect(Math.round((sub!.trialEndsAt!.getTime() - Date.now()) / 86400_000)).toBe(14);
    await withTenant(a.id, async (tx) => {
      await tx.creditEntry.create({ data: { tenantId: a.id, kind: 'usage', action: 'call_notes', credits: 4 } });
      await tx.platformInvoice.create({ data: { tenantId: a.id, number: `KCK/T/${run}`, description: 'x', subtotal: 100, total: 118 } });
    });
    expect(await withTenant(b.id, async (tx) => [await tx.subscription.count({ where: { tenantId: a.id } }), await tx.creditEntry.count(), await tx.platformInvoice.count()])).toEqual([0, 0, 0]);
  });

  it('a read-only workspace can read but Postgres refuses every write', async () => {
    const leads = await withTenant(a.id, (tx) => tx.lead.count(), { readOnly: true });
    expect(leads).toBeGreaterThan(0);
    await expect(withTenant(a.id, (tx) => tx.lead.create({ data: { tenantId: a.id, ref: `L-RO-${run}`, firstName: 'Nope' } }), { readOnly: true })).rejects.toThrow(/read-only transaction/);
  });

  it('users only list their own workspaces', async () => {
    const forA = await tenantsForUser(userA);
    expect(forA.map((t) => t.id)).toEqual([a.id]);
    expect(forA[0].role).toBe('OWNER');
  });
});

describe('deleting a workspace', () => {
  it('removes every row that belongs to it', async () => {
    const owner = `test-user-del-${run}`;
    await prisma.user.create({ data: { id: owner, name: owner, email: `${owner}@example.test` } });
    const t = await provisionTenant({ name: 'Agency Gone', slug: `gone-${run}`, ownerUserId: owner });
    // A full chain, including links that refuse deletion on their own (case → client, payment → client, …).
    await withTenant(t.id, async (tx) => {
      const product = await tx.visaProduct.findFirstOrThrow();
      const client = await tx.client.create({ data: { tenantId: t.id, ref: 'C-1', firstName: 'Gone' } });
      const kase = await tx.case.create({ data: { tenantId: t.id, ref: 'K-1', clientId: client.id, productId: product.id, stageKey: 'x' } });
      const inst = await tx.institution.create({ data: { tenantId: t.id, name: 'Uni', country: 'CA' } });
      const app = await tx.application.create({ data: { tenantId: t.id, caseId: kase.id, institutionId: inst.id } });
      await tx.commissionClaim.create({ data: { tenantId: t.id, applicationId: app.id, institutionId: inst.id, amount: 100, currency: 'CAD' } });
      const inv = await tx.invoice.create({ data: { tenantId: t.id, ref: 'INV-1', clientId: client.id } });
      await tx.payment.create({ data: { tenantId: t.id, invoiceId: inv.id, clientId: client.id, amount: 100, method: 'CASH', paidAt: new Date(), receiptRef: 'R-1' } });
    });

    await prisma.tenant.delete({ where: { id: t.id } });

    const left = await withTenant(t.id, (tx) =>
      Promise.all([tx.membership.count(), tx.visaProduct.count(), tx.client.count(), tx.case.count(), tx.invoice.count(), tx.payment.count(), tx.institution.count(), tx.application.count(), tx.commissionClaim.count(), tx.subscription.count()]),
    );
    expect(left).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await prisma.user.delete({ where: { id: owner } });
  });
});
