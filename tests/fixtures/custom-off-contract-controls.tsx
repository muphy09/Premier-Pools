import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import CustomFeaturesSectionNew from '../../src/components/CustomFeaturesSectionNew';
import CustomOptionsSection from '../../src/components/CustomOptionsSection';
import type { CustomFeatures, CustomOption } from '../../src/types/proposal-new';
import '../../src/index.css';

const initialOptions: CustomOption[] = [
  {
    name: 'Playwright Custom Option',
    description: 'Visual verification option',
    laborCost: 125,
    materialCost: 75,
    totalCost: 200,
    isOffContract: false,
  },
];

const initialFeatures: CustomFeatures = {
  features: [
    {
      name: 'Grouped Water Wall',
      description: 'Visual verification grouped feature',
      laborCost: 0,
      materialCost: 0,
      totalCost: 800,
      isOffContract: false,
      source: 'grouped',
      groupedOptionId: 'grouped-water-wall',
    },
    {
      name: 'Playwright Custom Feature',
      description: 'Visual verification manual feature',
      laborCost: 225,
      materialCost: 175,
      totalCost: 400,
      isOffContract: false,
      source: 'manual',
    },
  ],
  totalCost: 1_200,
};

function CustomOffContractControlsFixture() {
  const [options, setOptions] = useState(initialOptions);
  const [features, setFeatures] = useState(initialFeatures);

  return (
    <main style={{ width: 'min(1180px, calc(100% - 48px))', margin: '0 auto', padding: '32px 0 56px' }}>
      <CustomOptionsSection data={options} onChange={setOptions} />
      <div style={{ height: 28 }} />
      <CustomFeaturesSectionNew
        data={features}
        onChange={setFeatures}
        groupedOptions={[
          {
            id: 'grouped-water-wall',
            name: 'Grouped Water Wall',
            description: 'Visual verification grouped feature',
            totalPrice: 800,
          },
        ]}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CustomOffContractControlsFixture />
  </React.StrictMode>
);
