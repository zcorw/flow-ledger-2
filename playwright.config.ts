import { defineConfig, devices } from '@playwright/test';

const python = process.platform === 'win32' ? '..\\.venv\\Scripts\\python.exe' : 'python';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `${python} e2e_server.py`,
      cwd: './backend',
      url: 'http://127.0.0.1:8001/api/v1/system/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm dev --host 127.0.0.1 --port 4173',
      cwd: './frontend',
      env: { VITE_BACKEND_PROXY_TARGET: 'http://127.0.0.1:8001' },
      url: 'http://127.0.0.1:4173/setup',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
