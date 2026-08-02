import { describe, expect, it } from 'vitest';
import { isUnusualChange } from './change';

describe('snapshot change hints', () => {
  it('flags absolute or relative changes beyond thresholds', () => {
    expect(isUnusualChange(31_000, 10_000)).toBe(true);
    expect(isUnusualChange(1_300, 1_000)).toBe(true);
  });

  it('does not flag changes at or below thresholds', () => {
    expect(isUnusualChange(12_000, 10_000)).toBe(false);
    expect(isUnusualChange(1_200, 1_000)).toBe(false);
  });
});
