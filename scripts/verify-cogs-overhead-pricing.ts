import assert from 'node:assert/strict';
import { MasterPricingEngine } from '../src/services/masterPricingEngine';
import { getPricingDataSnapshot, withTemporaryPricingSnapshot } from '../src/services/pricingDataStore';
import { getDefaultProposal } from '../src/utils/proposalDefaults';
import type { Proposal } from '../src/types/proposal-new';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const proposal = getDefaultProposal();
proposal.poolSpecs = {
  ...proposal.poolSpecs!,
  maxLength: 30,
  maxWidth: 15,
  surfaceArea: 450,
  perimeter: 90,
  shallowDepth: 3.5,
  endDepth: 6,
};
proposal.pricing = {
  overheadMultiplier: 1.5,
} as Proposal['pricing'];

const calculateAtRate = (rate: number) => {
  const snapshot = clone(getPricingDataSnapshot());
  snapshot.pricingDefaults.cogsOverheadRate = rate;
  return withTemporaryPricingSnapshot(snapshot, () =>
    MasterPricingEngine.calculateCompleteProposal(proposal, proposal.papDiscounts)
  );
};

const defaultResult = calculateAtRate(0.01);
const adjustedResult = calculateAtRate(0.025);

assert.equal(defaultResult.pricing.overheadMultiplier, 1.01);
assert.equal(adjustedResult.pricing.overheadMultiplier, 1.025);
assert.equal(
  adjustedResult.pricing.totalCostsBeforeOverhead,
  defaultResult.pricing.totalCostsBeforeOverhead,
  'Changing COGS overhead changed costs before overhead'
);
assert.ok(
  Math.abs(
    defaultResult.pricing.totalCOGS -
      defaultResult.pricing.totalCostsBeforeOverhead * 1.01
  ) < 1e-9,
  'The default 1% COGS overhead was not applied'
);
assert.ok(
  Math.abs(
    adjustedResult.pricing.totalCOGS -
      adjustedResult.pricing.totalCostsBeforeOverhead * 1.025
  ) < 1e-9,
  'The adjusted COGS overhead was not applied'
);
assert.ok(
  adjustedResult.pricing.totalCOGS > defaultResult.pricing.totalCOGS,
  'Increasing COGS overhead did not increase total COGS'
);

console.log('COGS overhead pricing verification passed.');
