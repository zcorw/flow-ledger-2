import { API_BASE_URL, apiRequest } from '../../api/client';
import type { Category } from '../expenses/api';

export type ReceiptDraftValues = {
  amount: string; expenseDate: string; currencyCode: string; merchant: string;
  category: Category | ''; accountId: string; accountName: string; note: string;
};

export type StoredReceipt = {
  id: string; createdAt: string; status: 'recognizing' | 'recognized' | 'failed';
  mimeType: string; byteLength: number; sha256: string; expenseId: string | null;
  amount: string; expenseDate: string; currencyCode: string; merchant: string;
  warnings: string[]; failureCode: string;
  draftValues?: ReceiptDraftValues | null; draftRevision?: number;
};
export const listReceipts = (page: number, drafts = false, q = '') => apiRequest<{ items: StoredReceipt[]; total: number }>(`/receipts?${new URLSearchParams({ offset: String(page * 25), limit: '25', drafts: String(drafts), q })}`);
export const saveReceiptDraft = (receipt: StoredReceipt, values: ReceiptDraftValues, requestKey: string) => apiRequest<{ revision: number; values: ReceiptDraftValues }>('/receipts/drafts', { method: 'POST', body: JSON.stringify({ receiptId: receipt.id, expectedRevision: receipt.draftRevision ?? 0, requestKey, values }) });
export const receiptImageUrl = (id: string) => `${API_BASE_URL}/receipts/${encodeURIComponent(id)}/image`;
