import { describe, expect, it } from 'vitest';
import { checkSlot, localParts, minLocalInput, type WorkingHours } from './booking-rules';
import { parseLocal } from './format';

const IST = 'Asia/Kolkata';
const TORONTO = 'America/Toronto';
const office: WorkingHours = { days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '18:00' };
// Wednesday 22 Oct 2026, 14:30 in India (09:00 UTC)
const now = parseLocal('2026-10-22T14:30', IST)!;
const slot = (local: string, minutes = 30, tz = IST) => {
  const startsAt = parseLocal(local, tz)!;
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
};

describe('checkSlot', () => {
  it('refuses a date in the past', () => {
    expect(checkSlot({ ...slot('2026-10-21T11:00'), now, tz: IST, hours: office })).toMatchObject({
      code: 'past',
      message: 'That date is in the past. Pick a future date.',
    });
  });

  it('refuses a time earlier today, and says so', () => {
    expect(checkSlot({ ...slot('2026-10-22T11:00'), now, tz: IST, hours: office })).toMatchObject({
      code: 'past',
      message: 'That time has already passed today. Pick a later time.',
    });
  });

  it('allows a minute of slack for a form submitted straight away', () => {
    const justNow = { startsAt: new Date(now.getTime() - 30_000), endsAt: new Date(now.getTime() + 29 * 60_000) };
    expect(checkSlot({ ...justNow, now, tz: IST })).toBeNull();
  });

  it('accepts a valid future slot later today and on a later day', () => {
    expect(checkSlot({ ...slot('2026-10-22T15:00'), now, tz: IST, hours: office })).toBeNull();
    expect(checkSlot({ ...slot('2026-10-24T10:00', 60), now, tz: IST, hours: office })).toBeNull();
  });

  it('refuses a closed day and times outside office hours', () => {
    expect(checkSlot({ ...slot('2026-10-25T11:00'), now, tz: IST, hours: office })?.message).toBe('The office is closed on Sundays');
    expect(checkSlot({ ...slot('2026-10-23T09:30'), now, tz: IST, hours: office })?.code).toBe('outside_hours');
    // starts inside but runs past closing
    expect(checkSlot({ ...slot('2026-10-23T17:45'), now, tz: IST, hours: office })?.code).toBe('outside_hours');
    // ending exactly at closing is fine
    expect(checkSlot({ ...slot('2026-10-23T17:30'), now, tz: IST, hours: office })).toBeNull();
  });

  it('lets an admin override office hours, but never the past', () => {
    expect(checkSlot({ ...slot('2026-10-25T11:00'), now, tz: IST, hours: office, allowOutsideHours: true })).toBeNull();
    expect(checkSlot({ ...slot('2026-10-21T11:00'), now, tz: IST, hours: office, allowOutsideHours: true })?.code).toBe('past');
  });

  it('refuses a clash with the same consultant', () => {
    const busy = [{ ...slot('2026-10-23T11:00', 60), title: 'Visa review' }];
    expect(checkSlot({ ...slot('2026-10-23T11:30'), now, tz: IST, hours: office, busy })?.message).toBe('Clashes with "Visa review"');
    expect(checkSlot({ ...slot('2026-10-23T12:00'), now, tz: IST, hours: office, busy })).toBeNull();
  });

  it('refuses lengths outside 5 minutes to 8 hours', () => {
    expect(checkSlot({ ...slot('2026-10-23T11:00', 2), now, tz: IST })?.code).toBe('duration');
    expect(checkSlot({ ...slot('2026-10-23T11:00', 600), now, tz: IST })?.code).toBe('duration');
  });

  it('judges hours in the agency timezone, not the server timezone', () => {
    // 10:00 in Toronto is 19:30 in India: inside a Toronto agency's hours, outside an Indian one's.
    const toronto = slot('2026-10-23T10:00', 30, TORONTO);
    expect(checkSlot({ ...toronto, now, tz: TORONTO, hours: office })).toBeNull();
    expect(checkSlot({ ...toronto, now, tz: IST, hours: office })?.code).toBe('outside_hours');
  });

  it('knows "today" by the agency date across midnight UTC', () => {
    // 00:30 on 23 Oct in India is still 22 Oct in UTC
    const lateNow = parseLocal('2026-10-23T00:30', IST)!;
    expect(localParts(lateNow, IST).date).toBe('2026-10-23');
    expect(checkSlot({ ...slot('2026-10-23T00:10'), now: lateNow, tz: IST })?.message).toMatch(/passed today/);
  });
});

describe('minLocalInput', () => {
  it('is "now" as a datetime-local value in the agency timezone', () => {
    expect(minLocalInput(IST, now)).toBe('2026-10-22T14:30');
    expect(minLocalInput(TORONTO, now)).toBe('2026-10-22T05:00');
  });
});
