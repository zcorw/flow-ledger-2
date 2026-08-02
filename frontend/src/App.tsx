import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import { Box, Chip, Container, Paper, Stack, Typography } from '@mui/material';

export function App() {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 8 }}>
      <Container maxWidth="md">
        <Paper variant="outlined" sx={{ p: { xs: 3, md: 5 }, borderRadius: 3 }}>
          <Stack spacing={3} sx={{ alignItems: 'flex-start' }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 2,
                bgcolor: 'primary.main',
                color: 'white',
              }}
            >
              <AccountBalanceWalletOutlined />
            </Box>
            <Box>
              <Typography variant="overline" sx={{ color: 'primary.main', fontWeight: 700 }}>
                Flow Ledger
              </Typography>
              <Typography variant="h4" component="h1" sx={{ mt: 0.5 }}>
                工程骨架已就绪
              </Typography>
              <Typography sx={{ color: 'text.secondary', mt: 1 }}>
                React、MUI、TanStack Query 与 FastAPI 已连接到统一的开发结构。
              </Typography>
            </Box>
            <Chip icon={<CheckCircleOutlined />} label="T001 Foundation" color="success" variant="outlined" />
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}
