export function shouldStartAmountEdit(field: string, cellMode: 'edit' | 'view'): boolean {
  return field === 'original_amount' && cellMode === 'view';
}

export function selectAllInputText(target: EventTarget | null): void {
  if (target instanceof HTMLInputElement) target.select();
}
