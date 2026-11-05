export function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  return y > 0 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function localDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function validAmount(value: string): boolean {
  return /^\d{1,14}(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
}

// Display decimal text without passing through floating point (including 14-digit amounts).
export function formatExpenseAmount(value: string): string {
  const [whole, fraction] = value.split('.');
  const trimmed = fraction?.replace(/0+$/, '');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (trimmed ? `.${trimmed}` : '');
}
