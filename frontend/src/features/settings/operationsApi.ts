import { apiRequest } from '../../api/client';
import { blobRequest, saveBlob } from '../../api/download';

export type ImportType =
  | 'institution_account_project'
  | 'monthly_snapshot'
  | 'debt_event'
  | 'fx_rate';
export type DebtExportType = 'all' | 'receivable' | 'payable';

export type ImportError = {
  row: number;
  field: string;
  reason: string;
};

export type ImportJob = {
  id: string;
  import_type: ImportType;
  status: 'invalid' | 'validated' | 'committed' | 'rejected';
  file_name: string | null;
  row_count: number;
  error_report: ImportError[] | null;
  created_at: string;
  finished_at: string | null;
};

export type BackupMetadata = {
  id: string;
  file_name: string;
  checksum: string;
  purpose: string;
  created_at: string;
};

export type RestoreResult = {
  restored_from_id: string;
  pre_restore_backup_id: string;
};

export async function downloadImportTemplate(importType: ImportType): Promise<void> {
  const blob = await blobRequest(`/imports/templates/${importType}`);
  saveBlob(blob, `${importType}.csv`);
}

export async function validateImport(importType: ImportType, file: File): Promise<ImportJob> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<ImportJob>(`/imports/${importType}/validate`, {
    method: 'POST',
    body: form,
  });
}

export const commitImport = (importType: ImportType, jobId: string) =>
  apiRequest<ImportJob>(`/imports/${importType}/commit`, {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });

function exportParams(dateFrom: string, dateTo: string, debtType?: DebtExportType) {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (debtType && debtType !== 'all') params.set('type', debtType);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export async function exportMasterData(): Promise<void> {
  const blob = await blobRequest('/exports/master-data', { method: 'POST' });
  const date = new Date().toISOString().slice(0, 10);
  saveBlob(blob, `flow-ledger-master-data-${date}.zip`);
}

export async function exportMonthlySnapshots(dateFrom: string, dateTo: string): Promise<void> {
  const blob = await blobRequest(
    `/exports/monthly-snapshots${exportParams(dateFrom, dateTo)}`,
    { method: 'POST' },
  );
  saveBlob(blob, `flow-ledger-monthly-snapshots-${dateFrom || 'all'}-${dateTo || 'all'}.csv`);
}

export async function exportDebtEvents(
  debtType: DebtExportType,
  dateFrom: string,
  dateTo: string,
): Promise<void> {
  const blob = await blobRequest(
    `/exports/debt-events${exportParams(dateFrom, dateTo, debtType)}`,
    { method: 'POST' },
  );
  saveBlob(
    blob,
    `flow-ledger-debt-events-${debtType}-${dateFrom || 'all'}-${dateTo || 'all'}.csv`,
  );
}

export async function exportBackup(): Promise<void> {
  const blob = await blobRequest('/backups/export', { method: 'POST' });
  const date = new Date().toISOString().slice(0, 10);
  saveBlob(blob, `flow-ledger-backup-${date}.json`);
}

export async function uploadBackup(file: File): Promise<BackupMetadata> {
  const form = new FormData();
  form.append('file', file);
  return apiRequest<BackupMetadata>('/backups/upload', { method: 'POST', body: form });
}

export const restoreBackup = (backupFileId: string, password: string) =>
  apiRequest<RestoreResult>('/backups/restore', {
    method: 'POST',
    body: JSON.stringify({ backupFileId, password }),
  });
