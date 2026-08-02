import { describe, expect, it } from 'vitest';
import { containsFullAccountNumber } from './validation';

describe('account identifier safety', () => {
  it('allows a masked tail number or alias', () => {
    expect(containsFullAccountNumber('尾号 8888')).toBe(false);
    expect(containsFullAccountNumber('家庭备用金')).toBe(false);
  });

  it('rejects a full account number', () => {
    expect(containsFullAccountNumber('6225888888888888')).toBe(true);
  });
});
