import { z } from 'zod';

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, '请输入显示名称').max(100, '显示名称不能超过 100 个字符'),
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z.string().min(12, '新密码至少需要 12 位字符').max(256),
    confirmPassword: z.string().min(1, '请再次输入新密码'),
  })
  .superRefine((values, context) => {
    if (values.newPassword === values.currentPassword) {
      context.addIssue({
        code: 'custom',
        message: '新密码不能与当前密码相同',
        path: ['newPassword'],
      });
    }
    if (values.confirmPassword !== values.newPassword) {
      context.addIssue({
        code: 'custom',
        message: '两次输入的新密码不一致',
        path: ['confirmPassword'],
      });
    }
  });

export type ProfileFormValues = z.infer<typeof profileSchema>;
export type PasswordChangeFormValues = z.infer<typeof passwordChangeSchema>;
