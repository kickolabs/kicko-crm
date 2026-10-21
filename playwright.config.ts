import { defineConfig, devices } from '@playwright/test';

// E2E runs against a production build on :3100 (built into apps/web/.next-e2e),
// so tests aren't slowed by dev-mode compiling and the build itself is verified.
// Needs the local DB: `npm run db:start`. Then `npm run e2e`.
// To test against a running dev server instead: E2E_BASE_URL=http://localhost:3000 npm run e2e
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: external ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: external
    ? undefined
    : {
        command: 'npm run e2e:serve --workspace @kicko/web',
        url: 'http://localhost:3100/login',
        reuseExistingServer: true,
        timeout: 300_000,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /console-sweep/ },
    // Runs after everything else, on a quiet server: under heavy parallel load a test can
    // leave a page before React finishes hydrating, which logs spurious hydration errors.
    { name: 'console-sweep', use: { ...devices['Desktop Chrome'] }, testMatch: /console-sweep/, dependencies: ['chromium'] },
  ],
});
