import type { ExpenseFields } from '../expenses/api';
import type { StoredReceipt } from './api';

export function archiveDraft(receipt: StoredReceipt): ExpenseFields {
  const values = receipt.draftValues ?? receipt;
  return { receiptId: receipt.id, amount: values.amount, expenseDate: values.expenseDate,
    currencyCode: values.currencyCode, merchant: values.merchant,
    category: receipt.draftValues?.category ?? 'uncategorized', accountId: receipt.draftValues?.accountId || null,
    note: receipt.draftValues?.note ?? '' };
}
