import { describe, expect, it } from 'vitest';
import { applyDebtEvent } from './ledger';

describe('debt ledger event arithmetic', () => {
  it('adds issue and signed adjustment events', () => {
    expect(applyDebtEvent(0, 'issue', 500)).toBe(500);
    expect(applyDebtEvent(500, 'adjustment', -50)).toBe(450);
  });

  it('subtracts repayment and settle events', () => {
    expect(applyDebtEvent(500, 'repayment', 100)).toBe(400);
    expect(applyDebtEvent(400, 'settle', 400)).toBe(0);
  });
});
