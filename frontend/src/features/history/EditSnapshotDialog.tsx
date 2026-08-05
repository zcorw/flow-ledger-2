import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack,
  TextField, Typography,
} from '@mui/material';
import { useState } from 'react';
import type { SnapshotHistoryRow, SnapshotUpdatePayload } from './api';
import { snapshotEditSchema } from './snapshotEdit';

type Props = {
  row: SnapshotHistoryRow | null;
  saving: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSubmit: (snapshotId: string, payload: SnapshotUpdatePayload) => void;
};

type FormProps = Omit<Props, 'row'> & { row: SnapshotHistoryRow };

function EditSnapshotForm({ row, saving, errorMessage, onClose, onSubmit }: FormProps) {
  const [snapshotDate, setSnapshotDate] = useState(row.snapshot_date);
  const [originalAmount, setOriginalAmount] = useState(row.original_amount);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const result = snapshotEditSchema.safeParse({ snapshotDate, originalAmount });
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? 'form');
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    onSubmit(row.id, result.data);
  };

  return (
    <>
      <DialogTitle>编辑月度快照</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            {[row.institution_name, row.account_name, row.project_name].filter(Boolean).join(' / ')}
          </Typography>
          <Alert severity="info">
            保存后将按新日期重新匹配 {row.currency_code} 历史汇率，并重新计算 CNY 折算金额。
          </Alert>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          <TextField
            label="快照日期"
            type="date"
            value={snapshotDate}
            onChange={(event) => setSnapshotDate(event.target.value)}
            error={Boolean(fieldErrors.snapshotDate)}
            helperText={fieldErrors.snapshotDate}
            disabled={saving}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label={`原币金额（${row.currency_code}）`}
            value={originalAmount}
            onChange={(event) => setOriginalAmount(event.target.value)}
            error={Boolean(fieldErrors.originalAmount)}
            helperText={fieldErrors.originalAmount ?? '允许负数，最多保留 6 位小数'}
            disabled={saving}
            fullWidth
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>取消</Button>
        <Button variant="contained" onClick={submit} loading={saving}>保存修改</Button>
      </DialogActions>
    </>
  );
}

export function EditSnapshotDialog({ row, saving, errorMessage, onClose, onSubmit }: Props) {
  return (
    <Dialog open={Boolean(row)} onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      {row && <EditSnapshotForm
        key={`${row.id}-${row.snapshot_date}-${row.original_amount}`}
        row={row}
        saving={saving}
        errorMessage={errorMessage}
        onClose={onClose}
        onSubmit={onSubmit}
      />}
    </Dialog>
  );
}
