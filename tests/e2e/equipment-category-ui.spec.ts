import { expect, test, type Page } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/price-impact.html';

const categoryBlock = (page: Page, name: string) =>
  page
    .getByRole('heading', { name, exact: true })
    .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " spec-block ")][1]');

const categoryPosition = async (page: Page, block: ReturnType<typeof categoryBlock>) => {
  const blockBox = await block.boundingBox();
  const columnsBox = await page.locator('.equipment-category-columns').boundingBox();
  if (!blockBox || !columnsBox) return null;
  return {
    x: Math.round(blockBox.x - columnsBox.x),
    y: Math.round(blockBox.y - columnsBox.y),
  };
};

test('keeps only one Equipment subcategory editor open at a time', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(fixtureUrl);

  const pumpBlock = categoryBlock(page, 'Pump');
  const filterBlock = categoryBlock(page, 'Filter');
  const customBlock = categoryBlock(page, 'Custom Options');
  const initialColumns = await page.locator('.equipment-category-column-item').evaluateAll((items) =>
    items.map((item) => item.getAttribute('data-column'))
  );

  await pumpBlock.locator('.spec-subcard').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(pumpBlock.getByRole('button', { name: 'Done', exact: true })).toBeVisible();

  const filterTopBeforeOpen = (await filterBlock.boundingBox())?.y;
  await filterBlock.locator('.spec-subcard').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(filterBlock.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(pumpBlock.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect.poll(async () => (await filterBlock.boundingBox())?.y).toBeCloseTo(filterTopBeforeOpen!, 0);

  await customBlock.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(customBlock.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(filterBlock.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(1);

  await customBlock.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(() =>
    page.locator('.equipment-category-column-item').evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-column'))
    )
  ).toEqual(initialColumns);
});

test('explains why Automation sanitation and Spa blowers cannot be removed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(fixtureUrl);

  const sanitationBlock = categoryBlock(page, 'Sanitation System');
  const sanitationToggle = sanitationBlock.getByRole('switch', { name: 'Sanitation System selection' });
  await expect(sanitationToggle).toBeDisabled();
  await sanitationBlock.locator('.equipment-selection-toggle-anchor').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Required for Automation');

  await page.goto(`${fixtureUrl}?spa=on`);
  const blowerBlock = categoryBlock(page, 'Blowers');
  const blowerToggle = blowerBlock.getByRole('switch', { name: 'Blower selection' });
  await expect(blowerToggle).toBeDisabled();
  await blowerBlock.locator('.equipment-selection-toggle-anchor').hover();
  await expect(page.getByRole('tooltip')).toHaveText('Blower is required for Spa');
});

test('uses compact two-column Equipment cards with toggle-driven editing', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(fixtureUrl);

  const pumpBlock = categoryBlock(page, 'Pump');
  const categoryCards = page.locator(
    '.equipment-category-column-item > .spec-block'
  );
  await expect(categoryCards.first()).toBeVisible();
  const categoryBackgrounds = await categoryCards.evaluateAll((cards) =>
    cards.map((card) => window.getComputedStyle(card).backgroundColor)
  );
  expect(new Set(categoryBackgrounds).size).toBeGreaterThanOrEqual(4);

  const cardBoxes = await categoryCards.evaluateAll((cards) =>
    cards.map((card) => {
      const bounds = card.getBoundingClientRect();
      return {
        x: Math.round(bounds.x),
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        bottom: bounds.bottom,
      };
    })
  );
  const columnXPositions = [...new Set(cardBoxes.map((box) => box.x))].sort((a, b) => a - b);
  expect(columnXPositions).toHaveLength(2);
  expect(cardBoxes.every((box) => box.width < 600)).toBe(true);

  const columns = columnXPositions.map((x) =>
    cardBoxes.filter((box) => box.x === x).sort((a, b) => a.y - b.y)
  );
  for (const column of columns) {
    for (let index = 1; index < column.length; index += 1) {
      const gap = column[index].y - column[index - 1].bottom;
      expect(gap).toBeGreaterThanOrEqual(8);
      expect(gap).toBeLessThan(20);
    }
  }
  const columnBottoms = columns.map((column) => column[column.length - 1].bottom);
  const tallestCard = Math.max(...cardBoxes.map((box) => box.height));
  expect(Math.abs(columnBottoms[0] - columnBottoms[1])).toBeLessThan(tallestCard + 12);

  for (const category of ['Pump', 'Filter', 'Heater', 'Pool Lights', 'Custom Options']) {
    const block = categoryBlock(page, category);
    const controls = block.locator(':scope > .equipment-selection-controls');
    const addAnother = block.getByRole('button', { name: 'Add Another', exact: true });
    await expect(controls).toHaveCount(1);
    await expect(addAnother).toHaveCount(1);

    const toggleBox = await controls.locator('.equipment-selection-toggle').boundingBox();
    const addAnotherBox = await addAnother.boundingBox();
    const firstItemBox = await block.locator('.spec-subcard').first().boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(addAnotherBox).not.toBeNull();
    expect(firstItemBox).not.toBeNull();
    expect(addAnotherBox!.y).toBeGreaterThanOrEqual(toggleBox!.y + toggleBox!.height);
    expect(addAnotherBox!.y - (toggleBox!.y + toggleBox!.height)).toBeLessThan(8);
    expect(addAnotherBox!.y + addAnotherBox!.height).toBeLessThanOrEqual(firstItemBox!.y);
  }
  await expect(page.locator('.equipment-category-grid .equipment-add-another-row')).toHaveCount(0);

  const compactLayoutPath = testInfo.outputPath('equipment-add-another-under-toggle.png');
  await page.locator('.equipment-category-columns').screenshot({ path: compactLayoutPath });
  await testInfo.attach('Equipment Add Another placement', {
    path: compactLayoutPath,
    contentType: 'image/png',
  });
  await expect(page.getByRole('button', { name: /^Add Additional/ })).toHaveCount(0);
  await expect(
    page.locator('.spec-subcard-actions').getByRole('button', { name: 'Add Another', exact: true })
  ).toHaveCount(0);

  await expect(pumpBlock.getByRole('switch', { name: 'Pump selection' })).toBeChecked();
  await expect(pumpBlock.getByRole('switch', { name: 'Additional Pump 1 selection' })).toBeChecked();
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Pump 1"]'))
    .toContainText('Fixture 1.65 HP Pump');
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Filter 1"]')).toHaveCount(1);
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Heater 1"]')).toHaveCount(1);
  await expect(page.locator('.package-summary-item[data-summary-category="Additional Pool Light 1"]')).toHaveCount(1);

  const summaryPumpIcon = await page
    .locator('.package-summary-item[data-summary-category="Pump"] .package-summary-item__icon svg')
    .innerHTML();
  const categoryPumpIcon = await pumpBlock.locator('.equipment-category-icon svg').innerHTML();
  expect(categoryPumpIcon).toBe(summaryPumpIcon);

  const sanitationBlock = categoryBlock(page, 'Sanitation System');
  const additionalSanitationBlock = categoryBlock(page, 'Additional Sanitation Options');
  const sanitationIcon = await sanitationBlock.locator('.equipment-category-icon svg').innerHTML();
  const additionalSanitationIcon = await additionalSanitationBlock
    .locator('.equipment-category-icon svg')
    .innerHTML();
  expect(sanitationIcon).not.toBe(additionalSanitationIcon);
  await expect(
    page.locator('.package-summary-item[data-summary-category="Sanitation"] .package-summary-item__icon svg')
  ).toHaveCount(1);
  expect(
    await page
      .locator('.package-summary-item[data-summary-category="Sanitation"] .package-summary-item__icon svg')
      .innerHTML()
  ).toBe(sanitationIcon);
  expect(
    await page
      .locator(
        '.package-summary-item[data-summary-category="Additional Sanitation Option 1"] .package-summary-item__icon svg'
      )
      .innerHTML()
  ).toBe(additionalSanitationIcon);

  const pumpToggle = pumpBlock.getByRole('switch', { name: 'Pump selection' });
  await pumpToggle.focus();
  await page.keyboard.press('Space');
  await expect(pumpToggle).not.toBeChecked();
  await expect(pumpBlock.locator('.spec-subcard')).toHaveCount(0);
  await expect(pumpBlock.getByRole('button', { name: 'Add Another', exact: true })).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const collapsedPumpPosition = await categoryPosition(page, pumpBlock);
  expect(collapsedPumpPosition).not.toBeNull();

  await pumpToggle.focus();
  await page.keyboard.press('Space');
  await expect(pumpToggle).toBeChecked();
  await expect(pumpBlock.getByRole('button', { name: 'Add Another', exact: true })).toBeVisible();
  const pumpSelect = pumpBlock.locator('select.equipment-select').first();
  const doneButton = pumpBlock.getByRole('button', { name: 'Done', exact: true });
  await expect(pumpSelect).toBeVisible();
  await expect(doneButton).toBeVisible();
  await expect
    .poll(async () => categoryPosition(page, pumpBlock))
    .toEqual(collapsedPumpPosition);

  const selectBox = await pumpSelect.boundingBox();
  const doneBox = await doneButton.boundingBox();
  expect(selectBox).not.toBeNull();
  expect(doneBox).not.toBeNull();
  expect(Math.abs((selectBox!.y + selectBox!.height / 2) - (doneBox!.y + doneBox!.height / 2)))
    .toBeLessThan(18);

  await doneButton.click();
  await expect(pumpSelect).toHaveCount(0);
  await pumpBlock.getByRole('button', { name: 'Add Another', exact: true }).click();
  await expect(pumpBlock.locator('.spec-subcard')).toHaveCount(2);
  await expect(pumpBlock.locator('.spec-subcard').last().locator('.spec-subcard-subtitle')).toHaveCount(0);
  await pumpBlock.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: /^(Collapse|Clear|Remove)$/ })).toHaveCount(0);

  const blowerBlock = categoryBlock(page, 'Blowers');
  const blowerToggle = blowerBlock.getByRole('switch', { name: 'Blower selection' });
  await blowerToggle.click();
  await expect(blowerToggle).not.toBeChecked();
  await expect(blowerBlock.locator('.spec-subcard')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const collapsedBlowerPosition = await categoryPosition(page, blowerBlock);
  expect(collapsedBlowerPosition).not.toBeNull();

  await blowerToggle.click();
  await expect(blowerToggle).toBeChecked();
  await expect(blowerBlock.locator('select.equipment-select')).toBeVisible();
  await expect
    .poll(async () => categoryPosition(page, blowerBlock))
    .toEqual(collapsedBlowerPosition);
  await blowerBlock.getByRole('button', { name: 'Done', exact: true }).click();

  const customBlock = categoryBlock(page, 'Custom Options');
  const customToggle = customBlock.getByRole('switch', { name: 'Custom Options selection' });
  await expect(customToggle).toBeChecked();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const collapsedCustomPosition = await categoryPosition(page, customBlock);
  expect(collapsedCustomPosition).not.toBeNull();
  await customBlock.getByRole('button', { name: 'Edit', exact: true }).click();

  const offContractToggle = customBlock.getByRole('switch', { name: 'Off-contract' });
  await expect(offContractToggle).toBeVisible();
  await expect
    .poll(async () => categoryPosition(page, customBlock))
    .toEqual(collapsedCustomPosition);
  const customToggleBox = await customToggle.locator('xpath=ancestor::label[1]').boundingBox();
  const offContractBox = await offContractToggle.locator('xpath=ancestor::label[1]').boundingBox();
  expect(customToggleBox).not.toBeNull();
  expect(offContractBox).not.toBeNull();
  expect(offContractBox!.y).toBeGreaterThan(customToggleBox!.y);
  await customBlock.getByRole('button', { name: 'Done', exact: true }).click();

  await expect
    .poll(async () => {
      const expandedBoxes = await categoryCards.evaluateAll((cards) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          return { x: Math.round(bounds.x), bottom: bounds.bottom };
        })
      );
      const expandedColumns = [...new Set(expandedBoxes.map((box) => box.x))].map((x) =>
        expandedBoxes.filter((box) => box.x === x)
      );
      if (expandedColumns.length !== 2) return Number.POSITIVE_INFINITY;
      const bottoms = expandedColumns.map((column) => Math.max(...column.map((box) => box.bottom)));
      return Math.abs(bottoms[0] - bottoms[1]);
    })
    .toBeLessThan(220);

  const additionalSanitationToggle = additionalSanitationBlock.getByRole('switch', {
    name: 'Additional Sanitation Option selection',
  });
  await additionalSanitationToggle.click();
  await expect(additionalSanitationToggle).not.toBeChecked();
  const automationToggle = categoryBlock(page, 'Automation').getByRole('switch', {
    name: 'Automation selection',
  });
  await automationToggle.click();
  await expect(automationToggle).not.toBeChecked();
  const sanitationToggle = sanitationBlock.getByRole('switch', { name: 'Sanitation System selection' });
  await sanitationToggle.click();
  await expect(sanitationToggle).not.toBeChecked();
  await expect(additionalSanitationToggle).toBeDisabled();
  await expect(additionalSanitationBlock.getByText('Select a Sanitation System first.')).toHaveCount(0);
});
