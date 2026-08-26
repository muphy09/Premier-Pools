import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/tile-coping-decking-price-impact.html';

test('shows complete Price Impact for active Tile, Coping, and Decking controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1360, height: 960 });
  await page.goto(fixtureUrl);

  const expectedControls = [
    'Tile Option',
    'Additional Tile Length',
    'Trim Tile on Steps & Bench',
    'Coping Type',
    'Coping Size',
    'Bullnose',
    'Spillway Length',
    'Decking Type',
    'Additional Decking',
    'Additional Decking SQFT',
    'Additional Decking Off-Contract',
    'Concrete Steps Length',
    'Rough Grading',
    'Tile Accent Option',
  ];
  for (const control of expectedControls) {
    await expect(
      page.getByRole('button', { name: `Show Price Impact for ${control}`, exact: true })
    ).toHaveCount(1);
  }

  const tileField = page.locator('.spec-field').filter({ hasText: 'Tile Option' }).first();
  const tileEndcap = tileField.locator('.compact-input-endcap');
  await expect(tileEndcap).toBeVisible();
  expect(
    await tileEndcap.locator('.price-impact-trigger-wrap').evaluate(
      (element) => getComputedStyle(element).borderLeftWidth
    )
  ).not.toBe('0px');
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);

  await page.getByRole('button', { name: 'Show Price Impact for Tile Option' }).click();
  const tileDialog = page.getByRole('dialog', { name: 'Price Impact for Tile Option' });
  await expect(tileDialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  await expect(tileDialog).toContainText('Pool Tile Material Upgrade');
  await expect(tileDialog).toContainText('Tile Material Tax');
  await expect(tileDialog).toContainText('Compared with Level 1 base tile');
  await expect(tileDialog.locator('.price-impact-line .is-negative')).toHaveCount(0);
  await expect(tileDialog.getByText('Overhead', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Additional Decking Off-Contract' }).click();
  const offContractDialog = page.getByRole('dialog', {
    name: 'Price Impact for Additional Decking Off-Contract',
  });
  await expect(offContractDialog).toContainText('Off-Contract Retail Price');
  await expect(offContractDialog).toContainText('included in the contract');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Rough Grading' }).click();
  const gradingDialog = page.getByRole('dialog', { name: 'Price Impact for Rough Grading' });
  await expect(gradingDialog).toContainText('Rough Grading');
  await expect(gradingDialog.getByRole('heading', { name: 'Indirect Charges' })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Tile Accent Option' }).click();
  const customDialog = page.getByRole('dialog', { name: 'Price Impact for Tile Accent Option' });
  await expect(customDialog).toContainText('Tile Accent Option');

  const screenshotPath = testInfo.outputPath('tile-coping-decking-price-impact.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Tile Coping Decking Price Impact', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(4);
});

test('removes numeric Price Impact icons when values are cleared', async ({ page }) => {
  await page.goto(fixtureUrl);

  const tileLengthField = page.locator('.spec-field')
    .filter({ hasText: 'Additional Tile Length' })
    .first();
  await tileLengthField.getByRole('spinbutton').fill('0');
  await expect(
    tileLengthField.getByRole('button', { name: 'Show Price Impact for Additional Tile Length' })
  ).toHaveCount(0);

  const bullnoseField = page.locator('.spec-field').filter({ hasText: 'Bullnose' }).first();
  await bullnoseField.getByRole('spinbutton').fill('0');
  await expect(
    bullnoseField.getByRole('button', { name: 'Show Price Impact for Bullnose' })
  ).toHaveCount(0);
});

test('hides all Tile, Coping, and Decking Price Impact icons when the feature is off', async ({ page }) => {
  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
});
