import 'server-only';
import { z } from 'zod';
import { parseLocal } from '@/lib/format';
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
    ...link,
  });

export async function createAppointment(scope: Scope, raw: unknown) {
  const input = appointmentInput.parse(raw);
  const startsAt = parseLocal(input.startsAt, scope.timezone);
  if (!startsAt) throw new UserError('Invalid start time');
  const endsAt = new Date(startsAt.getTime() + input.durationMin * 60_000);
  return inTenant(scope, async (tx) => {
    const links = await resolveLinks(tx, input);
    const staffId = input.staffId ?? scope.actorId;
    if (staffId) {
      const clash = await tx.appointment.findFirst({
        where: { staffId, status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
      });
      if (clash) throw new UserError(`Clashes with "${clash.title}"`);
    }
    const appt = await tx.appointment.create({
      data: {
        tenantId: scope.tenantId,
        title: input.title,
        startsAt,
        endsAt,
        mode: input.mode,
        staffId,
        notes: input.notes || null,
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
    await tx.appointment.update({ where: { id }, data: { status } });
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
  });
}
