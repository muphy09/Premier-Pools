import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/water-features-price-impact.html';

test('uses one-column Equipment-style toggles for Water Features', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(fixtureUrl);

  const categories = page.locator('.water-feature-category-item');
  await expect(categories).toHaveCount(4);
  const firstBox = await categories.nth(0).boundingBox();
  const secondBox = await categories.nth(1).boundingBox();
  expect(firstBox).not.toBeNull();
  expect(secondBox).not.toBeNull();
  expect(Math.abs((firstBox?.x || 0) - (secondBox?.x || 0))).toBeLessThan(2);
  expect(Math.abs((firstBox?.width || 0) - (secondBox?.width || 0))).toBeLessThan(2);
  expect(secondBox?.y || 0).toBeGreaterThan((firstBox?.y || 0) + (firstBox?.height || 0));

  await expect(page.getByRole('switch', { name: 'Sheer Descents selection' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Wok Pots selection' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Jets selection' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Bubblers selection' })).not.toBeChecked();

  await page.getByRole('switch', { name: 'Jets selection' }).check();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Jets Valve Actuator' })).toBeChecked();
  await page.getByRole('switch', { name: 'Bubblers selection' }).check();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1);
  await expect(page.getByRole('switch', { name: 'Bubblers Valve Actuator' })).toBeChecked();

  const screenshotPath = testInfo.outputPath('water-features-modern-layout.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Water Features modern layout', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const customOptions = page.locator('.custom-options-block');
  await customOptions.getByRole('button', { name: 'Edit', exact: true }).click();
  const offContractSwitch = customOptions.getByRole('switch', { name: 'Off-contract' });
  await expect(offContractSwitch).toBeVisible();
  await expect(offContractSwitch.locator('xpath=ancestor::div[contains(@class,"spec-subcard-header")]'))
    .toHaveCount(1);
  await expect(customOptions.locator('.custom-option-off-contract-row')).toHaveCount(0);

  const customScreenshotPath = testInfo.outputPath('water-feature-custom-option-edit.png');
  await page.screenshot({ path: customScreenshotPath, fullPage: true });
  await testInfo.attach('Water Feature custom option edit', {
    path: customScreenshotPath,
    contentType: 'image/png',
  });
});

test('shows complete Price Impact and the 30-foot overage warning', async ({ page }, testInfo) => {
  await page.goto(fixtureUrl);

  const sheerCard = page.locator('.water-feature-category-item').filter({ hasText: 'Sheer Descents' });
  const collapsedHeader = sheerCard.locator('.spec-subcard-header');
  await expect(collapsedHeader.getByRole('button', {
    name: 'Show Price Impact for Fixture Sheer Descent',
    exact: true,
  })).toBeVisible();
  await collapsedHeader.getByRole('button', {
    name: 'Show Price Impact for Fixture Sheer Descent',
    exact: true,
  }).click();
  const collapsedDialog = page.getByRole('dialog', {
    name: 'Price Impact for Fixture Sheer Descent',
  });
  await expect(collapsedDialog).toContainText('Fixture Sheer Descent Equipment');
  await expect(collapsedDialog).toContainText('Water Feature Run Setup and Overage');
  await expect(collapsedDialog).toContainText('Linked Water Feature Plumbing');
  await expect(collapsedDialog).toContainText('Water Feature Valve Actuator');
  await page.keyboard.press('Escape');
  await sheerCard.getByRole('button', { name: 'Edit', exact: true }).click();

  const typeField = sheerCard.locator('.spec-field').filter({ hasText: 'Sheer Descent Type' });
  const quantityField = sheerCard.locator('.spec-field').filter({ hasText: 'Quantity' });
  const runField = sheerCard.locator('.spec-field').filter({ hasText: 'Water Feature and Conduit Run' });
  const warningText = '15 feet over 30 ft maximum. Additional charges apply.';
  const warning = runField.getByRole('button', { name: warningText, exact: true });
  await expect(warning).toBeVisible();
  await warning.hover();
  await expect(page.getByRole('tooltip')).toHaveText(warningText);

  await expect(
    typeField.getByRole('button', { name: 'Show Price Impact for Fixture Sheer Descent', exact: true })
  ).toBeVisible();
  await expect(collapsedHeader.getByRole('button', {
    name: 'Show Price Impact for Fixture Sheer Descent',
    exact: true,
  })).toHaveCount(0);
  await expect(
    runField.getByRole('button', { name: 'Show Price Impact for Fixture Sheer Descent Run' })
  ).toBeVisible();
  await expect(quantityField.getByRole('button', { name: /Show Price Impact/i })).toHaveCount(0);
  await expect(
    sheerCard.getByRole('button', { name: 'Show Price Impact for Sheer Descents Valve Actuator' })
  ).toBeVisible();

  await typeField.getByRole('button', {
    name: 'Show Price Impact for Fixture Sheer Descent',
    exact: true,
  }).click();
  const selectionDialog = page.getByRole('dialog', {
    name: 'Price Impact for Fixture Sheer Descent',
  });
  await expect(selectionDialog).toContainText('Fixture Sheer Descent Equipment');
  await expect(selectionDialog).toContainText('Equipment Tax');
  await expect(selectionDialog).toContainText('Water Feature Plans & Engineering');
  await expect(selectionDialog).toContainText('Water Feature Run Setup and Overage');
  await expect(selectionDialog).not.toContainText('Water Feature 2 Run Setup and Overage');
  await expect(selectionDialog).toContainText('Linked Water Feature Plumbing');
  await expect(selectionDialog.getByText('Overhead', { exact: true })).toHaveCount(0);

  const screenshotPath = testInfo.outputPath('water-feature-price-impact-popover.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Water Feature Price Impact popover', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await page.keyboard.press('Escape');
  await runField.getByRole('button', { name: 'Show Price Impact for Fixture Sheer Descent Run' }).click();
  const runDialog = page.getByRole('dialog', {
    name: 'Price Impact for Fixture Sheer Descent Run',
  });
  await expect(runDialog).toContainText('Water Feature Run 1 Setup');
  await expect(runDialog).toContainText('Water Feature Run 1 Overage');
  await expect(runDialog).toContainText('Up to 30 LNFT Included');
  await expect(runDialog).not.toContainText('Current unit impact');
  await expect(runDialog).not.toContainText('per LNFT');

  await page.keyboard.press('Escape');
  await runField.getByRole('spinbutton').fill('30');
  await expect(warning).toHaveCount(0);

  const wokCard = page.locator('.water-feature-category-item').filter({ hasText: 'Wok Pots' });
  await wokCard.getByRole('button', {
    name: 'Show Price Impact for Fixture Fire and Water Wok',
    exact: true,
  }).click();
  await expect(page.getByRole('dialog', {
    name: 'Price Impact for Fixture Fire and Water Wok',
  })).toContainText('Water Feature Gas Setup');
});

test('supports COGS and franchise or user Price Impact visibility', async ({ page }) => {
  await page.goto(`${fixtureUrl}?basis=cogs`);
  const sheerCard = page.locator('.water-feature-category-item').filter({ hasText: 'Sheer Descents' });
  await sheerCard.getByRole('button', {
    name: 'Show Price Impact for Fixture Sheer Descent',
    exact: true,
  }).click();
  await expect(page.getByRole('dialog', { name: 'Price Impact for Fixture Sheer Descent' }))
    .toContainText('COGS Amounts Shown');

  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Sheer Descents selection' })).toBeVisible();
});

test('keeps Water Feature cards and fields usable on a vertical display', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 });
  await page.goto(fixtureUrl);

  const firstCard = page.locator('.water-feature-category-item').first();
  const firstBox = await firstCard.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(firstBox?.width || 0).toBeLessThanOrEqual(528);
  await firstCard.getByRole('button', { name: 'Edit', exact: true }).click();
  const fields = firstCard.locator('.spec-grid-4-fixed > .spec-field');
  await expect(fields).toHaveCount(4);
  const firstFieldBox = await fields.nth(0).boundingBox();
  const secondFieldBox = await fields.nth(1).boundingBox();
  expect(secondFieldBox?.y || 0).toBeGreaterThan(firstFieldBox?.y || 0);
});
