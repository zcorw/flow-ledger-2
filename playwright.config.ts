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
    baseURL: 'http://127.0.0.1:4186',
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
      url: 'http://127.0.0.1:8016/api/v1/system/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview --host 127.0.0.1 --port 4186 --strictPort',
      cwd: './frontend',
      env: { VITE_BACKEND_PROXY_TARGET: 'http://127.0.0.1:8016' },
      url: 'http://127.0.0.1:4186/setup',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
