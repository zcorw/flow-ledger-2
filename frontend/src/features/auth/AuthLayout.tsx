import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import { Box, Paper, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.05fr .95fr' } }}>
      <Box
        component="aside"
        sx={{
          position: 'relative',
          minHeight: { xs: 260, md: '100vh' },
          overflow: 'hidden',
          bgcolor: '#172321',
          color: 'white',
          px: { xs: 3, md: 6 },
          py: { xs: 3, md: 4 },
          display: 'flex',
          flexDirection: 'column',
          '&::after': {
            content: '""',
            position: 'absolute',
            width: 520,
            height: 520,
            right: -220,
            top: -230,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(65,161,139,.25), transparent 68%)',
          },
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', position: 'relative', zIndex: 1 }}>
          <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 1.5, bgcolor: 'primary.main' }}>
            <AccountBalanceWalletOutlined fontSize="small" />
          </Box>
          <Typography sx={{ fontWeight: 700 }}>Flow Ledger</Typography>
        </Stack>
        <Box sx={{ position: 'relative', zIndex: 1, my: 'auto', maxWidth: 560, py: { xs: 4, md: 8 } }}>
          <Typography variant="overline" sx={{ color: '#67c4ad', fontWeight: 700, letterSpacing: '.16em' }}>
            Private wealth overview
          </Typography>
          <Typography component="h2" sx={{ mt: 2, fontSize: { xs: 34, md: 54 }, lineHeight: 1.18, fontWeight: 620, letterSpacing: '-.05em' }}>
            资产有迹可循，
            <br />
            决策自然从容。
          </Typography>
          <Typography sx={{ mt: 2, maxWidth: 500, color: '#9fb0ab', lineHeight: 1.8, fontSize: 14 }}>
            用一份清晰的月度快照，整理分散在不同机构、币种与借贷关系中的资产。
          </Typography>
          <Paper
            variant="outlined"
            sx={{ mt: 5, maxWidth: 460, p: 2.5, bgcolor: 'rgba(255,255,255,.035)', borderColor: 'rgba(255,255,255,.09)', color: 'white' }}
          >
            <Typography sx={{ color: '#7e918b', fontSize: 12 }}>当前净资产</Typography>
            <Stack direction="row" sx={{ mt: 0.5, alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 28, fontWeight: 700 }}>¥ 1,286,420</Typography>
              <Typography sx={{ color: '#66c6ae', fontSize: 12 }}>↗ 2.48%</Typography>
            </Stack>
            <Box sx={{ mt: 2, height: 70, borderBottom: '2px solid #52b69d', transform: 'skewY(-7deg)', bgcolor: 'rgba(61,163,139,.08)' }} />
          </Paper>
        </Box>
        <Typography sx={{ position: 'relative', zIndex: 1, color: '#63736f', fontSize: 11 }}>
          你的数据仅保存在自己的私有服务器中
        </Typography>
      </Box>
      <Box component="main" sx={{ minHeight: { xs: 620, md: '100vh' }, display: 'grid', placeItems: 'center', px: { xs: 3, sm: 6 }, py: 8, bgcolor: 'white' }}>
        <Box sx={{ width: '100%', maxWidth: 410 }}>{children}</Box>
      </Box>
    </Box>
  );
}
