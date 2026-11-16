import { describe, expect, it } from 'vitest';
import { expenseAccountLabel } from './accountLabel';
import type { ExpenseAccount } from './api';

const account: ExpenseAccount = {
  id: 'account-a', institution_id: 'bank-a', institution_name: 'Bank A',
  name: '资产账户', account_type: 'savings', masked_identifier: null,
  display_color: null, is_active: true, project_count: 0,
};

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
