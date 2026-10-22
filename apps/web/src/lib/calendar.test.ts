import { describe, expect, it } from 'vitest';
import { addMonths, layoutDay, step, viewDays, weekStart } from './calendar';

describe('calendar dates', () => {
  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-22')).toBe('2026-10-19'); // Thursday → Monday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday
  });

  it('month view covers whole weeks around the month', () => {
    const days = viewDays('month', '2026-10-22');
    expect(days[0]).toBe('2026-09-28');
    expect(days.at(-1)).toBe('2026-11-01');
    expect(days.length % 7).toBe(0);
    expect(viewDays('month', '2027-02-10')).toHaveLength(28); // Feb 2027 starts on a Monday and has 28 days
  });

  it('moves by a day, a week or a month, keeping month ends valid', () => {
    expect(step('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(step('week', '2026-10-22', -1)).toBe('2026-10-15');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(step('month', '2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('overlapping meetings', () => {
  it('share the width only with the meetings they overlap', () => {
    const placed = layoutDay([
      { id: 'a', start: 600, end: 660 }, // 10:00–11:00
      { id: 'b', start: 630, end: 690 }, // 10:30–11:30
      { id: 'c', start: 700, end: 730 }, // 11:40, alone
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, [p.col, p.cols]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });
});
