import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import EmailOutlined from '@mui/icons-material/EmailOutlined';
import KeyOutlined from '@mui/icons-material/KeyOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, CircularProgress, InputAdornment, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { ApiClientError } from '../../api/client';
import { bootstrap, getSetupStatus } from './api';
import { AuthLayout } from './AuthLayout';
import { setupSchema, type SetupFormValues } from './schemas';

export function SetupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setupStatus = useQuery({ queryKey: ['setup-status'], queryFn: getSetupStatus, retry: 1 });
  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: { bootstrapToken: '', displayName: '', email: '', password: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' });
  const mutation = useMutation({
    mutationFn: bootstrap,
    onSuccess: async (user) => {
      queryClient.setQueryData(['auth', 'me'], user);
      await navigate('/', { replace: true });
    },
  });

  if (setupStatus.isLoading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="正在检查初始化状态" /></Box>;
  if (setupStatus.data && !setupStatus.data.requires_setup) return <Navigate to="/login" replace />;
  const errorMessage = mutation.error instanceof ApiClientError ? mutation.error.message : undefined;

  return (
    <AuthLayout>
      <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>首次部署</Typography>
      <Typography component="h1" variant="h4" sx={{ mt: 1, fontSize: 30 }}>初始化管理员</Typography>
      <Typography sx={{ mt: 1, color: 'text.secondary', fontSize: 14 }}>验证部署令牌并创建唯一的管理员账户。</Typography>
      <Box component="form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} sx={{ mt: 3 }} noValidate>
        <Stack spacing={1.75}>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          <TextField
            label="Bootstrap Token"
            type="password"
            error={Boolean(form.formState.errors.bootstrapToken)}
            helperText={form.formState.errors.bootstrapToken?.message}
            {...form.register('bootstrapToken')}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><KeyOutlined fontSize="small" /></InputAdornment> } }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField label="显示名称" fullWidth error={Boolean(form.formState.errors.displayName)} helperText={form.formState.errors.displayName?.message} {...form.register('displayName')} slotProps={{ input: { startAdornment: <InputAdornment position="start"><BadgeOutlined fontSize="small" /></InputAdornment> } }} />
            <TextField label="管理员邮箱" fullWidth error={Boolean(form.formState.errors.email)} helperText={form.formState.errors.email?.message} {...form.register('email')} slotProps={{ input: { startAdornment: <InputAdornment position="start"><EmailOutlined fontSize="small" /></InputAdornment> } }} />
          </Stack>
          <TextField
            label="设置密码"
            type="password"
            autoComplete="new-password"
            error={Boolean(form.formState.errors.password)}
            helperText={form.formState.errors.password?.message ?? '建议使用大小写字母、数字和符号'}
            {...form.register('password')}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><LockOutlined fontSize="small" /></InputAdornment> } }}
          />
          <LinearProgress aria-label="密码强度" variant="determinate" value={password.length >= 12 ? 75 : password.length * 5} sx={{ borderRadius: 2 }} />
          <Button type="submit" variant="contained" size="large" disabled={mutation.isPending} sx={{ minHeight: 46 }}>
            {mutation.isPending ? <CircularProgress aria-label="正在创建管理员" size={22} color="inherit" /> : '创建管理员并初始化'}
          </Button>
        </Stack>
      </Box>
      <Alert severity="info" sx={{ mt: 2.5, fontSize: 12 }}>完成后初始化入口会永久失效，并自动创建默认币种和现金机构。</Alert>
    </AuthLayout>
  );
}
