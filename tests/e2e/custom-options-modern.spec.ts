import { expect, test } from '@playwright/test';

const fixtureRoot = 'http://127.0.0.1:5173/tests/fixtures';

const categoryFixtures = [
  ['Equipment', 'price-impact.html'],
  ['Plumbing', 'plumbing-price-impact.html'],
  ['Gas / Electrical', 'electrical-price-impact.html'],
  ['Tile / Coping / Decking', 'tile-coping-decking-price-impact.html'],
  ['Drainage', 'drainage-price-impact.html'],
  ['Water Features', 'water-features-price-impact.html'],
] as const;

test('uses one modern Custom Options card across completed Price Impact categories', async ({ page }) => {
  let equipmentIcon = '';
  let equipmentButtonStyle = '';

  for (const [category, fixture] of categoryFixtures) {
    await page.goto(`${fixtureRoot}/${fixture}`);

    const block = page.locator('.custom-options-block--compact');
    await expect(block, `${category} should use the modern Custom Options card`).toHaveCount(1);
    await expect(block.getByRole('heading', { name: 'Custom Options', exact: true })).toBeVisible();
    await expect(block.getByRole('switch', { name: 'Custom Options selection' })).toBeVisible();
    await expect(block.getByRole('button', { name: /Add Custom Option/i })).toHaveCount(0);
    await expect(block.locator('.equipment-category-icon svg')).toHaveCount(1);
    const addAnother = block.getByRole('button', { name: 'Add Another', exact: true });
    await expect(addAnother).toBeVisible();
    await expect(block.locator('.equipment-selection-divider')).toHaveCount(1);

    const controls = block.locator(':scope > .equipment-selection-controls');
    const buttonBox = await addAnother.boundingBox();
    const dividerBox = await controls.locator('.equipment-selection-divider').boundingBox();
    const toggleBox = await controls.locator('.equipment-selection-toggle').boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(dividerBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(buttonBox!.x + buttonBox!.width).toBeLessThan(dividerBox!.x);
    expect(dividerBox!.x + dividerBox!.width).toBeLessThan(toggleBox!.x);

    const backgroundColor = await block.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(backgroundColor).toBe('rgb(216, 221, 227)');

    const icon = await block.locator('.equipment-category-icon svg').innerHTML();
    if (category === 'Equipment') equipmentIcon = icon;
    expect(icon).toBe(equipmentIcon);

    const buttonStyle = await addAnother.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.height, style.padding, style.border, style.borderRadius, style.fontSize].join('|');
    });
    if (category === 'Equipment') equipmentButtonStyle = buttonStyle;
    expect(buttonStyle).toBe(equipmentButtonStyle);
  }
});
