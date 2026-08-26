import { expect, test, type Page } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/settings-price-impact.html';

async function mockFranchiseSetting(page: Page, enabled: boolean) {
  await page.route('**/rest/v1/franchise_configuration_assignments*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ current_revision_id: 'playwright-revision' }),
    });
  });
  await page.route('**/rest/v1/franchise_configuration_revisions*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'playwright-revision',
        franchise_id: 'playwright-franchise',
        revision_number: 1,
        schema_version: 1,
        configuration_json: {
          themeProfile: 'default',
          proposalLayout: 'standard',
          locationInputMode: 'state',
          contractResolutionMode: 'state_and_pool_type',
          capabilities: { priceImpact: enabled },
        },
        published_at: null,
        published_by: null,
      }),
    });
  });
}

test('defaults user Price Impact settings to enabled with Retail Cost selected', async ({ page }, testInfo) => {
  await mockFranchiseSetting(page, true);
  await page.goto(fixtureUrl);

  const enableSwitch = page.getByRole('switch', { name: 'Enable Price Impact' });
  const basisSwitch = page.getByRole('switch', { name: 'Price Impact cost basis' });
  await expect(enableSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(basisSwitch).toBeEnabled();
  await expect(basisSwitch).toHaveAttribute('aria-checked', 'false');

  await basisSwitch.click();
  await expect(basisSwitch).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Price Impact cost basis' }))
    .toHaveAttribute('aria-checked', 'true');

  const screenshotPath = testInfo.outputPath('user-price-impact-settings.png');
  await page.locator('.settings-price-impact-card').screenshot({ path: screenshotPath });
  await testInfo.attach('User Price Impact settings', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});

test('disabling Price Impact for a user also disables the cost-basis control', async ({ page }) => {
  await mockFranchiseSetting(page, true);
  await page.goto(fixtureUrl);

  const enableSwitch = page.getByRole('switch', { name: 'Enable Price Impact' });
  await enableSwitch.click();
  await expect(enableSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('switch', { name: 'Price Impact cost basis' })).toBeDisabled();
});

test('greys out user controls and explains when the franchise disables Price Impact', async ({ page }) => {
  await mockFranchiseSetting(page, false);
  await page.goto(`${fixtureUrl}?franchise=off`);

  await expect(page.getByRole('switch', { name: 'Enable Price Impact' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Price Impact cost basis' })).toBeDisabled();
  await page.locator('.settings-price-impact-tooltip').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Price Impact is disabled for your franchise');
});
