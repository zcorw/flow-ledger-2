import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import { Alert, Box, Button, Chip, Paper, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { DataGrid, GridEditInputCell, type GridCellParams, type GridColDef, type GridRenderEditCellParams, type GridRowModel } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ApiClientError } from '../../api/client';
import { copyPreviousSnapshot, getSnapshotSheet, saveSnapshotSheet, type SnapshotRow } from './api';
import { selectAllInputText, shouldStartAmountEdit } from './snapshotEditing';

type GridSnapshotRow = SnapshotRow & { grid_id: string };
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function SelectAllAmountEditCell(params: GridRenderEditCellParams<GridSnapshotRow>) {
  return (
    <GridEditInputCell
      {...params}
      slotProps={{ root: { onFocus: (event) => selectAllInputText(event.target) } }}
    />
  );
}

export function SnapshotPage() {
  const queryClient = useQueryClient();
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<{ date: string; rows: GridSnapshotRow[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sheetQuery = useQuery({ queryKey: ['snapshots', snapshotDate], queryFn: () => getSnapshotSheet(snapshotDate), placeholderData: keepPreviousData });
  const serverRows = useMemo(
    () => (sheetQuery.data?.rows ?? []).map((row) => ({ ...row, grid_id: row.project_id })),
    [sheetQuery.data?.rows],
  );
  const rows = draft?.date === snapshotDate ? draft.rows : serverRows;

  const copyMutation = useMutation({
    mutationFn: () => copyPreviousSnapshot(snapshotDate),
    onSuccess: (sheet) => { setDraft({ date: snapshotDate, rows: sheet.rows.map((row) => ({ ...row, grid_id: row.project_id })) }); setNotice(`已复制 ${sheet.source_date} 的项目清单`); },
  });
  const saveMutation = useMutation({
    mutationFn: () => saveSnapshotSheet(snapshotDate, rows.filter((row) => row.original_amount !== null && String(row.original_amount).trim() !== '').map((row) => ({ projectId: row.project_id, originalAmount: String(row.original_amount), liquidityLevel: row.liquidity_level, riskLevel: row.risk_level, changeNote: row.change_note ?? '' }))),
    onSuccess: async (sheet) => { setDraft({ date: snapshotDate, rows: sheet.rows.map((row) => ({ ...row, grid_id: row.project_id })) }); await queryClient.invalidateQueries({ queryKey: ['snapshots'] }); setNotice('月度快照已保存'); },
  });
  const processRowUpdate = (updated: GridRowModel) => {
    const row = updated as GridSnapshotRow;
    setDraft({ date: snapshotDate, rows: rows.map((item) => item.grid_id === row.grid_id ? row : item) });
    return row;
  };

  const columns = useMemo<GridColDef<GridSnapshotRow>[]>(() => [
    { field: 'institution_name', headerName: '机构', width: 120 },
    { field: 'account_name', headerName: '账户', width: 130 },
    { field: 'project_name', headerName: '项目', width: 150 },
    { field: 'asset_type', headerName: '资产类型', width: 120 },
    { field: 'currency_code', headerName: '币种', width: 76 },
    { field: 'original_amount', headerName: '原币金额', type: 'number', width: 135, editable: true, align: 'right', headerAlign: 'right', renderEditCell: (params) => <SelectAllAmountEditCell {...params} /> },
    { field: 'converted_amount_cny', headerName: 'CNY 折算', width: 135, align: 'right', headerAlign: 'right', valueFormatter: (value) => value == null ? '保存后计算' : money.format(Number(value)) },
    { field: 'fx_rate_to_cny', headerName: '使用汇率', width: 110, valueFormatter: (value) => value == null ? '—' : Number(value).toFixed(6) },
    { field: 'fx_is_stale', headerName: '汇率状态', width: 100, renderCell: ({ row }) => row.fx_rate_to_cny == null ? '待计算' : row.fx_is_stale ? <Chip size="small" color="warning" label="stale" /> : <Chip size="small" color="success" label="当日" /> },
    { field: 'liquidity_level', headerName: '流动性', type: 'singleSelect', valueOptions: ['t0', 'within_7d', 'within_30d', 'within_90d', 'locked_or_unknown'], width: 135, editable: true },
    { field: 'risk_level', headerName: '风险', type: 'singleSelect', valueOptions: ['low', 'medium', 'high'], width: 90, editable: true },
    { field: 'change_amount_cny', headerName: '较上月变化', width: 130, align: 'right', headerAlign: 'right', valueFormatter: (value) => value == null ? '—' : money.format(Number(value)) },
    { field: 'change_note', headerName: '备注', width: 210, editable: true },
  ], []);

  const error = sheetQuery.error ?? copyMutation.error ?? saveMutation.error;
  const errorMessage = error instanceof ApiClientError || error instanceof Error ? error.message : null;
  const warningCount = sheetQuery.data?.warnings.length ?? rows.filter((row) => row.unusual_change).length;
  const enterAmountEditMode = (params: GridCellParams<GridSnapshotRow>) => {
    if (shouldStartAmountEdit(params.field, params.cellMode)) {
      params.api.startCellEditMode({ id: params.id, field: params.field });
    }
  };

  return <Box>
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { lg: 'center' }, mb: 3 }}>
      <Box><Typography component="h1" variant="h4" sx={{ fontWeight: 780 }}>月度快照</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>按项目录入原币余额，保存时固化历史汇率与 CNY 折算值。</Typography></Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}><TextField label="快照日期" type="date" size="small" value={snapshotDate} onChange={(event) => setSnapshotDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} /><Button variant="outlined" startIcon={<ContentCopyOutlined />} onClick={() => copyMutation.mutate()} disabled={copyMutation.isPending}>复制上月</Button><Button variant="outlined" startIcon={<UploadFileOutlined />} disabled>导入</Button><Button variant="contained" startIcon={<SaveOutlined />} onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !rows.some((row) => row.original_amount !== null)}>保存</Button></Stack>
    </Stack>
    {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
    <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}><Chip color={(sheetQuery.data?.missing_project_ids.length ?? 0) > 0 ? 'warning' : 'success'} label={`缺失 ${(sheetQuery.data?.missing_project_ids.length ?? 0)} 项`} /><Chip color={warningCount > 0 ? 'warning' : 'default'} label={`异常变化提示 ${warningCount} 项`} /><Typography color="text.secondary" sx={{ alignSelf: 'center', fontSize: 12 }}>单击金额即可覆盖输入；双击可编辑流动性、风险和备注</Typography></Stack>
    <Paper variant="outlined" sx={{ height: 600, borderRadius: 2.5, overflow: 'hidden' }}><DataGrid aria-label="月度快照编辑表格" rows={rows} columns={columns} getRowId={(row) => row.grid_id} processRowUpdate={processRowUpdate} onCellClick={enterAmountEditMode} loading={sheetQuery.isLoading} disableRowSelectionOnClick rowBufferPx={320} showToolbar /></Paper>
    <Snackbar open={Boolean(notice)} autoHideDuration={3000} onClose={() => setNotice(null)} message={notice} />
  </Box>;
}
