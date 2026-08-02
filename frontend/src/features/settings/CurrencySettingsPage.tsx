import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import CurrencyExchangeOutlined from '@mui/icons-material/CurrencyExchangeOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import { Alert, Box, Button, Chip, CircularProgress, Paper, Snackbar, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClientError } from '../../api/client';
import { getCurrencies, getFxSyncRuns, getLatestRates, syncFxRates, updateCurrencies } from './api';
import { toggleCurrency } from './currencyState';
import { OperationsSettings } from './OperationsSettings';

const currencyColors: Record<string, { bg: string; fg: string }> = {
  CNY: { bg: '#e7f4f0', fg: '#176c5a' },
  USD: { bg: '#e8f2f5', fg: '#397c93' },
  JPY: { bg: '#fae9e7', fg: '#a94f49' },
  HKD: { bg: '#fbf1de', fg: '#9b6a22' },
  EUR: { bg: '#ece9f5', fg: '#66558c' },
};

export function CurrencySettingsPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const currencies = useQuery({ queryKey: ['currencies'], queryFn: getCurrencies });
  const latestRates = useQuery({ queryKey: ['fx-rates', 'latest'], queryFn: getLatestRates });
  const syncRuns = useQuery({ queryKey: ['fx-rates', 'runs'], queryFn: getFxSyncRuns });
  const updateMutation = useMutation({
    mutationFn: updateCurrencies,
    onSuccess: (data) => {
      queryClient.setQueryData(['currencies'], data);
      setNotice('币种设置已保存');
    },
  });
  const syncMutation = useMutation({
    mutationFn: syncFxRates,
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fx-rates', 'latest'] }),
        queryClient.invalidateQueries({ queryKey: ['fx-rates', 'runs'] }),
      ]);
      setNotice(run.status === 'success' ? '汇率同步成功' : `汇率同步失败：${run.message ?? '未知错误'}`);
    },
  });
  const list = currencies.data ?? [];
  const enabledCount = list.filter((currency) => currency.enabled).length;
  const latestRun = syncRuns.data?.[0];
  const error = updateMutation.error ?? syncMutation.error;

  const handleToggle = (code: string) => {
    try {
      updateMutation.mutate(toggleCurrency(list, code, 5));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : '无法更新币种');
    }
  };

  if (currencies.isLoading) return <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="正在加载币种" /></Box>;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 980, mx: 'auto' }}>
      <Box><Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>币种与汇率</Typography><Typography sx={{ mt: 0.5, color: 'text.secondary', fontSize: 13 }}>配置资产使用的币种，并管理历史 CNY 折算汇率。</Typography></Box>
      {error && <Alert severity="error">{error instanceof ApiClientError ? error.message : '操作失败'}</Alert>}
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2.5 }}>
        <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
          <Box><Typography sx={{ fontWeight: 700 }}>币种设置</Typography><Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5 }}>基础币种固定为 CNY，最多启用 5 个币种。</Typography></Box>
          <Chip size="small" label={`已启用 ${enabledCount} / 5`} />
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.25 }}>
          {list.map((currency) => {
            const colors = currencyColors[currency.code] ?? { bg: '#f0f3f2', fg: '#40514d' };
            return (
              <Paper key={currency.code} variant="outlined" sx={{ p: 1.5, display: 'grid', gridTemplateColumns: '38px 1fr auto', gap: 1.25, alignItems: 'center', bgcolor: currency.is_base ? 'background.default' : 'white' }}>
                <Box sx={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: '50%', bgcolor: colors.bg, color: colors.fg, fontWeight: 750, fontSize: 12 }}>{currency.symbol ?? currency.code}</Box>
                <Box><Typography sx={{ fontSize: 13, fontWeight: 700 }}>{currency.code}</Typography><Typography sx={{ color: 'text.secondary', fontSize: 11 }}>{currency.name}{currency.is_base ? ' · 基础币种' : ''}</Typography></Box>
                <Switch checked={currency.enabled} disabled={currency.is_base || updateMutation.isPending} onChange={() => handleToggle(currency.code)} slotProps={{ input: { 'aria-label': `启用 ${currency.code}` } }} />
              </Paper>
            );
          })}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2.5 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', p: 2.5 }}>
          <Box><Typography sx={{ fontWeight: 700 }}>最新汇率</Typography><Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5 }}>1 单位外币可兑换的 CNY 金额；缺失日期会使用之前最近记录。</Typography></Box>
          <Button variant="outlined" startIcon={syncMutation.isPending ? <CircularProgress aria-label="正在同步汇率" size={16} /> : <RefreshOutlined />} disabled={syncMutation.isPending} onClick={() => syncMutation.mutate()}>立即同步</Button>
        </Stack>
        {latestRates.data?.length ? (
          <Table size="small">
            <TableHead><TableRow><TableCell>币种</TableCell><TableCell align="right">最新汇率</TableCell><TableCell>数据日期</TableCell><TableCell>来源</TableCell><TableCell>状态</TableCell></TableRow></TableHead>
            <TableBody>{latestRates.data.map((rate) => <TableRow key={rate.id}><TableCell sx={{ fontWeight: 700 }}>{rate.quote_currency} / CNY</TableCell><TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{Number(rate.rate_to_base).toFixed(6)}</TableCell><TableCell>{rate.rate_date}</TableCell><TableCell>{rate.source}</TableCell><TableCell><Chip size="small" color="success" label="最新" /></TableCell></TableRow>)}</TableBody>
          </Table>
        ) : (
          <Stack sx={{ alignItems: 'center', py: 6, borderTop: '1px solid', borderColor: 'divider' }}><CurrencyExchangeOutlined color="disabled" /><Typography sx={{ mt: 1, color: 'text.secondary', fontSize: 13 }}>尚无汇率记录，请执行首次同步</Typography></Stack>
        )}
        {latestRun && <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', m: 2, p: 1.5, borderRadius: 1.5, bgcolor: latestRun.status === 'success' ? 'primary.light' : 'error.light' }}><CheckCircleOutlined color={latestRun.status === 'success' ? 'success' : 'error'} fontSize="small" /><Box sx={{ flex: 1 }}><Typography sx={{ fontSize: 12, fontWeight: 650 }}>最近同步{latestRun.status === 'success' ? '成功' : '失败'}</Typography><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{new Date(latestRun.started_at).toLocaleString('zh-CN')} · {latestRun.message}</Typography></Box></Stack>}
      </Paper>
      <OperationsSettings />
      <Snackbar open={Boolean(notice)} autoHideDuration={3500} onClose={() => setNotice(undefined)} message={notice} />
    </Stack>
  );
}
