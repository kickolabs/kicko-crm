import 'server-only';
import { nextRef, type LeadSource, type LeadStatus, type Tx, type VisaCategory } from '@kicko/db';
import { z } from 'zod';
import { fullName } from '@/lib/format';
import { normalizeEmail, normalizePhone } from '@/lib/phone';
import { LEAD_STATUS_LABEL } from '@/lib/constants';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { openCaseTx } from './cases';

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
    interestCountry: optional,
    interestCategory: z.enum(['STUDY', 'PR', 'WORK', 'VISIT', 'FAMILY']).optional().or(z.literal('').transform(() => undefined)),
    productId: optional,
    ownerId: optional,
    message: z.string().trim().max(4000).optional(),
    source: z.enum(['WEB_FORM', 'WHATSAPP', 'CALL', 'WALK_IN', 'REFERRAL', 'ADS', 'OTHER']).default('OTHER'),
    waOptIn: z.boolean().optional(),
  })
  .refine((v) => v.email || v.phone, { message: 'Add a phone number or email', path: ['phone'] });

export type LeadInput = z.input<typeof leadInput>;

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
  opts: { allowDuplicate?: boolean; mergeDuplicates?: boolean; utm?: Record<string, string> } = {},
): Promise<CreateLeadResult> {
  const input = leadInput.parse(raw);
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

    if (input.productId) {
      const product = await tx.visaProduct.findUnique({ where: { id: input.productId } });
      if (!product) throw new UserError('Unknown visa product');
    }
    let ownerId = input.ownerId ?? null;
    if (ownerId) {
      const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: scope.tenantId, userId: ownerId } } });
      if (!m?.active) throw new UserError('That owner is not an active team member');
    } else if (scope.settings.leadAssignment === 'round_robin') {
      ownerId = await pickAssignee(tx);
    }

    const ref = await nextRef(tx, scope.tenantId, 'lead', 'L');
    const lead = await tx.lead.create({
      data: {
        tenantId: scope.tenantId,
        ref,
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email,
        phone: input.phone ?? null,
        phoneNormalized,
        source: input.source as LeadSource,
        interestCountry: input.interestCountry ?? null,
        interestCategory: (input.interestCategory as VisaCategory | undefined) ?? null,
        productId: input.productId ?? null,
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

export async function updateLead(scope: Scope, leadId: string, raw: LeadInput) {
  const input = leadInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new UserError('Lead not found');
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: {
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: normalizeEmail(input.email),
        phone: input.phone ?? null,
        phoneNormalized: normalizePhone(input.phone, scope.country),
        source: input.source as LeadSource,
        interestCountry: input.interestCountry ?? null,
        interestCategory: (input.interestCategory as VisaCategory | undefined) ?? null,
        productId: input.productId ?? null,
        message: input.message ?? lead.message,
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
        },
      }));

    await tx.lead.update({ where: { id: lead.id }, data: { clientId: client.id, status: 'WON' } });
    // Carry the lead's open work and WhatsApp conversation over to the client.
    await tx.task.updateMany({ where: { leadId: lead.id, done: false }, data: { clientId: client.id } });
    await tx.note.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id } });
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
