import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/dashboard-pricing-model-load.html';

test('does not show a false pricing-model status while the dashboard directory loads', async ({ page }, testInfo) => {
  await page.goto(fixtureUrl);

  await expect.poll(() => page.evaluate(() => window.pricingModelRequestStarted)).toBe(true);

  const pricingModelPill = page.locator('.dashboard-model-pill', { hasText: 'Current 2026' });
  await expect(pricingModelPill).toHaveClass(/\bis-loading\b/);
  await expect(pricingModelPill).toHaveAttribute('aria-busy', 'true');
  await expect(pricingModelPill).not.toHaveClass(/\bis-inactive\b|\bis-removed\b/);
  await testInfo.attach('Dashboard pricing model loading state', {
    body: await page.locator('.dashboard-proposals-table').screenshot(),
    contentType: 'image/png',
  });

  await page.evaluate(() => window.resolvePricingModels());

  await expect(pricingModelPill).toHaveClass(/\bis-active\b/);
  await expect(pricingModelPill).not.toHaveAttribute('aria-busy', 'true');
});
