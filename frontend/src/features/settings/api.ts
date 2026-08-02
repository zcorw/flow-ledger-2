import { apiRequest } from '../../api/client';

export type Currency = {
  code: string;
  name: string;
  symbol: string | null;
  decimal_places: number;
  enabled: boolean;
  is_base: boolean;
};

export type FxRate = {
  id: string;
  base_currency: string;
  quote_currency: string;
  rate_date: string;
  rate_to_base: string;
  source: string;
  fetched_at: string;
};

export type FxSyncRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  currencies: string[];
  message: string | null;
};

export const getCurrencies = () => apiRequest<Currency[]>('/currencies');
export const updateCurrencies = (codes: string[]) =>
  apiRequest<Currency[]>('/currencies/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabledCurrencyCodes: codes }),
  });
export const getLatestRates = () => apiRequest<FxRate[]>('/fx-rates/latest');
export const getFxSyncRuns = () => apiRequest<FxSyncRun[]>('/fx-rates/sync-runs');
export const syncFxRates = () => apiRequest<FxSyncRun>('/fx-rates/sync', { method: 'POST' });
