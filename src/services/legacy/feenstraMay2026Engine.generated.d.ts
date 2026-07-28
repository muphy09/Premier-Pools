import type {
  PAPDiscounts,
  Proposal,
} from '../../types/proposal-new';
import type { MasterPricingEngine } from '../masterPricingEngine';
import type { PricingData } from '../pricingData';

export function calculateFeenstraMay2026Proposal(
  proposal: Partial<Proposal>,
  papDiscounts: PAPDiscounts | undefined,
  pricingSnapshot: PricingData
): ReturnType<typeof MasterPricingEngine.calculateCompleteProposal>;
