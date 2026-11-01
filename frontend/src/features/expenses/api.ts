import { apiRequest } from '../../api/client';
import type { Account } from '../assets/api';

export const categories = {
  uncategorized: '未分类', food: '餐饮', groceries: '日用食品', transport: '交通',
  housing: '居住', utilities: '水电通信', shopping: '购物', health: '医疗健康',
  entertainment: '休闲娱乐', education: '学习', travel: '旅行', other: '其他',
} as const;
export type Category = keyof typeof categories;
export type ExpenseFields = {
  expenseDate: string; amount: string; currencyCode: string; category: Category;
  merchant: string | null; accountId: string | null; note: string | null;
};
export type Expense = {
  id: string; expense_date: string; amount: string; currency_code: string; category: Category;
  merchant: string | null; account_id: string | null; note: string | null;
  source: 'manual' | 'receipt_ocr'; created_at: string; updated_at: string;
};
export type ExpenseInput = ExpenseFields & {
  requestKey: string; source: Expense['source']; allowDuplicate?: boolean;
};
export type Filters = { startDate: string; endDate: string; currency: string; category: string };
export type ExpenseList = {
  items: Expense[]; total: number;
  totals: { currency: string; amount: string }[];
  by_day: { date: string; currency: string; amount: string }[];
  by_category: { category: Category; currency: string; amount: string }[];
};
export const listExpenses = (filters: Filters, page: number) => {
  const params = new URLSearchParams({ offset: String(page * 50), limit: '50' });
  Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return apiRequest<ExpenseList>(`/expenses?${params}`);
};
export const getExpenseAccounts = () => apiRequest<Account[]>('/expenses/accounts');
export const createExpense = (input: ExpenseInput) => apiRequest<Expense>('/expenses', { method: 'POST', body: JSON.stringify(input) });
export const updateExpense = (id: string, input: ExpenseFields) => apiRequest<Expense>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(input) });
export const deleteExpense = (id: string) => apiRequest<void>(`/expenses/${id}`, { method: 'DELETE' });
