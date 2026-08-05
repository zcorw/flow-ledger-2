import { describe, expect, it } from 'vitest';
import { snapshotEditSchema } from './snapshotEdit';

describe('snapshotEditSchema', () => {
  it('accepts a valid date and signed amount with six decimals', () => {
    expect(snapshotEditSchema.safeParse({
      snapshotDate: '2026-08-31',
      originalAmount: '-12345678901234.123456',
    }).success).toBe(true);
  });

  it('rejects an invalid calendar date', () => {
    expect(snapshotEditSchema.safeParse({
      snapshotDate: '2026-02-30',
      originalAmount: '100',
    }).success).toBe(false);
  });

  it('rejects excessive decimal precision and scientific notation', () => {
    expect(snapshotEditSchema.safeParse({
      snapshotDate: '2026-08-31',
      originalAmount: '1.1234567',
    }).success).toBe(false);
    expect(snapshotEditSchema.safeParse({
      snapshotDate: '2026-08-31',
      originalAmount: '1e6',
    }).success).toBe(false);
  });
});
