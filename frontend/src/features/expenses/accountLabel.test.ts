import { describe, expect, it } from 'vitest';
import { canSelectExpenseAccount, expenseAccountLabel } from './accountLabel';
import type { ExpenseAccount } from './api';

const account: ExpenseAccount = {
  id: 'account-a', institution_id: 'bank-a', institution_name: 'Bank A',
  name: '资产账户', account_type: 'savings', masked_identifier: null,
  display_color: null, is_active: true, project_count: 0,
};

describe('expense account selection', () => {
  it('keeps eligible, unassigned and legacy API accounts selectable', () => {
    expect(canSelectExpenseAccount({ ...account, can_be_payment_account: true })).toBe(true);
    expect(canSelectExpenseAccount({ ...account, institution_id: null, can_be_payment_account: true })).toBe(true);
    expect(canSelectExpenseAccount(account)).toBe(true);
  });

  it('rejects newly selecting an ineligible account but preserves the existing expense relation', () => {
    const excluded = { ...account, can_be_payment_account: false };
    expect(canSelectExpenseAccount(excluded)).toBe(false);
    expect(canSelectExpenseAccount(excluded, 'different-account')).toBe(false);
    expect(canSelectExpenseAccount(excluded, excluded.id)).toBe(true);
    expect(expenseAccountLabel(excluded)).toBe('Bank A · 资产账户');
  });
});

describe('expense account labels', () => {
  it('distinguishes identically named accounts at different institutions', () => {
    expect(expenseAccountLabel(account)).toBe('Bank A · 资产账户');
    expect(expenseAccountLabel({ ...account, institution_name: 'Bank B' }))
      .toBe('Bank B · 资产账户');
  });
  it('includes masked identifiers and inactive status', () => {
    expect(expenseAccountLabel({ ...account, masked_identifier: '尾号 1234', is_active: false }))
      .toBe('Bank A · 资产账户 · 尾号 1234（停用）');
  });
  it('preserves unassigned accounts and tolerates an older API response', () => {
    expect(expenseAccountLabel({ ...account, institution_id: null, institution_name: null }))
      .toBe('未关联机构 · 资产账户');
    expect(expenseAccountLabel({ ...account, institution_name: undefined }))
      .toBe('资产账户');
  });
});
