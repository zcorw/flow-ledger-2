import type { SnapshotHistoryRow } from './api';

const headers = [
  '快照日期', '机构', '账户', '项目', '原币金额', '币种', '使用汇率',
  '人民币金额', '较上期变化', '变化比例', '汇率状态', '备注',
];

function csvCell(value: string | null) {
  return `"${(value ?? '').replaceAll('"', '""')}"`;
}

export function buildHistoryCsv(rows: SnapshotHistoryRow[]) {
  const content = rows.map((row) => [
    row.snapshot_date,
    row.institution_name,
    row.account_name,
    row.project_name,
    row.original_amount,
    row.currency_code,
    row.fx_rate_to_cny,
    row.converted_amount_cny,
    row.change_amount_cny,
    row.change_percent,
    row.fx_is_stale ? '历史汇率' : '当日汇率',
    row.change_note,
  ].map(csvCell).join(','));
  return `\uFEFF${[headers.map(csvCell).join(','), ...content].join('\r\n')}`;
}
