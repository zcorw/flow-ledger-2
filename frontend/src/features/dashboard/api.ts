import { apiRequest } from '../../api/client';

export type DashboardSummary = {
  snapshot_date: string; total_assets_cny: string; total_liabilities_cny: string;
  net_worth_cny: string; net_worth_change_from_previous_month_cny: string | null;
  foreign_asset_ratio: string; fx_warnings: string[];
};
export type ChartPoint = { name: string; value: string };
export type DashboardCharts = {
  trend: { date: string; value: string }[]; asset_composition: ChartPoint[];
  liquidity_distribution: ChartPoint[]; risk_distribution: ChartPoint[];
  currency_distribution: ChartPoint[]; top_institutions: ChartPoint[];
  project_changes: { project_name: string; institution_name: string; value: string }[];
};

export const getDashboardSummary = (date: string) => apiRequest<DashboardSummary>(`/dashboard/summary?snapshotDate=${date}`);
export const getDashboardCharts = (date: string) => apiRequest<DashboardCharts>(`/dashboard/charts?snapshotDate=${date}`);
