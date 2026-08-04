import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import BackupOutlined from '@mui/icons-material/BackupOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import RestoreOutlined from '@mui/icons-material/RestoreOutlined';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiClientError } from '../../api/client';
import {
  commitImport,
  downloadImportTemplate,
  exportDebtEvents,
  exportBackup,
  exportMasterData,
  exportMonthlySnapshots,
  restoreBackup,
  uploadBackup,
  validateImport,
  type BackupMetadata,
  type DebtExportType,
  type ImportJob,
  type ImportType,
} from './operationsApi';
import { canRestore, importStatus } from './operationsState';

const importDefinitions: Array<{
  type: ImportType;
  title: string;
  description: string;
  icon: typeof AccountTreeOutlined;
}> = [
  {
    type: 'institution_account_project',
    title: '机构、账户与项目',
    description: '按机构 → 账户 → 项目的顺序批量建立基础资料。',
    icon: AccountTreeOutlined,
  },
  {
    type: 'monthly_snapshot',
    title: '月度快照',
    description: '按日期导入项目金额、流动性、风险和变动备注。',
    icon: CalendarMonthOutlined,
  },
  {
    type: 'debt_event',
    title: '债权债务事件',
    description: '批量导入新增、还款、调整或结清事件。',
    icon: ReceiptLongOutlined,
  },
];

type DataExportRequest = {
  type: ImportType;
  dateFrom?: string;
  dateTo?: string;
  debtType?: DebtExportType;
};

const exportNoticeLabels: Record<ImportType, string> = {
  institution_account_project: '主数据',
  monthly_snapshot: '月度快照',
  debt_event: '债权债务事件',
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthsAgo(months: number) {
  const value = new Date();
  value.setUTCMonth(value.getUTCMonth() - months);
  return value.toISOString().slice(0, 10);
}

function operationError(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

export function OperationsSettings() {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<Partial<Record<ImportType, ImportJob>>>({});
  const [notice, setNotice] = useState<string>();
  const [backup, setBackup] = useState<BackupMetadata>();
  const [restoreDialog, setRestoreDialog] = useState(false);
  const [dataExportDialog, setDataExportDialog] = useState<ImportType | null>(null);
  const [exportDateFrom, setExportDateFrom] = useState(() => monthsAgo(12));
  const [exportDateTo, setExportDateTo] = useState(today);
  const [debtExportType, setDebtExportType] = useState<DebtExportType>('all');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const validationMutation = useMutation({
    mutationFn: ({ type, file }: { type: ImportType; file: File }) =>
      validateImport(type, file),
    onSuccess: (job) => {
      setJobs((current) => ({ ...current, [job.import_type]: job }));
      setNotice(job.status === 'validated' ? '文件校验通过，可确认导入' : '文件校验未通过');
    },
  });
  const commitMutation = useMutation({
    mutationFn: ({ type, jobId }: { type: ImportType; jobId: string }) =>
      commitImport(type, jobId),
    onSuccess: async (job) => {
      setJobs((current) => ({ ...current, [job.import_type]: job }));
      await queryClient.invalidateQueries();
      setNotice(`已原子导入 ${job.row_count} 行数据`);
    },
  });
  const templateMutation = useMutation({
    mutationFn: downloadImportTemplate,
    onSuccess: () => setNotice('模板已下载'),
  });
  const dataExportMutation = useMutation({
    mutationFn: (request: DataExportRequest) => {
      if (request.type === 'institution_account_project') return exportMasterData();
      if (request.type === 'monthly_snapshot') {
        return exportMonthlySnapshots(request.dateFrom ?? '', request.dateTo ?? '');
      }
      return exportDebtEvents(
        request.debtType ?? 'all',
        request.dateFrom ?? '',
        request.dateTo ?? '',
      );
    },
    onSuccess: (_, request) => {
      setDataExportDialog(null);
      setNotice(`${exportNoticeLabels[request.type]}已导出`);
    },
  });
  const backupExportMutation = useMutation({
    mutationFn: exportBackup,
    onSuccess: () => setNotice('完整备份已下载'),
  });
  const uploadMutation = useMutation({
    mutationFn: uploadBackup,
    onSuccess: (item) => {
      setBackup(item);
      setPassword('');
      setConfirmed(false);
      setRestoreDialog(true);
    },
  });
  const restoreMutation = useMutation({
    mutationFn: () => restoreBackup(backup?.id ?? '', password),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      setRestoreDialog(false);
      setNotice('备份恢复成功，恢复前数据已自动留存');
    },
  });
  const error =
    validationMutation.error ??
    commitMutation.error ??
    templateMutation.error ??
    (!dataExportDialog ? dataExportMutation.error : undefined) ??
    backupExportMutation.error ??
    uploadMutation.error ??
    restoreMutation.error;

  const handleImportFile = (type: ImportType, file?: File) => {
    if (file) validationMutation.mutate({ type, file });
  };
  const handleBackupFile = (file?: File) => {
    if (file) uploadMutation.mutate(file);
  };
  const openDataExport = (type: ImportType) => {
    dataExportMutation.reset();
    if (type === 'institution_account_project') {
      dataExportMutation.mutate({ type });
      return;
    }
    setDataExportDialog(type);
  };
  const closeDataExport = () => {
    if (!dataExportMutation.isPending) {
      dataExportMutation.reset();
      setDataExportDialog(null);
    }
  };
  const closeRestore = () => {
    if (restoreMutation.isPending) return;
    setRestoreDialog(false);
    setPassword('');
    setConfirmed(false);
  };
  const invalidExportRange = Boolean(
    exportDateFrom && exportDateTo && exportDateFrom > exportDateTo,
  );

  return (
    <>
      <Divider sx={{ my: 1 }} />
      <Box>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          导入、导出与恢复
        </Typography>
        <Typography sx={{ mt: 0.5, color: 'text.secondary', fontSize: 13 }}>
          集中管理三类业务数据；CSV 导入会先完整校验，导出不会改变现有数据。
        </Typography>
      </Box>
      {error && <Alert severity="error">{operationError(error)}</Alert>}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
          gap: 1.5,
        }}
      >
        {importDefinitions.map((definition) => {
          const job = jobs[definition.type];
          const status = importStatus(job);
          const DefinitionIcon = definition.icon;
          const templateBusy = templateMutation.isPending
            && templateMutation.variables === definition.type;
          const busy =
            templateBusy ||
            (validationMutation.isPending && validationMutation.variables.type === definition.type) ||
            (commitMutation.isPending && commitMutation.variables.type === definition.type) ||
            (dataExportMutation.isPending && dataExportMutation.variables.type === definition.type);
          return (
            <Paper
              key={definition.type}
              component="section"
              aria-label={`${definition.title}导入导出`}
              variant="outlined"
              sx={{
                p: 2.25,
                borderRadius: 2.5,
                borderColor: 'rgba(80, 105, 100, 0.18)',
                boxShadow: '0 10px 30px rgba(31, 55, 50, 0.035)',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '42px minmax(0, 1fr) auto',
                  columnGap: 1.25,
                  rowGap: 0.5,
                  alignItems: 'center',
                }}
              >
                <Box
                  sx={{
                    gridRow: '1 / span 2',
                    width: 42,
                    height: 42,
                    borderRadius: 2,
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: 'rgba(39, 138, 115, 0.10)',
                    color: 'primary.main',
                  }}
                >
                  <DefinitionIcon fontSize="small" />
                </Box>
                <Typography sx={{ minWidth: 0, fontWeight: 750, lineHeight: 1.3 }}>
                  {definition.title}
                </Typography>
                <Chip
                  size="small"
                  color={status.color}
                  icon={(
                    <Box
                      component="span"
                      sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor' }}
                    />
                  )}
                  label={status.label}
                  sx={{
                    flexShrink: 0,
                    bgcolor: status.color === 'default' ? 'action.hover' : undefined,
                    '& .MuiChip-icon': { ml: 1 },
                  }}
                />
                <Typography
                  sx={{
                    gridColumn: '2 / 4',
                    color: 'text.secondary',
                    fontSize: 12,
                    lineHeight: 1.55,
                    minHeight: 37,
                  }}
                >
                  {definition.description}
                </Typography>
              </Box>
              {job?.error_report?.length ? (
                <Alert severity="error" sx={{ mt: 1.5, fontSize: 12 }}>
                  {job.error_report.slice(0, 3).map((item) => (
                    <Box key={`${item.row}-${item.field}`}>
                      第 {item.row} 行 · {item.field}：{item.reason}
                    </Box>
                  ))}
                  {job.error_report.length > 3 && `另有 ${job.error_report.length - 3} 项错误`}
                </Alert>
              ) : null}
              <Divider sx={{ mt: 'auto', mb: 1.25 }} />
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'auto auto minmax(96px, 1fr)',
                  gap: 0.75,
                  alignItems: 'center',
                  '@media (max-width: 480px)': { gridTemplateColumns: '1fr 1fr' },
                }}
              >
                <Button
                  size="small"
                  disabled={busy}
                  startIcon={templateBusy
                    ? <CircularProgress aria-label="正在下载模板" size={15} />
                    : <DownloadOutlined />}
                  onClick={() => templateMutation.mutate(definition.type)}
                  sx={{ px: 0.75, whiteSpace: 'nowrap' }}
                >
                  下载模板
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  startIcon={busy && dataExportMutation.variables?.type === definition.type
                    ? <CircularProgress aria-label="正在导出数据" size={15} />
                    : <CloudDownloadOutlined />}
                  onClick={() => openDataExport(definition.type)}
                  sx={{ px: 1, whiteSpace: 'nowrap' }}
                >
                  导出数据
                </Button>
                {job?.status === 'validated' ? (
                  <Button
                    size="small"
                    variant="contained"
                    disableElevation
                    disabled={busy}
                    startIcon={busy ? <CircularProgress aria-label="正在处理导入" size={15} /> : <FileUploadOutlined />}
                    onClick={() => commitMutation.mutate({ type: definition.type, jobId: job.id })}
                    sx={{ whiteSpace: 'nowrap', '@media (max-width: 480px)': { gridColumn: '1 / -1' } }}
                  >
                    确认导入
                  </Button>
                ) : (
                  <Button
                    component="label"
                    size="small"
                    variant="contained"
                    disableElevation
                    disabled={busy}
                    startIcon={busy ? <CircularProgress aria-label="正在处理导入" size={15} /> : <FileUploadOutlined />}
                    sx={{ whiteSpace: 'nowrap', '@media (max-width: 480px)': { gridColumn: '1 / -1' } }}
                  >
                    选择文件
                    <input
                      hidden
                      type="file"
                      accept=".csv,text/csv"
                      onChange={(event) => {
                        handleImportFile(definition.type, event.currentTarget.files?.[0]);
                        event.currentTarget.value = '';
                      }}
                    />
                  </Button>
                )}
              </Box>
            </Paper>
          );
        })}
      </Box>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 2.5 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>完整业务数据备份</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5 }}>
              JSON 备份包含资产、快照、债权债务、币种汇率和审计记录，不包含管理员密码。
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              variant="outlined"
              startIcon={backupExportMutation.isPending ? <CircularProgress aria-label="正在导出备份" size={16} /> : <BackupOutlined />}
              disabled={backupExportMutation.isPending}
              onClick={() => backupExportMutation.mutate()}
            >
              导出完整备份
            </Button>
            <Button
              component="label"
              color="error"
              variant="outlined"
              startIcon={uploadMutation.isPending ? <CircularProgress aria-label="正在校验备份" size={16} /> : <RestoreOutlined />}
              disabled={uploadMutation.isPending}
            >
              选择备份并恢复
              <input
                hidden
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  handleBackupFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Dialog open={Boolean(dataExportDialog)} onClose={closeDataExport} fullWidth maxWidth="xs">
        <DialogTitle>
          {dataExportDialog === 'monthly_snapshot' ? '导出月度快照' : '导出债权债务事件'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="info">
              日期范围包含开始和结束日期；留空表示不限制。导出包含当前筛选范围内的全部记录。
            </Alert>
            {dataExportDialog === 'debt_event' && (
              <TextField
                select
                label="债权债务类型"
                value={debtExportType}
                onChange={(event) => setDebtExportType(event.target.value as DebtExportType)}
                disabled={dataExportMutation.isPending}
              >
                <MenuItem value="all">全部类型</MenuItem>
                <MenuItem value="receivable">债权</MenuItem>
                <MenuItem value="payable">债务</MenuItem>
              </TextField>
            )}
            <TextField
              label="开始日期"
              type="date"
              value={exportDateFrom}
              onChange={(event) => setExportDateFrom(event.target.value)}
              error={invalidExportRange}
              disabled={dataExportMutation.isPending}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="结束日期"
              type="date"
              value={exportDateTo}
              onChange={(event) => setExportDateTo(event.target.value)}
              error={invalidExportRange}
              helperText={invalidExportRange ? '开始日期不能晚于结束日期' : '可清空日期以取消该边界'}
              disabled={dataExportMutation.isPending}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            {dataExportMutation.error && (
              <Alert severity="error">{operationError(dataExportMutation.error)}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDataExport} disabled={dataExportMutation.isPending}>取消</Button>
          <Button
            variant="contained"
            startIcon={dataExportMutation.isPending
              ? <CircularProgress aria-label="正在导出数据" size={16} />
              : <CloudDownloadOutlined />}
            disabled={invalidExportRange || dataExportMutation.isPending}
            onClick={() => dataExportDialog && dataExportMutation.mutate({
              type: dataExportDialog,
              dateFrom: exportDateFrom,
              dateTo: exportDateTo,
              debtType: debtExportType,
            })}
          >
            导出 CSV
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={restoreDialog} onClose={closeRestore} fullWidth maxWidth="sm">
        <DialogTitle>确认全量恢复</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Alert severity="warning">
              恢复会全量替换当前业务数据。系统会先自动生成预恢复备份，管理员账号和密码保持不变。
            </Alert>
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{backup?.file_name}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', wordBreak: 'break-all' }}>
                校验和：{backup?.checksum}
              </Typography>
            </Box>
            <TextField
              label="当前管理员密码"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={restoreMutation.isPending}
              autoFocus
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
              }
              label="我理解当前业务数据将被完整替换"
            />
            {restoreMutation.error && (
              <Alert severity="error">{operationError(restoreMutation.error)}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRestore} disabled={restoreMutation.isPending}>
            取消
          </Button>
          <Button
            color="error"
            variant="contained"
            startIcon={restoreMutation.isPending ? <CircularProgress aria-label="正在恢复备份" size={16} /> : <RestoreOutlined />}
            disabled={!canRestore(backup, password, confirmed, restoreMutation.isPending)}
            onClick={() => restoreMutation.mutate()}
          >
            生成预备份并恢复
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3500}
        onClose={() => setNotice(undefined)}
        message={notice}
      />
    </>
  );
}
