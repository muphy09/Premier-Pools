import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/excavation-price-impact.html';

test('uses the modern one-column Excavation controls and actions', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(fixtureUrl);

  const cards = page.locator('.excavation-category-item');
  await expect(cards).toHaveCount(5);
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(Math.abs((first?.x || 0) - (second?.x || 0))).toBeLessThan(2);
  expect(second?.y || 0).toBeGreaterThan((first?.y || 0) + (first?.height || 0));

  await expect(page.getByRole('switch', { name: 'Raised Bond Beam selection' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Columns selection' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Retaining Wall selection' })).toBeChecked();
  await expect(page.getByRole('switch', { name: 'Exposed Pool Wall selection' })).toBeChecked();

  const rbbCard = cards.filter({ hasText: 'Raised Bond Beam (RBB)' });
  const controls = rbbCard.locator('.equipment-selection-controls');
  await expect(controls.getByRole('button', { name: 'Add Another' })).toBeVisible();
  await expect(controls.locator('.equipment-selection-divider')).toHaveCount(1);
  await expect(controls.locator('.equipment-add-another-btn + .equipment-selection-divider')).toHaveCount(1);

  await rbbCard.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1);
  const facingRow = rbbCard.locator('.excavation-facing-label-row');
  const backsideFacing = facingRow.getByRole('switch', { name: 'Backside Facing selection' });
  await expect(facingRow.getByText('Facing', { exact: true })).toBeVisible();
  await expect(facingRow.getByText('Backside Facing', { exact: true })).toBeVisible();
  await expect(backsideFacing).toBeChecked();
  await expect(facingRow.getByText(/Not included|Included/, { exact: true })).toHaveCount(0);
  const facingLabelBox = await facingRow.getByText('Facing', { exact: true }).boundingBox();
  const backsideBox = await backsideFacing.boundingBox();
  expect(backsideBox?.x || 0).toBeGreaterThan((facingLabelBox?.x || 0) + (facingLabelBox?.width || 0));
  await expect(facingRow.locator('.equipment-selection-toggle')).toHaveCSS('border-top-width', '0px');
  await expect(facingRow.locator('.equipment-selection-toggle')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  const rbbInputs = rbbCard.locator('.spec-grid-3-fixed .compact-input');
  const heightInputBox = await rbbInputs.nth(0).boundingBox();
  const lengthInputBox = await rbbInputs.nth(1).boundingBox();
  const facingInputBox = await rbbInputs.nth(2).boundingBox();
  expect(Math.abs((heightInputBox?.y || 0) - (lengthInputBox?.y || 0))).toBeLessThan(2);
  expect(Math.abs((heightInputBox?.y || 0) - (facingInputBox?.y || 0))).toBeLessThan(2);
  await expect(rbbCard.locator('.spec-field').filter({ hasText: 'Height' }).locator('option:checked')).toHaveText('24"');
  await expect(rbbCard.locator('.spec-field').filter({ hasText: 'Height' }).locator('option:checked')).not.toContainText('\\');

  const retainingCard = cards.filter({ hasText: 'Retaining Wall' });
  await retainingCard.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1);
  await expect(rbbCard.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);

  await expect(retainingCard.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);

  const custom = page.locator('.custom-options-block--compact');
  await expect(custom).toBeVisible();
  await expect(custom.getByRole('switch', { name: 'Custom Options selection' })).toBeChecked();

  const additionalOptions = cards.filter({ hasText: 'Additional Options' });
  await expect(additionalOptions.locator('.form-help')).toHaveCount(0);
  const doubleCurtainRow = additionalOptions.locator('.excavation-option-row').filter({
    has: page.getByText('Double Curtain', { exact: true }),
  });
  const sitePrepRow = additionalOptions.locator('.excavation-option-row').filter({
    has: page.getByText('Additional Site Prep', { exact: true }),
  });
  await expect(doubleCurtainRow.locator('.excavation-inline-option-input')).toBeVisible();
  await expect(sitePrepRow.locator('.excavation-inline-option-input')).toBeVisible();
  await expect(
    doubleCurtainRow.getByRole('button', { name: 'Show Price Impact for Double Curtain' })
  ).toHaveCount(1);
  await expect(
    sitePrepRow.getByRole('button', { name: 'Show Price Impact for Additional Site Prep' })
  ).toHaveCount(1);
  await expect(doubleCurtainRow.locator('.excavation-inline-option-input .price-impact-trigger')).toHaveCount(0);
  await expect(sitePrepRow.locator('.excavation-inline-option-input .price-impact-trigger')).toHaveCount(0);
  await expect(additionalOptions.locator('.excavation-option-detail')).toHaveCount(0);
  const doubleTitleBox = await doubleCurtainRow.getByText('Double Curtain', { exact: true }).boundingBox();
  const doubleInputBox = await doubleCurtainRow.locator('.compact-input').boundingBox();
  expect(doubleInputBox?.x || 0).toBeGreaterThan(
    (doubleTitleBox?.x || 0) + (doubleTitleBox?.width || 0)
  );
  expect(Math.abs(
    ((doubleInputBox?.y || 0) + (doubleInputBox?.height || 0) / 2) -
    ((doubleTitleBox?.y || 0) + (doubleTitleBox?.height || 0) / 2)
  )).toBeLessThan(4);

  const screenshotPath = testInfo.outputPath('excavation-modern-layout.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Excavation modern layout', {
    path: screenshotPath,
    contentType: 'image/png',
  });
});

test('shows complete Excavation Price Impact and the included-gravel warning', async ({ page }) => {
  await page.goto(`${fixtureUrl}?ppasEast=true`);

  const rbbCard = page.locator('.excavation-category-item').filter({ hasText: 'Raised Bond Beam (RBB)' });
  await rbbCard.getByRole('button', { name: 'Show Price Impact for Raised Bond Beam' }).click();
  const impact = page.getByRole('dialog', { name: 'Price Impact for Raised Bond Beam' });
  await expect(impact).toContainText('24" RBB Excavation');
  await expect(impact).toContainText('Panel Ledge Facing Labor');
  await expect(impact).toContainText('Panel Ledge Facing Material');
  await expect(impact).toContainText('RBB Plumbing Strip Forms');
  await expect(impact).toContainText('RBB Cleanup');
  await expect(impact).toContainText('Indirect Charges');
  await expect(impact.getByText('Overhead', { exact: true })).toHaveCount(0);

  await page.keyboard.press('Escape');
  const additional = page.locator('.excavation-category-item').filter({ hasText: 'Additional Options' });
  const warningText = '1 install over 1 included. Additional charges apply.';
  const warning = additional.getByRole('button', { name: warningText, exact: true });
  await expect(warning).toBeVisible();
  await warning.hover();
  await expect(page.getByRole('tooltip')).toHaveText(warningText);

  await additional.getByRole('button', { name: 'Show Price Impact for Double Curtain' }).first().click();
  const doubleCurtain = page.getByRole('dialog', { name: 'Price Impact for Double Curtain' });
  await expect(doubleCurtain).toContainText('Double Curtain');
  await expect(doubleCurtain).toContainText(/Shotcrete/i);
});

test('keeps Excavation usable on a vertical display and honors hidden Price Impact', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 900 });
  await page.goto(fixtureUrl);

  const firstCard = page.locator('.excavation-category-item').first();
  const box = await firstCard.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width || 0).toBeLessThanOrEqual(528);
  await firstCard.getByRole('button', { name: 'Edit', exact: true }).click();
  const fields = firstCard.locator('.spec-field');
  const firstField = await fields.nth(0).boundingBox();
  const secondField = await fields.nth(1).boundingBox();
  expect(secondField?.y || 0).toBeGreaterThan(firstField?.y || 0);

  await page.goto(`${fixtureUrl}?priceImpact=off`);
  await expect(page.getByRole('button', { name: /Show Price Impact for/i })).toHaveCount(0);
  await expect(page.getByRole('switch', { name: 'Raised Bond Beam selection' })).toBeVisible();
});

test('does not rewrite legacy Excavation data while rendering', async ({ page }) => {
  await page.goto(`${fixtureUrl}?legacyRetainingWall=true`);
  await expect(page.getByRole('switch', { name: 'Retaining Wall selection' })).toBeChecked();
  await expect(page.getByText('12" High - Standard | 20 LNFT', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.getExcavationChangeCount())).toBe(0);
});
