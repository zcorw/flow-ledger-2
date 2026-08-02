import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { theme } from './theme';

describe('App', () => {
  it('renders the foundation status', () => {
    render(<ThemeProvider theme={theme}><App /></ThemeProvider>);
    expect(screen.getByRole('heading', { name: '工程骨架已就绪' })).toBeInTheDocument();
    expect(screen.getByText('T001 Foundation')).toBeInTheDocument();
  });
});
