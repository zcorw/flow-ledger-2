import BackupOutlined from '@mui/icons-material/BackupOutlined';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import FileUploadOutlined from '@mui/icons-material/FileUploadOutlined';
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
  exportBackup,
  restoreBackup,
  uploadBackup,
  validateImport,
  type BackupMetadata,
  type ImportJob,
  type ImportType,
} from './operationsApi';
import { canRestore, importStatus } from './operationsState';

const importDefinitions: Array<{
  type: ImportType;
  title: string;
  description: string;
}> = [
  {
    type: 'institution_account_project',
    title: '机构、账户与项目',
    description: '按机构 → 账户 → 项目的顺序批量建立基础资料。',
  },
  {
    type: 'monthly_snapshot',
    title: '月度快照',
    description: '按日期导入项目金额、流动性、风险和变动备注。',
  },
  {
    type: 'debt_event',
    title: '债权债务事件',
    description: '批量导入新增、还款、调整或结清事件。',
  },
];

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
  const exportMutation = useMutation({
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
    exportMutation.error ??
    uploadMutation.error ??
    restoreMutation.error;

  const handleImportFile = (type: ImportType, file?: File) => {
    if (file) validationMutation.mutate({ type, file });
  };
  const handleBackupFile = (file?: File) => {
    if (file) uploadMutation.mutate(file);
  };
  const closeRestore = () => {
    if (restoreMutation.isPending) return;
    setRestoreDialog(false);
    setPassword('');
    setConfirmed(false);
  };

  return (
    <>
      <Divider sx={{ my: 1 }} />
      <Box>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          导入、导出与恢复
        </Typography>
        <Typography sx={{ mt: 0.5, color: 'text.secondary', fontSize: 13 }}>
          所有 CSV 都会先完整校验；存在任何冲突时整批拒绝，不覆盖现有数据。
        </Typography>
      </Box>
      {error && <Alert severity="error">{operationError(error)}</Alert>}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          gap: 1.5,
        }}
      >
        {importDefinitions.map((definition) => {
          const job = jobs[definition.type];
          const status = importStatus(job);
          const busy =
            (validationMutation.isPending && validationMutation.variables.type === definition.type) ||
            (commitMutation.isPending && commitMutation.variables.type === definition.type);
          return (
            <Paper
              key={definition.type}
              variant="outlined"
              sx={{ p: 2, borderRadius: 2.5, display: 'flex', flexDirection: 'column' }}
            >
              <Typography sx={{ fontWeight: 700 }}>{definition.title}</Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5, minHeight: 38 }}>
                {definition.description}
              </Typography>
              <Chip
                size="small"
                color={status.color}
                label={status.label}
                sx={{ alignSelf: 'flex-start', my: 1.5 }}
              />
              {job?.error_report?.length ? (
                <Alert severity="error" sx={{ mb: 1.5, fontSize: 12 }}>
                  {job.error_report.slice(0, 3).map((item) => (
                    <Box key={`${item.row}-${item.field}`}>
                      第 {item.row} 行 · {item.field}：{item.reason}
                    </Box>
                  ))}
                  {job.error_report.length > 3 && `另有 ${job.error_report.length - 3} 项错误`}
                </Alert>
              ) : null}
              <Stack spacing={1} sx={{ mt: 'auto' }}>
                <Button
                  size="small"
                  startIcon={<CloudDownloadOutlined />}
                  onClick={() => templateMutation.mutate(definition.type)}
                >
                  下载 CSV 模板
                </Button>
                {job?.status === 'validated' ? (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={busy}
                    startIcon={busy ? <CircularProgress size={15} /> : <FileUploadOutlined />}
                    onClick={() => commitMutation.mutate({ type: definition.type, jobId: job.id })}
                  >
                    确认导入全部数据
                  </Button>
                ) : (
                  <Button
                    component="label"
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    startIcon={busy ? <CircularProgress size={15} /> : <FileUploadOutlined />}
                  >
                    选择文件并校验
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
              </Stack>
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
              startIcon={exportMutation.isPending ? <CircularProgress size={16} /> : <BackupOutlined />}
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              导出完整备份
            </Button>
            <Button
              component="label"
              color="error"
              variant="outlined"
              startIcon={uploadMutation.isPending ? <CircularProgress size={16} /> : <RestoreOutlined />}
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
            startIcon={restoreMutation.isPending ? <CircularProgress size={16} /> : <RestoreOutlined />}
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
