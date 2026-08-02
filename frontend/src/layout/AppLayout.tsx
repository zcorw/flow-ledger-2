import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import LogoutOutlined from '@mui/icons-material/LogoutOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import WalletOutlined from '@mui/icons-material/WalletOutlined';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
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

const drawerPaper = {
  width: drawerWidth,
  bgcolor: '#172321',
  color: '#e7eeeb',
  border: 0,
  p: 2,
};

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: user } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['auth'] });
      await navigate('/login', { replace: true });
    },
  });
  useEffect(() => {
    if (user) queryClient.setQueryData(['setup-status'], { requires_setup: false });
  }, [queryClient, user]);
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mobileOpen]);
  if (!user) return null;

  const activeItem = navItems.find((item) => item.path === location.pathname) ?? navItems[0];
  const navigateTo = (path: string) => {
    setMobileOpen(false);
    void navigate(path);
  };
  const drawerContent = (
    <>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 1, py: 1.5 }}>
        <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 1.5, bgcolor: 'primary.main' }}>
          <WalletOutlined fontSize="small" />
        </Box>
        <Box>
          <Typography sx={{ color: 'white', fontWeight: 700, fontSize: 15 }}>Flow Ledger</Typography>
          <Typography sx={{ color: '#a7b2af', fontSize: 11 }}>个人资产台账</Typography>
        </Box>
      </Stack>
      <Divider sx={{ borderColor: 'rgba(255,255,255,.1)', my: 1.5 }} />
      <List component="nav" aria-label="主要导航" sx={{ flex: 1 }}>
        {navItems.map((item) => {
          const selected = activeItem.path === item.path;
          return (
            <ListItemButton
              key={item.path}
              selected={selected}
              aria-current={selected ? 'page' : undefined}
              onClick={() => navigateTo(item.path)}
              sx={{
                mb: 0.5,
                borderRadius: 1.5,
                color: '#b6c0bd',
                '&.Mui-selected': { color: 'white', bgcolor: 'rgba(39,148,124,.24)' },
                '&.Mui-selected:hover': { bgcolor: 'rgba(39,148,124,.3)' },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontSize: 13 } } }} />
            </ListItemButton>
          );
        })}
      </List>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', p: 1 }}>
        <Avatar sx={{ width: 34, height: 34, bgcolor: '#d9ece7', color: 'primary.dark', fontSize: 12 }}>
          {user.display_name.slice(0, 1)}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontSize: 12, fontWeight: 650 }}>{user.display_name}</Typography>
          <Typography noWrap sx={{ color: '#a7b2af', fontSize: 10 }}>私有管理员</Typography>
        </Box>
        <Button
          aria-label="退出登录"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          sx={{ minWidth: 32, color: '#b6c0bd' }}
        >
          <LogoutOutlined fontSize="small" />
        </Button>
      </Stack>
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main-content"
        sx={{
          position: 'fixed',
          zIndex: 2000,
          top: 8,
          left: 8,
          px: 2,
          py: 1,
          borderRadius: 1,
          bgcolor: 'primary.dark',
          color: 'white',
          transform: 'translateY(-160%)',
          '&:focus': { transform: 'translateY(0)' },
        }}
      >
        跳到主要内容
      </Box>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': drawerPaper }}
      >
        {drawerContent}
      </Drawer>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          '& .MuiDrawer-paper': drawerPaper,
        }}
      >
        {drawerContent}
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar
          position="sticky"
          elevation={0}
          color="transparent"
          sx={{ borderBottom: '1px solid', borderColor: 'divider', backdropFilter: 'blur(12px)', bgcolor: 'rgba(243,245,243,.94)' }}
        >
          <Toolbar sx={{ px: { xs: 2, md: 4 } }}>
            <IconButton
              edge="start"
              aria-label="打开导航菜单"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
              sx={{ display: { md: 'none' }, mr: 1 }}
            >
              <MenuOutlined />
            </IconButton>
            <Typography component="div" sx={{ fontSize: 21, fontWeight: 700 }}>{activeItem.label}</Typography>
          </Toolbar>
        </AppBar>
        <Box id="main-content" tabIndex={-1} component="main" sx={{ p: { xs: 2, md: 4 }, outline: 'none' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
