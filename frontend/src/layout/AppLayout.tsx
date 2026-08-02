import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import WalletOutlined from '@mui/icons-material/WalletOutlined';
import { AppBar, Avatar, Box, Button, Divider, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Paper, Stack, Toolbar, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { logout, type User } from '../features/auth/api';

const drawerWidth = 252;
const navItems = [
  [<DashboardOutlined key="dashboard" />, '首页看板'],
  [<CalendarMonthOutlined key="snapshot" />, '月度快照'],
  [<AccountBalanceOutlined key="institution" />, '机构与账户'],
  [<SwapHorizOutlined key="debt" />, '债权债务'],
  [<SettingsOutlined key="settings" />, '设置'],
] as const;

export function AppLayout({ user }: { user: User }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['auth'] });
      await navigate('/login', { replace: true });
    },
  });

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, display: { xs: 'none', md: 'block' }, '& .MuiDrawer-paper': { width: drawerWidth, bgcolor: '#172321', color: '#e7eeeb', border: 0, p: 2 } }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, py: 1.5 }}>
          <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 1.5, bgcolor: 'primary.main' }}><WalletOutlined fontSize="small" /></Box>
          <Box><Typography sx={{ color: 'white', fontWeight: 700, fontSize: 15 }}>Flow Ledger</Typography><Typography sx={{ color: '#85938f', fontSize: 11 }}>个人资产台账</Typography></Box>
        </Stack>
        <Divider sx={{ borderColor: 'rgba(255,255,255,.07)', my: 1.5 }} />
        <List sx={{ flex: 1 }}>
          {navItems.map(([icon, label], index) => (
            <ListItemButton key={label} selected={index === 0} sx={{ mb: 0.5, borderRadius: 1.5, color: '#9eaaa6', '&.Mui-selected': { color: 'white', bgcolor: 'rgba(39,148,124,.18)' }, '&.Mui-selected:hover': { bgcolor: 'rgba(39,148,124,.25)' } }}>
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{icon}</ListItemIcon><ListItemText primary={label} slotProps={{ primary: { sx: { fontSize: 13 } } }} />
            </ListItemButton>
          ))}
        </List>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1 }}>
          <Avatar sx={{ width: 34, height: 34, bgcolor: '#d9ece7', color: 'primary.dark', fontSize: 12 }}>{user.display_name.slice(0, 1)}</Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}><Typography noWrap sx={{ fontSize: 12, fontWeight: 650 }}>{user.display_name}</Typography><Typography noWrap sx={{ color: '#74847f', fontSize: 10 }}>私有管理员</Typography></Box>
          <Button aria-label="退出登录" onClick={() => logoutMutation.mutate()} sx={{ minWidth: 32, color: '#9eaaa6' }}><LogoutOutlined fontSize="small" /></Button>
        </Stack>
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0, ml: { md: `${drawerWidth}px` } }}>
        <AppBar position="sticky" elevation={0} color="transparent" sx={{ borderBottom: '1px solid', borderColor: 'divider', backdropFilter: 'blur(12px)', bgcolor: 'rgba(243,245,243,.9)' }}>
          <Toolbar sx={{ px: { xs: 2, md: 4 } }}><Typography component="h1" sx={{ fontSize: 21, fontWeight: 700 }}>首页看板</Typography></Toolbar>
        </AppBar>
        <Box component="main" sx={{ p: { xs: 2, md: 4 } }}>
          <Paper variant="outlined" sx={{ maxWidth: 900, p: { xs: 3, md: 5 }, borderRadius: 3 }}>
            <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>认证已就绪</Typography>
            <Typography variant="h4" component="h2" sx={{ mt: 1 }}>欢迎回来，{user.display_name}</Typography>
            <Typography sx={{ mt: 1.5, color: 'text.secondary' }}>你的会话由服务端安全管理。后续资产模块将按 TodoList 逐步接入此工作台。</Typography>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
}
