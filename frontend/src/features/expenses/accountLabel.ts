import type { ExpenseAccount } from './api';

export function expenseAccountLabel(account: ExpenseAccount): string {
  const institution = account.institution_name?.trim()
    || (account.institution_id === null ? '未关联机构' : '');
  const label = [institution, account.name, account.masked_identifier?.trim()]
    .filter(Boolean).join(' · ');
  return `${label}${account.is_active ? '' : '（停用）'}`;
}
