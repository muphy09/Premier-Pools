import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../src/index.css';

Object.defineProperty(window.navigator, 'onLine', {
  configurable: true,
  value: false,
});

const fixturePricing = {
  pricingDefaults: {
    cogsOverheadRate: 0.01,
    targetMargin: 0.7,
  },
};

(window as any).electron = {
  listPricingModels: async () => [],
  loadPricingModel: async () => ({
    franchiseId: 'pricing-cogs-overhead-fixture',
    pricingModelId: 'fixture-model',
    pricingModelName: 'Fixture Pricing Model',
    isDefault: true,
    version: 'fixture-v1',
    pricing: fixturePricing,
  }),
};

async function mountFixture() {
  const [{ default: PricingDataModal }, { getPricingDataSnapshot }] = await Promise.all([
    import('../../src/components/PricingDataModal'),
    import('../../src/services/pricingDataStore'),
  ]);

  (window as any).getCogsOverheadFixtureValue = () =>
    getPricingDataSnapshot().pricingDefaults.cogsOverheadRate;

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PricingDataModal
        franchiseId="pricing-cogs-overhead-fixture"
        onClose={() => undefined}
      />
    </React.StrictMode>
  );
}

void mountFixture();
