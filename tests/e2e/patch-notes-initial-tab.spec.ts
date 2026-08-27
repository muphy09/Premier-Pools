import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/patch-notes-initial-tab.html';

test('opens first-login patch notes on the global tab', async ({ page }) => {
  await page.goto(fixtureUrl);

  await expect(page.getByRole('tab', { name: 'Global' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'patch-notes-global-tab');
  await expect(page.getByText('Global updates')).toBeVisible();
});

test('falls back to franchise notes when global notes are unavailable to the role', async ({ page }) => {
  await page.goto(`${fixtureUrl}?role=designer`);

  await expect(page.getByRole('tab', { name: 'Playwright Franchise' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Global' })).toHaveCount(0);
  await expect(page.getByText('Franchise updates')).toBeVisible();
});
