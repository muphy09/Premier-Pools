import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { build } from 'vite';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const rendererDirectory = path.join(workspaceRoot, 'test-results', 'cloud-connection-renderer');
const cloudOrigin = 'https://submerge-playwright.supabase.co';

test.beforeAll(async () => {
  // Build the real app against a fake, intercepted endpoint. The normal UI test
  // bundle keeps cloud disabled; neither bundle uses production credentials.
  await build({
    mode: 'test',
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(cloudOrigin),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('playwright-anon-key'),
    },
    build: { outDir: rendererDirectory },
  });
});

type CloudFixture = {
  page: Page;
  cloud: { available: boolean; slow: boolean; healthCalls: number; loginCalls: number; loginUnavailable: boolean };
};

const connectionTest = test.extend<CloudFixture>({
  cloud: async ({}, use) => {
    await use({ available: false, slow: false, healthCalls: 0, loginCalls: 0, loginUnavailable: false });
  },
  page: async ({ cloud }, use, testInfo) => {
    const appDataDirectory = testInfo.outputPath('app-data');
    mkdirSync(appDataDirectory, { recursive: true });
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    Object.assign(env, {
      APPDATA: appDataDirectory,
      LOCALAPPDATA: appDataDirectory,
      NODE_ENV: 'production',
      SUBMERGE_DATA_PARTITION: 'playwright-e2e-cloud',
      SUBMERGE_TEST_USER_DATA_ROOT: appDataDirectory,
      VITE_SUPABASE_URL: cloudOrigin,
      VITE_SUPABASE_ANON_KEY: 'playwright-anon-key',
    });
    // Serve actual HTTP responses locally. Electron 29 and CDP fulfillment can
    // expose mocked responses with status 0, which does not model a real server.
    const server = createServer(async (request, response) => {
      const url = new URL(request.url || '/', cloudOrigin);
      response.setHeader('content-type', 'application/json');
      response.setHeader('access-control-allow-origin', '*');
      if (url.pathname === '/auth/v1/health' || url.pathname === '/auth/v1/settings') {
        cloud.healthCalls += 1;
        if (cloud.slow) await new Promise((resolve) => setTimeout(resolve, 400));
        if (!cloud.available) { request.destroy(); return; }
        response.end('{}');
      } else if (url.pathname === '/auth/v1/token') {
        cloud.loginCalls += 1;
        response.statusCode = cloud.loginUnavailable ? 503 : 400;
        response.end(cloud.loginUnavailable ? '{}' : JSON.stringify({
          code: 'invalid_credentials', msg: 'Invalid login credentials',
        }));
      } else {
        response.end('[]');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const localOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let app: ElectronApplication | undefined;
    try {
      app = await electron.launch({ args: ['main.js', '--no-sandbox'], cwd: workspaceRoot, env });
      const page = await app.firstWindow();
      await page.waitForLoadState('domcontentloaded');
      const context = app.context();
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await app.evaluate(({ session }, { cloudOrigin, localOrigin }) => {
        session.defaultSession.protocol.handle('https', async (request) => {
          const url = new URL(request.url);
          if (url.origin !== cloudOrigin) return Response.error();
          try {
            return await fetch(`${localOrigin}${url.pathname}${url.search}`, {
              method: request.method,
              headers: request.headers,
              ...(request.method === 'POST' ? { body: await request.text() } : {}),
            });
          } catch {
            return Response.error();
          }
        });
      }, { cloudOrigin, localOrigin });
      await page.goto(pathToFileURL(path.join(rendererDirectory, 'index.html')).href);
      await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
      await expect(page.locator('.login-modal')).not.toContainText(/submerge/i);
      expect(await page.evaluate(() => navigator.onLine)).toBe(true);
      await use(page);
    } finally {
      if (app) {
        const tracePath = testInfo.outputPath('trace.zip');
        await app.context().tracing.stop({ path: tracePath });
        await testInfo.attach('Electron connection trace', { path: tracePath, contentType: 'application/zip' });
        await app.close();
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
});

connectionTest('manual retry recovers without restarting or losing login inputs', async ({ page, cloud }, testInfo) => {
  await page.getByLabel('Email').fill('connection@playwright.invalid');
  await page.getByLabel('Password').fill('fixture-password');
  await page.getByLabel('Franchise Code').fill('PWTEST');

  cloud.slow = true;
  const beforeRetry = cloud.healthCalls;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
  expect(cloud.healthCalls).toBeGreaterThan(beforeRetry);

  const screenshotPath = testInfo.outputPath('connection-retry.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Recoverable sign-in connection warning', { path: screenshotPath, contentType: 'image/png' });

  cloud.available = true;
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('.login-connection-notice')).toHaveCount(0);
  await expect(page.getByLabel('Email')).toHaveValue('connection@playwright.invalid');
  await expect(page.getByLabel('Password')).toHaveValue('fixture-password');
  await expect(page.getByLabel('Franchise Code')).toHaveValue('PWTEST');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  expect(cloud.loginCalls).toBe(0);

  const diagnostics = await page.evaluate(() => JSON.parse(localStorage.getItem('submerge-cloud-diagnostics') || '[]'));
  expect(diagnostics.some((entry: any) => entry.outcome === 'network-error')).toBe(true);
  expect(diagnostics.at(-1).status).toBe(200);
  expect(JSON.stringify(diagnostics)).not.toMatch(/fixture-password|playwright-anon-key|connection@/);
});

connectionTest('automatically recovers while the network stays online', async ({ page, cloud }) => {
  cloud.available = true;
  await expect(page.locator('.login-connection-notice')).toHaveCount(0, { timeout: 8000 });
  expect(cloud.loginCalls).toBe(0);
});

connectionTest('checks immediately when returning to the app', async ({ page, cloud }) => {
  cloud.available = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.login-connection-notice')).toHaveCount(0, { timeout: 2500 });
});

connectionTest('failed health checks do not block authentication or turn network failures into login lockouts', async ({ page, cloud }) => {
  await page.getByLabel('Email').fill('connection@playwright.invalid');
  await page.getByLabel('Password').fill('fixture-password');
  cloud.loginUnavailable = true;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.locator('.login-error')).toHaveText('Unable to reach the sign-in service. Please try again in a moment.');
    await expect(page.locator('.login-modal')).not.toContainText(/submerge/i);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
    expect(cloud.loginCalls).toBe(attempt);
  }
  cloud.loginUnavailable = false;
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.login-error')).toHaveText('Invalid login credentials');
  expect(cloud.loginCalls).toBe(7);
  const attempts = await page.evaluate(() => localStorage.getItem('submerge-login-attempts:master:connection@playwright.invalid'));
  expect(JSON.parse(attempts!)).toHaveLength(1);
});

connectionTest('recovers from an actual offline transition without restarting', async ({ page, cloud }) => {
  await page.context().setOffline(true);
  await expect(page.getByRole('status')).toContainText('Connection appears offline');
  cloud.available = true;
  await page.context().setOffline(false);
  await expect(page.locator('.login-connection-notice')).toHaveCount(0);
});
