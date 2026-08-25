import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import PlumbingSectionNew from '../../src/components/PlumbingSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import {
  calculatePlumbingPriceImpact,
  getPlumbingPriceImpactTargetKey,
  type PlumbingPriceImpactTarget,
  type PriceImpactResult,
} from '../../src/services/priceImpact';
import type { Equipment, Plumbing } from '../../src/types/proposal-new';
import {
  getDefaultEquipment,
  getDefaultPlumbing,
  getDefaultProposal,
} from '../../src/utils/proposalDefaults';
import '../../src/index.css';

const hidePriceImpact = new URLSearchParams(window.location.search).get('priceImpact') === 'off';
const impactCache = new Map<string, PriceImpactResult>();
let comparisonCalculationCount = 0;

(window as Window & { getPriceImpactCalculationCount?: () => number })
  .getPriceImpactCalculationCount = () => comparisonCalculationCount;

const fixtureEquipment: Equipment = {
  ...getDefaultEquipment(),
  additionalPumps: [
    {
      name: 'Fixture Additional Pump',
      basePrice: 1000,
      addCost1: 0,
      addCost2: 0,
      price: 1000,
    },
  ],
};

function PlumbingPriceImpactFixture() {
  const [plumbing, setPlumbing] = useState<Plumbing>({
    ...getDefaultPlumbing(),
    runs: {
      ...getDefaultPlumbing().runs,
      skimmerRun: 45,
      mainDrainRun: 50,
      spaRun: 45,
      additionalSkimmers: 2,
    },
    customOptions: [
      {
        name: 'Fixture Plumbing Option',
        description: 'Custom plumbing labor and material',
        laborCost: 120,
        materialCost: 80,
        totalCost: 200,
        isOffContract: false,
      },
    ],
  });

  const getPlumbingPriceImpact = (target: PlumbingPriceImpactTarget) => {
    const proposalStateKey = JSON.stringify(plumbing);
    const cacheKey = `${proposalStateKey}:${getPlumbingPriceImpactTargetKey(target)}`;
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
      spaType: 'gunite',
      spaLength: 7,
      spaWidth: 7,
      spaPerimeter: 28,
    };
    proposal.equipment = fixtureEquipment;
    proposal.plumbing = plumbing;
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    comparisonCalculationCount += 1;
    const result = calculatePlumbingPriceImpact({
      proposal,
      target,
      displayBasis: 'retail',
      currentCalculation,
    });
    impactCache.set(cacheKey, result);
    return result;
  };

  return (
    <main style={{ width: 'min(1180px, calc(100vw - 48px))', margin: '24px auto 100px' }}>
      <PlumbingSectionNew
        data={plumbing}
        onChange={setPlumbing}
        allowSpaRunInput
        hasSpa
        additionalPumpCount={fixtureEquipment.additionalPumps?.length || 0}
        priceImpactRequestKey={JSON.stringify(plumbing)}
        getPlumbingPriceImpact={hidePriceImpact ? undefined : getPlumbingPriceImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <PlumbingPriceImpactFixture />
    </ToastProvider>
  </React.StrictMode>
);
