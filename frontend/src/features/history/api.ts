import { apiRequest } from '../../api/client';

export type HistoryLevel = 'institution' | 'account' | 'project';

export type SnapshotHistoryRow = {
  id: string;
  snapshot_date: string;
  institution_name: string | null;
  account_name: string;
  project_name: string;
  currency_code: string;
  original_amount: string;
  fx_rate_to_cny: string;
  fx_is_stale: boolean;
  converted_amount_cny: string;
  change_amount_cny: string | null;
  change_percent: string | null;
  change_note: string | null;
};

export type SnapshotHistory = {
  level: HistoryLevel;
  entity_id: string;
  entity_name: string;
  date_from: string | null;
  date_to: string | null;
  latest_snapshot_date: string | null;
  latest_amount_cny: string | null;
  latest_change_amount_cny: string | null;
  latest_change_percent: string | null;
  max_amount_cny: string | null;
  min_amount_cny: string | null;
  snapshot_count: number;
  record_count: number;
  trend: { snapshot_date: string; amount_cny: string }[];
  composition: { entity_id: string; name: string; amount_cny: string }[];
  rows: SnapshotHistoryRow[];
};

export function getSnapshotHistory(
  level: HistoryLevel,
  entityId: string,
  dateFrom: string,
  dateTo: string,
) {
  const params = new URLSearchParams({ level, entityId });
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  return apiRequest<SnapshotHistory>(`/snapshots/history?${params.toString()}`);
}
