import React, { useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import EquipmentSectionNew from '../../src/components/EquipmentSectionNew';
import { ToastProvider } from '../../src/components/Toast';
import pricingData from '../../src/services/pricingData';
import type {
  EquipmentPriceImpactTarget,
  PriceImpactResult,
} from '../../src/services/priceImpact';
import type { Equipment } from '../../src/types/proposal-new';
import { getEquipmentItemCost } from '../../src/utils/equipmentCost';
import { getDefaultEquipment, getDefaultPlumbingRuns } from '../../src/utils/proposalDefaults';
import '../../src/index.css';

pricingData.equipment.lights.poolLights = [
  {
    name: 'Fixture Pool Light',
    basePrice: 180,
    addCost1: 0,
    addCost2: 0,
    defaultLightChoice: true,
  },
];
pricingData.equipment.pumps = [
  {
    name: 'No Pump (Select pump)',
    basePrice: 0,
    addCost1: 0,
    addCost2: 0,
  },
  {
    name: 'Fixture Variable-Speed Pump',
    basePrice: 1400,
    addCost1: 0,
    addCost2: 0,
  },
  {
    name: 'Fixture 1.65 HP Pump',
    basePrice: 1620,
    addCost1: 0,
    addCost2: 0,
  },
];
pricingData.equipment.auxiliaryPumps = [
  {
    name: 'No Blower (Select blower)',
    basePrice: 0,
    addCost1: 0,
    addCost2: 0,
    defaultAuxiliaryPump: false,
  },
  {
    name: 'Fixture Blower',
    basePrice: 240,
    addCost1: 0,
    addCost2: 0,
    defaultAuxiliaryPump: true,
  },
];
pricingData.equipment.saltSystem = [
  {
    name: 'No Salt System',
    model: 'None',
    basePrice: 0,
    addCost1: 0,
    addCost2: 0,
  },
  {
    name: 'Fixture Sanitation',
    basePrice: 430,
    addCost1: 0,
    addCost2: 0,
    excludedFromSaltCell: false,
  },
  {
    name: 'Fixture Additional Sanitation',
    basePrice: 260,
    addCost1: 0,
    addCost2: 0,
    excludedFromSaltCell: true,
  },
];

const useFixedPackage = new URLSearchParams(window.location.search).get('package') === 'fixed';
const hidePriceImpact = new URLSearchParams(window.location.search).get('priceImpact') === 'off';
const fixedPackage = {
  id: 'fixture-fixed-bundle',
  name: 'Fixture Fixed Equipment Package',
  mode: 'fixed' as const,
  enabled: true,
  basePrice: 2500,
  includeCheckValve: true,
  supportsSpa: true,
  allowAdditionalPumps: true,
  allowHeaterUpgrade: true,
  allowCleanerUpgrade: true,
  allowAutoFillUpgrade: true,
  allowPoolLightUpgrade: true,
  allowSpaLightUpgrade: true,
  allowWaterFeatureUpgrade: true,
  allowSanitationAccessoryUpgrade: true,
  includedPumpName: 'Fixture Variable-Speed Pump',
  includedPumpQuantity: 1,
  includedFilterName: 'Fixture Main Filter',
  includedFilterQuantity: 1,
  includedCleanerName: 'Fixture Cleaner',
  includedCleanerQuantity: 1,
  includedHeaterName: 'Fixture Heater',
  includedHeaterQuantity: 1,
  includedAutomationName: 'Fixture Automation',
  includedAutomationQuantity: 1,
  includedSaltSystemName: 'Fixture Sanitation',
  includedSaltSystemQuantity: 1,
  includedPoolLightName: 'Fixture Pool Light',
  includedPoolLightQuantity: 1,
  includedAutoFillSystemName: 'Fixture Auto-fill',
  includedAutoFillSystemQuantity: 1,
  includedSanitationAccessoryName: 'Fixture Package Sanitation Accessory',
  includedSanitationAccessoryQuantity: 1,
};
(pricingData.equipment as any).packageOptions = [
  fixedPackage,
  {
    ...fixedPackage,
    id: 'fixture-standard-automation-bundle',
    name: 'Fixture Standard Automation Package',
  },
  {
    id: 'custom',
    name: 'Custom',
    mode: 'custom',
    enabled: true,
    includeCheckValve: true,
    supportsSpa: true,
    allowAdditionalPumps: true,
    allowHeaterUpgrade: true,
    allowCleanerUpgrade: true,
    allowAutoFillUpgrade: true,
    allowPoolLightUpgrade: true,
    allowSpaLightUpgrade: true,
    allowWaterFeatureUpgrade: true,
    allowSanitationAccessoryUpgrade: true,
  },
];

const impactResult: PriceImpactResult = {
  status: 'available',
  displayBasis: 'retail',
  controlLabel: 'Additional Pump 1',
  comparisonLabel: 'Compared with no additional pump 1',
  directCharges: [
    {
      key: 'pump-equipment',
      section: 'equipmentOrdered',
      category: 'Additional Pump',
      label: 'Pump equipment',
      amount: 1782,
      cogsAmount: 1247.4,
      retailAmount: 1782,
      effect: 'direct',
      approximate: false,
    },
    {
      key: 'equipment-tax',
      section: 'equipmentOrdered',
      category: 'Equipment Tax',
      label: 'Equipment Tax',
      amount: 147.02,
      cogsAmount: 102.91,
      retailAmount: 147.02,
      effect: 'direct',
      approximate: false,
    },
    {
      key: 'additional-pump-setup',
      section: 'equipmentSet',
      category: 'Equipment Set',
      label: 'Additional-pump setup',
      amount: 150,
      cogsAmount: 105,
      retailAmount: 150,
      effect: 'direct',
      approximate: false,
    },
  ],
  automaticEffects: [
    {
      key: 'main-drain-run',
      section: 'plumbing',
      category: 'Plumbing',
      label: 'Second main-drain plumbing run',
      amount: 935.83,
      cogsAmount: 655.08,
      retailAmount: 935.83,
      effect: 'automatic',
      approximate: true,
    },
    {
      key: 'interior-fittings',
      section: 'interiorFinish',
      category: 'Interior Finish',
      label: 'Interior-finish fittings',
      amount: 30,
      cogsAmount: 21,
      retailAmount: 30,
      effect: 'automatic',
      approximate: true,
    },
  ],
  overheadAmount: 30.15,
  customerPriceChange: 4350,
  costChangeBeforeOverhead: 3044.85,
  totalCogsChange: 3075,
  overheadCogsAmount: 21.11,
  overheadRetailAmount: 30.15,
  retailMultiplier: 1.428571,
  retailOnlyAdjustmentChange: 0,
  reconciliationDifference: 0,
  calculationDurationMs: 4,
};

const packageIncludedImpactResult: PriceImpactResult = {
  ...impactResult,
  controlLabel: 'Package-included Equipment',
  comparisonLabel:
    'Compared with this included selection omitted while Fixture Fixed Equipment Package remains selected',
  directCharges: [
    {
      key: 'package-included-fixture',
      section: 'equipmentOrdered',
      category: 'Equipment Package',
      label: 'Selected equipment — included in Fixture Fixed Equipment Package',
      amount: 0,
      cogsAmount: 0,
      retailAmount: 0,
      effect: 'direct',
      approximate: false,
    },
  ],
  automaticEffects: [],
  overheadAmount: 0,
  customerPriceChange: 0,
  costChangeBeforeOverhead: 0,
  totalCogsChange: 0,
  overheadCogsAmount: 0,
  overheadRetailAmount: 0,
};

let cachedImpact: PriceImpactResult | null = null;
let comparisonCalculationCount = 0;

(window as Window & { getPriceImpactCalculationCount?: () => number })
  .getPriceImpactCalculationCount = () => comparisonCalculationCount;

function PriceImpactFixture() {
  const initialEquipment = useMemo<Equipment>(() => {
    const base = getDefaultEquipment();
    const pumpOverhead = pricingData.equipment.pumpOverheadMultiplier || 1;
    const primaryPump = {
      name: 'Fixture Variable-Speed Pump',
      basePrice: 1400,
      addCost1: 0,
      addCost2: 0,
    };
    const additionalPump = {
      name: 'Fixture 1.65 HP Pump',
      basePrice: 1620,
      addCost1: 0,
      addCost2: 0,
    };

    const customEquipment: Equipment = {
      ...base,
      pump: {
        ...primaryPump,
        price: getEquipmentItemCost(primaryPump, pumpOverhead),
      },
      pumpQuantity: 1,
      additionalPumps: [
        {
          ...additionalPump,
          price: getEquipmentItemCost(additionalPump, pumpOverhead),
        },
      ],
      auxiliaryPumps: [
        { name: 'Fixture Blower', basePrice: 240, addCost1: 0, addCost2: 0, price: 240 },
      ],
      filter: {
        name: 'Fixture Main Filter',
        sqft: 300,
        basePrice: 420,
        addCost1: 0,
        addCost2: 0,
        price: 420,
      },
      filterQuantity: 1,
      additionalFilters: [
        {
          name: 'Fixture Additional Filter',
          sqft: 200,
          basePrice: 320,
          addCost1: 0,
          addCost2: 0,
          price: 320,
        },
      ],
      cleaner: {
        name: 'Fixture Cleaner',
        basePrice: 380,
        addCost1: 0,
        addCost2: 0,
        price: 380,
      },
      cleanerQuantity: 1,
      heater: {
        name: 'Fixture Heater',
        basePrice: 900,
        addCost1: 0,
        addCost2: 0,
        price: 900,
      },
      heaterQuantity: 1,
      additionalHeaters: [
        {
          name: 'Fixture Additional Heater',
          basePrice: 750,
          addCost1: 0,
          addCost2: 0,
          price: 750,
        },
      ],
      heaterChiller: {
        name: 'Fixture Heater Chiller',
        basePrice: 1050,
        addCost1: 0,
        addCost2: 0,
        price: 1050,
      },
      heaterChillerQuantity: 1,
      poolLights: [
        { type: 'pool', name: 'Fixture Pool Light', basePrice: 180, addCost1: 0, addCost2: 0, price: 180 },
        { type: 'pool', name: 'Fixture Pool Light', basePrice: 180, addCost1: 0, addCost2: 0, price: 180 },
      ],
      includePoolLights: true,
      numberOfLights: 1,
      automation: {
        name: 'Fixture Automation',
        basePrice: 680,
        addCost1: 0,
        addCost2: 0,
        addCost3: 0,
        price: 680,
        zones: 1,
      },
      automationQuantity: 1,
      saltSystem: {
        name: 'Fixture Sanitation',
        basePrice: 430,
        addCost1: 0,
        addCost2: 0,
        price: 430,
      },
      saltSystemQuantity: 1,
      additionalSaltSystem: {
        name: 'Fixture Additional Sanitation',
        basePrice: 260,
        addCost1: 0,
        addCost2: 0,
        price: 260,
      },
      autoFillSystem: {
        name: 'Fixture Auto-fill',
        basePrice: 190,
        addCost1: 0,
        addCost2: 0,
        price: 190,
        requiresElectricRun: true,
      },
      autoFillSystemQuantity: 1,
      customOptions: [
        {
          name: 'Fixture Equipment Option',
          description: 'Custom equipment labor and material',
          laborCost: 100,
          materialCost: 75,
          totalCost: 175,
          isOffContract: false,
        },
      ],
      packageSelectionId: 'custom',
      packageSelectionTouched: true,
      hasBeenEdited: true,
    };

    if (!useFixedPackage) return customEquipment;

    return {
      ...customEquipment,
      packageSelectionId: fixedPackage.id,
      additionalPumps: [],
      auxiliaryPumps: [],
      additionalFilters: [],
      additionalHeaters: [],
      heaterChiller: undefined,
      heaterChillerQuantity: 0,
      poolLights: [customEquipment.poolLights[0]],
      numberOfLights: 0,
      additionalSaltSystem: undefined,
      sanitationAccessory: {
        name: fixedPackage.includedSanitationAccessoryName,
        basePrice: 210,
        addCost1: 0,
        addCost2: 0,
        price: 210,
      },
      sanitationAccessoryQuantity: 1,
      customOptions: [],
    };
  }, []);
  const [equipment, setEquipment] = useState(initialEquipment);
  const [plumbingRuns, setPlumbingRuns] = useState({
    ...getDefaultPlumbingRuns(),
    mainDrainRun: 50,
  });

  const getEquipmentPriceImpact = (_target: EquipmentPriceImpactTarget) => {
    if (!cachedImpact) {
      comparisonCalculationCount += 1;
      cachedImpact = useFixedPackage ? packageIncludedImpactResult : impactResult;
    }
    return cachedImpact;
  };

  return (
    <main style={{ width: 'min(1180px, calc(100vw - 48px))', margin: '24px auto 100px' }}>
      <EquipmentSectionNew
        data={equipment}
        onChange={setEquipment}
        onSelectPackage={() => undefined}
        plumbingRuns={plumbingRuns}
        onChangePlumbingRuns={(next) => setPlumbingRuns((current) => ({ ...current, ...next }))}
        hasPool
        hasSpa={false}
        isPpasEast
        priceImpactRequestKey="fixture-v1"
        getEquipmentPriceImpact={hidePriceImpact ? undefined : getEquipmentPriceImpact}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <PriceImpactFixture />
    </ToastProvider>
  </React.StrictMode>
);
