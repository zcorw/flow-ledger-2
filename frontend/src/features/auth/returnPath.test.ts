import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './returnPath';

describe('login return path', () => {
  it('preserves an internal authorization page', () => {
    expect(safeReturnPath('/receipt-devices?code=ABCD-EFGH')).toBe('/receipt-devices?code=ABCD-EFGH');
  });
  it('rejects external and malformed targets', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example', null]) expect(safeReturnPath(value)).toBe('/');
  });
});
