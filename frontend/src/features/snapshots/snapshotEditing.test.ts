import { describe, expect, it } from 'vitest';
import { selectAllInputText, shouldStartAmountEdit } from './snapshotEditing';

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
});
