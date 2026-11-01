import { describe, expect, it } from 'vitest';
import { formatExpenseAmount, localDate, parseReceipt, validAmount, validCalendarDate } from './receiptParser';

describe('conservative Japanese/English receipt parsing', () => {
  it.each([
    '合計 ￥1,234', '合計（税込） ￥1,234', '税込合計 1,234円',
    '合計 1,234円（内消費税 91円）', '合計（内税91円） 1,234円',
    '合 計 ¥1,234', 'TOTAL JPY 1,234',
  ])('extracts a single total, including tax-inclusive labels: %s', (line) => {
    const value = parseReceipt(`合成スーパー\n2026年11月01日\nお茶 200円\n小計 1143円\n${line}\n消費税 91円\nお預り 2000円\nお釣り 766円`);
    expect(value.amount).toBe('1234');
    expect(value.expenseDate).toBe('2026-11-01');
    expect(value.currencyCode).toBe('JPY');
    expect(value.merchant).toBe('合成スーパー');
  });
  it('does not sum item rows, tax, subtotals or change', () => {
    expect(parseReceipt('商品 100円\n商品 200円\n小計 300円\n消費税 30円\nお釣り 670円').amount).toBe('');
    expect(parseReceipt('合計330円\nお支払合計330円').amount).toBe('330');
  });
  it('leaves ambiguous amounts, dates and yen currency empty', () => {
    const value = parseReceipt('合計 ¥100\n合計 ¥200\n2026/11/01\n2026/11/02');
    expect(value.amount).toBe(''); expect(value.currencyCode).toBe(''); expect(value.expenseDate).toBe('');
    expect(value.warnings).toHaveLength(4);
    expect(parseReceipt('TOTAL USD 10.200000\n2026-02-30').amount).toBe('10.2');
    expect(parseReceipt('TOTAL USD 10.200000\n2026-02-30').expenseDate).toBe('');
    expect(parseReceipt('').amount).toBe('');
  });
  it('normalizes fullwidth text and keeps categories outside OCR guessing', () => {
    expect(parseReceipt('合計 ￥１，２３４円\n２０２６年１１月１日').amount).toBe('1234');
  });
  it('requires correction when a yen thousands comma is misrecognized as a decimal', () => {
    const value = parseReceipt('合計 1.234円');
    expect(value.amount).toBe('');
    expect(value.warnings.join(' ')).toContain('分隔符识别错误');
  });
});

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
