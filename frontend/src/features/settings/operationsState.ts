import type { BackupMetadata, ImportJob } from './operationsApi';

export function importStatus(job?: ImportJob): { label: string; color: 'default' | 'success' | 'error' } {
  if (!job) return { label: '未选择文件', color: 'default' };
  if (job.status === 'validated') return { label: `已校验 · ${job.row_count} 行`, color: 'success' };
  if (job.status === 'committed') return { label: `已导入 · ${job.row_count} 行`, color: 'success' };
  return { label: job.status === 'invalid' ? '校验未通过' : '整批已拒绝', color: 'error' };
}

export function canRestore(
  backup: BackupMetadata | undefined,
  password: string,
  confirmed: boolean,
  pending: boolean,
): boolean {
  return Boolean(backup && password && confirmed && !pending);
}
