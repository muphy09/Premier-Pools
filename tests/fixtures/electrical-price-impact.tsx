import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import ElectricalSectionNew from '../../src/components/ElectricalSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import {
  calculateElectricalPriceImpact,
  getElectricalPriceImpactTargetKey,
  type ElectricalPriceImpactTarget,
  type PriceImpactResult,
} from '../../src/services/priceImpact';
import type { Electrical, PlumbingRuns } from '../../src/types/proposal-new';
import {
  getDefaultElectrical,
  getDefaultPlumbingRuns,
  getDefaultProposal,
  getDefaultWaterFeatures,
} from '../../src/utils/proposalDefaults';
import '../../src/index.css';

const hidePriceImpact = new URLSearchParams(window.location.search).get('priceImpact') === 'off';
const impactCache = new Map<string, PriceImpactResult>();
let comparisonCalculationCount = 0;

(window as Window & { getPriceImpactCalculationCount?: () => number })
  .getPriceImpactCalculationCount = () => comparisonCalculationCount;

function ElectricalPriceImpactFixture() {
  const [electrical, setElectrical] = useState<Electrical>({
    ...getDefaultElectrical(),
    runs: {
      electricalRun: 80,
      lightRun: 20,
      heatPumpElectricalRun: 50,
    },
    customOptions: [
      {
        name: 'Fixture Electrical Option',
        description: 'Custom electrical labor and material',
        laborCost: 150,
        materialCost: 50,
        totalCost: 200,
        isOffContract: false,
      },
    ],
  });
  const [plumbingRuns, setPlumbingRuns] = useState<PlumbingRuns>({
    ...getDefaultPlumbingRuns(),
    gasRun: 130,
  });
  const waterFeatures = getDefaultWaterFeatures();

  const getElectricalPriceImpact = (target: ElectricalPriceImpactTarget) => {
    const proposalStateKey = JSON.stringify({ electrical, plumbingRuns });
    const cacheKey = `${proposalStateKey}:${getElectricalPriceImpactTargetKey(target)}`;
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
    proposal.electrical = electrical;
    proposal.plumbing = {
      ...proposal.plumbing,
      runs: plumbingRuns,
    };
    proposal.waterFeatures = waterFeatures;
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    comparisonCalculationCount += 1;
    const result = calculateElectricalPriceImpact({
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
      <ElectricalSectionNew
        data={electrical}
        onChange={setElectrical}
        plumbingRuns={plumbingRuns}
        waterFeatures={waterFeatures}
        onChangePlumbingRuns={(updates) =>
          setPlumbingRuns((current) => ({ ...current, ...updates }))
        }
        hasSpa={false}
        priceImpactRequestKey={JSON.stringify({ electrical, plumbingRuns })}
        getElectricalPriceImpact={hidePriceImpact ? undefined : getElectricalPriceImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ElectricalPriceImpactFixture />
    </ToastProvider>
  </React.StrictMode>
);
