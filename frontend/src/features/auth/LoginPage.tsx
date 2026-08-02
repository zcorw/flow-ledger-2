import EmailOutlined from '@mui/icons-material/EmailOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import ShieldOutlined from '@mui/icons-material/ShieldOutlined';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Box, Button, CircularProgress, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ApiClientError } from '../../api/client';
import { getSetupStatus, login } from './api';
import { AuthLayout } from './AuthLayout';
import { loginSchema, type LoginFormValues } from './schemas';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setupStatus = useQuery({ queryKey: ['setup-status'], queryFn: getSetupStatus, retry: 1 });
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: async (user) => {
      queryClient.setQueryData(['auth', 'me'], user);
      await navigate('/', { replace: true });
    },
  });

  if (setupStatus.data?.requires_setup) return <Navigate to="/setup" replace />;

  const errorMessage = mutation.error instanceof ApiClientError ? mutation.error.message : undefined;
  return (
    <AuthLayout>
      <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>欢迎回来</Typography>
      <Typography component="h1" variant="h4" sx={{ mt: 1, fontSize: 30 }}>登录 Flow Ledger</Typography>
      <Typography sx={{ mt: 1, color: 'text.secondary', fontSize: 14 }}>继续查看和维护你的资产快照。</Typography>
      <Box component="form" onSubmit={form.handleSubmit((values) => mutation.mutate(values))} sx={{ mt: 4 }} noValidate>
        <Stack spacing={2}>
          {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
          <TextField
            label="邮箱地址"
            autoComplete="email"
            autoFocus
            error={Boolean(form.formState.errors.email)}
            helperText={form.formState.errors.email?.message}
            {...form.register('email')}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><EmailOutlined fontSize="small" /></InputAdornment> } }}
          />
          <TextField
            label="密码"
            type="password"
            autoComplete="current-password"
            error={Boolean(form.formState.errors.password)}
            helperText={form.formState.errors.password?.message}
            {...form.register('password')}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><LockOutlined fontSize="small" /></InputAdornment> } }}
          />
          <Button type="submit" variant="contained" size="large" disabled={mutation.isPending} sx={{ minHeight: 46 }}>
            {mutation.isPending ? <CircularProgress aria-label="正在登录" size={22} color="inherit" /> : '登录'}
          </Button>
        </Stack>
      </Box>
      <Stack direction="row" spacing={1.25} sx={{ mt: 3, p: 1.5, bgcolor: 'background.default', borderRadius: 2, alignItems: 'center' }}>
        <ShieldOutlined color="primary" fontSize="small" />
        <Box><Typography sx={{ fontSize: 12, fontWeight: 650 }}>私有单用户系统</Typography><Typography sx={{ fontSize: 11, color: 'text.secondary' }}>系统不开放公开注册</Typography></Box>
      </Stack>
    </AuthLayout>
  );
}
