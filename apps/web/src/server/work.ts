import 'server-only';
import { z } from 'zod';
import type { Tx } from '@kicko/db';
import { checkSlot } from '@/lib/booking-rules';
import { parseLocal } from '@/lib/format';
import { hoursFor } from './booking';
import { inTenant, logActivity, UserError, type Scope } from './scope';

// Tasks, appointments and notes attach to a lead, client and/or case.

const link = {
  leadId: z.string().optional().transform((v) => v || null),
  clientId: z.string().optional().transform((v) => v || null),
  caseId: z.string().optional().transform((v) => v || null),
};

async function resolveLinks(
  tx: Parameters<Parameters<typeof inTenant>[1]>[0],
  links: { leadId: string | null; clientId: string | null; caseId: string | null },
) {
  let { leadId, clientId } = links;
  const { caseId } = links;
  if (caseId) {
    const c = await tx.case.findUnique({ where: { id: caseId } });
    if (!c) throw new UserError('Case not found');
    clientId = c.clientId;
  }
  if (leadId && !(await tx.lead.findUnique({ where: { id: leadId } }))) throw new UserError('Lead not found');
  if (clientId && !(await tx.client.findUnique({ where: { id: clientId } }))) throw new UserError('Client not found');
  return { leadId, clientId, caseId };
}

export const taskInput = z.object({
  title: z.string().trim().min(1, 'What needs doing?').max(200),
  dueAt: z.string().optional(),
  assigneeId: z.string().optional().transform((v) => v || null),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  ...link,
});

export async function createTask(scope: Scope, raw: unknown) {
  const input = taskInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const links = await resolveLinks(tx, input);
    return tx.task.create({
      data: {
        tenantId: scope.tenantId,
        title: input.title,
        dueAt: parseLocal(input.dueAt, scope.timezone),
        priority: input.priority,
        assigneeId: input.assigneeId ?? scope.actorId,
        createdBy: scope.actorId,
        ...links,
      },
    });
  });
}

export async function toggleTask(scope: Scope, taskId: string, done: boolean) {
  return inTenant(scope, async (tx) => {
    const t = await tx.task.findUnique({ where: { id: taskId } });
    if (!t) throw new UserError('Task not found');
    await tx.task.update({ where: { id: taskId }, data: { done, doneAt: done ? new Date() : null } });
    if (done) {
      await logActivity(tx, scope, {
        type: 'TASK_DONE',
        summary: `Task done: ${t.title}`,
        leadId: t.leadId,
        clientId: t.clientId,
        caseId: t.caseId,
      });
    }
  });
}

export async function deleteTask(scope: Scope, taskId: string) {
  return inTenant(scope, (tx) => tx.task.deleteMany({ where: { id: taskId } }));
}

export const appointmentInput = z
  .object({
    title: z.string().trim().min(1, 'Add a title').max(200),
    startsAt: z.string().min(1, 'Pick a start time'),
    durationMin: z.coerce.number().int().min(5).max(480).default(30),
    mode: z.enum(['IN_PERSON', 'VIDEO', 'PHONE']).default('IN_PERSON'),
    staffId: z.string().optional().transform((v) => v || null),
    notes: z.string().trim().max(2000).optional(),
    outsideHours: z.string().optional().transform((v) => v === 'on'),
    ...link,
  });

export const rescheduleInput = z.object({
  startsAt: z.string().min(1, 'Pick a new time'),
  durationMin: z.coerce.number().int().min(5).max(480),
  staffId: z.string().optional().transform((v) => v || null),
  outsideHours: z.string().optional().transform((v) => v === 'on'),
});

/** Who may book outside office hours: decided by the caller from the signed-in role, never from the form. */
export type BookingRights = { outsideHours: boolean };

/**
 * Parse the start time and check the slot (not in the past, inside the consultant's hours,
 * no clash). Runs inside the write transaction so two bookings can't take the same time.
 */
async function validSlot(
  tx: Tx,
  scope: Scope,
  o: { startsAt: string; durationMin: number; staffId: string | null; outsideHours: boolean; ignoreId?: string },
) {
  const startsAt = parseLocal(o.startsAt, scope.timezone);
  if (!startsAt) throw new UserError('Pick a valid date and time', 'startsAt');
  const endsAt = new Date(startsAt.getTime() + o.durationMin * 60_000);
  if (o.staffId && !(await tx.membership.findFirst({ where: { userId: o.staffId, active: true } }))) {
    throw new UserError('Pick someone on your team', 'staffId');
  }
  const busy = o.staffId
    ? await tx.appointment.findMany({
        where: { staffId: o.staffId, status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, ...(o.ignoreId ? { id: { not: o.ignoreId } } : {}) },
        select: { startsAt: true, endsAt: true, title: true },
      })
    : [];
  const problem = checkSlot({
    startsAt,
    endsAt,
    now: new Date(),
    tz: scope.timezone,
    hours: await hoursFor(scope, o.staffId, tx),
    busy,
    allowOutsideHours: o.outsideHours,
  });
  if (problem) throw new UserError(problem.message, problem.code === 'clash' ? 'staffId' : 'startsAt');
  return { startsAt, endsAt };
}

export async function createAppointment(scope: Scope, raw: unknown, rights: BookingRights = { outsideHours: false }) {
  const appt = await createAppointmentTx(scope, raw, rights);
  const { emit } = await import('./rules');
  await emit(scope, 'APPOINTMENT_BOOKED', {
    recordType: 'appointment', recordId: appt.id, leadId: appt.leadId, clientId: appt.clientId, caseId: appt.caseId, ownerId: appt.staffId, values: {},
    words: { title: appt.title },
  });
  return appt;
}

function createAppointmentTx(scope: Scope, raw: unknown, rights: BookingRights) {
  const input = appointmentInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const links = await resolveLinks(tx, input);
    const staffId = input.staffId ?? scope.actorId;
    const { startsAt, endsAt } = await validSlot(tx, scope, {
      startsAt: input.startsAt,
      durationMin: input.durationMin,
      staffId,
      outsideHours: rights.outsideHours && input.outsideHours,
    });
    const appt = await tx.appointment.create({
      data: {
        tenantId: scope.tenantId,
        title: input.title,
        startsAt,
        endsAt,
        mode: input.mode,
        staffId,
        notes: input.notes || null,
        createdBy: scope.actorId,
        ...links,
      },
    });
    if (links.leadId) {
      const lead = await tx.lead.findUnique({ where: { id: links.leadId } });
      if (lead && ['NEW', 'CONTACTED', 'QUALIFIED'].includes(lead.status)) {
        await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONSULT_BOOKED' } });
      }
    }
    await logActivity(tx, scope, {
      type: 'APPOINTMENT',
      summary: `Appointment booked: ${input.title}`,
      ...links,
      data: { startsAt: startsAt.toISOString(), mode: input.mode },
    });
    return appt;
  });
}

export async function setAppointmentStatus(
  scope: Scope,
  id: string,
  status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED',
) {
  return inTenant(scope, async (tx) => {
    const a = await tx.appointment.findUnique({ where: { id } });
    if (!a) throw new UserError('Appointment not found');
    // Status only: no time checks, so a past appointment can still be marked done or no-show.
    await tx.appointment.update({ where: { id }, data: { status } });
    return a;
  }).then(async (a) => {
    if (status !== 'NO_SHOW' || a.status === 'NO_SHOW') return;
    const { emit } = await import('./rules');
    await emit(scope, 'APPOINTMENT_MISSED', { recordType: 'appointment', recordId: a.id, leadId: a.leadId, clientId: a.clientId, caseId: a.caseId, ownerId: a.staffId, values: {}, words: { title: a.title } });
  });
}

/** Move a scheduled appointment. The time rules run only when the time, length or person changes. */
export async function rescheduleAppointment(scope: Scope, id: string, raw: unknown, rights: BookingRights = { outsideHours: false }) {
  const input = rescheduleInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const a = await tx.appointment.findUnique({ where: { id } });
    if (!a) throw new UserError('Appointment not found');
    if (a.status !== 'SCHEDULED') throw new UserError('Only scheduled appointments can be moved');
    const staffId = input.staffId ?? a.staffId;
    const startsAt = parseLocal(input.startsAt, scope.timezone);
    const sameLength = a.endsAt.getTime() - a.startsAt.getTime() === input.durationMin * 60_000;
    if (startsAt && startsAt.getTime() === a.startsAt.getTime() && sameLength && staffId === a.staffId) return a;
    const slot = await validSlot(tx, scope, {
      startsAt: input.startsAt,
      durationMin: input.durationMin,
      staffId,
      outsideHours: rights.outsideHours && input.outsideHours,
      ignoreId: a.id,
    });
    const moved = await tx.appointment.update({
      where: { id },
      data: { startsAt: slot.startsAt, endsAt: slot.endsAt, staffId, rescheduledFrom: a.startsAt },
    });
    await logActivity(tx, scope, {
      type: 'APPOINTMENT',
      summary: `Appointment moved: ${a.title}`,
      leadId: a.leadId,
      clientId: a.clientId,
      caseId: a.caseId,
      data: { from: a.startsAt.toISOString(), startsAt: slot.startsAt.toISOString() },
    });
    return moved;
  });
}

export const noteInput = z.object({
  body: z.string().trim().min(1, 'Write something first').max(10_000),
  ...link,
});

export async function addNote(scope: Scope, raw: unknown) {
  const input = noteInput.parse(raw);
  return inTenant(scope, async (tx) => {
    const links = await resolveLinks(tx, input);
    await tx.note.create({ data: { tenantId: scope.tenantId, body: input.body, authorId: scope.actorId, ...links } });
    await logActivity(tx, scope, {
      type: 'NOTE',
      summary: input.body.length > 140 ? `${input.body.slice(0, 140)}…` : input.body,
      ...links,
    });
    const { notifyMentions } = await import('./notifications');
    const href = links.caseId ? `/${scope.slug}/cases/${links.caseId}` : links.leadId ? `/${scope.slug}/leads/${links.leadId}` : links.clientId ? `/${scope.slug}/clients/${links.clientId}` : null;
    await notifyMentions(tx, scope, input.body, href);
  });
}
