import { describe, expect, it } from 'vitest';
import { lodgedBy } from './cases';

const stages = ['counselling', 'applications', 'gic', 'lodged', 'biometrics', 'decision'].map((key) => ({ key }));

describe('lodged date', () => {
  it('is stamped at the lodged stage or any stage after it', () => {
    expect(lodgedBy(stages, 'gic')).toBe(false);
    expect(lodgedBy(stages, 'lodged')).toBe(true);
    expect(lodgedBy(stages, 'biometrics')).toBe(true); // skipped past "Lodged"
    expect(lodgedBy([{ key: 'one' }, { key: 'two' }], 'two')).toBe(false); // product without a lodged stage
  });
});
