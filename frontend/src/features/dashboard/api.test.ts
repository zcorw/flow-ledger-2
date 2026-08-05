import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDashboardCharts } from './api';

const emptyCharts = {
  trend: [],
  asset_composition: [],
  liquidity_distribution: [],
  risk_distribution: [],
  currency_distribution: [],
  top_institutions: [],
  project_changes: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dashboard charts API', () => {
  it.each([
    ['12m', '12m'],
    ['24m', '24m'],
    ['all', 'all'],
  ] as const)('requests the %s trend range', async (_label, trendRange) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => emptyCharts,
    });
    vi.stubGlobal('fetch', fetchMock);

    await getDashboardCharts('2026-08-05', trendRange);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/dashboard/charts?snapshotDate=2026-08-05&trendRange=${trendRange}`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });
});
