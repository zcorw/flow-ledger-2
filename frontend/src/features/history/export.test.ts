import { describe, expect, it } from 'vitest';
import { buildHistoryCsv } from './export';

describe('buildHistoryCsv', () => {
  it('exports UTF-8 CSV and escapes notes', () => {
    const csv = buildHistoryCsv([{
      id: 'snapshot-1',
      snapshot_date: '2026-07-31',
      institution_name: '测试银行',
      account_name: '储蓄账户',
      project_name: '活期余额',
      currency_code: 'CNY',
      original_amount: '100.000000',
      fx_rate_to_cny: '1.0000000000',
      fx_is_stale: false,
      converted_amount_cny: '100.000000',
      change_amount_cny: null,
      change_percent: null,
      change_note: '包含"引号",逗号',
    }]);

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"测试银行"');
    expect(csv).toContain('"包含""引号"",逗号"');
    expect(csv).toContain('"当日汇率"');
  });
});
