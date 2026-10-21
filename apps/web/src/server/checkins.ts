import 'server-only';
import { z } from 'zod';
import { normalizePhone } from '@/lib/phone';
import { inTenant, logActivity, UserError, type Scope } from './scope';
import { createLead, findDuplicates } from './leads';

export const checkInInput = z.object({
  name: z.string().trim().min(1, 'Please enter your name').max(120),
  phone: z.string().trim().min(6, 'Please enter your phone number').max(30),
  purpose: z.string().trim().min(1, 'What brings you in?').max(200),
  waOptIn: z.boolean().optional(),
});

/** Walk-in kiosk: queue the visitor and link (or create) their lead. */
export async function checkIn(scope: Scope, raw: z.input<typeof checkInInput>) {
  const input = checkInInput.parse(raw);
  const phoneNormalized = normalizePhone(input.phone, scope.country);

  const existing = await inTenant(scope, (tx) => findDuplicates(tx, phoneNormalized, null));
  const client = existing.find((m) => m.kind === 'client');
  const lead = existing.find((m) => m.kind === 'lead');
  let leadId = lead?.id ?? null;

  if (!client && !lead) {
    const [firstName, ...rest] = input.name.split(/\s+/);
    const res = await createLead(
      scope,
      { firstName: firstName!, lastName: rest.join(' ') || undefined, phone: input.phone, source: 'WALK_IN', message: input.purpose, waOptIn: input.waOptIn },
      { mergeDuplicates: true },
    );
    if (res.status === 'created') leadId = res.leadId;
  }

  return inTenant(scope, async (tx) => {
    const row = await tx.checkIn.create({
      data: {
        tenantId: scope.tenantId,
        name: input.name,
        phone: input.phone,
        purpose: input.purpose,
        leadId,
        clientId: client?.id ?? null,
      },
    });
    await logActivity(tx, scope, {
      type: 'CHECK_IN',
      summary: `Walked in · ${input.purpose}`,
      leadId,
      clientId: client?.id ?? null,
    });
    const ahead = await tx.checkIn.count({ where: { status: 'WAITING', createdAt: { lt: row.createdAt } } });
    return { id: row.id, ahead, returning: Boolean(client || lead) };
  });
}

export async function setCheckInStatus(
  scope: Scope,
  id: string,
  status: 'WAITING' | 'WITH_STAFF' | 'DONE' | 'LEFT',
) {
  return inTenant(scope, async (tx) => {
    const row = await tx.checkIn.findUnique({ where: { id } });
    if (!row) throw new UserError('Visitor not found');
    await tx.checkIn.update({
      where: { id },
      data: {
        status,
        assignedToId: status === 'WITH_STAFF' ? scope.actorId : row.assignedToId,
        calledAt: status === 'WITH_STAFF' ? new Date() : row.calledAt,
        doneAt: status === 'DONE' || status === 'LEFT' ? new Date() : null,
      },
    });
  });
}
