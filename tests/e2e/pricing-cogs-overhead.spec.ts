import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/pricing-cogs-overhead.html';

test('shows and edits the pricing revision COGS overhead rate', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(fixtureUrl);

  await expect(page.getByRole('heading', { name: 'Admin Pricing Model Editor' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manual Retail Price Adjustments' })).toBeVisible();

  const overheadField = page.locator('label.pricing-field').filter({ hasText: 'COGS Overhead' });
  const overheadInput = overheadField.locator('input');
  await expect(overheadField).toBeVisible();
  await expect(overheadInput).toHaveValue('1');

  await overheadInput.fill('2.5');
  await expect(overheadInput).toHaveValue('2.5');
  await expect.poll(() =>
    page.evaluate(() => (window as any).getCogsOverheadFixtureValue())
  ).toBe(0.025);

  const screenshotPath = testInfo.outputPath('pricing-cogs-overhead.png');
  await overheadField.screenshot({ path: screenshotPath });
  await testInfo.attach('COGS overhead pricing input', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});
