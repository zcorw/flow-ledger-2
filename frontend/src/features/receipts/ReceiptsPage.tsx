import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, CircularProgress, FormControlLabel, Pagination, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { formatExpenseAmount } from '../expenses/receiptParser';
import { listReceipts, type StoredReceipt } from './api';
import { ReceiptImage } from './ReceiptImage';
import { ReceiptDraftDialog } from './ReceiptDraftDialog';

export function ReceiptsPage() {
  const [page, setPage] = useState(0);
  const [imageId, setImageId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoredReceipt | null>(null);
  const [drafts, setDrafts] = useState(false), [search, setSearch] = useState('');
  const listing = useQuery({ queryKey: ['receipts', page, drafts, search], queryFn: () => listReceipts(page, drafts, search),
    refetchInterval: query => query.state.data?.items.some(item => item.status === 'recognizing') ? 5000 : false });
  return <Stack spacing={2.5}>
    <Button component={RouterLink} to="/expenses" sx={{ alignSelf: 'flex-start' }}>返回每日开销</Button>
    <Box><Typography component="h1" variant="h4">识别单据</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>查看拍摄原图及识别结果。识别单据不会自动记账。</Typography></Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}><TextField label="搜索商户" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} slotProps={{ htmlInput: { maxLength: 150 } }} /><FormControlLabel control={<Checkbox checked={drafts} onChange={event => { setDrafts(event.target.checked); setPage(0); }} />} label="仅看未入账草稿" /></Stack>
    {listing.isLoading && <CircularProgress aria-label="正在加载单据" />}
    {listing.isError && <Alert severity="error" action={<Button onClick={() => void listing.refetch()}>重试</Button>}>单据加载失败</Alert>}
    {listing.data?.total === 0 && <Typography color="text.secondary">暂无保存的单据。</Typography>}
    {listing.data?.items.map(item => { const values = item.draftValues ?? item; return <Card key={item.id}><CardContent><Stack spacing={1.5}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{values.amount ? `${values.currencyCode} ${formatExpenseAmount(values.amount)}`.trim() : ''}</Typography>
        <Chip size="small" label={item.expenseId ? '已关联开销' : item.draftValues ? '草稿 · 未入账' : item.status === 'recognized' ? '已识别 · 未入账' : item.status === 'failed' ? '识别失败 · 原图已保存' : '识别中'} />
      </Stack>
      {values.merchant && <Typography sx={{ overflowWrap: 'anywhere' }}>{values.merchant}</Typography>}
      <Typography>{values.expenseDate}</Typography>
      <Typography variant="caption" color="text.secondary">上传时间：{new Date(item.createdAt).toLocaleString()}</Typography>
      <Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => setImageId(item.id)}>查看原图</Button>
        {!item.expenseId && <Button onClick={() => setEditing(item)}>{item.draftValues ? '继续编辑草稿' : '编辑草稿'}</Button>}
        {(item.status === 'recognized' || item.draftValues) && !item.expenseId && <Button component={RouterLink} to="/expenses" state={{ receipt: item }}>记录开销</Button>}
      </Stack>
    </Stack></CardContent></Card>; })}
    {(listing.data?.total ?? 0) > 25 && <Pagination page={page + 1} count={Math.ceil((listing.data?.total ?? 0) / 25)} onChange={(_, value) => setPage(value - 1)} />}
    {imageId && <ReceiptImage key={imageId} id={imageId} onClose={() => setImageId(null)} />}
    {editing && <ReceiptDraftDialog key={editing.id} receipt={editing} onClose={() => setEditing(null)} />}
  </Stack>;
}
