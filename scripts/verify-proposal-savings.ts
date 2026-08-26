import assert from 'node:assert/strict';
import { calculateCustomerSavingsSummary } from '../src/utils/proposalSavings';

const noDiscountSummary = calculateCustomerSavingsSummary({
  retailSalePrice: 266_318.88,
  baseRetailPriceBeforePap: 262_230,
  pricing: {
    baseRetailPrice: 262_230,
    discountAmount: 0,
    historicalPricingAdjustment: 4_088.88,
  },
  manualAdjustments: {
    positive1: 0,
    positive2: 0,
    negative1: 0,
    negative2: 0,
  },
  retailAdjustments: [],
});

assert.deepEqual(noDiscountSummary, {
  retailPriceBeforeDiscounts: 266_318.88,
  retailSalePrice: 266_318.88,
  totalSavings: 0,
  totalSavingsPercent: 0,
});

const incompleteHistoricalPricingSummary = calculateCustomerSavingsSummary({
  retailSalePrice: 125_000,
  baseRetailPriceBeforePap: 120_000,
  pricing: { retailPrice: 125_000 },
});

assert.equal(
  incompleteHistoricalPricingSummary.totalSavings,
  0,
  'A missing historical base-retail field must not turn the whole base price into savings'
);

const mixedDiscountSummary = calculateCustomerSavingsSummary({
  retailSalePrice: 270_000,
  baseRetailPriceBeforePap: 265_000,
  pricing: {
    baseRetailPrice: 262_000,
    discountAmount: -100,
  },
  manualAdjustments: {
    positive1: 10_000,
    positive2: 0,
    negative1: 500,
    negative2: 0,
  },
  retailAdjustments: [
    { name: 'Positive customer change', amount: 2_000 },
    { name: 'Customer discount', amount: -750 },
  ],
  customFeatureItems: [
    {
      category: 'Custom Features',
      description: 'Retail-only discount',
      unitPrice: -250,
      quantity: 1,
      total: -250,
    },
  ],
});

assert.equal(mixedDiscountSummary.totalSavings, 4_600);
assert.equal(mixedDiscountSummary.retailPriceBeforeDiscounts, 274_600);
assert.equal(
  mixedDiscountSummary.totalSavingsPercent,
  (mixedDiscountSummary.totalSavings / mixedDiscountSummary.retailPriceBeforeDiscounts) * 100
);

console.log('Proposal savings verification passed.');
