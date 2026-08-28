export function shouldStartAmountEdit(field: string, cellMode: 'edit' | 'view'): boolean {
  return field === 'original_amount' && cellMode === 'view';
}

export function selectAllInputText(target: EventTarget | null): void {
  if (target instanceof HTMLInputElement) target.select();
}

export function getAmountValidationMessage(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    return '请输入合法数字（只能包含一个小数点）';
  }

  const unsigned = text.replace(/^[+-]/, '');
  const [integerPart = '', decimalPart = ''] = unsigned.split('.');
  const digitCount = integerPart.length + decimalPart.length;
  if (digitCount > 20) return '金额最多可输入 20 位数字';
  if (decimalPart.length > 6) return '金额最多可输入 6 位小数';
  return null;
}
