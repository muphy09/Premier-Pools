import type { Proposal } from '../../types/proposal-new';
import { shouldUseFeenstraMay2026Pricing } from './feenstraMay2026Profile';

const MAY_CONTRACT_RECONCILIATION = 730.2375;

const getStoredRetailPrice = (proposal: Partial<Proposal>): number =>
  Number(
    proposal.pricing?.retailPrice ??
      proposal.pricing?.baseRetailPrice ??
      proposal.totalCost ??
      proposal.subtotal ??
      0
  );

export function resolveFeenstraMay2026ContractCashPrice(
  proposal: Partial<Proposal>
): number | null {
  if (!shouldUseFeenstraMay2026Pricing(proposal)) {
    return null;
  }

  const retailPrice = getStoredRetailPrice(proposal);
  const offContractTotal = Number(proposal.pricing?.offContractTotal ?? 0);
  const storedReconciliation = Number(proposal.manualAdjustments?.negative1 ?? 0);
  if (
    !Number.isFinite(retailPrice) ||
    !Number.isFinite(offContractTotal) ||
    !Number.isFinite(storedReconciliation)
  ) {
    throw new Error('Feenstra contract pricing requires valid May retail and off-contract totals.');
  }

  // The signed May construction contract excludes off-contract work and uses
  // the editable copy's $730.2375 reconciliation. The protected customer-sheet
  // baseline carries an additional $286 residual, which must not reduce the
  // construction contract. Keep both reconciliations isolated to Feenstra.
  return Math.max(
    0,
    Math.round(
      retailPrice -
        offContractTotal +
        storedReconciliation -
        MAY_CONTRACT_RECONCILIATION
    )
  );
}
