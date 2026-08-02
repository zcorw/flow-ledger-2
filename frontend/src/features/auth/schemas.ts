import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email('请输入有效的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
});

export const setupSchema = z.object({
  bootstrapToken: z.string().min(1, '请输入 Bootstrap Token'),
  displayName: z.string().trim().min(1, '请输入显示名称').max(100),
  email: z.email('请输入有效的管理员邮箱'),
  password: z.string().min(12, '密码至少需要 12 位字符').max(256),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type SetupFormValues = z.infer<typeof setupSchema>;
