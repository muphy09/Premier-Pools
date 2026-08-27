import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/message-center-ui.html';

test('requires two seconds before an unread launch message can be confirmed', async ({ page }) => {
  await page.goto(`${fixtureUrl}?mode=delivery`);

  await expect(page.getByRole('heading', { name: 'Pool season readiness update' })).toBeVisible();
  await expect(page.getByText('From PPAS West', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').locator('img, script')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.messageConfirmed)).toBe(false);
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled({ timeout: 3_500 });
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect.poll(() => page.evaluate(() => window.messageConfirmed)).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('shows clean seen and not-seen recipient lists for sent messages', async ({ page }) => {
  await page.goto(`${fixtureUrl}?mode=sent`);

  await expect(page.getByText('1 / 2')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Seen', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Not Seen', exact: true })).toBeVisible();
  await expect(page.getByText('Taylor Admin')).toBeVisible();
  await expect(page.getByText('Jordan Designer')).toBeVisible();
});

test('offers broadcast and selected recipients with the approved formatting tools', async ({ page }) => {
  await page.goto(`${fixtureUrl}?mode=composer`);

  await expect(page.getByRole('heading', { name: 'Create New Message' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entire Franchise' })).toBeVisible();
  await page.getByRole('button', { name: 'Selected Members' }).click();
  await expect(page.getByText('Jordan Designer')).toBeVisible();
  await page.getByPlaceholder('Search by name or email').fill('Jordan');
  await expect(page.getByText('Jordan Designer')).toBeVisible();
  await expect(page.getByText('Taylor Admin')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Bold' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Italic' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Underline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bulleted list' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Numbered list' })).toBeVisible();

  const editor = page.getByRole('textbox', { name: 'Message' });
  await editor.fill('First item');
  await editor.press('Control+A');
  await page.getByRole('button', { name: 'Bulleted list' }).click();
  const bulletList = editor.locator('ul');
  await expect(bulletList).toBeVisible();
  const listPadding = await bulletList.evaluate((element) =>
    Number.parseFloat(window.getComputedStyle(element).paddingLeft)
  );
  expect(listPadding).toBeGreaterThanOrEqual(20);
});

test('loads Master owner-mode recipients when the composer opens and filters them by name', async ({ page }) => {
  await page.goto(`${fixtureUrl}?mode=owner-composer`);

  await page.getByRole('button', { name: 'Create New Message' }).click();
  await page.getByRole('button', { name: 'Selected Members' }).click();
  await page.getByPlaceholder('Search by name or email').fill('de');

  const matchingRecipient = page.getByText('Dedra Erwin');
  await expect(matchingRecipient).toBeVisible();
  await expect(page.getByText('John Neely')).toHaveCount(0);

  const recipientPanel = page.locator('.message-recipient-picker');
  const [panelBox, recipientBox] = await Promise.all([
    recipientPanel.boundingBox(),
    matchingRecipient.boundingBox(),
  ]);
  expect(panelBox).not.toBeNull();
  expect(recipientBox).not.toBeNull();
  expect(panelBox!.height).toBeGreaterThan(80);
  expect(recipientBox!.y).toBeGreaterThanOrEqual(panelBox!.y);
  expect(recipientBox!.y + recipientBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
});
