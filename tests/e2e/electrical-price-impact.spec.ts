import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/electrical-price-impact.html';

test('shows complete Price Impact for every active Gas and Electrical control', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(fixtureUrl);

  const expectedControls = [
    'Gas Run',
    'Main Electrical Run',
    'Light Run',
    'Heat Pump Electrical Run',
    'Fixture Electrical Option',
  ];
  for (const control of expectedControls) {
    await expect(
      page.getByRole('button', { name: `Show Price Impact for ${control}` })
    ).toHaveCount(1);
  }

  const gasField = page.locator('.spec-field').filter({ hasText: 'Gas Run' }).first();
  const gasEndcap = gasField.locator('.compact-input-endcap');
  await expect(gasEndcap).toContainText('LNFT');
  expect(
    await gasEndcap.locator('.price-impact-trigger-wrap').evaluate(
      (element) => getComputedStyle(element).borderLeftWidth
    )
  ).not.toBe('0px');
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);

  await page.getByRole('button', { name: 'Show Price Impact for Gas Run' }).click();
  const gasDialog = page.getByRole('dialog', { name: 'Price Impact for Gas Run' });
  await expect(gasDialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  await expect(gasDialog).toContainText('Base Gas Setup');
  await expect(gasDialog).toContainText('Gas Run Overage');
  await expect(gasDialog).toContainText('Up to 25 LNFT Included');
  await expect(gasDialog.getByRole('heading', { name: 'Indirect Charges' })).toBeVisible();
  await expect(gasDialog).toContainText('Long Gas Run Plumbing');
  await expect(gasDialog.getByText('Overhead', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Main Electrical Run' }).click();
  const mainDialog = page.getByRole('dialog', { name: 'Price Impact for Main Electrical Run' });
  await expect(mainDialog).toContainText('Main Electrical Run Overage');
  await expect(mainDialog).toContainText('Up to 65 LNFT Included');
  await expect(mainDialog).toContainText('Main Electrical Plumbing Conduit');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Light Run' }).click();
  const lightDialog = page.getByRole('dialog', { name: 'Price Impact for Light Run' });
  await expect(lightDialog).toContainText('Light Run Plumbing Conduit');
  await expect(lightDialog).not.toContainText('Additional Light Electrical');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Heat Pump Electrical Run' }).click();
  const heatPumpDialog = page.getByRole('dialog', { name: 'Price Impact for Heat Pump Electrical Run' });
  await expect(heatPumpDialog).toContainText('Heat Pump Electrical Setup');
  await expect(heatPumpDialog).toContainText('Heat Pump Electrical Run Overage');
  await expect(heatPumpDialog).toContainText('Up to 40 LNFT Included');

  const screenshotPath = testInfo.outputPath('gas-electrical-price-impact.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Gas and Electrical Price Impact', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await page.keyboard.press('Escape');
  await page.getByRole('button', {
    name: 'Show Price Impact for Fixture Electrical Option',
  }).click();
  const customDialog = page.getByRole('dialog', {
    name: 'Price Impact for Fixture Electrical Option',
  });
  await expect(customDialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  await expect(customDialog).toContainText('Fixture Electrical Option');

  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(5);
});

test('removes a Gas or Electrical icon as soon as its value is cleared', async ({ page }) => {
  await page.goto(fixtureUrl);

  const gasField = page.locator('.spec-field').filter({ hasText: 'Gas Run' }).first();
  await gasField.getByRole('spinbutton').fill('0');
  await expect(
    gasField.getByRole('button', { name: 'Show Price Impact for Gas Run' })
  ).toHaveCount(0);

  const mainElectricalField = page.locator('.spec-field')
    .filter({ hasText: 'Main Electrical Run' })
    .first();
  await mainElectricalField.getByRole('spinbutton').fill('0');
  await expect(
    mainElectricalField.getByRole('button', { name: 'Show Price Impact for Main Electrical Run' })
  ).toHaveCount(0);
});

test('hides all Gas and Electrical Price Impact icons when the feature is off', async ({ page }) => {
  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
});
