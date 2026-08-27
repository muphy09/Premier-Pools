import { expect, test } from '@playwright/test';

const fixtures = [
  ['Equipment', 'price-impact.html?legacyPartial=true'],
  ['Plumbing', 'plumbing-price-impact.html'],
  ['Gas / Electrical', 'electrical-price-impact.html'],
  ['Tile / Coping / Decking', 'tile-coping-decking-price-impact.html'],
  ['Drainage', 'drainage-price-impact.html'],
  ['Water Features', 'water-features-price-impact.html'],
  ['Excavation', 'excavation-price-impact.html'],
  ['Interior Finish', 'interior-finish-price-impact.html'],
] as const;

for (const [category, fixture] of fixtures) {
  test(`${category} rendering and Price Impact do not rewrite proposal inputs`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:5173/tests/fixtures/${fixture}`);

    await expect(page.getByRole('button', { name: /Show Price Impact for/i }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      window as Window & { getProposalChangeCount?: () => number }
    ).getProposalChangeCount?.())).toBe(0);

    await page.getByRole('button', { name: /Show Price Impact for/i }).first().click();
    await expect(page.getByRole('dialog', { name: /Price Impact for/i })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      window as Window & { getProposalChangeCount?: () => number }
    ).getProposalChangeCount?.())).toBe(0);
  });
}
