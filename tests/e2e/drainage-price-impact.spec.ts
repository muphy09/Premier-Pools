import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/drainage-price-impact.html';

test('shows complete Price Impact for every active Drainage control', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(fixtureUrl);

  const expectedControls = [
    'Downspout Drain',
    'Deck Drain',
    'French Drain',
    'Box Drain',
    'Drainage Catch Basin',
    'Off-Contract Drainage Option',
  ];
  for (const control of expectedControls) {
    await expect(
      page.getByRole('button', { name: `Show Price Impact for ${control}`, exact: true })
    ).toHaveCount(1);
  }

  const downspoutField = page.locator('.spec-field').filter({ hasText: 'Downspout Drain' }).first();
  const downspoutEndcap = downspoutField.locator('.compact-input-endcap');
  await expect(downspoutEndcap).toContainText('LNFT');
  expect(
    await downspoutEndcap.locator('.price-impact-trigger-wrap').evaluate(
      (element) => getComputedStyle(element).borderLeftWidth
    )
  ).not.toBe('0px');
  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(0);

  await page.getByRole('button', { name: 'Show Price Impact for Downspout Drain' }).click();
  const downspoutDialog = page.getByRole('dialog', { name: 'Price Impact for Downspout Drain' });
  await expect(downspoutDialog.getByRole('heading', { name: 'Direct Charges', exact: true })).toBeVisible();
  const downspoutBaseLine = downspoutDialog.locator('.price-impact-line')
    .filter({ hasText: 'Downspout Drain Base' });
  const downspoutOverageLine = downspoutDialog.locator('.price-impact-line')
    .filter({ hasText: 'Downspout Drain Overage' });
  await expect(downspoutBaseLine).toHaveCount(1);
  await expect(downspoutBaseLine.locator('small')).toHaveCount(0);
  await expect(downspoutOverageLine).toContainText('Up to 10 LNFT Included');
  await expect(downspoutDialog).not.toContainText('per LNFT');
  await expect(downspoutDialog.getByRole('heading', { name: 'Indirect Charges' })).toHaveCount(0);
  await expect(downspoutDialog.getByText('Overhead', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Deck Drain' }).click();
  const deckDrainDialog = page.getByRole('dialog', { name: 'Price Impact for Deck Drain' });
  await expect(deckDrainDialog).toContainText('Deck Drain Base');
  await expect(deckDrainDialog).toContainText('Deck Drain Overage');
  await expect(deckDrainDialog).toContainText('Up to 10 LNFT Included');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for French Drain' }).click();
  await expect(page.getByRole('dialog', { name: 'Price Impact for French Drain' }))
    .toContainText('French Drain Overage');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Box Drain' }).click();
  await expect(page.getByRole('dialog', { name: 'Price Impact for Box Drain' }))
    .toContainText('Box Drain Base');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Drainage Catch Basin' }).click();
  const customDialog = page.getByRole('dialog', { name: 'Price Impact for Drainage Catch Basin' });
  await expect(customDialog).toContainText('Drainage Catch Basin');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Off-Contract Drainage Option' }).click();
  const offContractDialog = page.getByRole('dialog', {
    name: 'Price Impact for Off-Contract Drainage Option',
  });
  await expect(offContractDialog).toContainText('Off-Contract Retail Price');

  const screenshotPath = testInfo.outputPath('drainage-price-impact.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Drainage Price Impact', {
    path: screenshotPath,
    contentType: 'image/png',
  });

  await expect.poll(() =>
    page.evaluate(() => (window as any).getPriceImpactCalculationCount())
  ).toBe(6);
});

test('removes a Drainage icon as soon as its value is cleared', async ({ page }) => {
  await page.goto(fixtureUrl);

  const downspoutField = page.locator('.spec-field').filter({ hasText: 'Downspout Drain' }).first();
  await downspoutField.getByRole('spinbutton').fill('0');
  await expect(
    downspoutField.getByRole('button', { name: 'Show Price Impact for Downspout Drain' })
  ).toHaveCount(0);
});

test('shows inline overage warnings for every Drainage run above its allowance', async ({ page }) => {
  await page.goto(fixtureUrl);

  const downspoutField = page.locator('.spec-field').filter({ hasText: 'Downspout Drain' }).first();
  const deckField = page.locator('.spec-field').filter({ hasText: 'Deck Drain' }).first();
  const frenchField = page.locator('.spec-field').filter({ hasText: 'French Drain' }).first();
  const boxField = page.locator('.spec-field').filter({ hasText: 'Box Drain' }).first();
  const downspoutWarningText = '10 feet over 10 ft maximum. Additional charges apply.';

  const downspoutWarning = downspoutField.getByRole('button', {
    name: downspoutWarningText,
    exact: true,
  });
  await expect(downspoutWarning).toBeVisible();
  await expect(frenchField.getByRole('button', {
    name: '25 feet over 10 ft maximum. Additional charges apply.',
    exact: true,
  })).toBeVisible();
  await expect(deckField.locator('.inline-overage-warning')).toHaveCount(0);
  await expect(boxField.locator('.inline-overage-warning')).toHaveCount(0);

  await downspoutWarning.hover();
  await expect(page.getByRole('tooltip')).toHaveText(downspoutWarningText);

  await deckField.getByRole('spinbutton').fill('12');
  await boxField.getByRole('spinbutton').fill('11');
  await expect(deckField.getByRole('button', {
    name: '2 feet over 10 ft maximum. Additional charges apply.',
    exact: true,
  })).toBeVisible();
  await expect(boxField.getByRole('button', {
    name: '1 feet over 10 ft maximum. Additional charges apply.',
    exact: true,
  })).toBeVisible();

  await downspoutField.getByRole('spinbutton').fill('10');
  await expect(downspoutWarning).toHaveCount(0);
});

test('shows Drainage amounts in the user-selected COGS basis without unit rates', async ({ page }) => {
  await page.goto(`${fixtureUrl}?basis=cogs`);
  await page.getByRole('button', { name: 'Show Price Impact for French Drain' }).click();

  const dialog = page.getByRole('dialog', { name: 'Price Impact for French Drain' });
  await expect(dialog).toContainText('Up to 10 LNFT Included');
  await expect(dialog).not.toContainText('per LNFT');
  await expect(dialog).toContainText('COGS Amounts Shown');
});

test('hides all Drainage Price Impact icons when the feature is off', async ({ page }) => {
  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
});
