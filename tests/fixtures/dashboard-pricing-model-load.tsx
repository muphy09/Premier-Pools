import React from 'react';
import ReactDOM from 'react-dom/client';
import DashboardProposalsPanel from '../../src/components/DashboardProposalsPanel';
import type { Proposal } from '../../src/types/proposal-new';
import '../../src/index.css';

declare global {
  interface Window {
    pricingModelRequestStarted: boolean;
    resolvePricingModels: () => void;
  }
}

window.pricingModelRequestStarted = false;
window.resolvePricingModels = () => undefined;

const pricingModelsPromise = new Promise<any[]>((resolve) => {
  window.resolvePricingModels = () => {
    resolve([
      {
        id: 'model-current',
        name: 'Current 2026',
        version: 'v1',
        isDefault: true,
      },
    ]);
  };
});

(window as any).electron = {
  listPricingModels: () => {
    window.pricingModelRequestStarted = true;
    return pricingModelsPromise;
  },
};

const proposal = {
  proposalNumber: 'PW-DASHBOARD-1',
  franchiseId: 'franchise-dashboard',
  pricingModelFranchiseId: 'franchise-dashboard',
  pricingModelId: 'model-current',
  pricingModelName: 'Current 2026',
  pricingTierId: 'normal',
  customerInfo: {
    customerName: 'Dashboard Customer',
    state: 'NC',
  },
  poolSpecs: {
    poolType: 'gunite',
  },
  status: 'draft',
  createdDate: '2026-08-27T12:00:00.000Z',
  lastModified: '2026-08-27T12:00:00.000Z',
} as Proposal;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <DashboardProposalsPanel
    proposals={[proposal]}
    loading={false}
    onCreateProposal={() => undefined}
    onDeleteProposal={() => undefined}
    onOpenProposal={() => undefined}
  />
);
