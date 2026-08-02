import { describe, expect, it } from 'vitest';
import type { BackupMetadata, ImportJob } from './operationsApi';
import { canRestore, importStatus } from './operationsState';

const job: ImportJob = {
  id: 'job-id',
  import_type: 'monthly_snapshot',
  status: 'validated',
  file_name: 'snapshot.csv',
  row_count: 8,
  error_report: null,
  created_at: '2026-08-02T00:00:00Z',
  finished_at: null,
};

const backup: BackupMetadata = {
  id: 'backup-id',
  file_name: 'backup.json',
  checksum: 'checksum',
  purpose: 'uploaded',
  created_at: '2026-08-02T00:00:00Z',
};

describe('operations state', () => {
  it('maps validation and rejection states to clear labels', () => {
    expect(importStatus(job)).toEqual({ label: '校验通过 · 8 行', color: 'success' });
    expect(importStatus({ ...job, status: 'rejected' })).toEqual({
      label: '整批已拒绝',
      color: 'error',
    });
  });

  it('requires a backup, password, confirmation and idle request before restore', () => {
    expect(canRestore(backup, 'password', true, false)).toBe(true);
    expect(canRestore(backup, '', true, false)).toBe(false);
    expect(canRestore(backup, 'password', false, false)).toBe(false);
    expect(canRestore(backup, 'password', true, true)).toBe(false);
  });
});
