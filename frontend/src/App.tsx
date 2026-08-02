import { useQuery } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './features/auth/LoginPage';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { SetupPage } from './features/auth/SetupPage';
import { getMe } from './features/auth/api';
import { AppLayout } from './layout/AppLayout';

function HomeRoute() {
  const { data: user } = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: false });
  return user ? <AppLayout user={user} /> : null;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<HomeRoute />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
