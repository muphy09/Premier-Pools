import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/cogs-report.html';

test('keeps the summary on one page and switches through balanced detail pages', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(fixtureUrl);

  const summaryPage = page.locator('.cogs-report-page--summary');
  await expect(summaryPage).toBeVisible();
  await expect(summaryPage.getByText('Cost of Goods Sold', { exact: true })).toBeVisible();
  await expect(summaryPage.getByText('Category mix', { exact: true })).toBeVisible();
  await expect(summaryPage.getByText('COGS Overhead', { exact: true }).first()).toBeVisible();
  await expect(summaryPage.getByText('At a glance', { exact: true })).toHaveCount(0);
  await expect(summaryPage.locator('.cogs-report-mix-column')).toHaveCount(2);
  await expect(summaryPage.locator('.cogs-report-mix-row')).toHaveCount(22);

  const summaryBounds = await summaryPage.boundingBox();
  expect(summaryBounds?.width).toBeCloseTo(1224, 0);
  expect(summaryBounds?.height).toBeCloseTo(924, 0);
  const summaryOverflow = await summaryPage.evaluate((node) => ({
    horizontal: node.scrollWidth - node.clientWidth,
    vertical: node.scrollHeight - node.clientHeight,
  }));
  expect(summaryOverflow.horizontal).toBeLessThanOrEqual(1);
  expect(summaryOverflow.vertical).toBeLessThanOrEqual(1);
  const mixRowOverflow = await summaryPage.locator('.cogs-report-mix-row').evaluateAll((rows) => (
    rows.reduce((largestOverflow, row) => Math.max(
      largestOverflow,
      row.scrollHeight - row.clientHeight,
      row.scrollWidth - row.clientWidth
    ), 0)
  ));
  expect(mixRowOverflow).toBeLessThanOrEqual(1);
  const summaryTotal = Number(
    (await summaryPage.locator('.cogs-report-summary-total strong').innerText()).replace(/[$,]/g, '')
  );

  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await expect(tabs.nth(0)).toHaveText('Summary');
  await expect(tabs.nth(1)).toHaveText('Details 1');
  await expect(tabs.nth(3)).toHaveText('Details 3');

  const itemCounts: number[] = [];
  let detailTotal = 0;
  for (let index = 1; index < 4; index += 1) {
    await tabs.nth(index).click();
    const activeDetailPage = page.locator('.cogs-report-page--detail');
    await expect(activeDetailPage).toBeVisible();
    itemCounts.push(await activeDetailPage.locator('.cogs-report-detail-item-row').count());
    const lineTotals = await activeDetailPage
      .locator('.cogs-report-detail-item-row strong')
      .allTextContents();
    detailTotal += lineTotals.reduce(
      (sum, value) => sum + Number(value.replace(/[$,]/g, '')),
      0
    );
    const overflow = await activeDetailPage.evaluate((node) => ({
      horizontal: node.scrollWidth - node.clientWidth,
      vertical: node.scrollHeight - node.clientHeight,
      footerOverlap: Math.max(
        0,
        ...Array.from(node.querySelectorAll<HTMLElement>('.cogs-report-detail-table-body')).map((body) => (
          body.getBoundingClientRect().bottom -
          (node.querySelector<HTMLElement>('.cogs-report-page-footer')?.getBoundingClientRect().top || 0)
        ))
      ),
    }));
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeLessThanOrEqual(2);
    expect(overflow.footerOverlap).toBeLessThanOrEqual(0);
  }

  expect(Math.max(...itemCounts) - Math.min(...itemCounts)).toBeLessThanOrEqual(8);
  expect(Math.round(detailTotal * 100) / 100).toBe(summaryTotal);
  await expect(page.getByText('Retail-only price credit', { exact: true })).toHaveCount(0);

  const overheadRow = page.locator('.cogs-report-detail-item-row').filter({ hasText: 'COGS Overhead' });
  await expect(overheadRow).toBeVisible();
  await expect(overheadRow.locator('span').nth(1)).toHaveText('1%');
  await expect(overheadRow.locator('span').nth(2)).toHaveText('');
  const finalDetailScreenshotPath = testInfo.outputPath('cogs-final-detail-page.png');
  await page.locator('.cogs-report-page--detail').screenshot({ path: finalDetailScreenshotPath });
  await testInfo.attach('COGS final detail page', {
    path: finalDetailScreenshotPath,
    contentType: 'image/png',
  });

  await tabs.nth(0).click();
  const summaryScreenshotPath = testInfo.outputPath('cogs-summary-page.png');
  await summaryPage.screenshot({ path: summaryScreenshotPath });
  await testInfo.attach('COGS summary page', { path: summaryScreenshotPath, contentType: 'image/png' });

  await tabs.nth(1).click();
  const detailScreenshotPath = testInfo.outputPath('cogs-detail-page.png');
  await page.locator('.cogs-report-page--detail').screenshot({ path: detailScreenshotPath });
  await testInfo.attach('COGS detail page', { path: detailScreenshotPath, contentType: 'image/png' });
});

test('generates landscape export pages with consecutive page numbering', async ({ page }, testInfo) => {
  await page.goto(`${fixtureUrl}?mode=export`);

  const exportPages = page.locator('.export-breakdown-page--cogs');
  await expect(exportPages).toHaveCount(4);

  for (let index = 0; index < 4; index += 1) {
    const reportPage = exportPages.nth(index).locator('.cogs-report-page');
    const bounds = await reportPage.boundingBox();
    expect(bounds?.width).toBeCloseTo(979.2, 0);
    expect(bounds?.height).toBeCloseTo(739.2, 0);
    await expect(reportPage.locator('.cogs-report-page-footer strong')).toHaveText(`${index + 1} / 4`);
  }

  const downloadPromise = page.waitForEvent('download');
  await page.evaluate(() => (
    window as Window & { downloadCogsFixturePdf: () => Promise<void> }
  ).downloadCogsFixturePdf());
  const download = await downloadPromise;
  const pdfPath = testInfo.outputPath('cogs-report-landscape.pdf');
  await download.saveAs(pdfPath);

  const pdfBytes = readFileSync(pdfPath);
  expect(pdfBytes.byteLength).toBeLessThan(12 * 1024 * 1024);
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBe(4);
  pdf.getPages().forEach((pdfPage) => {
    const { width, height } = pdfPage.getSize();
    expect(width).toBeCloseTo(792, 1);
    expect(height).toBeCloseTo(612, 1);
    expect(width).toBeGreaterThan(height);
  });
  await testInfo.attach('COGS landscape PDF', { path: pdfPath, contentType: 'application/pdf' });
});
