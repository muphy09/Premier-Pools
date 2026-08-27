import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import DrainageSectionNew from '../../src/components/DrainageSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import {
  calculateDrainagePriceImpact,
  getDrainagePriceImpactTargetKey,
  type DrainagePriceImpactTarget,
  type PriceImpactDisplayBasis,
  type PriceImpactResult,
} from '../../src/services/priceImpact';
import type { Drainage } from '../../src/types/proposal-new';
import { getDefaultDrainage, getDefaultProposal } from '../../src/utils/proposalDefaults';
import '../../src/index.css';

const query = new URLSearchParams(window.location.search);
const hidePriceImpact = query.get('priceImpact') === 'off';
const displayBasis: PriceImpactDisplayBasis = query.get('basis') === 'cogs' ? 'cogs' : 'retail';
const impactCache = new Map<string, PriceImpactResult>();
let comparisonCalculationCount = 0;
let proposalChangeCount = 0;

(window as Window & {
  getPriceImpactCalculationCount?: () => number;
  getProposalChangeCount?: () => number;
})
  .getPriceImpactCalculationCount = () => comparisonCalculationCount;
(window as Window & { getProposalChangeCount?: () => number })
  .getProposalChangeCount = () => proposalChangeCount;

function DrainagePriceImpactFixture() {
  const [drainage, setDrainage] = useState<Drainage>({
    ...getDefaultDrainage(),
    downspoutTotalLF: 20,
    deckDrainTotalLF: 10,
    frenchDrainTotalLF: 35,
    boxDrainTotalLF: 2,
    customOptions: [
      {
        name: 'Drainage Catch Basin',
        description: 'Fixture drainage labor and material',
        laborCost: 150,
        materialCost: 50,
        totalCost: 200,
        isOffContract: false,
      },
      {
        name: 'Off-Contract Drainage Option',
        description: 'Fixture off-contract drainage option',
        laborCost: 200,
        materialCost: 100,
        totalCost: 300,
        isOffContract: true,
      },
    ],
  });

  const getDrainagePriceImpact = (target: DrainagePriceImpactTarget) => {
    const proposalStateKey = JSON.stringify(drainage);
    const cacheKey = `${proposalStateKey}:${displayBasis}:${getDrainagePriceImpactTargetKey(target)}`;
    const cached = impactCache.get(cacheKey);
    if (cached) return cached;

    const proposal = getDefaultProposal();
    proposal.poolSpecs = {
      ...proposal.poolSpecs,
      perimeter: 100,
      surfaceArea: 500,
      shallowDepth: 3,
      endDepth: 6,
      maxWidth: 20,
      maxLength: 40,
    };
    proposal.drainage = drainage;
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    comparisonCalculationCount += 1;
    const result = calculateDrainagePriceImpact({
      proposal,
      target,
      displayBasis,
      currentCalculation,
    });
    impactCache.set(cacheKey, result);
    return result;
  };

  return (
    <main style={{ width: 'min(1180px, calc(100vw - 48px))', margin: '24px auto 100px' }}>
      <DrainageSectionNew
        data={drainage}
        onChange={(next) => {
          proposalChangeCount += 1;
          setDrainage(next);
        }}
        priceImpactRequestKey={`${displayBasis}:${JSON.stringify(drainage)}`}
        getDrainagePriceImpact={hidePriceImpact ? undefined : getDrainagePriceImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <DrainagePriceImpactFixture />
    </ToastProvider>
  </React.StrictMode>
);
