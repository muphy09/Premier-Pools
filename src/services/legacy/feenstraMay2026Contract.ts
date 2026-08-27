import type { Proposal } from '../../types/proposal-new';
import { shouldUseFeenstraMay2026Pricing } from './feenstraMay2026Profile';

export const FEENSTRA_MAY_2026_CONTRACT_CASH_PRICE = 75_800;

export function resolveFeenstraMay2026ContractCashPrice(
  proposal: Partial<Proposal>
): number | null {
  if (!shouldUseFeenstraMay2026Pricing(proposal)) {
    return null;
  }

  // This is the signed May 11 construction-contract amount recorded by the
  // production repair. Later edits belong to copied proposal versions and may
  // change their retail/off-contract totals, but they must never reprice the
  // already-signed construction contract or its deposit schedule.
  return FEENSTRA_MAY_2026_CONTRACT_CASH_PRICE;
}
