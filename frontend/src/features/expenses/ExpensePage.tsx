import AddOutlined from '@mui/icons-material/AddOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent,
  Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  LinearProgress, MenuItem, Pagination, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError } from '../../api/client';
import { getCurrencies } from '../settings/api';
import {
  categories, createExpense, deleteExpense, getExpenseAccounts, listExpenses, updateExpense,
  type Category, type Expense, type ExpenseFields, type Filters,
} from './api';
import { recognizeReceipt, validateReceiptImage } from './ocr';
import { formatExpenseAmount, localDate, parseReceipt, validAmount, validCalendarDate } from './receiptParser';

const emptyDraft = (): ExpenseFields => ({ expenseDate: localDate(), amount: '', currencyCode: 'JPY',
  category: 'uncategorized', merchant: '', accountId: null, note: '' });
const initialFilters = (): Filters => ({ startDate: `${localDate().slice(0, 7)}-01`,
  endDate: '', currency: '', category: '' });
const money = (amount: string, code: string) => `${code} ${formatExpenseAmount(amount)}`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';

function ReceiptPreview({ file }: { file: File }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <Box component="img" ref={ref} alt="待核对票据原图" sx={{ maxHeight: 280, maxWidth: '100%', objectFit: 'contain', bgcolor: '#f3f5f3', borderRadius: 1 }} />;
}

export function ExpensePage() {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(0);
  const listing = useQuery({ queryKey: ['expenses', filters, page], queryFn: () => listExpenses(filters, page) });
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: getCurrencies });
  const accounts = useQuery({ queryKey: ['expense-accounts'], queryFn: getExpenseAccounts });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [source, setSource] = useState<Expense['source']>('manual');
  const requestKey = useRef(crypto.randomUUID());
  const [hasDraft, setHasDraft] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, status: '' });
  const [ocrText, setOcrText] = useState('');
  const [ocrWarnings, setOcrWarnings] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [formError, setFormError] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const cancelOcr = useRef<(() => void) | null>(null);
  const saveLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { generation.current += 1; cancelOcr.current?.(); }, []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['expenses'] });
  const save = useMutation({
    mutationFn: (allowDuplicate: boolean) => editing
      ? updateExpense(editing.id, draft)
      : createExpense({ ...draft, requestKey: requestKey.current, source, allowDuplicate }),
    onSuccess: async () => {
      setOpen(false); setHasDraft(false); setFile(null); setOcrText(''); setFormError('');
      setNotice(editing ? '开销已更新' : '开销已保存');
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.code === 'POSSIBLE_DUPLICATE') setDuplicate(true);
      setFormError(errorMessage(error));
    },
    onSettled: () => { saveLock.current = false; },
  });
  const remove = useMutation({
    mutationFn: deleteExpense,
    onSuccess: async () => { setDeleting(null); setPage(0); setNotice('开销已删除'); await invalidate(); },
  });

  const stopOcr = () => {
    generation.current += 1;
    cancelOcr.current?.(); cancelOcr.current = null;
    setOcrBusy(false);
  };
  const startNew = () => {
    stopOcr(); setEditing(null); setDraft(emptyDraft()); setSource('manual');
    requestKey.current = crypto.randomUUID(); setHasDraft(true); setFile(null); setOcrText('');
    setOcrWarnings([]); setReviewed(false); setFormError(''); setDuplicate(false); setOpen(true);
  };
  const edit = (item: Expense) => {
    stopOcr(); setEditing(item); setDraft({ expenseDate: item.expense_date, amount: item.amount,
      currencyCode: item.currency_code, category: item.category, merchant: item.merchant,
      accountId: item.account_id, note: item.note });
    setSource(item.source); setHasDraft(true); setFile(null); setOcrText('');
    setOcrWarnings([]); setFormError(''); setDuplicate(false); setReviewed(true); setOpen(true);
  };
  const changeDraft = (patch: Partial<ExpenseFields>) => {
    setDraft((value) => ({ ...value, ...patch })); setDuplicate(false); setFormError('');
    if (source === 'receipt_ocr') setReviewed(false);
  };
  const close = () => { if (!save.isPending) { stopOcr(); setOpen(false); } };
  const selectImage = async (selected: File) => {
    stopOcr();
    const version = generation.current;
    setFormError(''); setOcrBusy(true); setProgress({ percent: 0, status: '校验图片' });
    try {
      await validateReceiptImage(selected);
      if (version !== generation.current) return;
      setFile(selected);
      const task = recognizeReceipt(selected, (percent, status) => {
        if (version === generation.current) setProgress({ percent, status });
      });
      cancelOcr.current = task.cancel;
      const result = await task.result;
      if (version !== generation.current) return;
      const candidate = parseReceipt(result.text);
      setOcrText(result.text);
      setOcrWarnings([...candidate.warnings, `引擎文字置信度 ${Math.round(result.confidence)}%（不代表字段准确率）。`]);
      if (!result.text.trim()) throw new Error('未识别到文字，草稿保留，请换图或手工录入。');
      setDraft((value) => ({ ...value, amount: candidate.amount, currencyCode: candidate.currencyCode,
        expenseDate: candidate.expenseDate, merchant: candidate.merchant, category: 'uncategorized' }));
      setSource('receipt_ocr'); setReviewed(false); setDuplicate(false);
    } catch (error) {
      if (version === generation.current) setFormError(errorMessage(error));
    } finally {
      if (version === generation.current) { setOcrBusy(false); cancelOcr.current = null; }
    }
  };
  const submit = (allowDuplicate = false) => {
    if (saveLock.current || ocrBusy) return;
    if (!validAmount(draft.amount) || !validCalendarDate(draft.expenseDate) || !draft.currencyCode) {
      setFormError('请填写有效日期、币种和正数金额（最多 14 位整数、6 位小数）。'); return;
    }
    if (source === 'receipt_ocr' && !reviewed) { setFormError('请核对并勾选确认识别字段。'); return; }
    saveLock.current = true; setFormError(''); save.mutate(allowDuplicate);
  };
  const setFilter = (patch: Partial<Filters>) => { setFilters((value) => ({ ...value, ...patch })); setPage(0); };
  const actions = (item: Expense) => <Stack direction="row" spacing={0.5}>
    <Button size="small" aria-label={`编辑开销 ${item.merchant || item.expense_date}`} onClick={() => edit(item)}>编辑</Button>
    <Button size="small" color="error" aria-label={`删除开销 ${item.merchant || item.expense_date}`} onClick={() => { remove.reset(); setDeleting(item); }}>删除</Button>
  </Stack>;
  const availableCurrencies = currencies.data?.filter((item) => item.enabled || item.code === draft.currencyCode) ?? [];

  return <Stack spacing={2.5}>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
      <Box><Typography component="h1" variant="h5" sx={{ fontWeight: 700 }}>每日开销</Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 0.75 }}>记下每一天的消费，按币种看清去向。</Typography></Box>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
        {hasDraft && <Button onClick={() => setOpen(true)}>继续草稿</Button>}
        <Button variant="contained" startIcon={<AddOutlined />} onClick={startNew}>记一笔</Button>
      </Stack>
    </Stack>
    <Alert severity="info">这里只记录实际消费，不自动扣减账户余额。转账、信用卡还款和退款请勿重复记为消费；本轮暂不处理退款冲销。</Alert>
    {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
    <Card><CardContent><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
      <TextField label="开始日期" type="date" value={filters.startDate} onChange={(e) => setFilter({ startDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField label="结束日期" type="date" value={filters.endDate} onChange={(e) => setFilter({ endDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
      <TextField select label="筛选币种" value={filters.currency} onChange={(e) => setFilter({ currency: e.target.value })}>
        <MenuItem value="">所有币种</MenuItem>{currencies.data?.map((item) => <MenuItem key={item.code} value={item.code}>{item.code}</MenuItem>)}
      </TextField>
      <TextField select label="筛选分类" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
        <MenuItem value="">所有分类</MenuItem>{Object.entries(categories).map(([key, value]) => <MenuItem key={key} value={key}>{value}</MenuItem>)}
      </TextField>
    </Box><Button size="small" sx={{ mt: 1 }} onClick={() => { setFilters({ startDate: '', endDate: '', currency: '', category: '' }); setPage(0); }}>清空筛选</Button></CardContent></Card>
    {listing.isPending && <LinearProgress aria-label="加载开销中" />}
    {listing.isError && <Alert severity="error" action={<Button onClick={() => void listing.refetch()}>重试</Button>}>{errorMessage(listing.error)}</Alert>}
    {listing.data && <>
      <Box><Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700 }}>筛选范围合计 <Typography component="span" variant="body2" color="text.secondary">· {listing.data.total} 笔 · 各币种分别统计</Typography></Typography>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ mt: 1, flexWrap: 'wrap' }}>
          {listing.data.totals.map((item) => <Card key={item.currency} sx={{ minWidth: 175 }}><CardContent>
            <Typography variant="caption" color="text.secondary">{item.currency} 消费</Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{formatExpenseAmount(item.amount)}</Typography>
          </CardContent></Card>)}
        </Stack>
      </Box>
      {!listing.data.total ? <Card><CardContent sx={{ textAlign: 'center', py: 6 }}><ReceiptLongOutlined color="disabled" sx={{ fontSize: 40 }} />
        <Typography sx={{ my: 1 }}>这个范围还没有开销记录</Typography><Button onClick={startNew}>手工录入或选择票据图片</Button></CardContent></Card>
        : <Card>
          <TableContainer sx={{ display: { xs: 'none', sm: 'block' } }}><Table aria-label="开销记录">
            <TableHead><TableRow>{['日期 / 商户', '分类', '金额', '账户 / 来源', '操作'].map((label) => <TableCell key={label} align={label === '金额' ? 'right' : 'left'}>{label}</TableCell>)}</TableRow></TableHead>
            <TableBody>{listing.data.items.map((item) => <TableRow key={item.id}>
              <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{item.merchant || '未填写商户'}</Typography><Typography variant="caption" color="text.secondary">{item.expense_date}</Typography>{item.note && <Typography variant="body2" sx={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{item.note}</Typography>}</TableCell>
              <TableCell><Chip size="small" label={categories[item.category]} variant="outlined" /></TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(item.amount, item.currency_code)}</TableCell>
              <TableCell><Typography variant="body2">{accounts.data?.find((a) => a.id === item.account_id)?.name || '未关联账户'}</Typography><Typography variant="caption" color="text.secondary">{item.source === 'receipt_ocr' ? '图片 OCR · 已确认' : '手工录入'}</Typography></TableCell>
              <TableCell>{actions(item)}</TableCell>
            </TableRow>)}</TableBody>
          </Table></TableContainer>
          <Stack divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />} sx={{ display: { xs: 'flex', sm: 'none' } }}>
            {listing.data.items.map((item) => <Box key={item.id} sx={{ p: 2 }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{item.merchant || '未填写商户'}</Typography><Typography sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{money(item.amount, item.currency_code)}</Typography></Stack>
              <Typography variant="caption" color="text.secondary">{item.expense_date} · {categories[item.category]} · {item.source === 'receipt_ocr' ? '图片 OCR' : '手工'}</Typography>
              {item.note && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.note}</Typography>}{actions(item)}
            </Box>)}
          </Stack>
        </Card>}
      {listing.data.total > 50 && <Pagination count={Math.ceil(listing.data.total / 50)} page={page + 1} onChange={(_, value) => setPage(value - 1)} aria-label="开销分页" />}
      {listing.data.total > 0 && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
        <Accordion disableGutters><AccordionSummary><Typography component="h2" variant="subtitle2">按日汇总 ▾</Typography></AccordionSummary><AccordionDetails><Stack spacing={1}>{listing.data.by_day.map((row) => <Stack direction="row" sx={{ justifyContent: 'space-between' }} key={`${row.date}-${row.currency}`}><Typography variant="body2">{row.date}</Typography><Typography variant="body2">{money(row.amount, row.currency)}</Typography></Stack>)}</Stack></AccordionDetails></Accordion>
        <Accordion disableGutters><AccordionSummary><Typography component="h2" variant="subtitle2">按分类汇总 ▾</Typography></AccordionSummary><AccordionDetails><Stack spacing={1}>{listing.data.by_category.map((row) => <Stack direction="row" sx={{ justifyContent: 'space-between' }} key={`${row.category}-${row.currency}`}><Typography variant="body2">{categories[row.category]}</Typography><Typography variant="body2">{money(row.amount, row.currency)}</Typography></Stack>)}</Stack></AccordionDetails></Accordion>
      </Box>}
    </>}

    <Dialog open={open} onClose={close} fullScreen={mobile} fullWidth maxWidth="md" aria-labelledby="expense-dialog-title">
      <DialogTitle id="expense-dialog-title">{editing ? '编辑开销' : '记录开销'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {!editing && <Box>
            <Typography variant="subtitle2" gutterBottom>从票据图片填写</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>支持日文横排与英文。图片仅在浏览器处理，不上传、不长期保存；首次识别需从本站下载引擎和语言模型。每张票据只生成一笔合计候选。</Typography>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg" aria-label="选择票据图片" disabled={ocrBusy || save.isPending} onChange={(e) => { const selected = e.target.files?.[0]; e.target.value = ''; if (selected) void selectImage(selected); }} />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>PNG / JPEG · 最大 8 MB · 2000 万像素 · 不支持 PDF / HEIC</Typography>
          </Box>}
          {ocrBusy && <Box role="status" aria-live="polite"><Typography variant="body2">{progress.status === 'recognizing text' ? '识别文字' : '准备识别资源'} · {progress.percent}%</Typography><LinearProgress variant="determinate" value={progress.percent} sx={{ my: 1 }} /><Button onClick={() => { stopOcr(); setFormError('已取消识别，草稿保留。'); }}>取消识别</Button></Box>}
          {file && <ReceiptPreview file={file} />}
          {ocrWarnings.map((warning) => <Alert severity="warning" key={warning}>{warning}</Alert>)}
          {ocrText && <Accordion><AccordionSummary>查看识别原文 ▾</AccordionSummary><AccordionDetails><Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ocrText}</Typography></AccordionDetails></Accordion>}
          {formError && <Alert severity="error">{formError} 草稿已保留，可修正或原样重试。</Alert>}
          {(currencies.isError || accounts.isError) && <Alert severity="warning">币种或账户加载失败，请刷新后继续。</Alert>}
          <Box component="fieldset" disabled={ocrBusy || save.isPending} inert={ocrBusy || save.isPending} sx={{ border: 0, p: 0, m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField label="消费日期" type="date" required value={draft.expenseDate} onChange={(e) => changeDraft({ expenseDate: e.target.value })} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="金额" required value={draft.amount} onChange={(e) => changeDraft({ amount: e.target.value })} helperText="正数；最多 14 位整数、6 位小数" slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
            <TextField select label="币种" required value={draft.currencyCode} onChange={(e) => changeDraft({ currencyCode: e.target.value })}>
              <MenuItem value="">请选择币种</MenuItem>{availableCurrencies.map((item) => <MenuItem value={item.code} key={item.code}>{item.code} · {item.name}</MenuItem>)}
            </TextField>
            <TextField select label="消费分类" required value={draft.category} onChange={(e) => changeDraft({ category: e.target.value as Category })}>
              {Object.entries(categories).map(([key, value]) => <MenuItem value={key} key={key}>{value}</MenuItem>)}
            </TextField>
            <TextField label="商户（可选）" value={draft.merchant ?? ''} onChange={(e) => changeDraft({ merchant: e.target.value })} slotProps={{ htmlInput: { maxLength: 150 } }} />
            <TextField select label="支付账户（可选）" value={draft.accountId ?? ''} onChange={(e) => changeDraft({ accountId: e.target.value || null })} helperText="仅关联记录，不扣减余额">
              <MenuItem value="">不关联账户</MenuItem>{accounts.data?.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}{!item.is_active && '（停用）'}</MenuItem>)}
            </TextField>
            <TextField label="备注（可选）" multiline minRows={2} value={draft.note ?? ''} onChange={(e) => changeDraft({ note: e.target.value })} sx={{ gridColumn: '1 / -1' }} slotProps={{ htmlInput: { maxLength: 2000 } }} />
          </Box>
          {source === 'receipt_ocr' && <FormControlLabel control={<Checkbox checked={reviewed} disabled={ocrBusy || save.isPending} onChange={(e) => setReviewed(e.target.checked)} />} label="我已对照原图核对金额、币种、日期及分类，确认保存这一笔消费" />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={close} disabled={save.isPending}>返回（保留草稿）</Button>
        {duplicate && <Button color="warning" variant="contained" disabled={save.isPending || ocrBusy} onClick={() => submit(true)}>确认仍保存</Button>}
        {!duplicate && <Button variant="contained" disabled={save.isPending || ocrBusy || (source === 'receipt_ocr' && !reviewed)} onClick={() => submit()}>{save.isPending ? '保存中…' : editing ? '保存修改' : '确认保存'}</Button>}
      </DialogActions>
    </Dialog>
    <Dialog open={Boolean(deleting)} onClose={() => { if (!remove.isPending) setDeleting(null); }} aria-labelledby="delete-expense-title">
      <DialogTitle id="delete-expense-title">删除这笔开销？</DialogTitle><DialogContent>
        <Typography>{deleting && `${deleting.expense_date} · ${deleting.merchant || '未填写商户'} · ${money(deleting.amount, deleting.currency_code)}`}</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>删除后将从开销统计中移除，界面无法撤销。</Typography>
        {remove.isError && <Alert severity="error">{errorMessage(remove.error)}</Alert>}
      </DialogContent><DialogActions><Button disabled={remove.isPending} onClick={() => setDeleting(null)}>取消</Button><Button color="error" disabled={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>确认删除</Button></DialogActions>
    </Dialog>
  </Stack>;
}
