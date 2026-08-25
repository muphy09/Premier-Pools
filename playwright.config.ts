import { defineConfig } from '@playwright/test';

const isElectronOnlyRun = process.env.SUBMERGE_ELECTRON_UI_ONLY === '1';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/playwright',
  webServer: isElectronOnlyRun
    ? undefined
    : {
        command: 'npm run dev:react -- --host 127.0.0.1',
        url: 'http://127.0.0.1:5173/tests/fixtures/custom-off-contract-controls.html',
        reuseExistingServer: true,
        timeout: 30_000,
      },
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
