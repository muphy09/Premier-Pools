import type { CostBreakdown, PAPDiscounts, PricingCalculations, Proposal } from '../types/proposal-new';
import {
  getCustomOptionTotal,
  hasCustomOptionContent,
  isOffContractCustomOption,
} from './customOptions';
import { createVersionFromProposal, upsertVersionInContainer } from './proposalVersions';

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

export type CorrectedPricingVersionResult = {
  container: Proposal;
  correctedVersion: Proposal;
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

const getCorrectionSourceName = (source: Partial<Proposal>): string =>
  source.versionName?.trim() ||
  source.customerInfo?.customerName?.trim() ||
  source.proposalNumber?.trim() ||
  'Proposal';

/**
 * Preserve the source version exactly and place recalculated pricing on a new,
 * active draft version so accepting a correction is always reversible.
 */
export function createCorrectedPricingVersion(
  container: Proposal,
  source: Proposal,
  corrected: CorrectedPricingResult
): CorrectedPricingVersionResult {
  const sourceVersionId = source.versionId || container.activeVersionId || container.versionId || 'original';
  const correctedVersionName = `Corrected Pricing - ${getCorrectionSourceName(source)}`;
  const created = createVersionFromProposal(
    container,
    { mode: 'copy', sourceVersionId },
    correctedVersionName
  );
  const now = new Date().toISOString();
  const correctedVersion: Proposal = {
    ...created.newVersion,
    versionSourceId: sourceVersionId,
    status: 'draft',
    costBreakdown: corrected.costBreakdown,
    pricing: corrected.pricing,
    subtotal: corrected.subtotal,
    taxRate: corrected.taxRate,
    taxAmount: corrected.taxAmount,
    totalCost: corrected.totalCost,
    lastModified: now,
    versions: [],
  };
  const nextContainer = upsertVersionInContainer(
    created.container,
    correctedVersion,
    correctedVersion.versionId
  );

  return {
    container: {
      ...nextContainer,
      status: 'draft',
      lastModified: now,
      activeVersionId: correctedVersion.versionId,
    },
    correctedVersion,
  };
}
