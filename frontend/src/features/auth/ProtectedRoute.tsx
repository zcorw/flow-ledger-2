import { Box, CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router-dom';
import { ApiClientError } from '../../api/client';
import { getMe } from './api';

export function ProtectedRoute() {
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: false });
  if (auth.isLoading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  if (auth.error instanceof ApiClientError && auth.error.status === 401) return <Navigate to="/login" replace />;
  if (!auth.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}
