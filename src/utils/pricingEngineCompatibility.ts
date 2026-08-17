import type { Proposal } from '../types/proposal-new';

export const CURRENT_PRICING_ENGINE_VERSION = '2026-08-17-selected-model-v1' as const;

type PricingResult = {
  pricing: {
    retailPrice: number;
    offContractTotal?: number;
  };
  totalCost: number;
};

export type HistoricalPricingReview = {
  storedRetailPrice: number;
  protectedRetailPrice: number;
  currentCalculatedPrice: number;
  preservationAdjustment: number;
};

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const getStoredRetailPrice = (proposal: Partial<Proposal>): number => {
  const storedRetailPrice = Number(proposal.pricing?.retailPrice);
  if (Number.isFinite(storedRetailPrice) && storedRetailPrice > 0) return storedRetailPrice;
  const storedTotal = Number(proposal.totalCost);
  return Number.isFinite(storedTotal) ? storedTotal : 0;
};

export function isCurrentPricingEngineProposal(proposal: Partial<Proposal>): boolean {
  return proposal.pricingEngineVersion === CURRENT_PRICING_ENGINE_VERSION;
}

/**
 * Older proposals pin their pricing-model inputs, but historically did not pin
 * the calculation rules. Preserve their saved pool-price baseline so a later
 * engine release cannot silently reprice unrelated work. Off-contract work is
 * part of the saved retail baseline, while downstream calculations keep it out
 * of COGS, commissions, margins, and the construction contract.
 */
export function buildHistoricalPricingReview(
  proposal: Partial<Proposal>,
  currentCalculation: PricingResult
): HistoricalPricingReview | null {
  if (proposal.calculationProfile || isCurrentPricingEngineProposal(proposal)) return null;

  const storedRetailPrice = getStoredRetailPrice(proposal);
  const currentCalculatedPrice = Number(
    currentCalculation.pricing?.retailPrice ?? currentCalculation.totalCost
  );
  if (
    !Number.isFinite(storedRetailPrice) ||
    storedRetailPrice <= 0 ||
    !Number.isFinite(currentCalculatedPrice)
  ) {
    return null;
  }

  const protectedRetailPrice = roundCurrency(storedRetailPrice);
  const preservationAdjustment = roundCurrency(protectedRetailPrice - currentCalculatedPrice);

  if (Math.abs(preservationAdjustment) < 0.01) {
    return null;
  }

  return {
    storedRetailPrice: roundCurrency(storedRetailPrice),
    protectedRetailPrice,
    currentCalculatedPrice: roundCurrency(currentCalculatedPrice),
    preservationAdjustment,
  };
}

export function applyHistoricalPricingProtection<T extends Partial<Proposal>>(
  proposal: T,
  review: HistoricalPricingReview | null
): T {
  return {
    ...proposal,
    pricingEngineVersion: CURRENT_PRICING_ENGINE_VERSION,
    historicalPricingAdjustment: review?.preservationAdjustment ?? 0,
  };
}
