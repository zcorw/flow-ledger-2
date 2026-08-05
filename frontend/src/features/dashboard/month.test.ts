import { describe, expect, it } from 'vitest';
import { localMonth, monthEndDate } from './month';

describe('dashboard month selection', () => {
  it('uses the local calendar month', () => {
    expect(localMonth(new Date(2026, 7, 5, 10, 30))).toBe('2026-08');
  });

  it('converts a selected month to its month-end date', () => {
    expect(monthEndDate('2026-02')).toBe('2026-02-28');
    expect(monthEndDate('2024-02')).toBe('2024-02-29');
    expect(monthEndDate('2026-12')).toBe('2026-12-31');
  });

  it('rejects an invalid month', () => {
    expect(() => monthEndDate('2026-13')).toThrow('月份必须在 01 到 12 之间');
  });
});
