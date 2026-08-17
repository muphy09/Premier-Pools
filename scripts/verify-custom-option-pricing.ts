import assert from 'node:assert/strict';
import { MasterPricingEngine } from '../src/services/masterPricingEngine';
import pricingData from '../src/services/pricingData';
import {
  getPricingDataSnapshot,
  withTemporaryPricingSnapshot,
} from '../src/services/pricingDataStore';
import { getDefaultPAPDiscounts, getDefaultProposal } from '../src/utils/proposalDefaults';
import type { PAPDiscounts, Proposal } from '../src/types/proposal-new';
import { buildCustomOptionPricingCorrectionReview } from '../src/utils/customOptionPricingCorrection';

const CUSTOM_OPTION_COST = 1800;
const OVERHEAD_MULTIPLIER = 1.01;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const calculate = (
  proposal: Partial<Proposal>,
  selectedModelPapDiscounts: PAPDiscounts,
  suppliedProposalDiscounts: PAPDiscounts = selectedModelPapDiscounts
) => {
  const selectedModelSnapshot = getPricingDataSnapshot();
  selectedModelSnapshot.papDiscountRates = { ...selectedModelPapDiscounts };
  return withTemporaryPricingSnapshot(selectedModelSnapshot, () =>
    MasterPricingEngine.calculateCompleteProposal(proposal, suppliedProposalDiscounts)
  );
};

const calculateWhileActiveModelDiffers = (
  proposal: Partial<Proposal>,
  selectedModelPapDiscounts: PAPDiscounts,
  suppliedProposalDiscounts: PAPDiscounts = selectedModelPapDiscounts
) => {
  const activeModelDiscounts = {
    ...getDefaultPAPDiscounts(),
    excavation: 0.15,
    plumbing: 0.15,
    electrical: 0.15,
  };
  const activeModelSnapshot = getPricingDataSnapshot();
  activeModelSnapshot.papDiscountRates = activeModelDiscounts;
  return withTemporaryPricingSnapshot(activeModelSnapshot, () => {
    const result = calculate(proposal, selectedModelPapDiscounts, suppliedProposalDiscounts);
    assert.deepEqual(
      pricingData.papDiscountRates,
      activeModelDiscounts,
      'Selected-model calculation did not restore the different active model'
    );
    return result;
  });
};

const assertPriceIncrease = (
  label: string,
  baseline: ReturnType<typeof calculate>,
  withCustomOption: ReturnType<typeof calculate>,
  expectedCogsIncrease: number,
  expectedRetailMinimum: number,
  expectedRetailMaximum: number
) => {
  const cogsIncrease = withCustomOption.pricing.totalCOGS - baseline.pricing.totalCOGS;
  const retailIncrease = withCustomOption.pricing.retailPrice - baseline.pricing.retailPrice;

  assert.equal(cogsIncrease, expectedCogsIncrease, `${label} custom option COGS was incorrect`);
  assert.ok(
    retailIncrease >= expectedRetailMinimum && retailIncrease <= expectedRetailMaximum,
    `${label} $1,800 custom option increased retail by $${retailIncrease}, expected $${expectedRetailMinimum}-$${expectedRetailMaximum}`
  );
};

const cases: Array<{
  label: string;
  section: 'excavation' | 'plumbing' | 'electrical';
  discount: 'excavation' | 'plumbing' | 'electrical';
}> = [
  { label: 'Excavation', section: 'excavation', discount: 'excavation' },
  { label: 'Plumbing', section: 'plumbing', discount: 'plumbing' },
  { label: 'Electrical', section: 'electrical', discount: 'electrical' },
];

cases.forEach(({ label, section, discount }) => {
  const baselineProposal = getDefaultProposal();
  const customOptionProposal = clone(baselineProposal);
  customOptionProposal[section]!.customOptions = [
    {
      name: `${label} test option`,
      description: 'Pricing verification',
      laborCost: 1000,
      materialCost: 800,
      totalCost: CUSTOM_OPTION_COST,
      isOffContract: false,
    },
  ];

  const noPapDiscounts = getDefaultPAPDiscounts();
  const staleProposalDiscounts = { ...getDefaultPAPDiscounts(), [discount]: 0.2 };
  customOptionProposal.papDiscounts = staleProposalDiscounts;
  const zeroPapBaseline = calculateWhileActiveModelDiffers(
    baselineProposal,
    noPapDiscounts,
    staleProposalDiscounts
  );
  const zeroPapCustom = calculateWhileActiveModelDiffers(
    customOptionProposal,
    noPapDiscounts,
    staleProposalDiscounts
  );
  assert.equal(
    zeroPapCustom.costBreakdown[section].some((item) => item.description === 'PAP Discount'),
    false,
    `${label} received a PAP line even though its configured rate is zero`
  );
  assertPriceIncrease(
    `${label} with selected-model PAP at zero`,
    zeroPapBaseline,
    zeroPapCustom,
    CUSTOM_OPTION_COST * OVERHEAD_MULTIPLIER,
    2590,
    2600
  );

  const categoryPapDiscounts = { ...getDefaultPAPDiscounts(), [discount]: 0.2 };
  const papBaseline = calculateWhileActiveModelDiffers(
    baselineProposal,
    categoryPapDiscounts,
    noPapDiscounts
  );
  const papCustom = calculateWhileActiveModelDiffers(
    customOptionProposal,
    categoryPapDiscounts,
    noPapDiscounts
  );
  const baselineDiscount = papBaseline.costBreakdown[section].find(
    (item) => item.description === 'PAP Discount'
  )?.total;
  const optionDiscount = papCustom.costBreakdown[section].find(
    (item) => item.description === 'PAP Discount'
  )?.total;

  assert.equal(
    Number(((optionDiscount || 0) - (baselineDiscount || 0)).toFixed(2)),
    -(CUSTOM_OPTION_COST * 0.2),
    `${label} custom option did not receive the selected model's PAP discount`
  );
  assertPriceIncrease(
    `${label} with selected-model PAP at 20%`,
    papBaseline,
    papCustom,
    CUSTOM_OPTION_COST * (1 - 0.2) * OVERHEAD_MULTIPLIER,
    2070,
    2080
  );
});

const legacyProposal = getDefaultProposal();
legacyProposal.excavation.customOptions = [
  {
    name: 'Legacy excavation option',
    description: 'Affected April pricing example',
    laborCost: 1000,
    materialCost: 800,
    totalCost: CUSTOM_OPTION_COST,
    isOffContract: false,
  },
];
const legacyStoredDiscounts = { ...getDefaultPAPDiscounts(), excavation: 0.1 };
legacyProposal.papDiscounts = legacyStoredDiscounts;
const correctedLegacyPricing = calculate(
  legacyProposal,
  getDefaultPAPDiscounts(),
  legacyStoredDiscounts
);
const storedLegacyProposal = clone(legacyProposal);
storedLegacyProposal.papDiscounts = getDefaultPAPDiscounts();
storedLegacyProposal.costBreakdown = correctedLegacyPricing.costBreakdown;
storedLegacyProposal.pricing = {
  ...correctedLegacyPricing.pricing,
  totalCOGS: correctedLegacyPricing.pricing.totalCOGS - CUSTOM_OPTION_COST * 0.1 * OVERHEAD_MULTIPLIER,
  retailPrice: correctedLegacyPricing.pricing.retailPrice - 260,
};
storedLegacyProposal.totalCost = correctedLegacyPricing.totalCost - 260;

const correctionReview = buildCustomOptionPricingCorrectionReview(
  storedLegacyProposal,
  correctedLegacyPricing
);
assert.ok(correctionReview, 'Affected stored proposal did not receive a pricing correction review');
assert.equal(correctionReview.correctedRetailPrice, correctedLegacyPricing.pricing.retailPrice);
assert.equal(
  buildCustomOptionPricingCorrectionReview(
    {
      ...storedLegacyProposal,
      pricing: correctedLegacyPricing.pricing,
      totalCost: correctedLegacyPricing.totalCost,
    },
    correctedLegacyPricing
  ),
  null,
  'Already-corrected proposal was prompted again'
);

console.log('Selected-model PAP rates control category custom options; stale stored rates cannot override zero.');
