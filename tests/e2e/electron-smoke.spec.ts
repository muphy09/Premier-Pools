import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

const workspaceRoot = path.resolve(__dirname, '..', '..');

test('launches Submerge with isolated data and validates the login screen', async ({}, testInfo) => {
  const appDataDirectory = testInfo.outputPath('app-data');
  const screenshotPath = testInfo.outputPath('submerge-login.png');
  const tracePath = testInfo.outputPath('trace.zip');
  mkdirSync(appDataDirectory, { recursive: true });

  const electronEnvironment = { ...process.env };
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  Object.assign(electronEnvironment, {
    APPDATA: appDataDirectory,
    LOCALAPPDATA: appDataDirectory,
    NODE_ENV: 'production',
    SUBMERGE_DATA_PARTITION: 'playwright-e2e',
  });

  let electronApp: ElectronApplication | null = null;
  let traceStarted = false;

  try {
    electronApp = await electron.launch({
      args: ['main.js'],
      cwd: workspaceRoot,
      env: electronEnvironment,
      timeout: 30_000,
    });

    const window = await electronApp.firstWindow();
    await window.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    traceStarted = true;

    await window.waitForLoadState('domcontentloaded');
    await expect(window).toHaveTitle('Submerge Proposal Builder');
    await expect(window.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await expect(window.getByLabel('Email')).toBeVisible();
    await expect(window.getByLabel('Password')).toBeVisible();
    await expect(window.getByLabel('Franchise Code')).toBeVisible();

    await window.getByRole('button', { name: 'Continue' }).click();
    await expect(window.getByText('Please enter your email.')).toBeVisible();

    await window.getByLabel('Email').fill('playwright@example.com');
    await window.getByRole('button', { name: 'Continue' }).click();
    await expect(window.getByText('Please enter your password.')).toBeVisible();

    await window.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('Submerge login screen', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } finally {
    if (electronApp && traceStarted) {
      await electronApp.context().tracing.stop({ path: tracePath }).catch(() => undefined);
      await testInfo.attach('Playwright trace', {
        path: tracePath,
        contentType: 'application/zip',
      }).catch(() => undefined);
    }
    await electronApp?.close().catch(() => undefined);
  }
});
