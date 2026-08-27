import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/custom-features-modern.html';

test('Manual Custom Features matches the modern Custom Options presentation', async ({ page }) => {
  await page.goto(fixtureUrl);

  const manual = page.locator('.custom-options-block--compact').filter({
    has: page.getByRole('heading', { name: 'Manual Custom Features' }),
  });
  await expect(manual).toBeVisible();
  await expect(manual.locator('.equipment-category-icon')).toHaveCount(1);
  await expect(manual.getByRole('switch', { name: 'Manual Custom Features selection' })).toBeChecked();
  await expect(manual.getByRole('button', { name: 'Add Another' })).toBeVisible();
  await expect(manual.locator('.equipment-add-another-btn + .equipment-selection-divider')).toHaveCount(1);
  await expect(manual.getByText('Manual Accent - Additional', { exact: true })).toBeVisible();
  await expect(manual.locator('.btn-add')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.getProposalChangeCount())).toBe(0);

  await manual.getByRole('button', { name: 'Edit' }).first().click();
  await expect(manual.getByText('Off-contract', { exact: true })).toBeVisible();
  await expect(manual.getByRole('button', { name: 'Done' })).toBeVisible();
});

test('the modern selection control changes Manual Custom Features only when clicked', async ({ page }) => {
  await page.goto(fixtureUrl);

  const manual = page.locator('.custom-options-block--compact').filter({
    has: page.getByRole('heading', { name: 'Manual Custom Features' }),
  });
  const selection = manual.getByRole('switch', { name: 'Manual Custom Features selection' });
  await selection.click();
  await expect(selection).not.toBeChecked();
  await expect(manual.locator('.spec-subcard')).toHaveCount(0);

  await selection.click();
  await expect(selection).toBeChecked();
  await expect(manual.locator('.spec-subcard')).toHaveCount(1);
  await expect(manual.getByRole('button', { name: 'Done' })).toBeVisible();
});
