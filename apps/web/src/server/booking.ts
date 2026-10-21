import 'server-only';
import type { TenantSettings } from '@kicko/db/provision';
import { fmtDateTime, parseLocal, toLocalInput } from '@/lib/format';
import type { Contact } from './contacts';
import { inTenant, logActivity, UserError, type Scope } from './scope';

export type AppointmentMode = 'IN_PERSON' | 'VIDEO' | 'PHONE';

// Self-service booking against the agency's booking hours (Settings → Client portal).
// Used by the client portal and the WhatsApp assistant.

export const DEFAULT_BOOKING: NonNullable<TenantSettings['portal']> = {
  bookingEnabled: true,
  days: [1, 2, 3, 4, 5, 6],
  start: '10:00',
  end: '18:00',
  slotMinutes: 30,
};

/** Who takes the booking: the contact's owner, else the first owner/admin. */
export async function bookingStaff(scope: Scope, ownerId: string | null) {
  if (ownerId) return ownerId;
  const m = await inTenant(scope, (tx) => tx.membership.findFirst({ where: { active: true, role: { in: ['OWNER', 'ADMIN'] } }, orderBy: { createdAt: 'asc' } }));
  return m?.userId ?? null;
}

export async function openSlots(scope: Scope, staffId: string | null, horizonDays = 14) {
  const cfg = { ...DEFAULT_BOOKING, ...scope.settings.portal };
  if (!cfg.bookingEnabled) return { enabled: false as const, days: [] };
  const tz = scope.timezone;
  const now = new Date();
  const earliest = new Date(now.getTime() + 2 * 3600_000);
  const until = new Date(now.getTime() + (horizonDays + 1) * 86400_000);
  const busy = staffId
    ? await inTenant(scope, (tx) => tx.appointment.findMany({ where: { staffId, status: 'SCHEDULED', startsAt: { lt: until }, endsAt: { gt: now } }, select: { startsAt: true, endsAt: true } }))
    : [];

  const [sh, sm] = cfg.start.split(':').map(Number) as [number, number];
  const [eh, em] = cfg.end.split(':').map(Number) as [number, number];
  const days: { date: string; label: string; slots: string[] }[] = [];
  for (let d = 0; d <= horizonDays; d++) {
    const date = toLocalInput(new Date(now.getTime() + d * 86400_000), tz, true);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!cfg.days.includes(weekday)) continue;
    const slots: string[] = [];
    for (let m = sh * 60 + sm; m + cfg.slotMinutes <= eh * 60 + em; m += cfg.slotMinutes) {
      const local = `${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const start = parseLocal(local, tz)!;
      const end = new Date(start.getTime() + cfg.slotMinutes * 60_000);
      if (start < earliest) continue;
      if (busy.some((b) => b.startsAt < end && b.endsAt > start)) continue;
      slots.push(start.toISOString());
    }
    if (slots.length) {
      days.push({
        date,
        label: new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(`${date}T12:00:00Z`)),
        slots,
      });
    }
  }
  return { enabled: true as const, days, slotMinutes: cfg.slotMinutes };
}

const MODE_WORD: Record<AppointmentMode, string> = { IN_PERSON: 'meeting', VIDEO: 'video call', PHONE: 'phone call' };

export async function bookSlot(
  scope: Scope,
  input: { contact: Contact; ownerId: string | null; startsAt: string; mode: AppointmentMode; topic?: string; via: string },
) {
  const staffId = await bookingStaff(scope, input.ownerId);
  const avail = await openSlots(scope, staffId);
  if (!avail.enabled) throw new UserError('Online booking is turned off. Please message your consultant.');
  if (!avail.days.some((d) => d.slots.includes(new Date(input.startsAt).toISOString()))) {
    throw new UserError('That time was just taken. Please pick another slot.');
  }
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + avail.slotMinutes * 60_000);
  const isClient = input.contact.kind === 'client';
  return inTenant(scope, async (tx) => {
    // Re-check inside the transaction to avoid double booking.
    if (staffId && (await tx.appointment.count({ where: { staffId, status: 'SCHEDULED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }))) {
      throw new UserError('That time was just taken. Please pick another slot.');
    }
    const openCase = isClient ? await tx.case.findFirst({ where: { clientId: input.contact.id, status: 'OPEN' }, orderBy: { createdAt: 'desc' } }) : null;
    const appt = await tx.appointment.create({
      data: {
        tenantId: scope.tenantId,
        title: 'Consultation (booked online)',
        startsAt,
        endsAt,
        mode: input.mode,
        staffId,
        notes: input.topic || null,
        ...(isClient ? { clientId: input.contact.id } : { leadId: input.contact.id }),
        caseId: openCase?.id ?? null,
      },
    });
    await logActivity(tx, scope, {
      type: 'APPOINTMENT',
      summary: `${isClient ? 'Client' : 'Lead'} booked a ${MODE_WORD[input.mode]} via ${input.via}`,
      ...(isClient ? { clientId: input.contact.id } : { leadId: input.contact.id }),
      caseId: openCase?.id ?? null,
      data: { startsAt: startsAt.toISOString(), topic: input.topic ?? null },
    });
    return appt;
  });
}

/** A short, spread-out choice of free times (up to two a day) for chat and voice. */
export async function suggestSlots(scope: Scope, ownerId: string | null, count = 6) {
  const avail = await openSlots(scope, await bookingStaff(scope, ownerId), 14);
  if (!avail.enabled) return { enabled: false as const, slots: [] as { iso: string; label: string }[] };
  const isos = avail.days.flatMap((d) => (d.slots.length > 1 ? [d.slots[0]!, d.slots[Math.floor(d.slots.length / 2)]!] : d.slots)).slice(0, count);
  return { enabled: true as const, slots: isos.map((iso) => ({ iso, label: fmtDateTime(iso, scope.timezone) })) };
}
