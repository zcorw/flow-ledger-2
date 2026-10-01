export function localMonth(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

export function monthEndDate(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('月份格式必须为 YYYY-MM');

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('月份必须在 01 到 12 之间');

  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function monthIndex(month: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error('月份格式必须为 YYYY-MM');

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) throw new Error('月份必须在 01 到 12 之间');
  return year * 12 + monthNumber - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function dashboardMonthOptions(
  availableMonths: string[],
  currentMonth = localMonth(),
): string[] {
  const uniqueMonths = [...new Set([...availableMonths, currentMonth])].sort();
  const start = monthIndex(uniqueMonths[0]);
  const end = monthIndex(uniqueMonths.at(-1)!);
  return Array.from({ length: end - start + 1 }, (_item, offset) => monthFromIndex(start + offset));
}

export function formatMonthLabel(month: string): string {
  const [year, monthNumber] = month.split('-');
  return `${year}年${monthNumber}月`;
}
