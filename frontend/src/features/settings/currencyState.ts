import type { Currency } from './api';

export function toggleCurrency(currencies: Currency[], code: string, limit: number): string[] {
  const target = currencies.find((currency) => currency.code === code);
  if (!target || target.is_base) return currencies.filter((currency) => currency.enabled).map((currency) => currency.code);
  const enabled = currencies.filter((currency) => currency.enabled).map((currency) => currency.code);
  if (target.enabled) return enabled.filter((currencyCode) => currencyCode !== code);
  if (enabled.length >= limit) throw new Error(`最多只能启用 ${limit} 个币种`);
  return [...enabled, code];
}
