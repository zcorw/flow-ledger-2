import { describe, expect, it } from 'vitest';
import { loginSchema, setupSchema } from './schemas';

describe('authentication schemas', () => {
  it('validates login credentials', () => {
    expect(loginSchema.safeParse({ email: 'admin@example.com', password: 'secret' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'invalid', password: '' }).success).toBe(false);
  });

  it('requires a strong setup payload', () => {
    const result = setupSchema.safeParse({
      bootstrapToken: 'token',
      displayName: 'Admin',
      email: 'admin@example.com',
      password: 'strong-password-123',
    });
    expect(result.success).toBe(true);
    expect(setupSchema.safeParse({ ...result.data, password: 'short' }).success).toBe(false);
  });
});
