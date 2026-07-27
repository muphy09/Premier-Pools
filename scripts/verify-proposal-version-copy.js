const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const testSource = `
  import assert from 'node:assert/strict';
  import { getDefaultProposal } from './src/utils/proposalDefaults';
  import { createVersionFromProposal, listAllVersions } from './src/utils/proposalVersions';

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const base = getDefaultProposal();

  const source = {
    ...clone(base),
    proposalNumber: 'PROP-VERSION-COPY-TEST',
    versionId: 'source-revision-1',
    versionName: 'Source Revision 1',
    isOriginalVersion: false,
    pricingModelId: 'pricing-model-1',
    pricingModelName: 'Pricing Model',
    pricingModelFranchiseId: 'franchise-1',
    pricingModelRevisionId: 'revision-1',
    pricingModelRevisionNumber: 1,
    pricingRevisionReview: {
      latestRevisionId: 'revision-2',
      latestRevisionNumber: 2,
      decision: 'declined',
      detectedAt: '2026-07-01T00:00:00.000Z',
    },
    manualAdjustments: { positive1: 125, positive2: 0, negative1: 0, negative2: 0 },
    retailAdjustments: [{ name: 'Source adjustment', amount: -250 }, { name: '', amount: 0 }],
    papDiscounts: { excavation: 0.05 },
    subtotal: 43210.12,
    taxRate: 0.0825,
    taxAmount: 321.45,
    totalCost: 76543.21,
    pricing: { retailPrice: 76543.21, totalCOGS: 43210.12 },
    costBreakdown: {
      ...clone(base.costBreakdown),
      totals: { ...clone(base.costBreakdown.totals), grandTotal: 43210.12 },
    },
    contractOverrides: { p1_7: '$76,543.21' },
    warrantySections: [{ id: 'source-warranty', title: 'Source warranty', items: [] }],
    status: 'approved',
    versionLocked: true,
    versionLockedAt: '2026-07-01T00:00:00.000Z',
    versionSubmittedAt: '2026-07-01T00:00:00.000Z',
    workflow: { status: 'approved', approved: true },
  };

  const active = {
    ...clone(base),
    proposalNumber: source.proposalNumber,
    versionId: 'active-revision-2',
    versionName: 'Active Revision 2',
    pricingModelId: source.pricingModelId,
    pricingModelName: source.pricingModelName,
    pricingModelFranchiseId: source.pricingModelFranchiseId,
    pricingModelRevisionId: 'revision-2',
    pricingModelRevisionNumber: 2,
    activeVersionId: 'active-revision-2',
    versions: [source],
  };

  const copied = createVersionFromProposal(
    active,
    { mode: 'copy', sourceVersionId: source.versionId },
    'Copied Source'
  );

  assert.equal(copied.newVersion.versionCreationMode, 'copy');
  assert.equal(copied.newVersion.pricingModelRevisionId, source.pricingModelRevisionId);
  assert.equal(copied.newVersion.pricingModelRevisionNumber, source.pricingModelRevisionNumber);
  assert.deepEqual(copied.newVersion.pricingRevisionReview, source.pricingRevisionReview);
  assert.deepEqual(copied.newVersion.manualAdjustments, source.manualAdjustments);
  assert.deepEqual(copied.newVersion.retailAdjustments, source.retailAdjustments);
  assert.deepEqual(copied.newVersion.papDiscounts, source.papDiscounts);
  assert.deepEqual(copied.newVersion.costBreakdown, source.costBreakdown);
  assert.deepEqual(copied.newVersion.pricing, source.pricing);
  assert.equal(copied.newVersion.subtotal, source.subtotal);
  assert.equal(copied.newVersion.taxRate, source.taxRate);
  assert.equal(copied.newVersion.taxAmount, source.taxAmount);
  assert.equal(copied.newVersion.totalCost, source.totalCost);
  assert.deepEqual(copied.newVersion.contractOverrides, source.contractOverrides);
  assert.deepEqual(copied.newVersion.warrantySections, source.warrantySections);
  copied.newVersion.manualAdjustments.positive1 = 999;
  assert.equal(source.manualAdjustments.positive1, 125);
  copied.newVersion.manualAdjustments.positive1 = 125;
  assert.equal(copied.newVersion.status, 'draft');
  assert.equal(copied.newVersion.versionLocked, false);
  assert.equal(copied.newVersion.versionLockedAt, null);
  assert.equal(copied.newVersion.versionSubmittedAt, null);
  assert.equal(copied.newVersion.versionSubmittedBy, null);
  assert.equal(copied.newVersion.workflow, undefined);

  const persistedCopy = listAllVersions(copied.container).find(
    (version) => version.versionId === copied.newVersion.versionId
  );
  assert.equal(persistedCopy.pricingModelRevisionId, 'revision-1');
  assert.equal(persistedCopy.pricingModelRevisionNumber, 1);

  const scratch = createVersionFromProposal(active, { mode: 'scratch' }, 'Scratch');
  assert.equal(scratch.newVersion.versionCreationMode, 'scratch');
  assert.equal(scratch.newVersion.pricingModelId, undefined);
  assert.equal(scratch.newVersion.pricingModelRevisionId, undefined);

  const persistedScratch = listAllVersions(scratch.container).find(
    (version) => version.versionId === scratch.newVersion.versionId
  );
  assert.equal(persistedScratch.pricingModelId, undefined);
  assert.equal(persistedScratch.pricingModelRevisionId, undefined);

  const unpinnedExplicitModelVersion = {
    ...clone(source),
    versionId: 'explicit-model-without-revision',
    pricingModelRevisionId: undefined,
    pricingModelRevisionNumber: undefined,
  };
  const containerWithUnpinnedVersion = {
    ...clone(active),
    versions: [unpinnedExplicitModelVersion],
  };
  const normalizedUnpinnedVersion = listAllVersions(containerWithUnpinnedVersion).find(
    (version) => version.versionId === unpinnedExplicitModelVersion.versionId
  );
  assert.equal(normalizedUnpinnedVersion.pricingModelId, source.pricingModelId);
  assert.equal(normalizedUnpinnedVersion.pricingModelRevisionId, undefined);
  assert.equal(normalizedUnpinnedVersion.pricingModelRevisionNumber, undefined);
`;

const result = buildSync({
  stdin: {
    contents: testSource,
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'proposal-version-copy.verification.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  write: false,
  logLevel: 'silent',
});

const output = result.outputFiles?.[0]?.text;
assert.ok(output, 'The proposal-version verification bundle was not generated.');

const testModule = { exports: {} };
const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
execute(require, testModule, testModule.exports, __filename, __dirname);

console.log('Proposal version copy verification passed.');
