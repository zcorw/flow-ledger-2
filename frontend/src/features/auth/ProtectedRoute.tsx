import { Box, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ApiClientError } from '../../api/client';
import { getMe } from './api';

export function ProtectedRoute() {
  const location = useLocation();
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: false });
  if (auth.isLoading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress aria-label="正在验证登录状态" /></Box>;
  const login = <Navigate to="/login" state={{ returnTo: location.pathname + location.search }} replace />;
  if (auth.error instanceof ApiClientError && auth.error.status === 401) return login;
  if (!auth.data) return login;
  return <Outlet />;
}
