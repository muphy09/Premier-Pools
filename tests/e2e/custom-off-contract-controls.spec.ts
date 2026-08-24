import { expect, test } from '@playwright/test';

test('uses the off-contract switch and separated remove action for custom options and features', async ({
  page,
}, testInfo) => {
  await page.goto('http://127.0.0.1:5173/tests/fixtures/custom-off-contract-controls.html');

  const optionCard = page.locator('.spec-subcard').filter({ hasText: 'Playwright Custom Option' });
  await optionCard.getByRole('button', { name: 'Edit' }).click();

  const optionSwitch = optionCard.getByRole('switch', { name: 'Off-contract' });
  await expect(optionSwitch).not.toBeChecked();
  await expect(optionCard.locator('.custom-option-action-divider')).toBeVisible();
  await expect(optionCard.getByRole('button', { name: 'Remove' })).toHaveClass(/custom-option-remove-btn/);

  const optionControlStyles = await optionCard.evaluate((card) => {
    const track = card.querySelector<HTMLElement>('.custom-option-toggle-track');
    const divider = card.querySelector<HTMLElement>('.custom-option-action-divider');
    const removeButton = card.querySelector<HTMLElement>('.custom-option-remove-btn');
    if (!track || !divider || !removeButton) throw new Error('Custom option controls were not rendered.');
    const trackStyles = getComputedStyle(track);
    const dividerStyles = getComputedStyle(divider);
    const removeStyles = getComputedStyle(removeButton);
    return {
      trackWidth: Number.parseFloat(trackStyles.width),
      dividerWidth: Number.parseFloat(dividerStyles.width),
      removeBorderStyle: removeStyles.borderTopStyle,
    };
  });
  expect(optionControlStyles.trackWidth).toBeGreaterThanOrEqual(40);
  expect(optionControlStyles.dividerWidth).toBe(1);
  expect(optionControlStyles.removeBorderStyle).toBe('solid');

  await optionSwitch.click();
  await expect(optionSwitch).toBeChecked();
  await expect(optionCard.getByText('Total Cost', { exact: true })).toBeVisible();

  const optionScreenshotPath = testInfo.outputPath('custom-option-off-contract-controls.png');
  await optionCard.screenshot({ path: optionScreenshotPath });
  await testInfo.attach('Custom option off-contract controls', {
    path: optionScreenshotPath,
    contentType: 'image/png',
  });

  const groupedFeatureCard = page.locator('.custom-feature-group-card').filter({ hasText: 'Grouped Water Wall' });
  const groupedFeatureSwitch = groupedFeatureCard.getByRole('switch', { name: 'Off-contract' });
  await expect(groupedFeatureSwitch).not.toBeChecked();
  await groupedFeatureSwitch.click();
  await expect(groupedFeatureSwitch).toBeChecked();

  const featureCard = page.locator('.spec-subcard').filter({ hasText: 'Playwright Custom Feature' });
  await featureCard.getByRole('button', { name: 'Edit' }).click();
  const featureSwitch = featureCard.getByRole('switch', { name: 'Off-contract' });
  await expect(featureSwitch).not.toBeChecked();
  await featureSwitch.click();
  await expect(featureSwitch).toBeChecked();
  await expect(featureCard.locator('.custom-option-action-divider')).toBeVisible();

  const featureScreenshotPath = testInfo.outputPath('custom-feature-off-contract-controls.png');
  await featureCard.screenshot({ path: featureScreenshotPath });
  await testInfo.attach('Custom feature off-contract controls', {
    path: featureScreenshotPath,
    contentType: 'image/png',
  });

  await featureCard.getByRole('button', { name: 'Remove' }).click();
  await expect(featureCard).toHaveCount(0);
});
