import { describe, expect, it } from 'vitest';
import { aggregate, measureValue, PRESETS, periodRange, specFromParams, specToParams, tableCsv, weekKey, type Fact } from './reports';

const lead = (source: string, owner: string | null, month: string, won = false): Fact => ({ dims: { source, owner, month, status: won ? 'WON' : 'NEW' }, won });

describe('aggregate', () => {
  const facts = [lead('ADS', 'u1', '2026-01'), lead('ADS', 'u1', '2026-02', true), lead('ADS', 'u2', '2026-02'), lead('REFERRAL', 'u2', '2026-01', true), lead('WALK_IN', null, '2026-03')];

  it('groups, sorts by size, and computes conversion', () => {
    const t = aggregate(facts, { groupBy: 'source', splitBy: null, measure: 'conversion' });
    expect(t.rows.map((r) => [r.key, r.total.n, measureValue(r.total, 'conversion')])).toEqual([
      ['ADS', 3, 33.3],
      ['REFERRAL', 1, 100],
      ['WALK_IN', 1, 0],
    ]);
    expect(measureValue(t.grand, 'conversion')).toBe(40);
  });

  it('splits into columns; months stay in time order; missing values are grouped', () => {
    const t = aggregate(facts, { groupBy: 'month', splitBy: 'owner', measure: 'count' });
    expect(t.rows.map((r) => r.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(t.columns).toEqual(['u1', 'u2', '__none']);
    expect(t.rows[1]!.cells.u2!.n).toBe(1);
    expect(t.totals.u1!.n).toBe(2);
  });

  it('filters, approval rates and amounts', () => {
    const cases: Fact[] = [
      { dims: { product: 'p1', status: 'CLOSED' }, outcome: 'APPROVED' },
      { dims: { product: 'p1', status: 'CLOSED' }, outcome: 'REFUSED' },
      { dims: { product: 'p1', status: 'CLOSED' }, outcome: 'APPROVED' },
      { dims: { product: 'p1', status: 'OPEN' }, outcome: null },
      { dims: { product: 'p2', status: 'CLOSED' }, outcome: 'WITHDRAWN' },
    ];
    const t = aggregate(cases, { groupBy: 'product', splitBy: null, measure: 'approval' });
    expect(measureValue(t.rows[0]!.total, 'approval')).toBe(66.7);
    expect(measureValue(t.rows[1]!.total, 'approval')).toBeNull(); // nothing decided
    expect(aggregate(cases, { groupBy: 'product', splitBy: null, measure: 'count', filter: { status: 'OPEN' } }).grand.n).toBe(1);
    const pay = aggregate([{ dims: { method: 'UPI' }, amount: 500 }, { dims: { method: 'UPI' }, amount: 250 }], { groupBy: 'method', splitBy: null, measure: 'amount' });
    expect(measureValue(pay.grand, 'amount')).toBe(750);
  });

  it('caps very long tables', () => {
    const many = Array.from({ length: 80 }, (_, i) => lead(`S${i}`, null, '2026-01'));
    const t = aggregate(many, { groupBy: 'source', splitBy: null, measure: 'count' }, 50);
    expect(t.rows).toHaveLength(50);
    expect(t.truncated).toBe(true);
    expect(t.grand.n).toBe(80);
  });
});

describe('periods and URLs', () => {
  const now = new Date('2026-10-22T10:00:00Z');
  const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
  it('computes ranges', () => {
    expect([periodRange({ period: 'this_month' }, now)].map((r) => [iso(r.from), iso(r.to)])).toEqual([['2026-10-01', null]]);
    expect([periodRange({ period: 'last_month' }, now)].map((r) => [iso(r.from), iso(r.to)])).toEqual([['2026-09-01', '2026-10-01']]);
    expect(iso(periodRange({ period: 'last_30' }, now).from)).toBe('2026-09-23');
    expect([periodRange({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }, now)].map((r) => [iso(r.from), iso(r.to)])).toEqual([['2026-01-01', '2026-02-01']]);
    expect(weekKey(new Date('2026-10-22T00:00:00Z'))).toBe('2026-10-19');
  });
  it('round-trips specs through the URL and falls back sensibly', () => {
    for (const p of PRESETS) expect(specFromParams(specToParams(p.spec), PRESETS[0]!.spec)).toMatchObject(p.spec);
    const switched = specFromParams({ e: 'cases' }, PRESETS[0]!.spec);
    expect(switched).toMatchObject({ entity: 'cases', groupBy: 'product', measure: 'count', splitBy: null });
  });
  it('writes CSV', () => {
    expect(tableCsv(['Source', 'Leads'], [['Ads, Facebook', 3], ['Walk-in', null]])).toBe('Source,Leads\n"Ads, Facebook",3\nWalk-in,\n');
  });
});
