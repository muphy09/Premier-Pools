import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import { getDefaultProposal } from '../../src/utils/proposalDefaults';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const sessionStorageKey = 'submerge-user-session';
const supabaseAuthStorageKey = 'sb-127-auth-token';
const createdDate = '2026-05-13T13:51:22.159Z';

const testSession = {
  userId: 'playwright-proposal-safety-user',
  userEmail: 'proposal-safety@playwright.invalid',
  userName: 'Playwright Designer',
  franchiseId: 'playwright-franchise',
  franchiseName: 'Playwright Franchise',
  franchiseCode: 'PWTEST',
  role: 'designer',
  isTestAccount: true,
  testAccountId: 'playwright-proposal-safety-account',
};

function encodeJwtPart(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function buildLocalSupabaseSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const accessToken = [
    encodeJwtPart({ alg: 'none', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: expiresAt,
      sub: testSession.userId,
      email: testSession.userEmail,
      role: 'authenticated',
    }),
    'playwright',
  ].join('.');

  return {
    access_token: accessToken,
    refresh_token: 'playwright-refresh-token',
    token_type: 'bearer',
    expires_in: 24 * 60 * 60,
    expires_at: expiresAt,
    user: {
      id: testSession.userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: testSession.userEmail,
      app_metadata: {},
      user_metadata: {},
      created_at: createdDate,
    },
  };
}

function buildLocalProposal(proposalNumber: string, customerName: string, invalidPinnedPricing = false) {
  const defaults = getDefaultProposal();
  return {
    ...defaults,
    proposalNumber,
    createdDate,
    lastModified: '2026-08-24T18:12:58.079Z',
    customerInfo: {
      ...defaults.customerInfo,
      customerName,
      city: 'Charlotte',
      state: 'NC',
    },
    franchiseId: testSession.franchiseId,
    designerName: testSession.userName,
    designerRole: testSession.role,
    designerCode: testSession.franchiseCode,
    status: 'draft',
    versionId: 'original',
    versionName: 'Original Version',
    isOriginalVersion: true,
    activeVersionId: 'original',
    versions: [],
    totalCost: 75_000,
    pricing: { retailPrice: 75_000 },
    ...(invalidPinnedPricing
      ? {
          pricingModelId: 'missing-old-pricing-model',
          pricingModelName: 'Missing Old Pricing Model',
          pricingModelFranchiseId: testSession.franchiseId,
          pricingModelRevisionId: 'missing-old-pricing-revision',
          pricingModelRevisionNumber: 1,
        }
      : {}),
  };
}

async function launchIsolatedApp(appDataDirectory: string) {
  mkdirSync(appDataDirectory, { recursive: true });
  const electronEnvironment = { ...process.env };
  delete electronEnvironment.ELECTRON_RUN_AS_NODE;
  Object.assign(electronEnvironment, {
    APPDATA: appDataDirectory,
    LOCALAPPDATA: appDataDirectory,
    NODE_ENV: 'production',
    SUBMERGE_DATA_PARTITION: 'playwright-e2e-proposal-safety',
    SUBMERGE_TEST_USER_DATA_ROOT: appDataDirectory,
  });

  const electronApp = await electron.launch({
    // The managed test environment cannot initialize Electron 29's Chromium
    // child-process sandbox. Production launches do not use this switch.
    args: ['main.js', '--no-sandbox'],
    cwd: workspaceRoot,
    env: electronEnvironment,
    timeout: 30_000,
  });
  const window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { electronApp, window };
}

async function seedSessionAndProposals(window: Page, proposals: unknown[]) {
  await window.evaluate(
    async ({ sessionKey, authKey, session, authSession, proposalFixtures }) => {
      localStorage.setItem(sessionKey, JSON.stringify(session));
      localStorage.setItem(authKey, JSON.stringify(authSession));
      for (const proposal of proposalFixtures) {
        await window.electron.saveProposal(proposal);
      }
    },
    {
      sessionKey: sessionStorageKey,
      authKey: supabaseAuthStorageKey,
      session: testSession,
      authSession: buildLocalSupabaseSession(),
      proposalFixtures: proposals,
    }
  );
}

test('locks a partially loaded existing proposal and preserves its local file', async ({}, testInfo) => {
  const proposalNumber = 'TEST-PWTEST-LOAD-GUARD';
  const original = buildLocalProposal(proposalNumber, 'Protected Existing Customer', true);
  let electronApp: ElectronApplication | null = null;

  try {
    const launched = await launchIsolatedApp(testInfo.outputPath('app-data'));
    electronApp = launched.electronApp;
    const window = launched.window;
    await seedSessionAndProposals(window, [original]);
    await window.context().setOffline(true);

    await window.evaluate((route) => {
      window.location.hash = route;
      window.location.reload();
    }, `/proposal/edit/${proposalNumber}`);

    await expect(window.getByTestId('proposal-load-safety-error')).toBeVisible({ timeout: 20_000 });
    await expect(window.getByRole('heading', { name: 'Proposal could not be opened safely' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Proposal Summary' })).toHaveCount(0);
    await window.waitForTimeout(1_800);

    const afterFailedLoad = await window.evaluate((number) => window.electron.getProposal(number), proposalNumber);
    expect(afterFailedLoad.customerInfo.customerName).toBe(original.customerInfo.customerName);
    expect(afterFailedLoad.createdDate).toBe(createdDate);
    expect(afterFailedLoad.totalCost).toBe(75_000);
    expect(afterFailedLoad.pricingModelRevisionId).toBe('missing-old-pricing-revision');

    const screenshotPath = testInfo.outputPath('proposal-load-protected.png');
    await window.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('Protected proposal load failure', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
});

test('still opens and saves a normal existing proposal without changing its identity', async ({}, testInfo) => {
  const proposalNumber = 'TEST-PWTEST-NORMAL-SAVE';
  const original = buildLocalProposal(proposalNumber, 'Normal Existing Customer');
  let electronApp: ElectronApplication | null = null;

  try {
    const launched = await launchIsolatedApp(testInfo.outputPath('app-data'));
    electronApp = launched.electronApp;
    const window = launched.window;
    await seedSessionAndProposals(window, [original]);
    await window.context().setOffline(true);

    await window.evaluate((route) => {
      window.location.hash = route;
      window.location.reload();
    }, `/proposal/edit/${proposalNumber}`);

    const customerNameInput = window.getByPlaceholder('Enter customer name');
    await expect(customerNameInput).toHaveValue('Normal Existing Customer', { timeout: 20_000 });
    await customerNameInput.fill('Normal Existing Customer Updated');
    await window.getByRole('button', { name: 'Proposal Summary' }).click();
    await expect(window).toHaveURL(new RegExp(`#\/proposal\/view\/${proposalNumber}$`), { timeout: 20_000 });

    const saved = await window.evaluate((number) => window.electron.getProposal(number), proposalNumber);
    expect(saved.customerInfo.customerName).toBe('Normal Existing Customer Updated');
    expect(saved.createdDate).toBe(createdDate);
    expect(saved.proposalNumber).toBe(proposalNumber);
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
});

test('creates and saves a new proposal version with its own creation date', async ({}, testInfo) => {
  const proposalNumber = 'TEST-PWTEST-NEW-VERSION';
  const original = buildLocalProposal(proposalNumber, 'Versioned Existing Customer');
  let electronApp: ElectronApplication | null = null;

  try {
    const launched = await launchIsolatedApp(testInfo.outputPath('app-data'));
    electronApp = launched.electronApp;
    const window = launched.window;
    await seedSessionAndProposals(window, [original]);
    await window.context().setOffline(true);

    await window.evaluate((route) => {
      window.location.hash = route;
      window.location.reload();
    }, `/proposal/view/${proposalNumber}`);

    await window.getByRole('button', { name: 'Build Another Version' }).click();
    const versionNameInput = window.getByLabel('Version Name');
    await expect(versionNameInput).toBeVisible({ timeout: 20_000 });
    await versionNameInput.fill('Safety Guard Regression Version');
    await window.getByRole('button', { name: 'Create', exact: true }).click();

    const versionNavigationItem = window.getByRole('button', {
      name: /Safety Guard Regression Version/,
    });
    await expect(versionNavigationItem).toBeVisible({ timeout: 20_000 });
    await versionNavigationItem.click();
    await window.getByRole('button', { name: 'Edit Proposal' }).click();

    const customerNameInput = window.getByPlaceholder('Enter customer name');
    await expect(customerNameInput).toHaveValue('Versioned Existing Customer', { timeout: 20_000 });
    await customerNameInput.fill('Versioned Existing Customer Updated');
    await window.getByRole('button', { name: 'Proposal Summary' }).click();
    await expect(window).toHaveURL(new RegExp(`#\/proposal\/view\/${proposalNumber}$`), { timeout: 20_000 });

    const saved = await window.evaluate((number) => window.electron.getProposal(number), proposalNumber);
    const allVersions = [saved, ...(saved.versions || [])];
    const createdVersion = allVersions.find(
      (version) => version.versionName === 'Safety Guard Regression Version'
    );
    expect(createdVersion).toBeTruthy();
    expect(createdVersion.customerInfo.customerName).toBe('Versioned Existing Customer Updated');
    expect(createdVersion.createdDate).not.toBe(createdDate);
    expect(allVersions.find((version) => version.versionId === 'original')?.createdDate).toBe(createdDate);
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
});
