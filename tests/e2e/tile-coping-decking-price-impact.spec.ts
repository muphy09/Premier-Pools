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
  await page.getByRole('button', { name: 'Show Price Impact for Decking Type' }).click();
  const deckingDialog = page.getByRole('dialog', { name: 'Price Impact for Decking Type' });
  await expect(deckingDialog.getByText('Concrete Decking Material', { exact: true })).toHaveCount(1);
  await expect(deckingDialog.getByText('Concrete Decking - Base', { exact: true })).toHaveCount(0);
  await expect(deckingDialog.getByText('Concrete Decking - Additional', { exact: true })).toHaveCount(0);

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
  ).toBe(5);
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

test('places the primary Decking off-contract switch above the header rule', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.goto(fixtureUrl);

  const deckingBlock = page
    .getByRole('heading', { name: 'Decking', exact: true })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " spec-block ")][1]');
  const offContractSwitch = deckingBlock.getByRole('switch', {
    name: 'Mark as Off-Contract',
    exact: true,
  });
  const headerRule = deckingBlock.locator('.decking-block-header__rule');

  await expect(offContractSwitch).toBeVisible();
  await expect(offContractSwitch).not.toBeChecked();
  await expect(headerRule).toBeVisible();

  const headingBox = await deckingBlock.getByRole('heading', { name: 'Decking', exact: true }).boundingBox();
  const switchBox = await offContractSwitch.boundingBox();
  const ruleBox = await headerRule.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(switchBox).not.toBeNull();
  expect(ruleBox).not.toBeNull();
  expect(headingBox!.y + headingBox!.height).toBeLessThan(ruleBox!.y);
  expect(switchBox!.y + switchBox!.height).toBeLessThanOrEqual(ruleBox!.y);

  await offContractSwitch.click();
  await expect(offContractSwitch).toBeChecked();
  await expect(
    deckingBlock.getByRole('button', { name: 'Show Price Impact for Primary Decking Off-Contract' })
  ).toBeVisible();

  await deckingBlock
    .getByRole('button', { name: 'Show Price Impact for Primary Decking Off-Contract' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Price Impact for Primary Decking Off-Contract' });
  await expect(dialog.locator('.price-impact-line')).toHaveCount(1);
  await expect(dialog.getByText('Off-Contract Retail Price', { exact: true })).toBeVisible();
  await expect(dialog.locator('.price-impact-line .is-negative')).toHaveCount(0);
  await expect(dialog).not.toContainText('Decking Labor');
  await expect(dialog).not.toContainText('Decking Material');
  await expect(dialog).not.toContainText('Decking Material Tax');
  await expect(dialog).toContainText('Compared with no primary decking');
});

test('uses an Equipment-style toggle for the Rough Grading additional option', async ({ page }) => {
  await page.goto(fixtureUrl);

  await expect(page.getByRole('heading', { name: 'Additional Options', exact: true })).toBeVisible();
  await expect(page.getByText('Enable or Disable Rough Grading', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rough Grading', exact: true })).toHaveCount(0);

  const roughGradingToggle = page.getByRole('switch', { name: 'Rough Grading', exact: true });
  await expect(roughGradingToggle).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Show Price Impact for Rough Grading', exact: true })
  ).toHaveCount(1);

  await roughGradingToggle.click();
  await expect(roughGradingToggle).not.toBeChecked();
  await expect(page.getByText('Disabled', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show Price Impact for Rough Grading', exact: true })
  ).toHaveCount(0);

  await roughGradingToggle.click();
  await expect(roughGradingToggle).toBeChecked();
  await expect(page.getByText('Enabled', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 500, height: 900 });
  const narrowLayout = await page.locator('.tile-additional-option-card').evaluate((card) => {
    const copy = card.querySelector<HTMLElement>('.tile-additional-option-copy');
    const actions = card.querySelector<HTMLElement>('.tile-additional-option-actions');
    return {
      copyTop: copy?.offsetTop ?? 0,
      actionsTop: actions?.offsetTop ?? 0,
      hasHorizontalOverflow: card.scrollWidth > card.clientWidth,
    };
  });
  expect(narrowLayout.actionsTop).toBeGreaterThan(narrowLayout.copyTop);
  expect(narrowLayout.hasHorizontalOverflow).toBe(false);
});

test('hides all Tile, Coping, and Decking Price Impact icons when the feature is off', async ({ page }) => {
  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
});
