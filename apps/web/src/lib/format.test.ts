import { describe, expect, it } from 'vitest';
import { displayIp } from './format';

describe('displayIp', () => {
  it('hides addresses that mean "no real IP" (local development)', () => {
    for (const ip of ['0000:0000:0000:0000:0000:0000:0000:0000', '::', '::1', '127.0.0.1', '::ffff:127.0.0.1', '0000:0000:0000:0000:0000:ffff:7f00:0001', null, '']) {
      expect(displayIp(ip)).toBeNull();
    }
  });

  it('shortens IPv6 the standard way', () => {
    expect(displayIp('2401:4900:1c3a:0000:0000:0000:0000:0012')).toBe('2401:4900:1c3a::12');
    expect(displayIp('2001:0db8:0000:0001:0000:0000:0000:0001')).toBe('2001:db8:0:1::1');
    expect(displayIp('2001:db8:85a3:1:2:8a2e:370:7334')).toBe('2001:db8:85a3:1:2:8a2e:370:7334');
  });

  it('shows IPv4 as IPv4, even when stored inside IPv6', () => {
    expect(displayIp('49.37.120.5')).toBe('49.37.120.5');
    expect(displayIp('::ffff:49.37.120.5')).toBe('49.37.120.5');
    expect(displayIp('0000:0000:0000:0000:0000:ffff:3125:7805')).toBe('49.37.120.5');
  });
});
