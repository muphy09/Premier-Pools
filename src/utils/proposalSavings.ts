import type {
  CostLineItem,
  ManualAdjustments,
  PricingCalculations,
  RetailAdjustment,
} from '../types/proposal-new';

type CustomerSavingsInput = {
  retailSalePrice: number;
  baseRetailPriceBeforePap: number;
  pricing?: Partial<PricingCalculations> | null;
  manualAdjustments?: Partial<ManualAdjustments> | null;
  retailAdjustments?: RetailAdjustment[] | null;
  customFeatureItems?: CostLineItem[] | null;
};

export type CustomerSavingsSummary = {
  retailPriceBeforeDiscounts: number;
  retailSalePrice: number;
  totalSavings: number;
  totalSavingsPercent: number;
};

const toFiniteNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const sumNegativeAmounts = (values: unknown[]): number =>
  values.reduce<number>((sum, value) => {
    const amount = toFiniteNumber(value);
    return amount < 0 ? sum + Math.abs(amount) : sum;
  }, 0);

/**
 * Builds the customer-facing savings figures from actual discount inputs.
 *
 * The final retail price can also contain non-discount amounts such as positive
 * adjustments, off-contract work, automatic-cover retail pricing, and a
 * historical price-preservation adjustment. Deriving savings by subtracting
 * final retail from the base price mislabels those amounts as negative savings.
 */
export function calculateCustomerSavingsSummary({
  retailSalePrice,
  baseRetailPriceBeforePap,
  pricing,
  manualAdjustments,
  retailAdjustments,
  customFeatureItems,
}: CustomerSavingsInput): CustomerSavingsSummary {
  const safeRetailSalePrice = roundCurrency(toFiniteNumber(retailSalePrice));
  const currentBaseRetailPrice = Number(pricing?.baseRetailPrice);
  const papSavings = Number.isFinite(currentBaseRetailPrice)
    ? Math.max(0, toFiniteNumber(baseRetailPriceBeforePap) - currentBaseRetailPrice)
    : 0;
  const pricingDiscount = Math.abs(Math.min(0, toFiniteNumber(pricing?.discountAmount)));
  const manualDiscounts =
    Math.max(0, toFiniteNumber(manualAdjustments?.negative1)) +
    Math.max(0, toFiniteNumber(manualAdjustments?.negative2));
  const retailAdjustmentDiscounts = sumNegativeAmounts(
    (retailAdjustments || []).map((adjustment) => adjustment?.amount)
  );
  const customFeatureDiscounts = sumNegativeAmounts(
    (customFeatureItems || []).map((item) => item?.total)
  );

  const totalSavings = roundCurrency(
    papSavings +
      pricingDiscount +
      manualDiscounts +
      retailAdjustmentDiscounts +
      customFeatureDiscounts
  );
  const retailPriceBeforeDiscounts = roundCurrency(safeRetailSalePrice + totalSavings);
  const totalSavingsPercent =
    retailPriceBeforeDiscounts > 0 ? (totalSavings / retailPriceBeforeDiscounts) * 100 : 0;

  return {
    retailPriceBeforeDiscounts,
    retailSalePrice: safeRetailSalePrice,
    totalSavings,
    totalSavingsPercent,
  };
}
