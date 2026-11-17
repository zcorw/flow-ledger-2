import { Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Pagination, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { formatExpenseAmount } from '../expenses/receiptParser';
import { listReceipts } from './api';
import { ReceiptImage } from './ReceiptImage';

export function ReceiptsPage() {
  const [page, setPage] = useState(0);
  const [imageId, setImageId] = useState<string | null>(null);
  const listing = useQuery({ queryKey: ['receipts', page], queryFn: () => listReceipts(page),
    refetchInterval: query => query.state.data?.items.some(item => item.status === 'recognizing') ? 5000 : false });
  return <Stack spacing={2.5}>
    <Button component={RouterLink} to="/expenses" sx={{ alignSelf: 'flex-start' }}>返回每日开销</Button>
    <Box><Typography component="h1" variant="h4">识别单据</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>查看拍摄原图及识别结果。识别单据不会自动记账。</Typography></Box>
    {listing.isLoading && <CircularProgress aria-label="正在加载单据" />}
    {listing.isError && <Alert severity="error" action={<Button onClick={() => void listing.refetch()}>重试</Button>}>单据加载失败</Alert>}
    {listing.data?.total === 0 && <Typography color="text.secondary">暂无保存的单据。</Typography>}
    {listing.data?.items.map(item => <Card key={item.id}><CardContent><Stack spacing={1.5}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{item.amount ? `${item.currencyCode} ${formatExpenseAmount(item.amount)}`.trim() : ''}</Typography>
        <Chip size="small" label={item.expenseId ? '已关联开销' : item.status === 'recognized' ? '已识别 · 未入账' : item.status === 'failed' ? '识别失败 · 原图已保存' : '识别中'} />
      </Stack>
      {item.merchant && <Typography sx={{ overflowWrap: 'anywhere' }}>{item.merchant}</Typography>}
      <Typography>{item.expenseDate}</Typography>
      <Typography variant="caption" color="text.secondary">上传时间：{new Date(item.createdAt).toLocaleString()}</Typography>
      <Stack direction="row" spacing={1}><Button variant="outlined" onClick={() => setImageId(item.id)}>查看原图</Button>
        {item.status === 'recognized' && !item.expenseId && <Button component={RouterLink} to="/expenses" state={{ receipt: item }}>记录开销</Button>}
      </Stack>
    </Stack></CardContent></Card>)}
    {(listing.data?.total ?? 0) > 25 && <Pagination page={page + 1} count={Math.ceil((listing.data?.total ?? 0) / 25)} onChange={(_, value) => setPage(value - 1)} />}
    {imageId && <ReceiptImage key={imageId} id={imageId} onClose={() => setImageId(null)} />}
  </Stack>;
}
