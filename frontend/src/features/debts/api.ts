import { apiRequest } from '../../api/client';

export type DebtBalance = {
  id: string; debt_type: 'receivable' | 'payable'; counterparty: string; currency_code: string;
  status: string; notes: string | null; balance: string; converted_amount_cny: string;
  fx_rate_to_cny: string; fx_is_stale: boolean; last_event_date: string | null;
};
export type DebtEvent = {
  id: string; debt_item_id: string; event_type: string; event_date: string;
  amount: string; counterparty: string; note: string | null; created_at: string;
};
export type DebtInput = { debtType: string; counterparty: string; currencyCode: string; notes: string };
export type EventInput = { eventType: string; eventDate: string; amount: string; counterparty: string; note: string; confirmNegative: boolean };

export const getDebts = (type: string) => apiRequest<DebtBalance[]>(`/debts?type=${type}`);
export const createDebt = (value: DebtInput) => apiRequest<DebtBalance>('/debts', { method: 'POST', body: JSON.stringify(value) });
export const getDebtEvents = (id: string) => apiRequest<DebtEvent[]>(`/debts/${id}/events`);
export const createDebtEvent = (id: string, value: EventInput) => apiRequest<DebtEvent>(`/debts/${id}/events`, { method: 'POST', body: JSON.stringify(value) });
