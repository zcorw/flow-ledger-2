import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#176c5a', dark: '#145c4d', light: '#e7f4f0' },
    secondary: { main: '#397c93' },
    success: { main: '#1b7f68' },
    warning: { main: '#d19a46' },
    error: { main: '#be5e55' },
    background: { default: '#f3f5f3', paper: '#ffffff' },
    text: { primary: '#20302d', secondary: '#71807c' },
    divider: '#dfe5e2',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.03em' },
    button: { textTransform: 'none', fontWeight: 650 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
});
