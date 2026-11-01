// Deliberately conservative: one receipt -> at most one editable expense candidate.
export type ReceiptCandidate = {
  amount: string; expenseDate: string; currencyCode: string; merchant: string;
  warnings: string[];
};

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

export function parseReceipt(text: string): ReceiptCandidate {
  const lines = text.normalize('NFKC').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join('\n');
  const amounts: { amount: string; priority: number }[] = [];
  lines.forEach((line) => {
    const compact = line.replace(/\s/g, '');
    // Total labels take precedence over the word tax (e.g. 合計(税込)).
    // Read the FIRST amount after the label, never the trailing tax/change amount.
    if (/小計|預[かり]*|お釣|釣銭|change|subtotal|tendered/i.test(compact)) return;
    const priority = /お支払[い]?合計|ご請求|支払金額|amountdue|grandtotal/i.test(compact) ? 2
      : /合計|総計|TOTAL/i.test(compact) ? 1 : 0;
    if (!priority) return;
    const label = /お支払い?合計|支払金額|ご請求(?:金額)?|amountdue|grandtotal|合計|総計|total/i.exec(compact);
    if (!label) return;
    const after = compact.slice(label.index + label[0].length).replace(/\([^)]*\)|【[^】]*】/g, '');
    const first = after.match(/(?:[¥￥$€]|JPY|CNY|USD|EUR|RMB)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?|\d+(?:\.\d{1,6})?)/)?.[1]?.replace(/,/g, '');
    if (first && /^\d{1,14}(?:\.\d{1,6})?$/.test(first) && /[1-9]/.test(first)) {
      const [whole, fraction] = first.split('.');
      const decimal = fraction?.replace(/0+$/, '');
      amounts.push({ amount: `${whole.replace(/^0+(?=\d)/, '')}${decimal ? `.${decimal}` : ''}`, priority });
    }
  });
  const bestPriority = Math.max(0, ...amounts.map((item) => item.priority));
  const candidates = [...new Set(amounts.filter((item) => item.priority === bestPriority).map((item) => item.amount))];
  const dates = [...joined.matchAll(/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})(?:日)?/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`)
    .filter(validCalendarDate);
  const distinctDates = [...new Set(dates)];
  const currencies = new Set<string>();
  if (/JPY|円/.test(joined)) currencies.add('JPY');
  if (/CNY|RMB|人民币|人民幣/.test(joined)) currencies.add('CNY');
  if (/USD|US\$/.test(joined)) currencies.add('USD');
  if (/EUR|€/.test(joined)) currencies.add('EUR');
  const warnings = ['金额、日期、商户均为候选，请对照原图核对。分类默认为未分类，请自行选择。'];
  if (candidates.length !== 1) warnings.push('未找到唯一明确的合计/实付金额，请手工填写。');
  if (distinctDates.length !== 1) warnings.push('未找到唯一有效日期，请手工填写。');
  if (currencies.size !== 1) warnings.push('币种不明确（¥ 可表示日元或人民币），请自行选择。');
  const suspiciousYen = currencies.size === 1 && currencies.has('JPY') && candidates.some((amount) => amount.includes('.'));
  if (suspiciousYen) warnings.push('日元合计出现小数，可能是千位分隔符识别错误，请对照原图手工填写。');
  const merchant = lines.find((line) => /[\p{L}]/u.test(line) && !/領収|レシート|receipt|領収書|\d{4}.*\d{2}.*\d{2}/i.test(line))?.slice(0, 150) ?? '';
  return { amount: candidates.length === 1 && !suspiciousYen ? candidates[0] : '',
    expenseDate: distinctDates.length === 1 ? distinctDates[0] : '',
    currencyCode: currencies.size === 1 ? [...currencies][0] : '', merchant, warnings };
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
