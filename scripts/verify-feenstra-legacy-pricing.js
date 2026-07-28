const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const testSource = `
  import assert from 'node:assert/strict';
  import { getDefaultProposal } from './src/utils/proposalDefaults';
  import { createVersionFromProposal, listAllVersions } from './src/utils/proposalVersions';
  import MasterPricingEngine from './src/services/masterPricingEngine';
  import pricingData from './src/services/pricingData';
  import { calculateFeenstraMay2026Proposal } from './src/services/legacy/feenstraMay2026Engine.generated.js';
  import {
    FEENSTRA_FRANCHISE_ID,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE,
    FEENSTRA_PRICING_MODEL_ID,
    FEENSTRA_PRICING_MODEL_REVISION_ID,
    FEENSTRA_PROPOSAL_NUMBER,
    shouldUseFeenstraMay2026Pricing,
  } from './src/services/legacy/feenstraMay2026Profile';

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const base = getDefaultProposal();
  const legacyProposal = {
    ...clone(base),
    proposalNumber: FEENSTRA_PROPOSAL_NUMBER,
    franchiseId: FEENSTRA_FRANCHISE_ID,
    pricingModelId: FEENSTRA_PRICING_MODEL_ID,
    pricingModelRevisionId: FEENSTRA_PRICING_MODEL_REVISION_ID,
    calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
    poolSpecs: {
      ...clone(base.poolSpecs),
      poolType: 'gunite',
      poolShape: 'geometric',
      maxLength: 30,
      maxWidth: 15,
      surfaceArea: 450,
      perimeter: 90,
      shallowDepth: 3.5,
      endDepth: 6,
    },
  };

  assert.equal(shouldUseFeenstraMay2026Pricing(legacyProposal), true);
  assert.equal(
    shouldUseFeenstraMay2026Pricing({
      ...legacyProposal,
      proposalNumber: 'PROP-NOT-FEENSTRA',
    }),
    false
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        pricingModelRevisionId: 'wrong-revision',
    }),
    /locked to the May 1 pricing model/
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        franchiseId: 'wrong-franchise',
      }),
    /locked to the May 1 pricing model/
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        pricingModelId: 'wrong-model',
      }),
    /locked to the May 1 pricing model/
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        pricingTierId: 'bronze',
      }),
    /locked to the May 1 pricing model/
  );

  const pricingBefore = clone(pricingData);
  const dispatched = MasterPricingEngine.calculateCompleteProposal(
    legacyProposal,
    legacyProposal.papDiscounts
  );
  const directLegacy = calculateFeenstraMay2026Proposal(
    legacyProposal,
    legacyProposal.papDiscounts,
    pricingData
  );
  assert.deepEqual(dispatched, directLegacy);
  assert.deepEqual(pricingData, pricingBefore);
  assert.equal(dispatched.totalCost, 60940);
  assert.equal(dispatched.pricing.totalCOGS, 42653.161024999994);
  assert.equal(dispatched.subtotal, 42230.85249999999);

  const ordinary = {
    ...clone(legacyProposal),
    proposalNumber: 'PROP-ORDINARY',
    calculationProfile: undefined,
  };
  const ordinaryWithCopiedProfile = {
    ...ordinary,
    calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
  };
  const ordinaryCalculation = MasterPricingEngine.calculateCompleteProposal(
    ordinary,
    ordinary.papDiscounts
  );
  assert.equal(dispatched.taxRate, 0);
  assert.equal(ordinaryCalculation.taxRate, 0.0725);
  assert.deepEqual(
    ordinaryCalculation,
    MasterPricingEngine.calculateCompleteProposal(
      ordinaryWithCopiedProfile,
      ordinaryWithCopiedProfile.papDiscounts
    )
  );

  const copied = createVersionFromProposal(
    legacyProposal,
    { mode: 'copy', sourceVersionId: legacyProposal.versionId },
    'Legacy copy'
  );
  assert.equal(
    copied.newVersion.calculationProfile,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE
  );

  const scratch = createVersionFromProposal(
    legacyProposal,
    { mode: 'scratch' },
    'Legacy scratch'
  );
  assert.equal(
    scratch.newVersion.calculationProfile,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE
  );
  assert.equal(scratch.newVersion.pricingModelId, FEENSTRA_PRICING_MODEL_ID);
  assert.equal(
    scratch.newVersion.pricingModelRevisionId,
    FEENSTRA_PRICING_MODEL_REVISION_ID
  );
  assert.equal(scratch.newVersion.pricingTierId, 'normal');
  assert.equal(shouldUseFeenstraMay2026Pricing(scratch.newVersion), true);
  assert.equal(
    listAllVersions(scratch.container).find(
      (version) => version.versionId === scratch.newVersion.versionId
    )?.calculationProfile,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE
  );

  console.log(
    JSON.stringify({
      legacyRetail: dispatched.totalCost,
      legacyCogs: dispatched.pricing.totalCOGS,
      legacySubtotal: dispatched.subtotal,
    })
  );
`;

const result = buildSync({
  stdin: {
    contents: testSource,
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'feenstra-legacy-pricing.verification.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  write: false,
  logLevel: 'silent',
});

const output = result.outputFiles?.[0]?.text;
assert.ok(output, 'The Feenstra legacy pricing verification bundle was not generated.');

const testModule = { exports: {} };
const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
execute(require, testModule, testModule.exports, __filename, __dirname);

console.log('Feenstra legacy pricing verification passed.');
