import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, List, ListItemButton, MenuItem, Paper, Snackbar, Stack,
  Switch, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClientError } from '../../api/client';
import { getCurrencies } from '../settings/api';
import { createDebt, createDebtEvent, getDebtEvents, getDebts } from './api';

const eventLabels: Record<string, string> = { issue: '新增本金', repayment: '还款', adjustment: '调整', settle: '结清' };
const statusLabels: Record<string, string> = { active: '进行中', partially_settled: '部分偿还', settled: '已结清', overdue: '逾期', written_off: '核销' };
const formatMoney = (value: string) => new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));

export function DebtPage() {
  const queryClient = useQueryClient();
  const [debtType, setDebtType] = useState<'receivable' | 'payable'>('receivable');
  const [selectedId, setSelectedId] = useState('');
  const [debtDialog, setDebtDialog] = useState(false);
  const [eventDialog, setEventDialog] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [debtForm, setDebtForm] = useState({ counterparty: '', currency: 'CNY', notes: '' });
  const [eventForm, setEventForm] = useState({ type: 'issue', date: new Date().toISOString().slice(0, 10), amount: '', counterparty: '', note: '', confirmNegative: false });

  const debtsQuery = useQuery({ queryKey: ['debts', debtType], queryFn: () => getDebts(debtType) });
  const debts = debtsQuery.data ?? [];
  const activeId = debts.some((item) => item.id === selectedId) ? selectedId : (debts[0]?.id ?? '');
  const selected = debts.find((item) => item.id === activeId);
  const eventsQuery = useQuery({ queryKey: ['debt-events', activeId], queryFn: () => getDebtEvents(activeId), enabled: Boolean(activeId) });
  const currenciesQuery = useQuery({ queryKey: ['currencies'], queryFn: getCurrencies });
  const currencies = (currenciesQuery.data ?? []).filter((item) => item.enabled);

  const refresh = async () => Promise.all([queryClient.invalidateQueries({ queryKey: ['debts'] }), queryClient.invalidateQueries({ queryKey: ['debt-events'] })]);
  const debtMutation = useMutation({
    mutationFn: () => createDebt({ debtType, counterparty: debtForm.counterparty, currencyCode: debtForm.currency, notes: debtForm.notes }),
    onSuccess: async (item) => { await refresh(); setSelectedId(item.id); setDebtDialog(false); setNotice('债权债务项目已创建'); },
  });
  const eventMutation = useMutation({
    mutationFn: () => createDebtEvent(activeId, { eventType: eventForm.type, eventDate: eventForm.date, amount: eventForm.amount || '0', counterparty: eventForm.counterparty || selected?.counterparty || '', note: eventForm.note, confirmNegative: eventForm.confirmNegative }),
    onSuccess: async () => { await refresh(); setEventDialog(false); setNotice('事件已保存，未偿本金已刷新'); },
  });
  const openEvent = () => { setEventForm({ type: 'issue', date: new Date().toISOString().slice(0, 10), amount: '', counterparty: selected?.counterparty ?? '', note: '', confirmNegative: false }); setEventDialog(true); };
  const error = debtsQuery.error ?? eventsQuery.error ?? debtMutation.error ?? eventMutation.error;
  const errorMessage = error instanceof ApiClientError || error instanceof Error ? error.message : null;

  return <Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 3 }}><Box><Typography variant="h4" sx={{ fontWeight: 780 }}>债权债务</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>通过事件时间线计算任意日期的未偿本金。</Typography></Box><Button variant="contained" startIcon={<AddOutlined />} onClick={() => setDebtDialog(true)}>新增{debtType === 'receivable' ? '债权' : '债务'}</Button></Stack>
    <ToggleButtonGroup exclusive value={debtType} onChange={(_, value) => { if (value) { setDebtType(value); setSelectedId(''); } }} sx={{ mb: 2 }}><ToggleButton value="receivable"><ArrowUpwardOutlined sx={{ mr: 1 }} />债权</ToggleButton><ToggleButton value="payable"><ArrowDownwardOutlined sx={{ mr: 1 }} />债务</ToggleButton></ToggleButtonGroup>
    {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '0.9fr 1.4fr' }, gap: 2 }}>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}><Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}><Typography sx={{ fontWeight: 750 }}>{debtType === 'receivable' ? '应收列表' : '应付列表'}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>{debts.length} 个项目</Typography></Box><List disablePadding>{debts.map((item) => <ListItemButton key={item.id} selected={item.id === activeId} onClick={() => setSelectedId(item.id)} sx={{ py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}><Box sx={{ flex: 1 }}><Stack direction="row" spacing={1}><Typography sx={{ fontWeight: 700, fontSize: 13 }}>{item.counterparty}</Typography><Chip size="small" label={statusLabels[item.status] ?? item.status} color={item.status === 'settled' ? 'default' : 'primary'} /></Stack><Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.5 }}>{item.currency_code} · 最近事件 {item.last_event_date ?? '暂无'}</Typography></Box><Box sx={{ textAlign: 'right' }}><Typography sx={{ fontWeight: 760 }}>{item.currency_code} {formatMoney(item.balance)}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>CNY {formatMoney(item.converted_amount_cny)}{item.fx_is_stale ? ' · stale' : ''}</Typography></Box></ListItemButton>)}</List></Paper>
      <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden' }}><Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: '1px solid', borderColor: 'divider' }}><Box><Typography sx={{ fontWeight: 750 }}>{selected?.counterparty ?? '事件时间线'}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>{selected ? `当前未偿本金 ${selected.currency_code} ${formatMoney(selected.balance)}` : '请选择项目'}</Typography></Box><Button startIcon={<EventNoteOutlined />} onClick={openEvent} disabled={!activeId}>添加事件</Button></Stack><Stack spacing={0} sx={{ p: 2 }}>{(eventsQuery.data ?? []).map((item) => <Box key={item.id} sx={{ display: 'grid', gridTemplateColumns: '18px 100px 1fr auto', gap: 1.5, py: 1.5, borderBottom: '1px dashed', borderColor: 'divider' }}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.event_type === 'repayment' || item.event_type === 'settle' ? 'warning.main' : 'primary.main', mt: 0.75 }} /><Typography color="text.secondary" sx={{ fontSize: 12 }}>{item.event_date}</Typography><Box><Typography sx={{ fontWeight: 700, fontSize: 13 }}>{eventLabels[item.event_type] ?? item.event_type}</Typography><Typography color="text.secondary" sx={{ fontSize: 11 }}>{item.note || item.counterparty}</Typography></Box><Typography sx={{ fontWeight: 700 }}>{item.event_type === 'repayment' || item.event_type === 'settle' ? '−' : item.event_type === 'adjustment' && Number(item.amount) < 0 ? '' : '+'}{formatMoney(item.amount)}</Typography></Box>)}</Stack></Paper>
    </Box>

    <Dialog open={debtDialog} onClose={() => setDebtDialog(false)} fullWidth maxWidth="sm"><DialogTitle>新增{debtType === 'receivable' ? '债权' : '债务'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField label="交易对手" value={debtForm.counterparty} onChange={(event) => setDebtForm({ ...debtForm, counterparty: event.target.value })} autoFocus required /><TextField select label="币种" value={debtForm.currency} onChange={(event) => setDebtForm({ ...debtForm, currency: event.target.value })}>{currencies.map((item) => <MenuItem key={item.code} value={item.code}>{item.code} · {item.name}</MenuItem>)}</TextField><TextField label="备注" multiline minRows={2} value={debtForm.notes} onChange={(event) => setDebtForm({ ...debtForm, notes: event.target.value })} /></Stack></DialogContent><DialogActions><Button onClick={() => setDebtDialog(false)}>取消</Button><Button variant="contained" disabled={!debtForm.counterparty.trim()} onClick={() => debtMutation.mutate()}>创建</Button></DialogActions></Dialog>
    <Dialog open={eventDialog} onClose={() => setEventDialog(false)} fullWidth maxWidth="sm"><DialogTitle>添加事件</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}><TextField select label="事件类型" value={eventForm.type} onChange={(event) => setEventForm({ ...eventForm, type: event.target.value })}>{Object.entries(eventLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField label="发生日期" type="date" value={eventForm.date} onChange={(event) => setEventForm({ ...eventForm, date: event.target.value })} slotProps={{ inputLabel: { shrink: true } }} /><TextField label={eventForm.type === 'settle' ? '结清金额由系统计算' : '金额'} type="number" value={eventForm.amount} onChange={(event) => setEventForm({ ...eventForm, amount: event.target.value })} disabled={eventForm.type === 'settle'} /><TextField label="交易对手" value={eventForm.counterparty} onChange={(event) => setEventForm({ ...eventForm, counterparty: event.target.value })} /><TextField label="备注" value={eventForm.note} onChange={(event) => setEventForm({ ...eventForm, note: event.target.value })} />{eventForm.type === 'adjustment' && <FormControlLabel control={<Switch checked={eventForm.confirmNegative} onChange={(event) => setEventForm({ ...eventForm, confirmNegative: event.target.checked })} />} label="若调整导致负余额，我已确认" />}</Stack></DialogContent><DialogActions><Button onClick={() => setEventDialog(false)}>取消</Button><Button variant="contained" onClick={() => eventMutation.mutate()} disabled={eventForm.type !== 'settle' && !eventForm.amount}>保存事件</Button></DialogActions></Dialog>
    <Snackbar open={Boolean(notice)} autoHideDuration={3000} onClose={() => setNotice(null)} message={notice} />
  </Box>;
}
