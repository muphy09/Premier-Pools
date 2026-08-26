import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import TileCopingDeckingSectionNew from '../../src/components/TileCopingDeckingSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import pricingData from '../../src/services/pricingData';
import {
  calculateTileCopingDeckingPriceImpact,
  getTileCopingDeckingPriceImpactTargetKey,
  type PriceImpactResult,
  type TileCopingDeckingPriceImpactTarget,
} from '../../src/services/priceImpact';
import type { TileCopingDecking } from '../../src/types/proposal-new';
import {
  getDefaultProposal,
  getDefaultTileCopingDecking,
} from '../../src/utils/proposalDefaults';
import '../../src/index.css';

const hidePriceImpact = new URLSearchParams(window.location.search).get('priceImpact') === 'off';
const impactCache = new Map<string, PriceImpactResult>();
let comparisonCalculationCount = 0;

(pricingData.tileCoping.decking as any).additionalOptions = [
  {
    id: 'premium-paver',
    name: 'Premium Paver',
    laborRate: 10,
    materialRate: 15,
    wasteNotIncluded: false,
  },
];

(window as Window & { getPriceImpactCalculationCount?: () => number })
  .getPriceImpactCalculationCount = () => comparisonCalculationCount;

function TileCopingDeckingPriceImpactFixture() {
  const [data, setData] = useState<TileCopingDecking>({
    ...getDefaultTileCopingDecking(),
    tileOptionId: 'level2',
    tileLevel: 2,
    additionalTileLength: 12,
    trimTileOptionId: 'step-trim',
    hasTrimTileOnSteps: true,
    copingType: 'flagstone',
    copingSize: '16x16',
    deckingType: 'concrete',
    deckingArea: 500,
    additionalDeckingSelections: [
      { deckingType: 'premium-paver', area: 100, isOffContract: true },
    ],
    additionalDeckingType: 'premium-paver',
    additionalDeckingArea: 100,
    isAdditionalDeckingOffContract: true,
    concreteStepsLength: 8,
    bullnoseLnft: 6,
    spillwayLnft: 4,
    hasRoughGrading: true,
    customOptions: [
      {
        name: 'Tile Accent Option',
        description: 'Fixture labor and material',
        laborCost: 150,
        materialCost: 50,
        totalCost: 200,
        isOffContract: false,
      },
    ],
  });

  const getPriceImpact = (target: TileCopingDeckingPriceImpactTarget) => {
    const proposalStateKey = JSON.stringify(data);
    const cacheKey = `${proposalStateKey}:${getTileCopingDeckingPriceImpactTargetKey(target)}`;
    const cached = impactCache.get(cacheKey);
    if (cached) return cached;

    const proposal = getDefaultProposal();
    proposal.poolSpecs = {
      ...proposal.poolSpecs,
      poolType: 'gunite',
      poolShape: 'freeform',
      perimeter: 100,
      surfaceArea: 500,
      shallowDepth: 3,
      endDepth: 6,
      maxWidth: 20,
      maxLength: 40,
      totalStepsAndBench: 24,
      deckingArea: 500,
    };
    proposal.tileCopingDecking = data;
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    comparisonCalculationCount += 1;
    const result = calculateTileCopingDeckingPriceImpact({
      proposal,
      target,
      displayBasis: 'retail',
      currentCalculation,
    });
    impactCache.set(cacheKey, result);
    return result;
  };

  return (
    <main style={{ width: 'min(1240px, calc(100vw - 48px))', margin: '24px auto 100px' }}>
      <TileCopingDeckingSectionNew
        data={data}
        onChange={setData}
        isFiberglass={false}
        poolDeckingArea={500}
        priceImpactRequestKey={JSON.stringify(data)}
        getTileCopingDeckingPriceImpact={hidePriceImpact ? undefined : getPriceImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <TileCopingDeckingPriceImpactFixture />
    </ToastProvider>
  </React.StrictMode>
);
