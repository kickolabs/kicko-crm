import { describe, expect, it } from 'vitest';
import { deviceName } from './audit';
import { rowsToCsv } from './export';

describe('data export CSV', () => {
  it('writes every column, formats dates and JSON, and never includes internal or secret columns', () => {
    const csv = rowsToCsv([
      { id: 'c1', tenantId: 't1', firstName: 'Priya, S', dob: new Date('1996-08-14T00:00:00Z'), tests: [{ test: 'IELTS', overall: '7' }], storageKey: 'tenants/t1/x', token: 'secret' },
      { id: 'c2', tenantId: 't1', firstName: 'Ravi', dob: null, extra: 5 },
    ]);
    const [head, r1, r2] = csv.trim().split('\n');
    expect(head).toBe('id,firstName,dob,tests,extra');
    expect(r1).toBe('c1,"Priya, S",1996-08-14T00:00:00.000Z,"[{""test"":""IELTS"",""overall"":""7""}]",');
    expect(r2).toBe('c2,Ravi,,,5');
  });
});

describe('device names in the audit log', () => {
  it('reads common browsers', () => {
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge on Windows');
    expect(deviceName(null)).toBe('Unknown device');
  });
});
