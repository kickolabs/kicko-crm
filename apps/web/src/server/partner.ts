import 'server-only';
import { withTenant } from '@kicko/db';
import { CATEGORY_LABEL, COUNTRIES, LEAD_STATUS_LABEL } from '@/lib/constants';
import { fullName } from '@/lib/format';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { stagesOf } from './cases';
import { createLead, findDuplicates } from './leads';
import type { PartnerCtx } from './partner-auth';
import { logActivity, UserError } from './scope';
import { referralInput, type ReferralResult } from './sub-agents';

// Everything a sub-agent sees: only their own referrals (progress, not notes or
// documents) and their commission statement. Every query is pinned to p.agent.id.

const run = <T>(p: PartnerCtx, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(p.scope.tenantId, fn);

export async function getPartnerHome(p: PartnerCtx) {
  return run(p, async (tx) => {
    const leads = await tx.lead.findMany({
      where: { subAgentId: p.agent.id },
      include: { client: { include: { cases: { include: { product: true }, orderBy: { createdAt: 'desc' } } } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const commissions = await tx.subAgentCommission.findMany({ where: { subAgentId: p.agent.id }, orderBy: { createdAt: 'desc' }, take: 300 });
    const clientNames = new Map(leads.filter((l) => l.client).map((l) => [l.client!.id, fullName(l.client!)]));

    const referrals = leads.map((l) => {
      const c = l.client?.cases.find((k) => k.status === 'OPEN') ?? l.client?.cases[0];
      const stage = c ? stagesOf(c.product).find((s) => s.key === c.stageKey)?.name ?? c.stageKey : null;
      return {
        id: l.id,
        ref: l.ref,
        name: fullName(l),
        createdAt: l.createdAt,
        interest: [l.interestCategory && CATEGORY_LABEL[l.interestCategory], l.interestCountry && (COUNTRIES[l.interestCountry] ?? l.interestCountry)].filter(Boolean).join(' · ') || null,
        status: l.clientId ? (c ? (c.status === 'CLOSED' ? `Case closed${c.outcome ? ` · ${c.outcome.toLowerCase()}` : ''}` : 'Client · case open') : 'Client') : LEAD_STATUS_LABEL[l.status],
        stage: c && c.status !== 'CLOSED' ? `${COUNTRIES[c.product.country] ?? c.product.country} ${c.product.name}: ${stage}` : null,
        converted: Boolean(l.clientId),
      };
    });
    const sum = (s: string) => commissions.filter((c) => c.status === s).reduce((a, c) => a + c.amount, 0);
    return {
      referrals,
      commissions: commissions.filter((c) => c.status !== 'VOID').map((c) => ({ ...c, clientName: clientNames.get(c.clientId) ?? 'Client' })),
      totals: { referrals: leads.length, converted: leads.filter((l) => l.clientId).length, due: sum('DUE'), paid: sum('PAID') },
    };
  });
}

/** A sub-agent refers someone. First come, first served: known people aren't reassigned. */
export async function submitReferral(p: PartnerCtx, raw: unknown): Promise<ReferralResult> {
  const input = referralInput.parse(raw);
  const phone = normalizePhone(input.phone, p.scope.country);
  if (!phone || phone.replace(/\D/g, '').length < 8) throw new UserError('Enter a valid phone number with country code');
  const email = input.email ? normalizeEmail(input.email) : null;

  const existing = await run(p, (tx) => findDuplicates(tx, phone, email));
  if (existing.length) {
    const target = existing[0]!;
    await run(p, (tx) =>
      logActivity(tx, { ...p.scope, actorId: null }, {
        type: 'SUB_AGENT',
        summary: `Sub-agent ${p.agent.name} (${p.agent.ref}) also referred this ${target.kind}. Not reassigned: already in the system.`,
        leadId: target.kind === 'lead' ? target.id : null,
        clientId: target.kind === 'client' ? target.id : null,
      }),
    );
    return { status: 'exists' };
  }

  const res = await createLead(
    { ...p.scope, actorId: null },
    {
      firstName: input.firstName,
      lastName: input.lastName || undefined,
      phone,
      email: email ?? undefined,
      interestCountry: input.interestCountry || undefined,
      interestCategory: input.interestCategory || undefined,
      message: input.message ? `Referred by ${p.agent.name}: ${input.message}` : `Referred by ${p.agent.name}`,
      source: 'SUB_AGENT',
    },
  );
  if (res.status !== 'created') return { status: 'exists' };
  await run(p, async (tx) => {
    await tx.lead.update({ where: { id: res.leadId }, data: { subAgentId: p.agent.id } });
    await logActivity(tx, { ...p.scope, actorId: null }, { type: 'SUB_AGENT', summary: `Referred by sub-agent ${p.agent.name} (${p.agent.ref}) via the partner portal`, leadId: res.leadId });
  });
  return { status: 'created', ref: res.ref };
}
