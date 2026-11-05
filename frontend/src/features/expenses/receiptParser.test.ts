import { expect, it } from 'vitest';
import { formatExpenseAmount, localDate, validAmount, validCalendarDate } from './receiptParser';

it('validates money without floating-point rounding and formats full precision', () => {
  expect(validAmount('99999999999999.999999')).toBe(true);
  for (const value of ['0', '-1', '1e2', 'Infinity', '1.0000001', '100000000000000']) expect(validAmount(value)).toBe(false);
  expect(formatExpenseAmount('99999999999999.999999')).toBe('99,999,999,999,999.999999');
  expect(formatExpenseAmount('1234.000000')).toBe('1,234');
});

it('uses local calendar dates and validates leap days', () => {
  expect(validCalendarDate('2024-02-29')).toBe(true);
  expect(validCalendarDate('2026-02-29')).toBe(false);
  expect(validCalendarDate('2026-11-01T00:00:00Z')).toBe(false);
  expect(localDate(new Date(2026, 10, 1, 0, 1))).toBe('2026-11-01');
  expect(localDate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
});
