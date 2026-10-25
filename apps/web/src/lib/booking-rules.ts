import { toLocalInput } from './format';

// Rules every staff-booked appointment must pass, checked on the server (the date picker's
// `min` is only a convenience). Times are judged as wall-clock time in the agency's timezone.

export type WorkingHours = { days: number[]; start: string; end: string }; // days: 0 = Sunday
export type Busy = { startsAt: Date; endsAt: Date; title?: string };
export type SlotProblem = { code: 'past' | 'outside_hours' | 'clash' | 'duration'; message: string };

/** A minute of slack so a form opened "now" and submitted at once still passes. */
export const PAST_GRACE_MS = 60_000;
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 480;

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Local date (YYYY-MM-DD), weekday and minute-of-day of an instant in `tz`. */
export function localParts(d: Date, tz: string) {
  const v = toLocalInput(d, tz);
  const date = v.slice(0, 10);
  return { date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay(), minute: minutes(v.slice(11, 16)) };
}

/** The value for a datetime-local `min`: now, in the agency's timezone. */
export const minLocalInput = (tz: string, now = new Date()) => toLocalInput(now, tz);

export function checkSlot(o: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  tz: string;
  hours?: WorkingHours | null;
  busy?: Busy[];
  allowOutsideHours?: boolean;
}): SlotProblem | null {
  const length = (o.endsAt.getTime() - o.startsAt.getTime()) / 60_000;
  if (!(length >= MIN_MINUTES && length <= MAX_MINUTES)) {
    return { code: 'duration', message: `Appointments run ${MIN_MINUTES} minutes to ${MAX_MINUTES / 60} hours` };
  }
  if (o.startsAt.getTime() < o.now.getTime() - PAST_GRACE_MS) {
    const today = localParts(o.startsAt, o.tz).date === localParts(o.now, o.tz).date;
    return { code: 'past', message: today ? 'That time has already passed today. Pick a later time.' : 'That date is in the past. Pick a future date.' };
  }
  if (o.hours && !o.allowOutsideHours) {
    const s = localParts(o.startsAt, o.tz);
    const e = localParts(new Date(o.endsAt.getTime() - 1), o.tz);
    if (!o.hours.days.includes(s.weekday)) {
      return { code: 'outside_hours', message: `The office is closed on ${DAY[s.weekday]}s` };
    }
    if (s.date !== e.date || s.minute < minutes(o.hours.start) || e.minute + 1 > minutes(o.hours.end)) {
      return { code: 'outside_hours', message: `Outside office hours (${o.hours.start}–${o.hours.end})` };
    }
  }
  const clash = o.busy?.find((b) => b.startsAt < o.endsAt && b.endsAt > o.startsAt);
  if (clash) return { code: 'clash', message: clash.title ? `Clashes with "${clash.title}"` : 'Clashes with another appointment' };
  return null;
}
