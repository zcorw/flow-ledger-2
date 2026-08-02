import { Box, CircularProgress } from '@mui/material';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from './features/auth/ProtectedRoute';

const LoginPage = lazy(() => import('./features/auth/LoginPage').then((module) => ({ default: module.LoginPage })));
const SetupPage = lazy(() => import('./features/auth/SetupPage').then((module) => ({ default: module.SetupPage })));
const AppLayout = lazy(() => import('./layout/AppLayout').then((module) => ({ default: module.AppLayout })));
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const SnapshotPage = lazy(() => import('./features/snapshots/SnapshotPage').then((module) => ({ default: module.SnapshotPage })));
const MasterDataPage = lazy(() => import('./features/assets/MasterDataPage').then((module) => ({ default: module.MasterDataPage })));
const DebtPage = lazy(() => import('./features/debts/DebtPage').then((module) => ({ default: module.DebtPage })));
const CurrencySettingsPage = lazy(() => import('./features/settings/CurrencySettingsPage').then((module) => ({ default: module.CurrencySettingsPage })));

function RouteFallback() {
  return (
    <Box role="status" aria-live="polite" sx={{ minHeight: '40vh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress aria-label="页面加载中" size={30} />
    </Box>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="snapshots" element={<SnapshotPage />} />
              <Route path="institutions" element={<MasterDataPage />} />
              <Route path="debts" element={<DebtPage />} />
              <Route path="settings" element={<CurrencySettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
