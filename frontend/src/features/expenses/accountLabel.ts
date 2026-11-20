import type { ExpenseAccount } from './api';

export function canSelectExpenseAccount(account: ExpenseAccount, existingId?: string | null): boolean {
  return account.can_be_payment_account !== false || account.id === existingId;
}

export function expenseAccountLabel(account: ExpenseAccount): string {
  const institution = account.institution_name?.trim()
    || (account.institution_id === null ? '未关联机构' : '');
  const label = [institution, account.name, account.masked_identifier?.trim()]
    .filter(Boolean).join(' · ');
  return `${label}${account.is_active ? '' : '（停用）'}`;
}
