import type { Proposal } from '../../types/proposal-new';

export const FEENSTRA_MAY_2026_CALCULATION_PROFILE =
  'feenstra-may-11-2026-v2.3.9' as const;
export const FEENSTRA_PROPOSAL_NUMBER = 'PROP-1775269396758';
export const FEENSTRA_FRANCHISE_ID = 'b4c27ce1-1485-4211-8336-3e2d2ef18a14';
export const FEENSTRA_PRICING_MODEL_ID = '0abaae9d-3b7a-497c-a228-829ade7e6d4f';
export const FEENSTRA_PRICING_MODEL_REVISION_ID =
  '8e59f0ee-0ef9-4259-a262-bba10d298808';

type ProposalCalculationProfileInput = Pick<
  Partial<Proposal>,
  | 'calculationProfile'
  | 'proposalNumber'
  | 'franchiseId'
  | 'pricingModelId'
  | 'pricingModelRevisionId'
  | 'pricingTierId'
>;

export function shouldUseFeenstraMay2026Pricing(
  proposal: ProposalCalculationProfileInput
): boolean {
  if (
    proposal.calculationProfile !== FEENSTRA_MAY_2026_CALCULATION_PROFILE ||
    proposal.proposalNumber !== FEENSTRA_PROPOSAL_NUMBER
  ) {
    return false;
  }

  if (
    proposal.franchiseId !== FEENSTRA_FRANCHISE_ID ||
    proposal.pricingModelId !== FEENSTRA_PRICING_MODEL_ID ||
    proposal.pricingModelRevisionId !== FEENSTRA_PRICING_MODEL_REVISION_ID ||
    (proposal.pricingTierId !== undefined && proposal.pricingTierId !== 'normal')
  ) {
    throw new Error(
      'Feenstra contract pricing is locked to the May 11 pricing model. Restore the proposal pricing pin before recalculating.'
    );
  }

  return true;
}
