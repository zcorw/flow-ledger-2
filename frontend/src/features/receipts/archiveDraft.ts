import type { ExpenseFields } from '../expenses/api';
import type { StoredReceipt } from './api';

export function archiveDraft(receipt: StoredReceipt): ExpenseFields {
  return { receiptId: receipt.id, amount: receipt.amount, expenseDate: receipt.expenseDate,
    currencyCode: receipt.currencyCode, merchant: receipt.merchant,
    category: 'uncategorized', accountId: null, note: '' };
}
