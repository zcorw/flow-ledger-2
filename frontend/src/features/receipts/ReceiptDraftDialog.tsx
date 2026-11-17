import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { categories, getExpenseAccounts } from '../expenses/api';
import { expenseAccountLabel } from '../expenses/accountLabel';
import { getCurrencies } from '../settings/api';
import { saveReceiptDraft, type ReceiptDraftValues, type StoredReceipt } from './api';

export function ReceiptDraftDialog({ receipt, onClose }: { receipt: StoredReceipt; onClose: () => void }) {
  const [values, setValues] = useState<ReceiptDraftValues>(() => receipt.draftValues ?? {
    amount: receipt.amount, expenseDate: receipt.expenseDate, currencyCode: receipt.currencyCode,
    merchant: receipt.merchant, category: '', accountId: '', accountName: '', note: '',
  });
  const key = useRef(crypto.randomUUID()), lock = useRef(false);
  const queryClient = useQueryClient();
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: getCurrencies });
  const accounts = useQuery({ queryKey: ['expense-accounts'], queryFn: getExpenseAccounts });
  const save = useMutation({ mutationFn: () => saveReceiptDraft(receipt, values, key.current),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['receipts'] }); onClose(); },
    onSettled: () => { lock.current = false; },
  });
  const change = (field: keyof ReceiptDraftValues, value: string) => {
    if (save.isPending) return;
    key.current = crypto.randomUUID(); setValues(current => ({ ...current, [field]: value }));
  };
  return <Dialog open fullWidth maxWidth="sm" onClose={() => { if (!save.isPending) onClose(); }}>
    <DialogTitle>编辑单据草稿</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      <Alert severity="info">草稿只保存单据字段和原图关联，不创建开销。未知字段可留空。</Alert>
      {save.error && <Alert severity="error">{save.error instanceof Error ? save.error.message : '保存失败，内容已保留，请重试'}</Alert>}
      {(currencies.isError || accounts.isError) && <Alert severity="warning">账户或币种加载失败，可关闭后重试，已填写内容仍可保存。</Alert>}
      <TextField label="商户" value={values.merchant} disabled={save.isPending} onChange={e => change('merchant', e.target.value)} slotProps={{ htmlInput: { maxLength: 150 } }} />
      <TextField label="金额" value={values.amount} disabled={save.isPending} onChange={e => change('amount', e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 32 } }} />
      <TextField select label="币种" value={values.currencyCode} disabled={save.isPending} onChange={e => change('currencyCode', e.target.value)}><MenuItem value="">待确认</MenuItem>{currencies.data?.map(item => <MenuItem key={item.code} value={item.code}>{item.code}</MenuItem>)}</TextField>
      <TextField label="时间" type="date" value={values.expenseDate} disabled={save.isPending} onChange={e => change('expenseDate', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField select label="账户" value={values.accountId} disabled={save.isPending} onChange={e => change('accountId', e.target.value)}><MenuItem value="">待确认</MenuItem>{accounts.data?.filter(item => item.is_active).map(item => <MenuItem key={item.id} value={item.id}>{expenseAccountLabel(item)}</MenuItem>)}</TextField>
      <TextField select label="分类" value={values.category} disabled={save.isPending} onChange={e => change('category', e.target.value)}><MenuItem value="">待确认</MenuItem>{Object.entries(categories).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
      <TextField label="备注" multiline value={values.note} disabled={save.isPending} onChange={e => change('note', e.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} />
    </Stack></DialogContent><DialogActions><Button disabled={save.isPending} onClick={onClose}>关闭</Button><Button variant="contained" disabled={save.isPending} onClick={() => { if (!lock.current) { lock.current = true; save.mutate(); } }}>{save.isPending ? '保存中…' : '保存草稿'}</Button></DialogActions>
  </Dialog>;
}
