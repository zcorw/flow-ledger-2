import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#176c5a', dark: '#145c4d', light: '#e7f4f0' },
    secondary: { main: '#397c93' },
    success: { main: '#1b7f68' },
    warning: { main: '#94631f' },
    error: { main: '#a44740' },
    background: { default: '#f3f5f3', paper: '#ffffff' },
    text: { primary: '#20302d', secondary: '#62736e' },
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
    MuiButtonBase: {
      styleOverrides: {
        root: {
          '&:focus-visible': {
            outline: '3px solid #397c93',
            outlineOffset: 2,
          },
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            scrollBehavior: 'auto !important',
            transitionDuration: '0.01ms !important',
          },
        },
      },
    },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
});
