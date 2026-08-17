import type { CostBreakdown, PAPDiscounts, PricingCalculations, Proposal } from '../types/proposal-new';
import {
  getCustomOptionTotal,
  hasCustomOptionContent,
  isOffContractCustomOption,
} from './customOptions';

type CorrectedPricingResult = {
  costBreakdown: CostBreakdown;
  pricing: PricingCalculations;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalCost: number;
};

export type CustomOptionPricingCorrectionReview = {
  storedRetailPrice: number;
  correctedRetailPrice: number;
  retailIncrease: number;
  categoryCustomOptionTotal: number;
};

const AFFECTED_SECTIONS = ['excavation', 'plumbing', 'electrical'] as const;

const hasPapLineForSection = (
  costBreakdown: CostBreakdown | undefined,
  section: (typeof AFFECTED_SECTIONS)[number]
): boolean =>
  (costBreakdown?.[section] || []).some((item) =>
    String(item.description || '').toLowerCase().includes('pap discount')
  );

const getZeroRateCustomOptionTotal = (
  proposal: Partial<Proposal>,
  corrected: CorrectedPricingResult
): number => {
  const discounts = (proposal.papDiscounts || {}) as Partial<PAPDiscounts>;
  return AFFECTED_SECTIONS.reduce((total, section) => {
    // A configured positive PAP legitimately applies to the custom option.
    if (Number(discounts[section]) > 0 || hasPapLineForSection(corrected.costBreakdown, section)) {
      return total;
    }
    const options = proposal[section]?.customOptions || [];
    return total + options
      .filter((option) => hasCustomOptionContent(option) && !isOffContractCustomOption(option))
      .reduce((sectionTotal, option) => sectionTotal + getCustomOptionTotal(option), 0);
  }, 0);
};

const getStoredRetailPrice = (proposal: Partial<Proposal>): number => {
  const retailPrice = Number(proposal.pricing?.retailPrice);
  if (Number.isFinite(retailPrice) && retailPrice > 0) return retailPrice;
  const totalCost = Number(proposal.totalCost);
  return Number.isFinite(totalCost) ? totalCost : 0;
};

const hasStoredZeroRatePapLine = (proposal: Partial<Proposal>): boolean => {
  const discounts = (proposal.papDiscounts || {}) as Partial<PAPDiscounts>;
  return AFFECTED_SECTIONS.some((section) =>
    Number(discounts[section]) <= 0 && hasPapLineForSection(proposal.costBreakdown, section)
  );
};

export function buildCustomOptionPricingCorrectionReview(
  proposal: Partial<Proposal>,
  corrected: CorrectedPricingResult
): CustomOptionPricingCorrectionReview | null {
  const categoryCustomOptionTotal = getZeroRateCustomOptionTotal(proposal, corrected);
  if (categoryCustomOptionTotal <= 0) return null;

  const storedRetailPrice = getStoredRetailPrice(proposal);
  const correctedRetailPrice = Number(corrected.pricing?.retailPrice ?? corrected.totalCost);
  const storedCogs = Number(proposal.pricing?.totalCOGS);
  const correctedCogs = Number(corrected.pricing?.totalCOGS);
  if (
    !Number.isFinite(storedRetailPrice) ||
    storedRetailPrice <= 0 ||
    !Number.isFinite(correctedRetailPrice) ||
    !Number.isFinite(storedCogs) ||
    !Number.isFinite(correctedCogs)
  ) {
    return null;
  }

  const retailIncrease = correctedRetailPrice - storedRetailPrice;
  const cogsIncrease = correctedCogs - storedCogs;
  if (retailIncrease < 1 || cogsIncrease < 0.5) return null;

  // A stale PAP line may already have been removed while normalizing a legacy
  // April profile. In that case the stored pricing totals remain the evidence.
  if (!hasStoredZeroRatePapLine(proposal) && cogsIncrease >= categoryCustomOptionTotal) {
    return null;
  }

  return {
    storedRetailPrice,
    correctedRetailPrice,
    retailIncrease,
    categoryCustomOptionTotal,
  };
}
