import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import {
  Alert, Box, Button, ButtonGroup, Chip, Paper, Skeleton, Stack, TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EChartsCoreOption } from 'echarts/core';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiClientError } from '../../api/client';
import { EChart } from '../dashboard/EChart';
import { getSnapshotHistory, type HistoryLevel, type SnapshotHistoryRow } from './api';
import { buildHistoryCsv } from './export';

const cny = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
const levelLabels: Record<HistoryLevel, string> = {
  institution: '机构',
  account: '账户',
  project: '项目',
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgo(months: number) {
  const value = new Date();
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

function KpiCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}>
      <Typography color="text.secondary" sx={{ fontSize: 12 }}>{title}</Typography>
      <Typography sx={{ mt: 0.75, fontSize: 24, fontWeight: 780 }}>{value}</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: 11 }}>{detail}</Typography>
    </Paper>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawLevel = searchParams.get('level');
  const entityId = searchParams.get('entityId') ?? '';
  const level = (['institution', 'account', 'project'].includes(rawLevel ?? '')
    ? rawLevel
    : null) as HistoryLevel | null;
  const [dateFrom, setDateFrom] = useState(() => monthsAgo(12));
  const [dateTo, setDateTo] = useState(today);
  const historyQuery = useQuery({
    queryKey: ['snapshot-history', level, entityId, dateFrom, dateTo],
    queryFn: () => getSnapshotHistory(level as HistoryLevel, entityId, dateFrom, dateTo),
    enabled: Boolean(level && entityId),
    placeholderData: keepPreviousData,
  });
  const history = historyQuery.data;

  const trendOption = useMemo((): EChartsCoreOption | null => history ? ({
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) => cny.format(Number(value)),
    },
    grid: { left: 72, right: 24, top: 30, bottom: 40 },
    xAxis: { type: 'category', data: history.trend.map((item) => item.snapshot_date) },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => `${Math.round(value / 10_000)}万` },
    },
    series: [{
      type: 'line',
      smooth: true,
      areaStyle: { opacity: 0.12 },
      data: history.trend.map((item) => Number(item.amount_cny)),
      itemStyle: { color: '#278a73' },
    }],
  }) as EChartsCoreOption : null, [history]);

  const compositionOption = useMemo((): EChartsCoreOption | null => history?.composition.length ? ({
    tooltip: {
      trigger: 'item',
      valueFormatter: (value: unknown) => cny.format(Number(value)),
    },
    legend: { bottom: 4 },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '45%'],
      data: history.composition.map((item) => ({ name: item.name, value: Number(item.amount_cny) })),
      label: { show: false },
    }],
  }) as EChartsCoreOption : null, [history]);

  const columns = useMemo<GridColDef<SnapshotHistoryRow>[]>(() => [
    { field: 'snapshot_date', headerName: '快照日期', width: 112 },
    { field: 'institution_name', headerName: '机构', width: 130, valueFormatter: (value) => value ?? '待关联' },
    { field: 'account_name', headerName: '账户', width: 140 },
    { field: 'project_name', headerName: '项目', width: 150 },
    { field: 'original_amount', headerName: '原币金额', width: 130, align: 'right', headerAlign: 'right', valueFormatter: (value) => number.format(Number(value)) },
    { field: 'currency_code', headerName: '币种', width: 75 },
    { field: 'fx_rate_to_cny', headerName: '使用汇率', width: 110, valueFormatter: (value) => Number(value).toFixed(6) },
    { field: 'converted_amount_cny', headerName: 'CNY 折算', width: 140, align: 'right', headerAlign: 'right', valueFormatter: (value) => cny.format(Number(value)) },
    { field: 'change_amount_cny', headerName: '较上期变化', width: 135, align: 'right', headerAlign: 'right', valueFormatter: (value) => value == null ? '—' : cny.format(Number(value)) },
    { field: 'change_percent', headerName: '变化比例', width: 105, valueFormatter: (value) => value == null ? '—' : `${(Number(value) * 100).toFixed(1)}%` },
    { field: 'fx_is_stale', headerName: '汇率状态', width: 105, renderCell: ({ value }) => <Chip size="small" color={value ? 'warning' : 'success'} label={value ? '历史' : '当日'} /> },
    { field: 'change_note', headerName: '备注', minWidth: 180, flex: 1, valueFormatter: (value) => value || '—' },
  ], []);

  const setQuickRange = (months: number | null) => {
    setDateFrom(months === null ? '' : monthsAgo(months));
    setDateTo(months === null ? '' : today());
  };
  const exportCsv = () => {
    if (!history?.rows.length) return;
    const blob = new Blob([buildHistoryCsv(history.rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${history.entity_name.replaceAll(/[\\/:*?"<>|]/g, '-')}-历史快照.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  if (!level || !entityId) {
    return (
      <Box>
        <Button startIcon={<ArrowBackOutlined />} onClick={() => navigate('/institutions')}>返回机构与账户</Button>
        <Alert severity="warning" sx={{ mt: 2 }}>缺少有效的机构、账户或项目参数，请从“机构与账户”页面进入历史快照。</Alert>
      </Box>
    );
  }

  const error = historyQuery.error;
  const errorMessage = error instanceof ApiClientError || error instanceof Error ? error.message : null;
  const latestChangeDetail = history?.latest_change_percent == null
    ? '暂无上一期记录'
    : `较上一期 ${(Number(history.latest_change_percent) * 100).toFixed(1)}%`;

  return (
    <Box>
      <Button startIcon={<ArrowBackOutlined />} onClick={() => navigate('/institutions')} sx={{ mb: 2 }}>返回机构与账户</Button>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { lg: 'flex-start' }, mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4">{history?.entity_name ?? '历史快照'}</Typography>
            <Chip size="small" label={`${levelLabels[level]}历史`} color="primary" variant="outlined" />
          </Stack>
          <Typography color="text.secondary" sx={{ mt: 0.75 }}>按当前关联关系实时汇总；调整账户关联后，全部历史会同步转移。</Typography>
        </Box>
        <Button variant="outlined" startIcon={<DownloadOutlined />} onClick={exportCsv} disabled={!history?.rows.length}>导出 CSV</Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} sx={{ alignItems: { md: 'center' } }}>
          <ButtonGroup size="small" aria-label="历史时间范围">
            <Button onClick={() => setQuickRange(12)}>近 12 个月</Button>
            <Button onClick={() => setQuickRange(24)}>近 24 个月</Button>
            <Button onClick={() => setQuickRange(null)}>全部</Button>
          </ButtonGroup>
          <TextField label="开始日期" type="date" size="small" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="结束日期" type="date" size="small" value={dateTo} onChange={(event) => setDateTo(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          {history && <Chip size="small" label={`${history.snapshot_count} 个快照日期 · ${history.record_count} 条明细`} />}
        </Stack>
      </Paper>

      {historyQuery.isLoading && <Skeleton variant="rounded" height={160} sx={{ mb: 2 }} />}
      {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
      {history && <>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' }, gap: 1.5 }}>
          <KpiCard title="最新金额" value={history.latest_amount_cny == null ? '—' : cny.format(Number(history.latest_amount_cny))} detail={history.latest_snapshot_date ?? '暂无快照'} />
          <KpiCard title="较上一期变化" value={history.latest_change_amount_cny == null ? '—' : cny.format(Number(history.latest_change_amount_cny))} detail={latestChangeDetail} />
          <KpiCard title="历史最高" value={history.max_amount_cny == null ? '—' : cny.format(Number(history.max_amount_cny))} detail="当前筛选范围" />
          <KpiCard title="历史最低" value={history.min_amount_cny == null ? '—' : cny.format(Number(history.min_amount_cny))} detail="当前筛选范围" />
        </Box>

        {history.rows.length > 0 && trendOption && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: history.composition.length ? '1.6fr 1fr' : '1fr' }, gap: 2, mt: 2 }}>
          <Paper variant="outlined" sx={{ p: 1, borderRadius: 2.5 }}><Typography sx={{ px: 1.5, pt: 1, fontWeight: 700 }}>金额趋势</Typography><EChart option={trendOption} label={`${history.entity_name}历史金额趋势图`} height={300} /></Paper>
          {compositionOption && <Paper variant="outlined" sx={{ p: 1, borderRadius: 2.5 }}><Typography sx={{ px: 1.5, pt: 1, fontWeight: 700 }}>最新一期构成</Typography><EChart option={compositionOption} label={`${history.entity_name}最新一期构成图`} height={300} /></Paper>}
        </Box>}

        {history.rows.length === 0
          ? <Paper variant="outlined" sx={{ mt: 2, p: 6, textAlign: 'center', borderRadius: 2.5 }}><HistoryOutlined color="disabled" sx={{ fontSize: 44 }} /><Typography sx={{ mt: 1, fontWeight: 700 }}>当前范围内没有历史快照</Typography><Typography color="text.secondary">可调整时间范围，或先在月度快照中录入数据。</Typography></Paper>
          : <Paper variant="outlined" sx={{ mt: 2, height: 560, borderRadius: 2.5, overflow: 'hidden' }}><DataGrid aria-label={`${history.entity_name}历史快照明细`} rows={history.rows} columns={columns} getRowId={(row) => row.id} disableRowSelectionOnClick showToolbar initialState={{ pagination: { paginationModel: { page: 0, pageSize: 25 } }, columns: { columnVisibilityModel: { institution_name: level === 'institution', account_name: level !== 'project', project_name: level !== 'project' } } }} pageSizeOptions={[25, 50, 100]} /></Paper>}
      </>}
    </Box>
  );
}
