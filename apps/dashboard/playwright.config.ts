import { defineConfig } from '@playwright/test';

// Browser tests for the two surfaces the desk actually runs on: the development
// /test-ui/ entry, where the fixture chain and wallet live in the page, and a local
// production build, where the same fixtures are injected from the test process and the
// bundle contains no fixture code. 5174 is the worktree's development server; it is
// reused when it is already running. The preview server is this suite's own, on 5175.

const dev = 'http://127.0.0.1:5174';
const preview = 'http://127.0.0.1:5175';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 2 : 4,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'dev', testMatch: /\.dev\.spec\.ts$/, use: { baseURL: dev } },
    { name: 'build', testMatch: /\.build\.spec\.ts$/, use: { baseURL: preview } },
  ],
  webServer: [
    { command: 'pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort', url: `${dev}/test-ui/`, reuseExistingServer: true, timeout: 60_000 },
    { command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 5175 --strictPort', url: preview, reuseExistingServer: false, timeout: 180_000 },
  ],
});
