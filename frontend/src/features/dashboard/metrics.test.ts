import { describe, expect, it } from 'vitest';
import { calculateForeignRatio, calculateNetWorth } from './metrics';

describe('dashboard accounting metrics', () => {
  it('subtracts liabilities from positive assets', () => {
    expect(calculateNetWorth(1_500, 200)).toBe(1_300);
  });

  it('handles foreign asset ratios and an empty portfolio', () => {
    expect(calculateForeignRatio(350, 1_000)).toBe(0.35);
    expect(calculateForeignRatio(0, 0)).toBe(0);
  });
});
