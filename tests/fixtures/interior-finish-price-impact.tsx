import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import InteriorFinishSectionNew from '../../src/components/InteriorFinishSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import {
  calculateInteriorFinishPriceImpact,
  getInteriorFinishPriceImpactTargetKey,
  type InteriorFinishPriceImpactTarget,
  type PriceImpactDisplayBasis,
  type PriceImpactResult,
} from '../../src/services/priceImpact';
import pricingData from '../../src/services/pricingData';
import type { InteriorFinish } from '../../src/types/proposal-new';
import { getDefaultProposal } from '../../src/utils/proposalDefaults';
import '../../src/index.css';

const query = new URLSearchParams(window.location.search);
const hidePriceImpact = query.get('priceImpact') === 'off';
const displayBasis: PriceImpactDisplayBasis = query.get('basis') === 'cogs' ? 'cogs' : 'retail';
const impactCache = new Map<string, PriceImpactResult>();
let proposalChangeCount = 0;

declare global {
  interface Window {
    getProposalChangeCount: () => number;
  }
}

window.getProposalChangeCount = () => proposalChangeCount;

const configuredFinishes = pricingData.interiorFinish.finishes || [];
const fixtureFinish = configuredFinishes[2] || configuredFinishes[1] || configuredFinishes[0];

function InteriorFinishFixture() {
  const [data, setData] = useState<InteriorFinish>(() => ({
    ...getDefaultProposal().interiorFinish,
    finishType: fixtureFinish?.id || '',
    color: fixtureFinish?.colors?.[0] || '',
    hasSpa: false,
    hasWaterproofing: true,
    customOptions: [{
      name: 'Interior Finish Fixture Option',
      description: 'Fixture labor and material',
      laborCost: 125,
      materialCost: 75,
      totalCost: 200,
      isOffContract: false,
    }],
  }));

  const getImpact = (target: InteriorFinishPriceImpactTarget) => {
    const cacheKey = `${JSON.stringify(data)}:${displayBasis}:${getInteriorFinishPriceImpactTargetKey(target)}`;
    const cached = impactCache.get(cacheKey);
    if (cached) return cached;

    const proposal = getDefaultProposal();
    proposal.poolSpecs = {
      ...proposal.poolSpecs,
      poolType: 'gunite',
      poolShape: 'freeform',
      perimeter: 110,
      surfaceArea: 600,
      shallowDepth: 3.5,
      endDepth: 6.5,
      maxWidth: 22,
      maxLength: 42,
      spaType: 'gunite',
      spaPerimeter: 28,
      isRaisedSpa: true,
      totalStepsAndBench: 24,
    };
    proposal.interiorFinish = data;
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    const result = calculateInteriorFinishPriceImpact({
      proposal,
      target,
      displayBasis,
      currentCalculation,
    });
    impactCache.set(cacheKey, result);
    return result;
  };

  return (
    <main style={{ width: 'min(1180px, calc(100vw - 32px))', margin: '24px auto 100px' }}>
      <InteriorFinishSectionNew
        data={data}
        onChange={(next) => {
          proposalChangeCount += 1;
          setData(next);
        }}
        hasSpa
        isFiberglass={false}
        supportsMicroglass
        priceImpactRequestKey={`${JSON.stringify(data)}:${displayBasis}`}
        getInteriorFinishPriceImpact={hidePriceImpact ? undefined : getImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <InteriorFinishFixture />
    </ToastProvider>
  </React.StrictMode>
);
