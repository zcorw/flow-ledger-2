import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { Alert, Box, Button, Chip, InputBase, Paper, Snackbar, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, type GridCellParams, type GridColDef, type GridRenderEditCellParams, type GridRowModel } from '@mui/x-data-grid';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClientError } from '../../api/client';
import { copyPreviousSnapshot, getSnapshotSheet, saveSnapshotSheet, type SnapshotRow } from './api';
import { getAmountValidationMessage, selectAllInputText, shouldStartAmountEdit } from './snapshotEditing';

type GridSnapshotRow = SnapshotRow & { grid_id: string };
type AmountError = { rowId: string; message: string };
const money = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const originalMoney = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

function AmountEditCell({ params, error, onValidationChange }: {
  params: GridRenderEditCellParams<GridSnapshotRow>;
  error: string | null;
  onValidationChange: (rowId: string, message: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(() => String(params.value ?? ''));

  useEffect(() => {
    if (params.hasFocus || error) inputRef.current?.focus();
  }, [error, params.hasFocus]);

  return (
    <InputBase
      inputRef={inputRef}
      value={inputValue}
      fullWidth
      onChange={(event) => {
        const nextValue = event.target.value;
        setInputValue(nextValue);
        if (error) onValidationChange(String(params.id), null);
        void params.api.setEditCellValue({ id: params.id, field: params.field, value: nextValue }, event);
      }}
      onFocus={(event) => selectAllInputText(event.target)}
      onBlur={(event) => {
        const message = getAmountValidationMessage(event.currentTarget.value);
        onValidationChange(String(params.id), message);
        if (message) window.requestAnimationFrame(() => inputRef.current?.focus());
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onValidationChange(String(params.id), null);
      }}
      endAdornment={error ? <WarningAmberOutlined color="error" sx={{ mr: 1, fontSize: 18 }} /> : undefined}
      slotProps={{
        input: {
          inputMode: 'decimal',
          'aria-invalid': Boolean(error),
          title: error ?? undefined,
        },
      }}
      sx={{
        height: '100%',
        px: 1.5,
        bgcolor: error ? 'rgba(211, 47, 47, 0.06)' : 'background.paper',
        boxShadow: error ? 'inset 0 0 0 2px #d32f2f' : 'none',
        '& input': { height: '100%', boxSizing: 'border-box', textAlign: 'right' },
      }}
    />
  );
}

export function SnapshotPage() {
  const queryClient = useQueryClient();
  const [snapshotDate, setSnapshotDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<{ date: string; rows: GridSnapshotRow[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<AmountError | null>(null);
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
  const handleAmountValidation = useCallback((rowId: string, message: string | null) => {
    setAmountError((current) => message ? { rowId, message } : current?.rowId === rowId ? null : current);
  }, []);
  const processRowUpdate = (updated: GridRowModel) => {
    const row = updated as GridSnapshotRow;
    const validationMessage = getAmountValidationMessage(row.original_amount);
    if (validationMessage) {
      setAmountError({ rowId: row.grid_id, message: validationMessage });
      throw new Error(validationMessage);
    }
    setAmountError((current) => current?.rowId === row.grid_id ? null : current);
    setDraft({ date: snapshotDate, rows: rows.map((item) => item.grid_id === row.grid_id ? row : item) });
    return row;
  };

  const columns = useMemo<GridColDef<GridSnapshotRow>[]>(() => [
    { field: 'institution_name', headerName: '机构', width: 120 },
    { field: 'account_name', headerName: '账户', width: 130 },
    { field: 'project_name', headerName: '项目', width: 150 },
    { field: 'asset_type', headerName: '资产类型', width: 120 },
    { field: 'currency_code', headerName: '币种', width: 76 },
    { field: 'original_amount', headerName: '原币金额', width: 135, editable: true, align: 'right', headerAlign: 'right', valueFormatter: (value) => value == null || value === '' ? '' : originalMoney.format(Number(value)), renderEditCell: (params) => <AmountEditCell params={params} error={amountError?.rowId === String(params.id) ? amountError.message : null} onValidationChange={handleAmountValidation} /> },
    { field: 'converted_amount_cny', headerName: 'CNY 折算', width: 135, align: 'right', headerAlign: 'right', valueFormatter: (value) => value == null ? '保存后计算' : money.format(Number(value)) },
    { field: 'previous_original_amount', headerName: '上月原币金额', width: 145, align: 'right', headerAlign: 'right', valueFormatter: (value) => value == null ? '—' : originalMoney.format(Number(value)) },
    { field: 'change_amount_cny', headerName: '较上月变化', width: 155, align: 'right', headerAlign: 'right', renderCell: ({ row, value }) => <Stack direction="row" spacing={0.75} sx={{ width: '100%', justifyContent: 'flex-end', alignItems: 'center' }}>{row.unusual_change && <Tooltip title={`${row.institution_name} / ${row.account_name} / ${row.project_name}：金额变化较大`}><WarningAmberOutlined color="warning" sx={{ fontSize: 18 }} /></Tooltip>}<span>{value == null ? '—' : money.format(Number(value))}</span></Stack> },
    { field: 'fx_rate_to_cny', headerName: '使用汇率', width: 110, valueFormatter: (value) => value == null ? '—' : Number(value).toFixed(6) },
    { field: 'fx_is_stale', headerName: '汇率状态', width: 100, renderCell: ({ row }) => row.fx_rate_to_cny == null ? '待计算' : row.fx_is_stale ? <Chip size="small" color="warning" label="stale" /> : <Chip size="small" color="success" label="当日" /> },
    { field: 'liquidity_level', headerName: '流动性', type: 'singleSelect', valueOptions: ['t0', 'within_7d', 'within_30d', 'within_90d', 'locked_or_unknown'], width: 135, editable: true },
    { field: 'risk_level', headerName: '风险', type: 'singleSelect', valueOptions: ['low', 'medium', 'high'], width: 90, editable: true },
    { field: 'change_note', headerName: '备注', width: 210, editable: true },
  ], [amountError, handleAmountValidation]);

  const error = sheetQuery.error ?? copyMutation.error ?? saveMutation.error;
  const errorMessage = error instanceof ApiClientError || error instanceof Error ? error.message : null;
  const unusualRows = rows.filter((row) => row.unusual_change);
  const warningCount = unusualRows.length;
  const enterAmountEditMode = (params: GridCellParams<GridSnapshotRow>) => {
    if (shouldStartAmountEdit(params.field, params.cellMode)) {
      params.api.startCellEditMode({ id: params.id, field: params.field });
    }
  };

  return <Box>
    <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: { lg: 'center' }, mb: 3 }}>
      <Box><Typography component="h1" variant="h4" sx={{ fontWeight: 780 }}>月度快照</Typography><Typography color="text.secondary" sx={{ mt: 0.5 }}>按项目录入原币余额，保存时固化历史汇率与 CNY 折算值。</Typography></Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}><TextField label="快照日期" type="date" size="small" value={snapshotDate} onChange={(event) => { setSnapshotDate(event.target.value); setAmountError(null); }} slotProps={{ inputLabel: { shrink: true } }} /><Button variant="outlined" startIcon={<ContentCopyOutlined />} onClick={() => copyMutation.mutate()} disabled={copyMutation.isPending}>复制上月</Button><Button variant="outlined" startIcon={<UploadFileOutlined />} disabled>导入</Button><Button variant="contained" startIcon={<SaveOutlined />} onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || Boolean(amountError) || !rows.some((row) => row.original_amount !== null && String(row.original_amount).trim() !== '')}>保存</Button></Stack>
    </Stack>
    {errorMessage && <Alert severity="error" sx={{ mb: 2 }}>{errorMessage}</Alert>}
    {amountError && <Alert severity="error" sx={{ mb: 2 }}>{rows.find((row) => row.grid_id === amountError.rowId)?.project_name ?? '当前项目'}的原币金额不合法：{amountError.message}</Alert>}
    {unusualRows.length > 0 && <Alert severity="warning" icon={<WarningAmberOutlined />} sx={{ mb: 2 }}>异常变化项目：{unusualRows.map((row) => `${row.institution_name} / ${row.account_name} / ${row.project_name}`).join('；')}。建议核对金额并填写备注。</Alert>}
    <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}><Chip color={(sheetQuery.data?.missing_project_ids.length ?? 0) > 0 ? 'warning' : 'success'} label={`缺失 ${(sheetQuery.data?.missing_project_ids.length ?? 0)} 项`} /><Chip color={warningCount > 0 ? 'warning' : 'default'} label={`异常变化提示 ${warningCount} 项`} /><Typography color="text.secondary" sx={{ alignSelf: 'center', fontSize: 12 }}>单击金额即可覆盖输入；双击可编辑流动性、风险和备注</Typography></Stack>
    <Paper variant="outlined" sx={{ height: 600, borderRadius: 2.5, overflow: 'hidden' }}><DataGrid aria-label="月度快照编辑表格" rows={rows} columns={columns} getRowId={(row) => row.grid_id} getRowClassName={({ row }) => row.unusual_change ? 'snapshot-row--unusual' : ''} processRowUpdate={processRowUpdate} onProcessRowUpdateError={() => undefined} onCellClick={enterAmountEditMode} loading={sheetQuery.isLoading} disableRowSelectionOnClick rowBufferPx={320} showToolbar sx={{ '& .snapshot-row--unusual': { bgcolor: 'rgba(148, 99, 31, 0.08)' }, '& .snapshot-row--unusual:hover': { bgcolor: 'rgba(148, 99, 31, 0.14)' } }} /></Paper>
    <Snackbar open={Boolean(notice)} autoHideDuration={3000} onClose={() => setNotice(null)} message={notice} />
  </Box>;
}
