import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import CustomFeaturesSectionNew from '../../src/components/CustomFeaturesSectionNew';
import type { CustomFeatures } from '../../src/types/proposal-new';
import '../../src/index.css';

let proposalChangeCount = 0;

declare global {
  interface Window {
    getProposalChangeCount: () => number;
  }
}

window.getProposalChangeCount = () => proposalChangeCount;

const initialFeatures: CustomFeatures = {
  features: [
    {
      name: 'Manual Water Wall',
      description: 'Fixture manual feature',
      laborCost: 200,
      materialCost: 300,
      totalCost: 500,
      isOffContract: false,
      source: 'manual',
    },
    {
      name: 'Manual Accent',
      description: '',
      laborCost: -50,
      materialCost: 0,
      totalCost: -50,
      isOffContract: false,
      source: 'manual',
    },
  ],
  totalCost: 450,
};

function CustomFeaturesFixture() {
  const [data, setData] = useState(initialFeatures);

  return (
    <main style={{ width: 'min(1180px, calc(100vw - 32px))', margin: '24px auto 100px' }}>
      <CustomFeaturesSectionNew
        data={data}
        onChange={(next) => {
          proposalChangeCount += 1;
          setData(next);
        }}
        retailPrice={10_000}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CustomFeaturesFixture />
  </React.StrictMode>
);
