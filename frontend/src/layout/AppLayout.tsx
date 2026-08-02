import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import WalletOutlined from '@mui/icons-material/WalletOutlined';
import { AppBar, Avatar, Box, Button, Divider, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Stack, Toolbar, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getMe, logout } from '../features/auth/api';

const drawerWidth = 252;
const navItems = [
  { icon: <DashboardOutlined />, label: '首页看板', path: '/' },
  { icon: <CalendarMonthOutlined />, label: '月度快照', path: '/snapshots' },
  { icon: <AccountBalanceOutlined />, label: '机构与账户', path: '/institutions' },
  { icon: <SwapHorizOutlined />, label: '债权债务', path: '/debts' },
  { icon: <SettingsOutlined />, label: '设置', path: '/settings' },
] as const;

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe, retry: false });
  const logoutMutation = useMutation({ mutationFn: logout, onSuccess: async () => { queryClient.removeQueries({ queryKey: ['auth'] }); await navigate('/login', { replace: true }); } });
  if (!user) return null;
  const activeItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, bgcolor: '#172321', color: '#e7eeeb', border: 0, p: 2 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, py: 1.5 }}><Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 1.5, bgcolor: 'primary.main' }}><WalletOutlined fontSize="small" /></Box><Box><Typography sx={{ color: 'white', fontWeight: 700, fontSize: 15 }}>Flow Ledger</Typography><Typography sx={{ color: '#85938f', fontSize: 11 }}>个人资产台账</Typography></Box></Stack>
        <Divider sx={{ borderColor: 'rgba(255,255,255,.07)', my: 1.5 }} />
        <List sx={{ flex: 1 }}>{navItems.map((item) => <ListItemButton key={item.path} selected={activeItem.path === item.path} onClick={() => navigate(item.path)} sx={{ mb: 0.5, borderRadius: 1.5, color: '#9eaaa6', '&.Mui-selected': { color: 'white', bgcolor: 'rgba(39,148,124,.18)' }, '&.Mui-selected:hover': { bgcolor: 'rgba(39,148,124,.25)' } }}><ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{item.icon}</ListItemIcon><ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: 13 } } }} /></ListItemButton>)}</List>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1 }}><Avatar sx={{ width: 34, height: 34, bgcolor: '#d9ece7', color: 'primary.dark', fontSize: 12 }}>{user.display_name.slice(0, 1)}</Avatar><Box sx={{ minWidth: 0, flex: 1 }}><Typography noWrap sx={{ fontSize: 12, fontWeight: 650 }}>{user.display_name}</Typography><Typography noWrap sx={{ color: '#74847f', fontSize: 10 }}>私有管理员</Typography></Box><Button aria-label="退出登录" onClick={() => logoutMutation.mutate()} sx={{ minWidth: 32, color: '#9eaaa6' }}><LogoutOutlined fontSize="small" /></Button></Stack>
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar position="sticky" elevation={0} color="transparent" sx={{ borderBottom: '1px solid', borderColor: 'divider', backdropFilter: 'blur(12px)', bgcolor: 'rgba(243,245,243,.9)' }}><Toolbar sx={{ px: { xs: 2, md: 4 } }}><Typography component="h1" sx={{ fontSize: 21, fontWeight: 700 }}>{activeItem.label}</Typography></Toolbar></AppBar>
        <Box component="main" sx={{ p: { xs: 2, md: 4 } }}><Outlet /></Box>
      </Box>
    </Box>
  );
}
