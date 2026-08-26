import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/price-impact.html';
const plumbingFixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/plumbing-price-impact.html';

test('shows the complete Additional Pump price impact on demand', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixtureUrl);

  const trigger = page.getByRole('button', {
    name: 'Show Price Impact for Additional Pump 1',
  }).first();
  const pumpCard = trigger.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " spec-subcard ")][1]'
  );

  await expect(pumpCard).toBeVisible();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('dialog', { name: 'Price Impact for Additional Pump 1' })).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);

  await trigger.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Price Impact');

  // The first render must be positioned synchronously. Keeping animation frames
  // pending reproduces the old one-frame flash at viewport coordinate 0,0.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => undefined;
  });

  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Price Impact for Additional Pump 1' });
  await expect(dialog).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Indirect Charges' })).toBeVisible();
  await expect(dialog).toContainText('Pump Equipment');
  await expect(dialog).toContainText('$1,782.00');
  await expect(dialog).toContainText('Equipment Tax');
  await expect(dialog).toContainText('$147.02');
  await expect(dialog).toContainText('Additional Pump Setup');
  await expect(dialog).toContainText('Second Main Drain Plumbing Run');
  await expect(dialog).toContainText('Interior Finish Fittings');
  await expect(dialog.getByText('Overhead', { exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('Estimated customer price change');
  await expect(dialog).toContainText('+~$4,350');
  await expect(dialog).toContainText('Retail Amounts Shown.');
  await expect(dialog).toContainText('Calculated using this proposal version and pricing model.');
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(1);

  const triggerBox = await trigger.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(triggerBox!.width).toBeGreaterThanOrEqual(32);
  expect(triggerBox!.height).toBeGreaterThanOrEqual(32);
  expect(dialogBox!.x).toBeGreaterThan(100);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(1440);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(1000);

  const screenshotPath = testInfo.outputPath('additional-pump-price-impact.png');
  await dialog.screenshot({ path: screenshotPath });
  await testInfo.attach('Additional Pump Price Impact', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Price Impact for Additional Pump 1' })).toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(1);
});

test('offers Price Impact across editable Equipment selections', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixtureUrl);

  const expectedControls = [
    'Main Pump',
    'Additional Pump 1',
    'Blower 1',
    'Main Filter',
    'Additional Filter 1',
    'Cleaner',
    'Main Heater',
    'Additional Heater 1',
    'Heater Chiller',
    'Pool Light 1',
    'Additional Pool Light 1',
    'Automation System',
    'Sanitation System',
    'Additional Sanitation Option',
    'Auto-fill System',
    'Fixture Equipment Option',
  ];

  for (const control of expectedControls) {
    await expect(
      page.getByRole('button', { name: `Show Price Impact for ${control}` })
    ).toHaveCount(1);
  }
});

test('shows COGS amounts when the user selects the COGS basis', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${fixtureUrl}?basis=cogs`);

  await page.getByRole('button', {
    name: 'Show Price Impact for Additional Pump 1',
  }).first().click();

  const dialog = page.getByRole('dialog', { name: 'Price Impact for Additional Pump 1' });
  await expect(dialog).toContainText('$1,247.40');
  await expect(dialog).toContainText('+~$3,075');
  await expect(dialog).toContainText('COGS Amounts Shown.');
  await expect(dialog).not.toContainText('Retail Amounts Shown.');
});

test('shows complete Price Impact on every active Plumbing selection', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(plumbingFixtureUrl);

  const expectedControls = [
    'Total Skimmer Run',
    'Main Drain Run',
    'Spa Run',
    'Extra Skimmers',
    'Fixture Plumbing Option',
  ];
  for (const control of expectedControls) {
    await expect(
      page.getByRole('button', { name: `Show Price Impact for ${control}` })
    ).toHaveCount(1);
  }

  const mainDrainTrigger = page.getByRole('button', {
    name: 'Show Price Impact for Main Drain Run',
  });
  const mainDrainField = page.locator('.spec-field').filter({ hasText: 'Main Drain Run' }).first();
  await expect(mainDrainField).toContainText('Main drain to equipment');
  await expect(mainDrainField.getByRole('spinbutton')).toHaveValue('50');
  await expect(mainDrainTrigger).toBeVisible();
  const mainDrainEndcap = mainDrainField.locator('.plumbing-input-endcap');
  await expect(mainDrainEndcap).toContainText('LNFT');
  await expect(mainDrainEndcap.getByRole('button', {
    name: 'Show Price Impact for Main Drain Run',
  })).toHaveCount(1);
  expect(
    await mainDrainEndcap.locator('.price-impact-trigger-wrap').evaluate(
      (element) => getComputedStyle(element).borderLeftWidth
    )
  ).not.toBe('0px');

  const corePlumbingBlock = page.getByRole('heading', { name: 'Core Plumbing' }).locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " spec-block ")][1]'
  );
  const corePlumbingFields = corePlumbingBlock.locator(':scope > .spec-grid > .spec-field');
  await expect(corePlumbingFields).toHaveCount(4);
  await expect(corePlumbingBlock.getByRole('heading', { name: 'Additional Skimmers' })).toHaveCount(0);
  const extraSkimmersField = corePlumbingFields.filter({ hasText: 'Extra Skimmers' });
  await expect(extraSkimmersField).toContainText('1 Skimmer is included');
  await expect(extraSkimmersField.locator('.info-pill')).toHaveCount(0);
  const desktopFieldTops = await corePlumbingFields.evaluateAll((fields) =>
    fields.map((field) => Math.round(field.getBoundingClientRect().top))
  );
  expect(new Set(desktopFieldTops).size).toBe(1);
  const controlsScreenshotPath = testInfo.outputPath('plumbing-price-impact-icons.png');
  await corePlumbingBlock.screenshot({ path: controlsScreenshotPath });
  await testInfo.attach('Plumbing Price Impact icons', {
    path: controlsScreenshotPath,
    contentType: 'image/png',
  });

  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);
  await mainDrainTrigger.click();

  const dialog = page.getByRole('dialog', { name: 'Price Impact for Main Drain Run' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  await expect(dialog).toContainText('2.5" Plumbing');
  await expect(dialog.getByRole('heading', { name: 'Current unit impact' })).toHaveCount(0);
  await expect(dialog).toContainText('Estimated customer price change');
  await expect(dialog).toContainText('Current 50 LNFT compared with 0 LNFT.');
  await expect(dialog).toContainText('Retail Amounts Shown.');
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(1);

  const screenshotPath = testInfo.outputPath('plumbing-main-drain-price-impact.png');
  await dialog.screenshot({ path: screenshotPath });
  await testInfo.attach('Main Drain Price Impact', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Spa Run' }).click();
  const spaDialog = page.getByRole('dialog', { name: 'Price Impact for Spa Run' });
  await expect(spaDialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  await expect(spaDialog).toContainText('Spa Run Overage');
  await expect(spaDialog).toContainText('Up to 30 LNFT Included');
  await expect(spaDialog.getByRole('heading', { name: 'Current unit impact' })).toHaveCount(0);
});

test('removes a Plumbing icon as soon as its input is cleared', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(plumbingFixtureUrl);

  const skimmerField = page.locator('.spec-field').filter({ hasText: 'Total Skimmer Run' }).first();
  const trigger = skimmerField.getByRole('button', {
    name: 'Show Price Impact for Total Skimmer Run',
  });
  await expect(trigger).toBeVisible();

  const input = skimmerField.getByRole('spinbutton');
  await input.fill('0');
  await expect(trigger).toHaveCount(0);
});

test('wraps the four Core Plumbing inputs for vertical displays', async ({ page }) => {
  const getCoreFieldRows = () => page
    .getByRole('heading', { name: 'Core Plumbing' })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " spec-block ")][1]')
    .locator(':scope > .spec-grid > .spec-field')
    .evaluateAll((fields) => new Set(
      fields.map((field) => Math.round(field.getBoundingClientRect().top))
    ).size);

  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto(plumbingFixtureUrl);
  await expect.poll(getCoreFieldRows).toBe(2);

  await page.setViewportSize({ width: 600, height: 1000 });
  await expect.poll(getCoreFieldRows).toBe(4);
});

test('hides every Plumbing Price Impact icon when the franchise setting is off', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${plumbingFixtureUrl}?priceImpact=off`);

  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);
});

test('places Price Impact on fixed-package contents instead of the package summary', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${fixtureUrl}?package=fixed`);

  await expect(page.getByText("What's included", { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Show Price Impact for Equipment Package' })
  ).toHaveCount(0);

  const packageCardControls = [
    'Main Pump',
    'Main Filter',
    'Cleaner',
    'Main Heater',
    'Pool Light 1',
    'Automation System',
    'Sanitation System',
    'Auto-fill System',
  ];

  for (const control of packageCardControls) {
    const trigger = page.getByRole('button', { name: `Show Price Impact for ${control}` });
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();

    const card = trigger.locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " spec-subcard ")][1]'
    );
    const triggerBox = await trigger.boundingBox();
    const cardBox = await card.boundingBox();
    expect(triggerBox, `${control} trigger should have a visible position.`).not.toBeNull();
    expect(cardBox, `${control} should live inside its selected item card.`).not.toBeNull();
    expect(triggerBox!.x).toBeGreaterThan(cardBox!.x + cardBox!.width / 2);
    expect(triggerBox!.y).toBeLessThan(cardBox!.y + 80);
  }

  const additionalSanitationTrigger = page.getByRole('button', {
    name: 'Show Price Impact for Additional Sanitation Option',
  });
  await expect(additionalSanitationTrigger).toHaveCount(1);
  await expect(additionalSanitationTrigger).toBeVisible();
  const additionalSanitationBlock = additionalSanitationTrigger.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " spec-block ")][1]'
  );
  const additionalTriggerBox = await additionalSanitationTrigger.boundingBox();
  const additionalBlockBox = await additionalSanitationBlock.boundingBox();
  expect(additionalTriggerBox).not.toBeNull();
  expect(additionalBlockBox).not.toBeNull();
  expect(additionalTriggerBox!.x).toBeGreaterThan(additionalBlockBox!.x + additionalBlockBox!.width / 2);
  expect(additionalTriggerBox!.y).toBeLessThan(additionalBlockBox!.y + 80);

  const mainPumpTrigger = page.getByRole('button', { name: 'Show Price Impact for Main Pump' });
  await mainPumpTrigger.click();
  const mainPumpDialog = page.getByRole('dialog', { name: 'Price Impact for Main Pump' });
  await expect(mainPumpDialog).toBeVisible();
  await expect(mainPumpDialog).toContainText('included in Fixture Fixed Equipment Package');
  await expect(mainPumpDialog.locator('.is-negative')).toHaveCount(0);

  const screenshotPath = testInfo.outputPath('fixed-package-item-price-impact-icons.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Fixed package item Price Impact icons', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});

test('hides every Price Impact icon when the franchise setting is off', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${fixtureUrl}?priceImpact=off`);

  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);
});

test('renders the modern package picker and keeps repeated custom items separate', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto(fixtureUrl);

  await expect(page.getByRole('heading', { name: 'Package Options' })).toBeVisible();
  await expect(page.getByText('Choose the equipment package that best fits this project.')).toBeVisible();
  await expect(page.getByText('Fixed bundle', { exact: true })).toHaveCount(0);
  await expect(page.getByText("What's included", { exact: true })).toBeVisible();

  const fixedPackageIcons = page.locator(
    '.package-option-anchor--fixed .equipment-package-button__icon svg'
  );
  await expect(fixedPackageIcons).toHaveCount(2);
  const firstFixedIcon = await fixedPackageIcons.nth(0).innerHTML();
  const secondFixedIcon = await fixedPackageIcons.nth(1).innerHTML();
  expect(secondFixedIcon).toBe(firstFixedIcon);

  const customPackageIcon = await page
    .locator('.package-option-anchor--custom .equipment-package-button__icon svg')
    .innerHTML();
  expect(customPackageIcon).not.toBe(firstFixedIcon);

  const pumpSummaryItems = page.locator('.package-summary-item[data-summary-category="Pump"]');
  await expect(pumpSummaryItems).toHaveCount(1);
  await expect(pumpSummaryItems.nth(0)).toContainText('Fixture Variable-Speed Pump');
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Pump 1"]'))
    .toContainText('Fixture 1.65 HP Pump');

  await expect(page.locator('.package-summary-item[data-summary-category="Filter"]')).toHaveCount(1);
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Filter 1"]')).toHaveCount(1);
  await expect(page.locator('.package-summary-item[data-summary-category="Pool Light"]')).toHaveCount(1);
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Pool Light 1"]')).toHaveCount(1);

  const screenshotPath = testInfo.outputPath('modern-package-options.png');
  await page.locator('.package-options-block').screenshot({ path: screenshotPath });
  await testInfo.attach('Modern Package Options', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});
