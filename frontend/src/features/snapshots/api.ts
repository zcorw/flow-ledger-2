import { apiRequest } from '../../api/client';

export type SnapshotRow = {
  id: string | null; project_id: string; institution_name: string; account_name: string;
  project_name: string; asset_type: string; currency_code: string; original_amount: string | null;
  converted_amount_cny: string | null; previous_original_amount: string | null;
  fx_rate_to_cny: string | null; fx_is_stale: boolean;
  liquidity_level: string; risk_level: string; change_note: string | null;
  change_amount_cny: string | null; change_percent: string | null; unusual_change: boolean;
};
export type SnapshotSheet = {
  snapshot_date: string; source_date: string | null; rows: SnapshotRow[];
  missing_project_ids: string[]; warnings: { project_id: string; message: string }[];
};
export type SnapshotSaveRow = {
  projectId: string; originalAmount: string; liquidityLevel: string;
  riskLevel: string; changeNote: string;
};

export const getSnapshotSheet = (date: string) => apiRequest<SnapshotSheet>(`/snapshots?date=${date}`);
export const copyPreviousSnapshot = (targetDate: string) => apiRequest<SnapshotSheet>('/snapshots/copy-from-previous', { method: 'POST', body: JSON.stringify({ targetDate }) });
export const saveSnapshotSheet = (snapshotDate: string, rows: SnapshotSaveRow[]) => apiRequest<SnapshotSheet>('/snapshots/bulk', { method: 'PUT', body: JSON.stringify({ snapshotDate, rows }) });
