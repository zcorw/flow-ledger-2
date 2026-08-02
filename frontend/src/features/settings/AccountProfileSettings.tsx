import LockResetOutlined from '@mui/icons-material/LockResetOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ApiClientError } from '../../api/client';
import { changePassword, getMe, updateProfile } from '../auth/api';
import {
  passwordChangeSchema,
  profileSchema,
  type PasswordChangeFormValues,
  type ProfileFormValues,
} from './accountProfileSchemas';

function accountError(error: unknown): string | undefined {
  if (!error) return undefined;
  return error instanceof ApiClientError ? error.message : '操作失败，请稍后重试';
}

export function AccountProfileSettings() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const userQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: false });
  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: '' },
  });
  const passwordForm = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const resetProfile = profileForm.reset;

  useEffect(() => {
    if (userQuery.data) resetProfile({ displayName: userQuery.data.display_name });
  }, [resetProfile, userQuery.data]);

  const profileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (user) => {
      queryClient.setQueryData(['auth', 'me'], user);
      profileForm.reset({ displayName: user.display_name });
      setNotice('显示名称已更新');
    },
  });
  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: (user) => {
      queryClient.setQueryData(['auth', 'me'], user);
      passwordForm.reset();
      setNotice('密码已更新，其他登录会话已退出');
    },
  });

  const user = userQuery.data;
  const profileError = accountError(profileMutation.error ?? userQuery.error);
  const passwordError = accountError(passwordMutation.error);

  return (
    <>
      <Box>
        <Typography variant="h5" component="h2" sx={{ fontWeight: 700 }}>
          账户资料
        </Typography>
        <Typography sx={{ mt: 0.5, color: 'text.secondary', fontSize: 13 }}>
          管理左侧导航中显示的管理员名称，并定期更新登录密码。
        </Typography>
      </Box>
      <Paper
        variant="outlined"
        sx={{ borderRadius: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}
      >
        <Box
          component="form"
          aria-label="修改账户资料"
          noValidate
          onSubmit={profileForm.handleSubmit((values) => profileMutation.mutate(values))}
          sx={{ p: { xs: 2, md: 2.5 } }}
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.dark' }}>
                {user?.display_name.slice(0, 1) || '?'}
              </Avatar>
              <Box>
                <Typography sx={{ fontWeight: 700 }}>基本资料</Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                  邮箱作为登录账号，暂不支持修改。
                </Typography>
              </Box>
            </Stack>
            <TextField
              label="管理员邮箱"
              value={user?.email ?? ''}
              slotProps={{ input: { readOnly: true } }}
              disabled={!user}
            />
            <TextField
              label="显示名称"
              autoComplete="name"
              error={Boolean(profileForm.formState.errors.displayName)}
              helperText={profileForm.formState.errors.displayName?.message}
              disabled={!user || profileMutation.isPending}
              {...profileForm.register('displayName')}
            />
            {profileError && <Alert severity="error">{profileError}</Alert>}
            <Button
              type="submit"
              variant="contained"
              startIcon={profileMutation.isPending ? <CircularProgress aria-label="正在保存显示名称" size={16} color="inherit" /> : <SaveOutlined />}
              disabled={!user || !profileForm.formState.isDirty || profileMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              保存显示名称
            </Button>
          </Stack>
        </Box>
        <Box
          component="form"
          aria-label="修改密码"
          noValidate
          onSubmit={passwordForm.handleSubmit((values) =>
            passwordMutation.mutate({
              currentPassword: values.currentPassword,
              newPassword: values.newPassword,
            }),
          )}
          sx={{
            p: { xs: 2, md: 2.5 },
            borderTop: { xs: '1px solid', md: 0 },
            borderLeft: { xs: 0, md: '1px solid' },
            borderColor: 'divider',
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <LockResetOutlined color="primary" />
              <Box>
                <Typography sx={{ fontWeight: 700 }}>修改密码</Typography>
                <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>
                  修改后会撤销其他设备上的登录会话。
                </Typography>
              </Box>
            </Stack>
            <TextField
              label="当前密码"
              type="password"
              autoComplete="current-password"
              error={Boolean(passwordForm.formState.errors.currentPassword)}
              helperText={passwordForm.formState.errors.currentPassword?.message}
              disabled={passwordMutation.isPending}
              {...passwordForm.register('currentPassword')}
            />
            <TextField
              label="新密码"
              type="password"
              autoComplete="new-password"
              error={Boolean(passwordForm.formState.errors.newPassword)}
              helperText={passwordForm.formState.errors.newPassword?.message ?? '至少 12 位字符'}
              disabled={passwordMutation.isPending}
              {...passwordForm.register('newPassword')}
            />
            <TextField
              label="确认新密码"
              type="password"
              autoComplete="new-password"
              error={Boolean(passwordForm.formState.errors.confirmPassword)}
              helperText={passwordForm.formState.errors.confirmPassword?.message}
              disabled={passwordMutation.isPending}
              {...passwordForm.register('confirmPassword')}
            />
            {passwordError && <Alert severity="error">{passwordError}</Alert>}
            <Button
              type="submit"
              variant="outlined"
              startIcon={passwordMutation.isPending ? <CircularProgress aria-label="正在更新密码" size={16} /> : <LockResetOutlined />}
              disabled={passwordMutation.isPending}
              sx={{ alignSelf: 'flex-start' }}
            >
              更新密码
            </Button>
          </Stack>
        </Box>
      </Paper>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={3500}
        onClose={() => setNotice(undefined)}
        message={notice}
      />
    </>
  );
}
