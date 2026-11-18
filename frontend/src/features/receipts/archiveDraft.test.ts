import { expect, test } from 'vitest';
import { archiveDraft } from './archiveDraft';
import type { StoredReceipt } from './api';

test('archived candidates preserve their association and leave unknown fields empty', () => {
  const receipt = { id: 'bc9b17dd-e2b9-4310-b2f5-ed9f50c9c935', amount: '42.00', expenseDate: '', currencyCode: '', merchant: '' } as StoredReceipt;
  const draft = archiveDraft(receipt);
  expect(draft.receiptId).toBe(receipt.id); expect(draft.amount).toBe('42.00');
  expect(draft.expenseDate).toBe(''); expect(draft.currencyCode).toBe(''); expect(draft.merchant).toBe('');
  expect(draft.accountId).toBeNull(); expect(draft.category).toBe('uncategorized');
});

test('continues saved fields without inventing a category or account', () => {
  const receipt = { id: 'receipt', amount: '1', expenseDate: '', currencyCode: '', merchant: '',
    draftValues: { amount: '614', expenseDate: '', currencyCode: 'JPY', merchant: '已修正',
      category: '' as const, accountId: '', accountName: '', note: '草稿' } } as Parameters<typeof archiveDraft>[0];
  expect(archiveDraft(receipt)).toMatchObject({ amount: '614', merchant: '已修正', category: '', accountId: null, note: '草稿' });
});
