import { describe, expect, it } from 'vitest';
import { passwordChangeSchema, profileSchema } from './accountProfileSchemas';

describe('account profile schemas', () => {
  it('normalizes and validates the display name', () => {
    expect(profileSchema.parse({ displayName: '  私有管理员  ' })).toEqual({
      displayName: '私有管理员',
    });
    expect(profileSchema.safeParse({ displayName: '   ' }).success).toBe(false);
  });

  it('requires a new confirmed password', () => {
    const valid = {
      currentPassword: 'current-password-123',
      newPassword: 'new-password-456',
      confirmPassword: 'new-password-456',
    };
    expect(passwordChangeSchema.safeParse(valid).success).toBe(true);
    expect(
      passwordChangeSchema.safeParse({ ...valid, confirmPassword: 'different-password' }).success,
    ).toBe(false);
    expect(
      passwordChangeSchema.safeParse({ ...valid, newPassword: valid.currentPassword }).success,
    ).toBe(false);
  });
});
