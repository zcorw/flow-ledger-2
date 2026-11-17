import { API_BASE_URL, apiRequest } from '../../api/client';

export type StoredReceipt = {
  id: string; createdAt: string; status: 'recognizing' | 'recognized' | 'failed';
  mimeType: string; byteLength: number; sha256: string; expenseId: string | null;
  amount: string; expenseDate: string; currencyCode: string; merchant: string;
  warnings: string[]; failureCode: string;
};
export const listReceipts = (page: number) => apiRequest<{ items: StoredReceipt[]; total: number }>(`/receipts?offset=${page * 25}&limit=25`);
export const receiptImageUrl = (id: string) => `${API_BASE_URL}/receipts/${encodeURIComponent(id)}/image`;
