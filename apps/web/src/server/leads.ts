import 'server-only';
import { accrueOnConversion } from './sub-agents';
import { nextRef, type LeadSource, type LeadStatus, type Prisma, type Tx, type VisaCategory } from '@kicko/db';
import { z } from 'zod';
import { fullName } from '@/lib/format';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { LEAD_STATUS_LABEL } from '@/lib/constants';
import { countryCode, countryName } from '@/lib/countries';
import { carryOver, cleanPackValues, type PackValues } from '@/lib/pack-fields';
import { allowedKeys, tenantPack, visibleFields } from './library';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { openCaseTx } from './cases';
import { defaultBranch } from './branches';

const optional = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : undefined));

export const leadInput = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(80),
    lastName: optional,
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : undefined))
      .pipe(z.email('Enter a valid email').optional()),
    phone: optional,
    // A code or a name ("CA", "Canada"); stored as the ISO code when we recognise it.
    interestCountry: optional.transform((v) => (v ? (countryCode(v) ?? v) : undefined)),
    interestCategory: z.enum(['STUDY', 'PR', 'WORK', 'VISIT', 'FAMILY', 'OTHER']).optional().or(z.literal('').transform(() => undefined)),
    productId: optional,
    ownerId: optional,
    message: z.string().trim().max(4000).optional(),
    source: z.enum(['WEB_FORM', 'WHATSAPP', 'CALL', 'WALK_IN', 'REFERRAL', 'SUB_AGENT', 'ADS', 'OTHER']).default('OTHER'),
    waOptIn: z.boolean().optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Add a phone number or email', path: ['phone'] });

export type LeadInput = z.input<typeof leadInput>;

/** Raw pack-field values from a form (see readPackForm). */
export type PackRaw = Record<string, string | string[]>;

/** Validate pack fields for leads against the workspace's pack and library. */
async function cleanLeadPack(scope: Scope, raw: PackRaw | undefined, prev: PackValues = {}) {
  if (!raw) return null;
  const { pack, settings } = await tenantPack(scope);
  return cleanPackValues(visibleFields(pack, settings, 'leads'), raw, await allowedKeys(scope, pack), prev);
}

/**
 * The chosen workflow must be for the chosen destination: changing the country makes
 * an old pathway invalid. With a workflow and no country, the country is the workflow's.
 */
async function checkPathway(tx: Tx, productId: string | undefined, country: string | undefined) {
  if (!productId) return country ?? null;
  const product = await tx.visaProduct.findUnique({ where: { id: productId } });
  if (!product) throw new UserError('Unknown visa product', 'productId');
  if (country && product.country !== country) {
    throw new UserError(`That visa product is for ${countryName(product.country)}. Pick one for ${countryName(country)}, or change the country.`, 'productId');
  }
  return product.country;
}

export type DuplicateMatch = {
  kind: 'lead' | 'client';
  id: string;
  ref: string;
  name: string;
  matchedOn: 'phone' | 'email';
};

export async function findDuplicates(tx: Tx, phoneNormalized: string | null, email: string | null, excludeLeadId?: string) {
  const or = [
    ...(phoneNormalized ? [{ phoneNormalized }] : []),
    ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
  ];
  if (!or.length) return [];
  const [leads, clients] = await Promise.all([
    tx.lead.findMany({
      where: { OR: or, clientId: null, ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}) },
      take: 5,
      orderBy: { createdAt: 'desc' },
    }),
    tx.client.findMany({ where: { OR: or }, take: 5, orderBy: { createdAt: 'desc' } }),
  ]);
  const on = (r: { phoneNormalized: string | null }) =>
    phoneNormalized && r.phoneNormalized === phoneNormalized ? ('phone' as const) : ('email' as const);
  return [
    ...clients.map((c): DuplicateMatch => ({ kind: 'client', id: c.id, ref: c.ref, name: fullName(c), matchedOn: on(c) })),
    ...leads.map((l): DuplicateMatch => ({ kind: 'lead', id: l.id, ref: l.ref, name: fullName(l), matchedOn: on(l) })),
  ];
}

/** Round-robin by load: the counsellor with the fewest open leads. */
export async function pickAssignee(tx: Tx): Promise<string | null> {
  const members = await tx.membership.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  const counsellors = members.filter((m) => m.role === 'COUNSELLOR');
  const pool = counsellors.length ? counsellors : members.filter((m) => m.role === 'OWNER' || m.role === 'ADMIN');
  if (!pool.length) return null;
  const loads = await tx.lead.groupBy({
    by: ['ownerId'],
    where: { ownerId: { in: pool.map((m) => m.userId) }, status: { notIn: ['WON', 'LOST'] } },
    _count: { _all: true },
  });
  const load = (id: string) => loads.find((l) => l.ownerId === id)?._count._all ?? 0;
  return [...pool].sort((a, b) => load(a.userId) - load(b.userId))[0]!.userId;
}

export type CreateLeadResult =
  | { status: 'created'; leadId: string; ref: string }
  | { status: 'duplicate'; matches: DuplicateMatch[] }
  | { status: 'merged'; leadId?: string; clientId?: string };

/**
 * Create a lead. Staff get a duplicate warning first (allowDuplicate to override);
 * public channels attach the enquiry to the existing record instead.
 */
export async function createLead(
  scope: Scope,
  raw: LeadInput,
  opts: { allowDuplicate?: boolean; mergeDuplicates?: boolean; utm?: Record<string, string>; pack?: PackRaw } = {},
): Promise<CreateLeadResult> {
  const input = leadInput.parse(raw);
  const packData = await cleanLeadPack(scope, opts.pack);
  const phoneNormalized = normalizePhone(input.phone, scope.country);
  const email = normalizeEmail(input.email);

  return inTenant<CreateLeadResult>(scope, async (tx) => {
    const matches = await findDuplicates(tx, phoneNormalized, email);
    if (matches.length && opts.mergeDuplicates) {
      const target = matches[0]!;
      await logActivity(tx, scope, {
        type: 'DUPLICATE_ENQUIRY',
        summary: `New ${input.source.replace('_', ' ').toLowerCase()} enquiry from an existing ${target.kind}`,
        leadId: target.kind === 'lead' ? target.id : null,
        clientId: target.kind === 'client' ? target.id : null,
        data: { message: input.message ?? null, source: input.source },
      });
      return target.kind === 'lead' ? { status: 'merged', leadId: target.id } : { status: 'merged', clientId: target.id };
    }
    if (matches.length && !opts.allowDuplicate) return { status: 'duplicate', matches };

    const interestCountry = await checkPathway(tx, input.productId, input.interestCountry);
    let ownerId = input.ownerId ?? null;
    if (ownerId) {
      const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: ownerId } } });
      if (!m?.active) throw new UserError('That owner is not an active team member');
    } else if (scope.settings.leadAssignment === 'round_robin') {
      ownerId = await pickAssignee(tx);
    }

    const ref = await nextRef(tx, scope.tenantId, 'lead', 'L');
    const branchId = await defaultBranch(tx, scope, ownerId);
    const lead = await tx.lead.create({
      data: {
        tenantId: scope.tenantId,
        ref,
        branchId,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email,
        phone: input.phone ?? null,
        phoneNormalized,
        source: input.source as LeadSource,
        interestCountry,
        interestCategory: (input.interestCategory as VisaCategory | undefined) ?? null,
        productId: input.productId ?? null,
        ...(packData ? { packData: packData as Prisma.InputJsonValue } : {}),
        ownerId,
        message: input.message ?? null,
        utm: opts.utm,
        ...(input.waOptIn ? { waOptIn: true, waOptInAt: new Date() } : {}),
      },
    });
    await logActivity(tx, scope, {
      type: 'LEAD_CREATED',
      summary: `Lead created from ${input.source.replace('_', ' ').toLowerCase()}`,
      leadId: lead.id,
      data: matches.length ? { duplicateOf: matches.map((m) => m.ref) } : undefined,
    });
    return { status: 'created', leadId: lead.id, ref };
  }).then(async (res) => {
    // New enquiries can get an instant AI qualification call (Settings → AI voice agent).
    if (res.status === 'created') {
      const { onLeadCreated } = await import('./voice/service');
      await onLeadCreated(scope, res.leadId, input.source);
    }
    return res;
  });
}

export async function setLeadStatus(scope: Scope, leadId: string, status: LeadStatus, lostReason?: string) {
  return inTenant(scope, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new UserError('Lead not found');
    if (lead.status === status) return lead;
    if (lead.clientId && status !== 'WON') throw new UserError('This lead is already converted to a client');
    if (status === 'WON' && !lead.clientId) throw new UserError('Convert the lead to a client to mark it won');
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: { status, lostReason: status === 'LOST' ? (lostReason ?? null) : null },
    });
    await logActivity(tx, scope, {
      type: 'STATUS_CHANGED',
      summary: `${LEAD_STATUS_LABEL[lead.status]} → ${LEAD_STATUS_LABEL[status]}${status === 'LOST' && lostReason ? ` · ${lostReason}` : ''}`,
      leadId,
    });
    return updated;
  });
}

export async function updateLead(scope: Scope, leadId: string, raw: LeadInput, pack?: PackRaw) {
  const input = leadInput.parse(raw);
  const before = pack ? await inTenant(scope, (tx) => tx.lead.findUnique({ where: { id: leadId }, select: { packData: true } })) : null;
  const packData = await cleanLeadPack(scope, pack, (before?.packData as PackValues) ?? {});
  return inTenant(scope, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new UserError('Lead not found');
    const interestCountry = await checkPathway(tx, input.productId, input.interestCountry);
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: normalizeEmail(input.email),
        phone: input.phone ?? null,
        phoneNormalized: normalizePhone(input.phone, scope.country),
        source: input.source as LeadSource,
        interestCountry,
        interestCategory: (input.interestCategory as VisaCategory | undefined) ?? null,
        productId: input.productId ?? null,
        message: input.message ?? lead.message,
        ...(packData ? { packData: packData as Prisma.InputJsonValue } : {}),
      },
    });
    if (lead.ownerId !== (input.ownerId ?? null)) {
      await assignLeadTx(tx, scope, leadId, input.ownerId ?? null);
    }
    return updated;
  });
}

async function assignLeadTx(tx: Tx, scope: Scope, leadId: string, ownerId: string | null) {
  if (ownerId) {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: ownerId } } });
    if (!m?.active) throw new UserError('That owner is not an active team member');
  }
  await tx.lead.update({ where: { id: leadId }, data: { ownerId } });
  await logActivity(tx, scope, { type: 'ASSIGNED', summary: ownerId ? 'Lead reassigned' : 'Lead unassigned', leadId, data: { ownerId } });
}

export function assignLead(scope: Scope, leadId: string, ownerId: string | null) {
  return inTenant(scope, (tx) => assignLeadTx(tx, scope, leadId, ownerId));
}

/** Convert a lead into a client, optionally opening a case straight away. */
export async function convertLead(scope: Scope, leadId: string, opts: { productId?: string | null }) {
  const { pack, settings } = await tenantPack(scope);
  const leadFields = visibleFields(pack, settings, 'leads');
  const clientFields = visibleFields(pack, settings, 'clients');
  const clientCustom = await inTenant(scope, (tx) => tx.customField.findMany({ where: { entity: 'clients', archived: false }, select: { key: true } }));
  return inTenant(scope, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new UserError('Lead not found');
    if (lead.clientId) throw new UserError('Already converted');

    // Reuse an existing client with the same phone/email rather than duplicating.
    const existing = await tx.client.findFirst({
      where: {
        OR: [
          ...(lead.phoneNormalized ? [{ phoneNormalized: lead.phoneNormalized }] : []),
          ...(lead.email ? [{ email: lead.email }] : []),
        ],
      },
    });
    const client =
      existing ??
      (await tx.client.create({
        data: {
          tenantId: scope.tenantId,
          ref: await nextRef(tx, scope.tenantId, 'client', 'C'),
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          phoneNormalized: lead.phoneNormalized,
          ownerId: lead.ownerId ?? scope.actorId,
          subAgentId: lead.subAgentId,
        },
      }));
    // Referral credit follows the client (an existing client keeps its first referrer).
    if (existing && lead.subAgentId && !existing.subAgentId) await tx.client.update({ where: { id: client.id }, data: { subAgentId: lead.subAgentId } });
    await accrueOnConversion(tx, scope, client.id, existing?.subAgentId ?? lead.subAgentId);

    // Carry what the lead told us onto the client so nobody types it twice. Existing client
    // values win; the destination joins the client's preferred countries.
    const carried: PackValues = carryOver(leadFields, clientFields, lead.packData as PackValues);
    const prefKey = clientFields.find((f) => f.type === 'multi_lookup' && f.library === pack.regionType && /prefer/i.test(f.key))?.key;
    if (prefKey && lead.interestCountry) {
      carried[prefKey] = [...new Set([lead.interestCountry, ...((carried[prefKey] as string[]) ?? [])])];
    }
    const sameCustom = new Set(clientCustom.map((f) => f.key));
    const custom = Object.fromEntries(Object.entries(lead.customFields as Record<string, unknown>).filter(([k]) => sameCustom.has(k)));
    await tx.client.update({
      where: { id: client.id },
      data: {
        packData: { ...carried, ...(client.packData as PackValues) } as Prisma.InputJsonValue,
        customFields: { ...custom, ...(client.customFields as Record<string, unknown>) } as Prisma.InputJsonValue,
      },
    });

    await tx.lead.update({ where: { id: lead.id }, data: { clientId: client.id, status: 'WON' } });
    // Carry the lead's open work and WhatsApp conversation over to the client.
    await tx.task.updateMany({ where: { leadId: lead.id, done: false }, data: { clientId: client.id } });
    await tx.note.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id } });
    // The lead's history shows on the client's timeline too (it stays on the lead as well).
    await tx.activity.updateMany({ where: { leadId: lead.id, clientId: null }, data: { clientId: client.id } });
    await tx.message.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id, leadId: null } });
    await tx.call.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id, leadId: null } });
    const lastInbound = [lead.waLastInbound, client.waLastInbound].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
    if (lead.waOptIn || lastInbound) {
      await tx.client.update({
        where: { id: client.id },
        data: {
          waOptIn: client.waOptIn || lead.waOptIn,
          waOptInAt: client.waOptInAt ?? lead.waOptInAt,
          waLastInbound: lastInbound,
        },
      });
    }

    await logActivity(tx, scope, {
      type: 'CONVERTED',
      summary: existing ? `Linked to existing client ${client.ref}` : `Converted to client ${client.ref}`,
      leadId: lead.id,
      clientId: client.id,
    });

    let caseId: string | null = null;
    const productId = opts.productId || lead.productId;
    if (productId) {
      const c = await openCaseTx(tx, scope, { clientId: client.id, productId, ownerId: lead.ownerId ?? scope.actorId });
      caseId = c.id;
    }
    return { clientId: client.id, caseId };
  });
}
