import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './features/auth/LoginPage';
import { ProtectedRoute } from './features/auth/ProtectedRoute';
import { SetupPage } from './features/auth/SetupPage';
import { MasterDataPage } from './features/assets/MasterDataPage';
import { CurrencySettingsPage } from './features/settings/CurrencySettingsPage';
import { SnapshotPage } from './features/snapshots/SnapshotPage';
import { AppLayout } from './layout/AppLayout';
import { PlaceholderPage } from './pages/PlaceholderPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route index element={<PlaceholderPage title="首页看板" />} />
            <Route path="snapshots" element={<SnapshotPage />} />
            <Route path="institutions" element={<MasterDataPage />} />
            <Route path="debts" element={<PlaceholderPage title="债权债务" />} />
            <Route path="settings" element={<CurrencySettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
