import { describe, expect, it } from 'vitest';
import { getAmountValidationMessage, selectAllInputText, shouldStartAmountEdit } from './snapshotEditing';

describe('snapshot amount editing', () => {
  it('starts single-click editing only for a view-mode amount cell', () => {
    expect(shouldStartAmountEdit('original_amount', 'view')).toBe(true);
    expect(shouldStartAmountEdit('original_amount', 'edit')).toBe(false);
    expect(shouldStartAmountEdit('project_name', 'view')).toBe(false);
  });

  it('selects the complete input value when editing receives focus', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = '123456.78';
    input.setSelectionRange(3, 3);

    selectAllInputText(input);

    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it('accepts complete decimal amounts and validates only the final text', () => {
    expect(getAmountValidationMessage('')).toBeNull();
    expect(getAmountValidationMessage('123456.789')).toBeNull();
    expect(getAmountValidationMessage('-.5')).toBeNull();
    expect(getAmountValidationMessage('12.')).toBeNull();
    expect(getAmountValidationMessage('1.2.3')).toContain('合法数字');
    expect(getAmountValidationMessage('.')).toContain('合法数字');
    expect(getAmountValidationMessage('1.1234567')).toContain('6 位小数');
    expect(getAmountValidationMessage('123456789012345678901')).toContain('20 位数字');
  });
});
