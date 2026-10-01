import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { Alert, Box, Chip, Paper, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EChartsCoreOption } from 'echarts/core';
import { useMemo, useState } from 'react';
import { getDashboardCharts, getDashboardSummary, type ChartPoint, type TrendRange } from './api';
import { EChart } from './EChart';
import { localMonth, monthEndDate } from './month';

const cny = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 });
const labels: Record<string, string> = { bank_deposit: '银行存款', cash: '现金', securities: '证券', receivable: '债权', t0: '随时可用', within_7d: '7 天内', within_30d: '30 天内', within_90d: '90 天内', locked_or_unknown: '锁定或未知', low: '低风险', medium: '中风险', high: '高风险' };
const displayName = (name: string) => labels[name] ?? name;

function KpiCard({ title, value, detail, color = '#1f2d29' }: { title: string; value: string; detail?: string; color?: string }) {
  return <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5 }}><Typography color="text.secondary" sx={{ fontSize: 12 }}>{title}</Typography><Typography sx={{ fontSize: 25, fontWeight: 780, color, mt: 0.75 }}>{value}</Typography>{detail && <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.5 }}>{detail}</Typography>}</Paper>;
}

function pieOption(title: string, points: ChartPoint[]): EChartsCoreOption {
  return { title: { text: title, left: 16, top: 12, textStyle: { fontSize: 14 } }, tooltip: { trigger: 'item', valueFormatter: (value: unknown) => cny.format(Number(value)) }, legend: { bottom: 8 }, series: [{ type: 'pie', radius: ['42%', '68%'], center: ['50%', '48%'], data: points.map((item) => ({ name: displayName(item.name), value: Number(item.value) })), label: { show: false }, emphasis: { label: { show: true, fontWeight: 'bold' } } }] } as EChartsCoreOption;
}

export function DashboardPage() {
  const [snapshotMonth, setSnapshotMonth] = useState(localMonth);
  const [trendRange, setTrendRange] = useState<TrendRange>('12m');
  const snapshotDate = useMemo(() => monthEndDate(snapshotMonth), [snapshotMonth]);
  const summaryQuery = useQuery({ queryKey: ['dashboard-summary', snapshotDate], queryFn: () => getDashboardSummary(snapshotDate), placeholderData: keepPreviousData });
  const chartsQuery = useQuery({ queryKey: ['dashboard-charts', snapshotDate, trendRange], queryFn: () => getDashboardCharts(snapshotDate, trendRange), placeholderData: keepPreviousData });
  const summary = summaryQuery.data;
  const charts = chartsQuery.data;
  const options = useMemo((): { trend: EChartsCoreOption; top: EChartsCoreOption; changes: EChartsCoreOption } | null => charts ? ({
    trend: { tooltip: { trigger: 'axis' }, xAxis: { type: 'category', data: charts.trend.map((item) => item.date) }, yAxis: { type: 'value', axisLabel: { formatter: (value: number) => `${Math.round(value / 10_000)}万` } }, grid: { left: 65, right: 25, top: 25, bottom: 35 }, series: [{ type: 'line', smooth: true, areaStyle: { opacity: 0.12 }, data: charts.trend.map((item) => Number(item.value)), itemStyle: { color: '#278a73' } }] } as EChartsCoreOption,
    top: { title: { text: 'Top 5 机构', left: 16, top: 12, textStyle: { fontSize: 14 } }, tooltip: { trigger: 'axis' }, grid: { left: 95, right: 25, top: 55, bottom: 25 }, xAxis: { type: 'value' }, yAxis: { type: 'category', data: [...charts.top_institutions].reverse().map((item) => item.name) }, series: [{ type: 'bar', data: [...charts.top_institutions].reverse().map((item) => Number(item.value)), itemStyle: { color: '#4f8f81', borderRadius: [0, 4, 4, 0] } }] } as EChartsCoreOption,
    changes: { title: { text: '项目金额变化', left: 16, top: 12, textStyle: { fontSize: 14 } }, tooltip: { trigger: 'axis' }, grid: { left: 16, right: 25, top: 55, bottom: 25, containLabel: true }, xAxis: { type: 'value' }, yAxis: { type: 'category', data: [...charts.project_changes].reverse().map((item) => `${item.institution_name}-${item.project_name}`), axisLabel: { width: 160, overflow: 'truncate', ellipsis: '…' } }, series: [{ type: 'bar', data: [...charts.project_changes].reverse().map((item) => ({ value: Number(item.value), itemStyle: { color: Number(item.value) >= 0 ? '#2f8f78' : '#c76358' } })) }] } as EChartsCoreOption,
  }) : null, [charts]);

  return <Box>
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 3 }}><Box><Typography component="h1" variant="h4" sx={{ fontWeight: 780 }}>首页看板</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>按月查看资产、负债与净资产。</Typography></Box><TextField label="统计月份" type="month" size="small" value={snapshotMonth} onChange={(event) => event.target.value && setSnapshotMonth(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Stack>
    {(summaryQuery.isLoading || chartsQuery.isLoading) && <Skeleton variant="rounded" height={140} sx={{ mb: 2 }} />}
    {(summaryQuery.error || chartsQuery.error) && <Alert severity="error" sx={{ mb: 2 }}>看板加载失败，请检查该月份的快照与汇率。</Alert>}
    {summary && <><Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(5, 1fr)' }, gap: 1.5 }}><KpiCard title="当月总资产" value={cny.format(Number(summary.total_assets_cny))} detail="当月正资产 + 月末债权" /><KpiCard title="当月总负债" value={cny.format(Number(summary.total_liabilities_cny))} detail="月末债务未偿本金" color="#b24a42" /><KpiCard title="当月净资产" value={cny.format(Number(summary.net_worth_cny))} detail="总资产 − 总负债" color="#1d7b67" /><KpiCard title="较上月金额变化" value={summary.net_worth_change_from_previous_month_cny == null ? '暂无对比' : cny.format(Number(summary.net_worth_change_from_previous_month_cny))} detail="比较两个自然月" /><KpiCard title="外币正资产占比" value={`${(Number(summary.foreign_asset_ratio) * 100).toFixed(1)}%`} detail="仅统计当月正资产" /></Box>{summary.fx_warnings.length > 0 && <Alert severity="warning" icon={<WarningAmberOutlined />} sx={{ mt: 2 }}>部分数据使用历史汇率：{summary.fx_warnings.join('；')}</Alert>}</>}
    {charts && options && <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, 1fr)' }, gap: 2, mt: 2 }}><Paper variant="outlined" sx={{ gridColumn: { xl: '1 / -1' }, borderRadius: 2.5 }}><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ px: 2, pt: 1.5, justifyContent: 'space-between', alignItems: { sm: 'center' } }}><Typography sx={{ fontWeight: 700 }}>净资产月度趋势</Typography><ToggleButtonGroup exclusive size="small" value={trendRange} onChange={(_event, value: TrendRange | null) => value && setTrendRange(value)} aria-label="趋势时间范围"><ToggleButton value="12m">最近 12 个月</ToggleButton><ToggleButton value="24m">最近 24 个月</ToggleButton><ToggleButton value="all">全部</ToggleButton></ToggleButtonGroup></Stack><EChart option={options.trend} label="净资产月度趋势图" height={290} /></Paper>{[['资产组成比例', charts.asset_composition], ['流动性分布', charts.liquidity_distribution], ['风险分布', charts.risk_distribution], ['币种占比', charts.currency_distribution]].map(([title, points]) => <Paper key={title as string} variant="outlined" sx={{ borderRadius: 2.5 }}><EChart option={pieOption(title as string, points as ChartPoint[])} label={`${title as string}图表`} /></Paper>)}<Paper variant="outlined" sx={{ borderRadius: 2.5 }}><EChart option={options.top} label="资产最多的五个机构图表" /></Paper><Paper variant="outlined" sx={{ borderRadius: 2.5 }}><EChart option={options.changes} label="项目金额变化图表" /></Paper></Box>}
    {summary && Number(summary.total_assets_cny) === 0 && <Paper variant="outlined" sx={{ mt: 2, p: 5, textAlign: 'center' }}><AccountBalanceWalletOutlined color="disabled" sx={{ fontSize: 42 }} /><Typography sx={{ fontWeight: 700, mt: 1 }}>该月份暂无正资产</Typography><Typography color="text.secondary">请先在对应月份录入项目余额。</Typography></Paper>}
    <Stack direction="row" spacing={1} sx={{ mt: 2, color: 'text.secondary' }}><PublicOutlined fontSize="small" /><Typography sx={{ fontSize: 12 }}>币种占比只统计正资产；Top 5 机构不受债务影响。</Typography><Chip size="small" icon={<TrendingUpOutlined />} label="金额变化" /></Stack>
  </Box>;
}
