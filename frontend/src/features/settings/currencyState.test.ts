import { describe, expect, it } from 'vitest';
import type { Currency } from './api';
import { toggleCurrency } from './currencyState';

const currencies: Currency[] = [
  { code: 'CNY', name: '人民币', symbol: '¥', decimal_places: 2, enabled: true, is_base: true },
  { code: 'USD', name: '美元', symbol: '$', decimal_places: 2, enabled: true, is_base: false },
  { code: 'JPY', name: '日元', symbol: '¥', decimal_places: 2, enabled: false, is_base: false },
];

describe('toggleCurrency', () => {
  it('keeps the base currency enabled', () => {
    expect(toggleCurrency(currencies, 'CNY', 5)).toEqual(['CNY', 'USD']);
  });

  it('enables and disables optional currencies', () => {
    expect(toggleCurrency(currencies, 'USD', 5)).toEqual(['CNY']);
    expect(toggleCurrency(currencies, 'JPY', 5)).toEqual(['CNY', 'USD', 'JPY']);
  });

  it('enforces the configured limit', () => {
    expect(() => toggleCurrency(currencies, 'JPY', 2)).toThrow('最多只能启用 2 个币种');
  });
});
