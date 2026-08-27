import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import ExcavationSectionNew from '../../src/components/ExcavationSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import MasterPricingEngine from '../../src/services/masterPricingEngine';
import {
  calculateExcavationPriceImpact,
  getExcavationPriceImpactTargetKey,
  type ExcavationPriceImpactTarget,
  type PriceImpactResult,
} from '../../src/services/priceImpact';
import { BRONZE_PRICING_TIER_ID } from '../../src/services/pricingTiers';
import type { Excavation } from '../../src/types/proposal-new';
import { getDefaultProposal } from '../../src/utils/proposalDefaults';
import '../../src/index.css';

const query = new URLSearchParams(window.location.search);
const hidePriceImpact = query.get('priceImpact') === 'off';
const useLegacyRetainingWall = query.get('legacyRetainingWall') === 'true';
const isPpasEast = query.get('ppasEast') === 'true';
const impactCache = new Map<string, PriceImpactResult>();
let excavationChangeCount = 0;

declare global {
  interface Window {
    getExcavationChangeCount: () => number;
  }
}

window.getExcavationChangeCount = () => excavationChangeCount;
(window as Window & { getProposalChangeCount?: () => number })
  .getProposalChangeCount = () => excavationChangeCount;

function ExcavationFixture() {
  const [excavation, setExcavation] = useState<Excavation>(() => ({
    ...getDefaultProposal().excavation,
    rbbLevels: [{
      height: 24,
      length: 120,
      facing: 'panel-ledge',
      hasBacksideFacing: true,
      backsideFacing: 'panel-ledge',
    }],
    columns: { count: 2, width: 2, depth: 2, height: 4, facing: 'panel-ledge' },
    retainingWalls: useLegacyRetainingWall ? [] : [{ type: '12" High - Standard', length: 20 }],
    retainingWallType: '12" High - Standard',
    retainingWallLength: 20,
    exposedPoolWallLevels: [{ height: 12, length: 40, facing: 'stacked-stone' }],
    hasGravelInstall: true,
    gravelInstallQuantity: 2,
    hasDirtHaul: true,
    dirtHaulQuantity: 1,
    needsSoilSampleEngineer: true,
    hasDoubleCurtain: true,
    doubleCurtainLength: 80,
    hasAdditionalSitePrep: true,
    additionalSitePrepHours: 3,
    hasTightAccessJob: true,
    customOptions: [{
      name: 'Excavation Fixture Option',
      description: 'Fixture custom option',
      laborCost: 100,
      materialCost: 50,
      totalCost: 150,
      isOffContract: false,
    }],
  }));

  const getImpact = (target: ExcavationPriceImpactTarget) => {
    const stateKey = JSON.stringify(excavation);
    const cacheKey = `${stateKey}:${getExcavationPriceImpactTargetKey(target)}`;
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
    proposal.excavation = excavation;
    const currentCalculation = MasterPricingEngine.calculateCompleteProposal(
      proposal,
      proposal.papDiscounts
    );
    const result = calculateExcavationPriceImpact({
      proposal,
      target,
      currentCalculation,
    });
    impactCache.set(cacheKey, result);
    return result;
  };

  return (
    <main style={{ width: 'min(1120px, calc(100vw - 32px))', margin: '24px auto 100px' }}>
      <ExcavationSectionNew
        data={excavation}
        onChange={(next) => {
          excavationChangeCount += 1;
          setExcavation(next);
        }}
        pricingTierId={BRONZE_PRICING_TIER_ID}
        isPpasEast={isPpasEast}
        priceImpactRequestKey={JSON.stringify(excavation)}
        getExcavationPriceImpact={hidePriceImpact ? undefined : getImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider><ExcavationFixture /></ToastProvider>
  </React.StrictMode>
);
