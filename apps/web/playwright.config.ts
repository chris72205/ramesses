import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests. The global setup boots the real backend against the test
 * database plus a fake warrior; Playwright starts the Vite dev server pointed at it.
 */
const BACKEND_PORT = 3100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: false,
    env: { VITE_BACKEND_URL: `http://localhost:${BACKEND_PORT}` },
  },
});

export { BACKEND_PORT, WEB_PORT };
