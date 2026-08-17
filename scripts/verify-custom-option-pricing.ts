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
import {
  applyHistoricalPricingProtection,
  buildHistoricalPricingReview,
} from '../src/utils/pricingEngineCompatibility';
import {
  getContractTotalCashPrice,
  getEditableContractFields,
} from '../src/services/contractGenerator';

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

const offContractBaseline = getDefaultProposal();
const offContractProposal = clone(offContractBaseline);
offContractProposal.excavation!.customOptions = [
  {
    name: 'Owner-direct excavation work',
    description: 'Tracked outside the construction contract',
    laborCost: 4228.814625,
    materialCost: 0,
    totalCost: 4228.814625,
    isOffContract: true,
  },
];
const offContractBaselinePricing = calculate(offContractBaseline, getDefaultPAPDiscounts());
const offContractPricing = calculate(offContractProposal, getDefaultPAPDiscounts());
assert.equal(
  offContractPricing.pricing.retailPrice,
  offContractBaselinePricing.pricing.retailPrice + 4228.814625,
  'Off-contract work was not added dollar-for-dollar to retail'
);
assert.equal(
  offContractPricing.pricing.totalCOGS,
  offContractBaselinePricing.pricing.totalCOGS,
  'Off-contract work changed pool COGS'
);
assert.equal(
  offContractPricing.pricing.offContractTotal,
  4228.814625,
  'Off-contract work was not retained in its separate total'
);
assert.equal(
  offContractPricing.pricing.digCommission,
  offContractBaselinePricing.pricing.digCommission,
  'Off-contract work changed dig commission'
);
assert.equal(
  offContractPricing.pricing.adminFee,
  offContractBaselinePricing.pricing.adminFee,
  'Off-contract work changed the admin fee'
);
assert.equal(
  offContractPricing.pricing.closeoutCommission,
  offContractBaselinePricing.pricing.closeoutCommission,
  'Off-contract work changed closeout commission'
);
assert.equal(
  getContractTotalCashPrice({
    ...offContractProposal,
    pricing: offContractPricing.pricing,
    totalCost: offContractPricing.totalCost,
  }),
  offContractPricing.pricing.retailPrice,
  'Contract cash price no longer matched total retail'
);

const contractFeatureProposal = clone(offContractBaseline);
contractFeatureProposal.createdDate = '2026-01-01T00:00:00.000Z';
contractFeatureProposal.customFeatures = {
  features: [
    {
      name: 'Visible contract feature',
      description: 'This belongs on the contract',
      laborCost: 100,
      materialCost: 0,
      totalCost: 100,
      isOffContract: false,
    },
    {
      name: 'Hidden off-contract feature',
      description: 'This must never appear on the contract',
      laborCost: 200,
      materialCost: 0,
      totalCost: 200,
      isOffContract: true,
    },
  ],
  totalCost: 300,
};
const contractFields = await getEditableContractFields(
  contractFeatureProposal,
  undefined,
  undefined,
  {
    id: 'off-contract-feature-test',
    label: 'Off-contract feature test',
    pdfUrl: '',
    pdfPath: '',
    staticPatches: [],
    fields: [
      {
        id: 'p2_additional_spec_73',
        page: 2,
        rect: [0, 0, 100, 10],
        label: 'Additional Specification 1',
        color: 'blue',
      },
      {
        id: 'p2_additional_spec_74',
        page: 2,
        rect: [0, 10, 100, 20],
        label: 'Additional Specification 2',
        color: 'blue',
      },
    ],
  }
);
const contractFieldText = contractFields.map((field) => field.autoValue).join('\n');
assert.match(contractFieldText, /Visible contract feature/);
assert.doesNotMatch(contractFieldText, /Hidden off-contract feature/);

const historicalDriftProposal = clone(offContractBaseline);
delete historicalDriftProposal.pricingEngineVersion;
historicalDriftProposal.pricing = {
  ...offContractBaselinePricing.pricing,
  retailPrice: offContractBaselinePricing.pricing.retailPrice + 1000,
};
historicalDriftProposal.totalCost = historicalDriftProposal.pricing.retailPrice;
const historicalDriftReview = buildHistoricalPricingReview(
  historicalDriftProposal,
  offContractBaselinePricing
);
assert.ok(historicalDriftReview, 'Historical engine drift did not receive a pricing review');
const protectedHistoricalPricing = calculate(
  applyHistoricalPricingProtection(historicalDriftProposal, historicalDriftReview),
  getDefaultPAPDiscounts()
);
assert.equal(
  protectedHistoricalPricing.pricing.retailPrice,
  historicalDriftProposal.pricing.retailPrice,
  'Historical saved baseline was not preserved'
);

console.log('Selected-model PAP, retail-only off-contract handling, contract filtering, and historical price protection verified.');
