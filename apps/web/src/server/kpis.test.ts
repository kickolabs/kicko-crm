import { describe, expect, it } from 'vitest';
import { buildTrends, weekEnds } from './kpis';

const now = new Date('2026-10-22T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000);
const kase = (o: Partial<{ createdAt: Date; status: string; outcome: string | null; decisionAt: Date | null; updatedAt: Date; lodgedAt: Date | null }>) => ({
  createdAt: daysAgo(200), status: 'OPEN', outcome: null, decisionAt: null, updatedAt: daysAgo(1), lodgedAt: null, ...o,
});

describe('dashboard trends', () => {
  it('has eight weekly points, the last ending now', () => {
    const ends = weekEnds(now);
    expect(ends).toHaveLength(8);
    expect(ends.at(-1)).toEqual(now);
    expect(ends[0]).toEqual(daysAgo(49));
  });

  it('counts per week and keeps cases open until they close', () => {
    const t = buildTrends(
      {
        leads: [{ createdAt: daysAgo(1) }, { createdAt: daysAgo(2) }, { createdAt: daysAgo(9) }],
        closedLeads: [],
        cases: [kase({ lodgedAt: daysAgo(3) }), kase({ createdAt: daysAgo(20), status: 'CLOSED', outcome: 'APPROVED', decisionAt: daysAgo(10) })],
        payments: [{ paidAt: daysAgo(1), amount: 50_000 }],
      },
      now,
      'Asia/Kolkata',
    );
    expect(t.newLeads.points.slice(-2)).toEqual([1, 2]);
    expect(t.lodged.points.at(-1)).toBe(1);
    expect(t.activeCases.points.slice(-4)).toEqual([1, 2, 1, 1]); // opened 20 days ago, decided 10 days ago
    expect(t.collected!.points.at(-1)).toBe(50_000);
    expect(t.newLeads.labels.at(-1)).toBe('Week to 22 Oct');
  });

  it('approval rate leaves withdrawn cases out, and is empty with no decisions', () => {
    const decided = (outcome: string, d: number) => kase({ status: 'CLOSED', outcome, decisionAt: daysAgo(d) });
    const t = buildTrends({ leads: [], closedLeads: [], cases: [decided('APPROVED', 5), decided('APPROVED', 30), decided('REFUSED', 40), decided('WITHDRAWN', 6)], payments: null }, now, 'UTC');
    expect(t.approval.rate).toBe(66.7);
    expect(t.approval.decisions).toBe(3);
    expect(t.collected).toBeNull();
    const none = buildTrends({ leads: [], closedLeads: [], cases: [], payments: null }, now, 'UTC');
    expect(none.approval.rate).toBeNull();
    expect(none.conversion.points.every((p) => p === null)).toBe(true);
  });
});
