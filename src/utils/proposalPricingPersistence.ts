import MasterPricingEngine from '../services/masterPricingEngine';
import { withTemporaryPricingSnapshot } from '../services/pricingDataStore';
import type { PricingData } from '../services/pricingTiers';
import type { Proposal, RetailAdjustment } from '../types/proposal-new';
import {
  applyHistoricalPricingProtection,
  buildHistoricalPricingReview,
  isCurrentPricingEngineProposal,
} from './pricingEngineCompatibility';

type MergeProposalWithDefaults = (input: Partial<Proposal>) => Partial<Proposal>;

/**
 * Recalculate every persisted pricing field when a customer-facing retail
 * adjustment is edited outside the proposal builder. This keeps the saved
 * inputs and totals on the same pricing-model revision.
 */
export function recalculateProposalForRetailAdjustmentSave(options: {
  proposal: Proposal;
  retailAdjustments: RetailAdjustment[];
  pricingSnapshot: PricingData;
  mergeWithDefaults: MergeProposalWithDefaults;
}): Proposal {
  const { proposal, retailAdjustments, pricingSnapshot, mergeWithDefaults } = options;

  let pricingBaseline = proposal;
  if (!isCurrentPricingEngineProposal(proposal)) {
    const baselineInput = withTemporaryPricingSnapshot(
      pricingSnapshot,
      () => mergeWithDefaults(proposal) as Proposal
    );
    const baselineCalculation = withTemporaryPricingSnapshot(
      pricingSnapshot,
      () => MasterPricingEngine.calculateCompleteProposal(baselineInput, baselineInput.papDiscounts)
    );
    pricingBaseline = applyHistoricalPricingProtection(
      proposal,
      buildHistoricalPricingReview(proposal, baselineCalculation)
    );
  }

  const adjustedProposal: Proposal = {
    ...pricingBaseline,
    retailAdjustments,
  };
  const calculationInput = withTemporaryPricingSnapshot(
    pricingSnapshot,
    () => mergeWithDefaults(adjustedProposal) as Proposal
  );
  const calculation = withTemporaryPricingSnapshot(
    pricingSnapshot,
    () => MasterPricingEngine.calculateCompleteProposal(calculationInput, calculationInput.papDiscounts)
  );

  return {
    ...proposal,
    pricingEngineVersion: pricingBaseline.pricingEngineVersion,
    historicalPricingAdjustment: pricingBaseline.historicalPricingAdjustment,
    retailAdjustments,
    costBreakdown: calculation.costBreakdown,
    pricing: calculation.pricing,
    subtotal: calculation.subtotal,
    taxRate: calculation.taxRate,
    taxAmount: calculation.taxAmount,
    totalCost: calculation.totalCost,
  };
}
