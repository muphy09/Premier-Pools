import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/interior-finish-price-impact.html';

test('uses dropdowns, a Microglass toggle, and the modern Custom Options card', async ({ page }) => {
  await page.goto(fixtureUrl);

  const finishBlock = page.locator('.spec-block').filter({ hasText: 'Finish Type' });
  await expect(finishBlock.locator('select')).toHaveCount(2);
  await expect(finishBlock.getByRole('switch', { name: 'Microglass (Waterproofing)' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Include Waterproofing (Microglass)' })).toHaveCount(0);

  const additionalOptions = page.locator('.interior-finish-additional-options-card');
  await expect(additionalOptions.getByRole('heading', { name: 'Additional Options' })).toBeVisible();
  await expect(additionalOptions.getByText('Microglass (Waterproofing)', { exact: true })).toBeVisible();
  await expect(additionalOptions.getByText('Enable or Disable Microglass', { exact: true })).toBeVisible();
  await expect(additionalOptions.getByRole('switch', { name: 'Microglass (Waterproofing)' })).toBeChecked();
  await expect(additionalOptions.getByText(/Enabled|Disabled/, { exact: true })).toHaveCount(0);
  await expect(additionalOptions.locator('.excavation-option-row')).toHaveCount(1);

  const customOptions = page.locator('.custom-options-block--compact');
  await expect(customOptions).toBeVisible();
  await expect(customOptions.getByRole('switch', { name: 'Custom Options selection' })).toBeChecked();
  await expect(customOptions.locator('.equipment-category-icon')).toHaveCount(1);

  await expect.poll(() => page.evaluate(() => window.getProposalChangeCount())).toBe(0);
});

test('shows full finish, Microglass, and custom-option Price Impacts without rewriting the proposal', async ({ page }) => {
  await page.goto(fixtureUrl);

  const finishField = page.locator('.spec-field').filter({ has: page.getByText('Finish', { exact: true }) });
  await finishField.getByRole('button', { name: /Show Price Impact for/i }).click();
  const finishImpact = page.getByRole('dialog', { name: /Price Impact for/i });
  await expect(finishImpact).toContainText('Pool Interior Finish Material Upgrade');
  await expect(finishImpact).toContainText('Spa Interior Finish Material');
  await expect(finishImpact).toContainText('Compared with');
  await expect(finishImpact.getByText('Overhead', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.getProposalChangeCount())).toBe(0);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Microglass (Waterproofing)' }).click();
  const microglassImpact = page.getByRole('dialog', {
    name: 'Price Impact for Microglass (Waterproofing)',
  });
  await expect(microglassImpact).toContainText('Microglass (Waterproofing)');
  await expect(microglassImpact).toContainText('Raised Spa');
  await expect(microglassImpact).toContainText('Retail Amounts Shown');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show Price Impact for Interior Finish Fixture Option' }).click();
  const customImpact = page.getByRole('dialog', {
    name: 'Price Impact for Interior Finish Fixture Option',
  });
  await expect(customImpact).toContainText('Interior Finish Fixture Option');
  await expect(customImpact).toContainText('Compared with no interior finish fixture option');
  await expect.poll(() => page.evaluate(() => window.getProposalChangeCount())).toBe(0);
});

test('honors hidden Price Impact and the user COGS display preference', async ({ page }) => {
  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Microglass (Waterproofing)' })).toBeVisible();

  await page.goto(`${fixtureUrl}?basis=cogs`);
  await page.getByRole('button', { name: 'Show Price Impact for Microglass (Waterproofing)' }).click();
  await expect(page.getByRole('dialog', {
    name: 'Price Impact for Microglass (Waterproofing)',
  })).toContainText('COGS Amounts Shown');
});
