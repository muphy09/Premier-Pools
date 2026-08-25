import { expect, test } from '@playwright/test';

test('shows Price Impact as an on-by-default franchise setting', async ({ page }, testInfo) => {
  await page.goto('http://127.0.0.1:5173/tests/fixtures/franchise-settings-price-impact.html');

  const dialog = page.getByRole('dialog', { name: 'Franchise Settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Price Impact' })).toBeVisible();

  const priceImpactSwitch = dialog.getByRole('switch', { name: 'Price Impact' });
  await expect(priceImpactSwitch).toHaveAttribute('aria-checked', 'true');
  await expect(priceImpactSwitch).toContainText('On');
  await expect(
    dialog.getByText('Turning this off hides the icons only; it does not change proposal pricing.')
  ).toBeVisible();

  const priceImpactSection = dialog
    .locator('section.admin-settings-item')
    .filter({ hasText: 'Proposal Builder Price Impact' });
  await testInfo.attach('Price Impact franchise setting', {
    body: await priceImpactSection.screenshot(),
    contentType: 'image/png',
  });
});
