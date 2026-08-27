import { expect, test } from '@playwright/test';

const fixtureUrl = 'http://127.0.0.1:5173/tests/fixtures/master-proposal-authorization.html';

test.beforeEach(async ({ page }) => {
  await page.goto(fixtureUrl);
  await expect(page.getByText('Ready')).toBeVisible();
});

test('direct master saves only its own proposal in the master area', async ({ page }) => {
  const result = await page.evaluate(() =>
    (window as any).masterProposalAuthorizationFixture.saveOwnProposal()
  );

  expect(result.ok).toBe(true);
  expect(result.persistedProposal.franchiseId).toBe('default');
  expect(result.persistedProposal.designerAuthUserId).toBe('playwright-master-user');
  expect(result.persistedProposal.pricingModelFranchiseId).toBe('borrowed-pricing-franchise');
});

test('direct master cannot save a franchise-user-owned proposal', async ({ page }) => {
  const result = await page.evaluate(() =>
    (window as any).masterProposalAuthorizationFixture.saveFranchiseOwnedProposal()
  );

  expect(result.ok).toBe(false);
  expect(result.message).toBe(
    'Master accounts can only change proposals they created in the master area.'
  );
  expect(result.persistedProposal).toBeNull();
});

test('Act as Owner remains read-only for proposal saves', async ({ page }) => {
  const result = await page.evaluate(() =>
    (window as any).masterProposalAuthorizationFixture.saveWhileActingAsOwner()
  );

  expect(result.ok).toBe(false);
  expect(result.message).toContain('Master accounts have read-only access to franchise proposals');
  expect(result.persistedProposal).toBeNull();
});

test('direct master cannot delete from a franchise area', async ({ page }) => {
  const result = await page.evaluate(() =>
    (window as any).masterProposalAuthorizationFixture.deleteOutsideMasterArea()
  );

  expect(result.ok).toBe(false);
  expect(result.message).toBe(
    'Master accounts can only change proposals they created in the master area.'
  );
});

test('direct master dashboard uses the stable account id when the saved designer name is stale', async ({ page }) => {
  const proposalNumbers = await page.evaluate(() =>
    (window as any).masterProposalAuthorizationFixture.listDashboardForDirectMaster()
  );

  expect(proposalNumbers).toEqual(['PROP-PW-MASTER-OWN']);
});

for (const role of ['owner', 'admin', 'bookkeeper', 'designer'] as const) {
  test(`${role} dashboard uses account ids without exposing another user's proposal`, async ({ page }) => {
    const proposalNumbers = await page.evaluate((selectedRole) =>
      (window as any).masterProposalAuthorizationFixture.listDashboardForFranchiseRole(selectedRole),
      role
    );

    expect(proposalNumbers).toEqual([`PROP-PW-${role}-OWN`]);
  });
}
