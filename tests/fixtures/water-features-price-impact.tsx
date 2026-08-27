import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import WaterFeaturesSectionNew from '../../src/components/WaterFeaturesSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import pricingData from '../../src/services/pricingData';
import {
  calculateWaterFeaturePriceImpact,
  getWaterFeaturePriceImpactTargetKey,
  type PriceImpactDisplayBasis,
  type PriceImpactResult,
  type WaterFeaturePriceImpactTarget,
} from '../../src/services/priceImpact';
import type { PlumbingRuns, WaterFeatures } from '../../src/types/proposal-new';
import { getDefaultProposal } from '../../src/utils/proposalDefaults';
import '../../src/index.css';

pricingData.plumbing.waterFeatureRun = {
  setup: 200,
  baseAllowanceFt: 30,
  perFt: 5.5,
};
pricingData.plumbing.valveActuator = 125;
pricingData.waterFeatures = {
  ...pricingData.waterFeatures,
  sheerDescents: [
    {
      id: 'fixture-sheer',
      name: 'Fixture Sheer Descent',
      category: 'Sheer Descent',
      basePrice: 500,
      addCost1: 50,
      addCost2: 0,
      requiresConduit: true,
    },
  ],
  jets: [
    {
      id: 'fixture-jet',
      name: 'Fixture Deck Jet',
      category: 'Jets',
      basePrice: 300,
      addCost1: 0,
      addCost2: 0,
    },
  ],
  woks: {
    waterOnly: [],
    fireOnly: [],
    waterAndFire: [
      {
        id: 'fixture-fire-wok',
        name: 'Fixture Fire and Water Wok',
        category: 'Wok Pots - Water & Fire',
        basePrice: 900,
        addCost1: 100,
        addCost2: 0,
      },
    ],
  },
  bubblers: [
    {
      id: 'fixture-bubbler',
      name: 'Fixture Bubbler',
      category: 'Bubbler',
      basePrice: 400,
      addCost1: 0,
      addCost2: 0,
    },
  ],
};

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

function WaterFeaturesPriceImpactFixture() {
  const [waterFeatures, setWaterFeatures] = useState<WaterFeatures>({
    selections: [
      { featureId: 'fixture-sheer', quantity: 2, includeValveActuator: true },
      { featureId: 'fixture-fire-wok', quantity: 1, includeValveActuator: true },
    ],
    customOptions: [
      {
        name: 'Water Feature Accent',
        description: 'Fixture custom option',
        laborCost: 100,
        materialCost: 200,
        totalCost: 300,
        isOffContract: false,
      },
    ],
    totalCost: 1_950,
  });
  const [plumbingRuns, setPlumbingRuns] = useState<PlumbingRuns>(() => ({
    ...getDefaultProposal().plumbing.runs,
    waterFeature1Run: 45,
    waterFeature2Run: 20,
  }));

  const getWaterFeaturePriceImpact = (target: WaterFeaturePriceImpactTarget) => {
    const stateKey = JSON.stringify({ waterFeatures, plumbingRuns });
    const cacheKey = `${stateKey}:${displayBasis}:${getWaterFeaturePriceImpactTargetKey(target)}`;
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
    proposal.equipment = {
      ...proposal.equipment,
      packageSelectionId: 'custom',
      packageSelectionTouched: true,
    };
    proposal.waterFeatures = waterFeatures;
    proposal.plumbing = {
      ...proposal.plumbing,
      runs: plumbingRuns,
    };
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    comparisonCalculationCount += 1;
    const result = calculateWaterFeaturePriceImpact({
      proposal,
      target,
      displayBasis,
      currentCalculation,
    });
    impactCache.set(cacheKey, result);
    return result;
  };

  return (
    <main style={{ width: 'min(1120px, calc(100vw - 32px))', margin: '24px auto 100px' }}>
      <WaterFeaturesSectionNew
        data={waterFeatures}
        onChange={(next) => {
          proposalChangeCount += 1;
          setWaterFeatures(next);
        }}
        plumbingRuns={plumbingRuns}
        onChangePlumbingRuns={(updates) => {
          proposalChangeCount += 1;
          setPlumbingRuns((current) => ({ ...current, ...updates }));
        }}
        priceImpactRequestKey={`${displayBasis}:${JSON.stringify({ waterFeatures, plumbingRuns })}`}
        getWaterFeaturePriceImpact={hidePriceImpact ? undefined : getWaterFeaturePriceImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <WaterFeaturesPriceImpactFixture />
    </ToastProvider>
  </React.StrictMode>
);
