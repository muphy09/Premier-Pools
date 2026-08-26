import assert from 'node:assert/strict';
import pricingData from '../src/services/pricingData';
import MasterPricingEngine from '../src/services/masterPricingEngine';
import {
  buildAdditionalPumpComparisonProposal,
  buildDrainagePriceImpactComparisonProposal,
  buildTileCopingDeckingPriceImpactComparisonProposal,
  buildWaterFeaturePriceImpactComparisonProposal,
  calculateDrainagePriceImpact,
  calculateElectricalPriceImpact,
  buildPlumbingPriceImpactComparisonProposal,
  calculateAdditionalPumpPriceImpact,
  calculateEquipmentPriceImpact,
  calculatePlumbingPriceImpact,
  calculateTileCopingDeckingPriceImpact,
  calculateWaterFeaturePriceImpact,
  getEquipmentPriceImpactLineLabel,
  type DrainagePriceImpactTarget,
  type ElectricalPriceImpactTarget,
  type EquipmentPriceImpactTarget,
  type PlumbingPriceImpactTarget,
  type TileCopingDeckingPriceImpactTarget,
  type WaterFeaturePriceImpactTarget,
} from '../src/services/priceImpact';
import { withTemporaryPricingSnapshot } from '../src/services/pricingDataStore';
import type { Proposal } from '../src/types/proposal-new';
import { getDefaultProposal } from '../src/utils/proposalDefaults';
import {
  DEFAULT_PRICE_IMPACT_ENABLED,
  isPriceImpactEnabled,
  PRICE_IMPACT_CAPABILITY,
} from '../src/services/franchiseConfiguration';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const roundCurrency = (value: number) => Math.round(value * 100) / 100;

assert.equal(DEFAULT_PRICE_IMPACT_ENABLED, true);
assert.equal(PRICE_IMPACT_CAPABILITY, 'priceImpact');
assert.equal(isPriceImpactEnabled(undefined), true, 'Price Impact should default on.');
assert.equal(
  isPriceImpactEnabled({
    franchiseId: 'fixture-franchise',
    revisionId: 'fixture-revision',
    revisionNumber: 1,
    schemaVersion: 1,
    source: 'remote',
    configuration: {
      themeProfile: 'default',
      proposalLayout: 'standard',
      locationInputMode: 'state',
      contractResolutionMode: 'state_and_pool_type',
      capabilities: { priceImpact: false },
    },
  }),
  false,
  'An explicit franchise setting should turn Price Impact off.'
);

const snapshot = clone(pricingData) as any;
snapshot.misc.taxRate = 0.08;
snapshot.equipment.taxRate = 0.08;
snapshot.equipment.pumpOverheadMultiplier = 1;
snapshot.equipment.pumps = [
  {
    name: 'No Pump (Select pump)',
    basePrice: 0,
    addCost1: 0,
    addCost2: 0,
  },
  {
    name: 'Impact Test Pump',
    basePrice: 1_000,
    addCost1: 0,
    addCost2: 0,
  },
];
snapshot.misc.equipmentSet.additionalPump = 150;
snapshot.plumbing.twoPointFiveInchPipe = 7;
snapshot.plumbing.addlMainDrainWhenAuxPump = 100;
snapshot.pricingDefaults.cogsOverheadRate = 0.01;
snapshot.pricingDefaults.targetMargin = 0.7;
Object.keys(snapshot.papDiscountRates).forEach((key) => {
  snapshot.papDiscountRates[key] = 0;
});

const pump = {
  name: 'Impact Test Pump',
  basePrice: 1_000,
  addCost1: 0,
  addCost2: 0,
  price: 1_000,
};

const proposal = withTemporaryPricingSnapshot(snapshot, () => {
  const next = getDefaultProposal() as Proposal;
  next.poolSpecs = {
    ...next.poolSpecs,
    perimeter: 100,
    surfaceArea: 500,
    shallowDepth: 3,
    endDepth: 6,
    maxWidth: 20,
    maxLength: 40,
    hasSiltFence: false,
  };
  next.plumbing = {
    ...next.plumbing,
    runs: {
      ...next.plumbing.runs,
      mainDrainRun: 50,
    },
  };
  next.equipment = {
    ...next.equipment,
    pump: { ...pump },
    pumpQuantity: 1,
    additionalPumps: [{ ...pump }],
    packageSelectionId: undefined,
    packageSelectionTouched: true,
  };
  next.papDiscounts = clone(snapshot.papDiscountRates);
  return next;
});

const calculate = (input: Proposal) =>
  MasterPricingEngine.calculateCompleteProposal(input, input.papDiscounts);
const currentCalculation = withTemporaryPricingSnapshot(snapshot, () => calculate(proposal));
let comparisonCalculationCount = 0;
const result = calculateAdditionalPumpPriceImpact({
  proposal,
  pumpIndex: 0,
  currentCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: (input) => {
    comparisonCalculationCount += 1;
    return calculate(input);
  },
});

assert.equal(result.status, 'available');
assert.equal(comparisonCalculationCount, 1, 'The current builder calculation should be reused.');
assert.equal(result.reconciliationDifference, 0);
assert.equal(result.costChangeBeforeOverhead, 1_710);
assert.equal(result.totalCogsChange, 1_727.1);
assert.equal(result.displayBasis, 'retail');
assert.equal(result.overheadCogsAmount, 17.1);
assert.equal(result.overheadRetailAmount, 24.43);
assert.equal(result.overheadAmount, 24.43);
assert.deepEqual(
  result.directCharges.map((line) => [line.label, line.cogsAmount, line.amount]),
  [
    ['Pump Equipment', 1_000, 1_428.57],
    ['Equipment Tax', 80, 114.29],
    ['Additional Pump Setup', 150, 214.29],
  ]
);
assert.deepEqual(
  result.automaticEffects.map((line) => [line.label, line.cogsAmount, line.amount]),
  [
    ['Second Main Drain Plumbing Run', 350, 500],
    ['Additional Main Drain', 100, 142.86],
    ['Interior Finish Fittings', 30, 42.86],
  ]
);

const cogsResult = calculateEquipmentPriceImpact({
  proposal,
  target: { kind: 'additionalPump', index: 0 },
  displayBasis: 'cogs',
  currentCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.equal(cogsResult.status, 'available');
assert.equal(cogsResult.displayBasis, 'cogs');
assert.equal(cogsResult.customerPriceChange, cogsResult.totalCogsChange);
assert.deepEqual(
  cogsResult.directCharges.map((line) => [line.label, line.amount]),
  [
    ['Pump Equipment', 1_000],
    ['Equipment Tax', 80],
    ['Additional Pump Setup', 150],
  ]
);
assert.deepEqual(
  cogsResult.automaticEffects.map((line) => [line.label, line.amount]),
  [
    ['Second Main Drain Plumbing Run', 350],
    ['Additional Main Drain', 100],
    ['Interior Finish Fittings', 30],
  ]
);

const comparisonProposal = buildAdditionalPumpComparisonProposal(proposal, 0);
assert.ok(comparisonProposal);
const comparisonCalculation = withTemporaryPricingSnapshot(snapshot, () =>
  calculate(comparisonProposal)
);
assert.equal(
  result.customerPriceChange,
  roundCurrency(
    currentCalculation.pricing.retailPrice - comparisonCalculation.pricing.retailPrice
  )
);

const requiredProposal = clone(proposal);
requiredProposal.equipment.additionalPumps = [
  { ...pump, autoAddedReason: 'waterFeature' },
];
const requiredResult = calculateAdditionalPumpPriceImpact({
  proposal: requiredProposal,
  pumpIndex: 0,
  currentCalculation,
  pricingSnapshot: snapshot,
});
assert.equal(requiredResult.status, 'available');
requiredResult.directCharges.concat(requiredResult.automaticEffects).forEach((line) => {
  assert.ok(line.amount >= 0, 'A required selected pump should still show its positive retail impact.');
});

snapshot.equipment.saltSystem = [
  { name: 'No Salt System', basePrice: 0, addCost1: 0, addCost2: 0 },
  { name: 'Base Sanitation', basePrice: 180, addCost1: 0, addCost2: 0 },
  { name: 'Upgraded Sanitation', basePrice: 320, addCost1: 0, addCost2: 0 },
];
snapshot.equipment.heaters = [
  { name: 'No Heater', basePrice: 0, addCost1: 0, addCost2: 0 },
  { name: 'Configured Base Heater', basePrice: 350, addCost1: 0, addCost2: 0 },
  { name: 'Gas Heater', basePrice: 500, addCost1: 0, addCost2: 0 },
];
snapshot.equipment.lights.poolLights = [
  { name: 'Pool Light', basePrice: 100, addCost1: 0, addCost2: 0 },
];
snapshot.equipment.lights.spaLights = [
  { name: 'Spa Light', basePrice: 90, addCost1: 0, addCost2: 0 },
];

const comprehensiveProposal = clone(proposal);
comprehensiveProposal.designerCode = '9724';
comprehensiveProposal.poolSpecs = {
  ...comprehensiveProposal.poolSpecs,
  spaType: 'gunite',
  spaLength: 7,
  spaWidth: 7,
  spaPerimeter: 28,
};
comprehensiveProposal.plumbing.runs = {
  ...comprehensiveProposal.plumbing.runs,
  skimmerRun: 45,
  mainDrainRun: 50,
  spaRun: 45,
  additionalSkimmers: 2,
  cleanerRun: 30,
  autoFillRun: 40,
  autoFillElectricRun: 25,
  waterFeature1Run: 35,
  waterFeature2Run: 40,
  waterFeature3Run: 45,
  waterFeature4Run: 50,
  infloorValveToEQ: 20,
  infloorValveToPool: 15,
  gasRun: 130,
};
comprehensiveProposal.plumbing.customOptions = [
  {
    name: 'Plumbing Labor Option',
    description: '',
    laborCost: 150,
    materialCost: 50,
    totalCost: 200,
    isOffContract: false,
  },
  {
    name: 'Off-contract Plumbing Option',
    description: '',
    laborCost: 0,
    materialCost: 0,
    totalCost: 750,
    isOffContract: true,
  },
];
comprehensiveProposal.electrical = {
  ...comprehensiveProposal.electrical,
  runs: {
    electricalRun: 80,
    lightRun: 20,
    heatPumpElectricalRun: 50,
  },
  customOptions: [
    {
      name: 'Electrical Labor Option',
      description: '',
      laborCost: 175,
      materialCost: 25,
      totalCost: 200,
      isOffContract: false,
    },
  ],
};
comprehensiveProposal.equipment = {
  ...comprehensiveProposal.equipment,
  auxiliaryPumps: [
    { name: 'Manual Blower', basePrice: 200, addCost1: 0, addCost2: 0, price: 200 },
  ],
  filter: { name: 'Main Filter', basePrice: 300, addCost1: 0, addCost2: 0, price: 300 },
  filterQuantity: 1,
  additionalFilters: [
    { name: 'Additional Filter', basePrice: 250, addCost1: 0, addCost2: 0, price: 250 },
  ],
  cleaner: { name: 'Cleaner', basePrice: 400, addCost1: 0, addCost2: 0, price: 400 },
  cleanerQuantity: 1,
  heater: { name: 'Gas Heater', basePrice: 500, addCost1: 0, addCost2: 0, price: 500 },
  heaterQuantity: 1,
  additionalHeaters: [
    { name: 'Additional Heater', basePrice: 450, addCost1: 0, addCost2: 0, price: 450 },
  ],
  heaterChiller: {
    name: 'Heater Chiller',
    basePrice: 550,
    addCost1: 0,
    addCost2: 0,
    price: 550,
  },
  heaterChillerQuantity: 1,
  poolLights: [
    { type: 'pool', name: 'Pool Light', basePrice: 100, addCost1: 0, addCost2: 0, price: 100 },
    { type: 'pool', name: 'Pool Light', basePrice: 100, addCost1: 0, addCost2: 0, price: 100 },
  ],
  includePoolLights: true,
  numberOfLights: 1,
  spaLights: [
    { type: 'spa', name: 'Spa Light', basePrice: 90, addCost1: 0, addCost2: 0, price: 90 },
  ],
  includeSpaLights: true,
  hasSpaLight: true,
  automation: {
    name: 'Automation',
    basePrice: 600,
    addCost1: 0,
    addCost2: 0,
    addCost3: 0,
    price: 600,
    zones: 2,
    includesSaltCell: false,
  },
  automationQuantity: 1,
  saltSystem: {
    name: 'Upgraded Sanitation',
    basePrice: 320,
    addCost1: 0,
    addCost2: 0,
    price: 320,
  },
  saltSystemQuantity: 1,
  additionalSaltSystem: {
    name: 'Additional Sanitation',
    basePrice: 200,
    addCost1: 0,
    addCost2: 0,
    price: 200,
  },
  autoFillSystem: {
    name: 'Powered Auto-fill',
    basePrice: 100,
    addCost1: 0,
    addCost2: 0,
    price: 100,
    requiresElectricRun: true,
  },
  autoFillSystemQuantity: 1,
  customOptions: [
    {
      name: 'Equipment Labor Option',
      description: '',
      laborCost: 125,
      materialCost: 75,
      totalCost: 200,
      isOffContract: false,
    },
    {
      name: 'Off-contract Equipment Option',
      description: '',
      laborCost: 0,
      materialCost: 0,
      totalCost: 900,
      isOffContract: true,
    },
  ],
};

const equipmentTargets: EquipmentPriceImpactTarget[] = [
  { kind: 'mainPump' },
  { kind: 'additionalPump', index: 0 },
  { kind: 'blower', index: 0 },
  { kind: 'mainFilter' },
  { kind: 'additionalFilter', index: 0 },
  { kind: 'cleaner' },
  { kind: 'mainHeater' },
  { kind: 'additionalHeater', index: 0 },
  { kind: 'heaterChiller' },
  { kind: 'poolLight', index: 0 },
  { kind: 'poolLight', index: 1 },
  { kind: 'spaLight', index: 0 },
  { kind: 'automation' },
  { kind: 'sanitation' },
  { kind: 'additionalSanitation' },
  { kind: 'autoFill' },
  { kind: 'customOption', index: 0 },
  { kind: 'customOption', index: 1 },
];
const comprehensiveCalculation = withTemporaryPricingSnapshot(snapshot, () =>
  calculate(comprehensiveProposal)
);

equipmentTargets.forEach((target) => {
  let comparisonCalls = 0;
  const targetResult = calculateEquipmentPriceImpact({
    proposal: comprehensiveProposal,
    target,
    currentCalculation: comprehensiveCalculation,
    pricingSnapshot: snapshot,
    calculateProposal: (input) => {
      comparisonCalls += 1;
      return calculate(input);
    },
  });
  assert.equal(
    targetResult.status,
    'available',
    `${target.kind} should produce a complete Equipment comparison: ${targetResult.message || ''}`
  );
  assert.equal(comparisonCalls, 1, `${target.kind} should use one comparison calculation.`);
  assert.equal(targetResult.displayBasis, 'retail');
  assert.ok(
    Math.abs(targetResult.reconciliationDifference) < 0.02,
    `${JSON.stringify(target)} should reconcile within one cent.`
  );
  targetResult.directCharges.concat(targetResult.automaticEffects).forEach((line) => {
    assert.equal(line.amount, line.retailAmount, `${target.kind} should display retail row amounts.`);
  });
});

const electricalTargets: ElectricalPriceImpactTarget[] = [
  { kind: 'run', field: 'gasRun' },
  { kind: 'run', field: 'electricalRun' },
  { kind: 'run', field: 'lightRun' },
  { kind: 'run', field: 'heatPumpElectricalRun' },
  { kind: 'customOption', index: 0 },
];

const electricalResults = new Map<string, ReturnType<typeof calculateElectricalPriceImpact>>();
electricalTargets.forEach((target) => {
  let comparisonCalls = 0;
  const targetResult = calculateElectricalPriceImpact({
    proposal: comprehensiveProposal,
    target,
    currentCalculation: comprehensiveCalculation,
    pricingSnapshot: snapshot,
    calculateProposal: (input) => {
      comparisonCalls += 1;
      return calculate(input);
    },
  });
  const targetKey = target.kind === 'run' ? target.field : `customOption:${target.index}`;
  electricalResults.set(targetKey, targetResult);
  assert.equal(
    targetResult.status,
    'available',
    `${targetKey} should produce a complete Gas / Electrical comparison: ${targetResult.message || ''}`
  );
  assert.equal(comparisonCalls, 1, `${targetKey} should use one comparison calculation.`);
  assert.equal(targetResult.displayBasis, 'retail');
  assert.equal(targetResult.reconciliationDifference, 0);
  targetResult.directCharges.concat(targetResult.automaticEffects).forEach((line) => {
    assert.equal(line.amount, line.retailAmount, `${targetKey} should display retail row amounts.`);
  });
});

const electricalGasResult = electricalResults.get('gasRun')!;
assert.ok(electricalGasResult.directCharges.some((line) => line.label === 'Base Gas Setup'));
assert.equal(
  electricalGasResult.directCharges.find((line) => line.label === 'Gas Run Overage')?.note,
  `Up to ${snapshot.plumbing.gasOverrunThreshold} LNFT Included`
);
assert.ok(
  electricalGasResult.automaticEffects.some((line) => line.label === 'Long Gas Run Plumbing')
);

const mainElectricalResult = electricalResults.get('electricalRun')!;
assert.equal(
  mainElectricalResult.directCharges.find(
    (line) => line.label === 'Main Electrical Run Overage'
  )?.note,
  `Up to ${snapshot.electrical.overrunThreshold} LNFT Included`
);
assert.ok(
  mainElectricalResult.automaticEffects.some(
    (line) => line.label === 'Main Electrical Plumbing Conduit'
  )
);

const lightRunResult = electricalResults.get('lightRun')!;
assert.ok(
  lightRunResult.automaticEffects.some(
    (line) => line.label === 'Light Run Plumbing Conduit'
  )
);
assert.ok(
  !lightRunResult.directCharges.concat(lightRunResult.automaticEffects).some(
    (line) => line.label === 'Additional Light Electrical'
  ),
  'Changing only the run length must not duplicate the equipment-driven additional-light charge.'
);

const heatPumpElectricalResult = electricalResults.get('heatPumpElectricalRun')!;
assert.ok(
  heatPumpElectricalResult.directCharges.some(
    (line) => line.label === 'Heat Pump Electrical Setup'
  )
);
assert.equal(
  heatPumpElectricalResult.directCharges.find(
    (line) => line.label === 'Heat Pump Electrical Run Overage'
  )?.note,
  `Up to ${snapshot.electrical.heatPumpOverrunThreshold} LNFT Included`
);
assert.ok(
  electricalResults.get('customOption:0')!.directCharges.some(
    (line) => line.label === 'Electrical Labor Option'
  )
);

const includedElectricalProposal = clone(comprehensiveProposal);
includedElectricalProposal.plumbing.runs.gasRun = 20;
includedElectricalProposal.electrical.runs.electricalRun = 20;
includedElectricalProposal.electrical.runs.heatPumpElectricalRun = 20;
const includedElectricalCalculation = withTemporaryPricingSnapshot(snapshot, () =>
  calculate(includedElectricalProposal)
);
([
  ['gasRun', 'Gas Run Overage', snapshot.plumbing.gasOverrunThreshold],
  ['electricalRun', 'Main Electrical Run Overage', snapshot.electrical.overrunThreshold],
  [
    'heatPumpElectricalRun',
    'Heat Pump Electrical Run Overage',
    snapshot.electrical.heatPumpOverrunThreshold,
  ],
] as const).forEach(([field, label, allowance]) => {
  const includedResult = calculateElectricalPriceImpact({
    proposal: includedElectricalProposal,
    target: { kind: 'run', field },
    currentCalculation: includedElectricalCalculation,
    pricingSnapshot: snapshot,
    calculateProposal: calculate,
  });
  const allowanceLine = includedResult.directCharges.find((line) => line.label === label);
  assert.equal(allowanceLine?.amount, 0, `${label} should show a zero charge within its allowance.`);
  assert.equal(allowanceLine?.note, `Up to ${allowance} LNFT Included`);
});

const manualSpaHeaterResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'mainHeater' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.equal(
  manualSpaHeaterResult.comparisonLabel,
  'Compared with the configured base heater',
  'A manually selected spa heater should retain the base-heater comparison.'
);

const autoAddedHeaterProposal = clone(comprehensiveProposal);
autoAddedHeaterProposal.equipment.heater = {
  ...autoAddedHeaterProposal.equipment.heater,
  autoAddedForSpa: true,
  autoAddedReason: 'spa',
};
const autoAddedHeaterCalculation = withTemporaryPricingSnapshot(snapshot, () =>
  calculate(autoAddedHeaterProposal)
);
const noHeaterProposal = clone(autoAddedHeaterProposal);
noHeaterProposal.equipment.heater = {
  name: 'No Heater (Price Impact comparison)',
  basePrice: 0,
  addCost1: 0,
  addCost2: 0,
  price: 0,
  autoAddedForSpa: false,
  autoAddedReason: undefined,
};
noHeaterProposal.equipment.heaterQuantity = 0;
const noHeaterCalculation = withTemporaryPricingSnapshot(snapshot, () =>
  calculate(noHeaterProposal)
);
const autoAddedHeaterResult = calculateEquipmentPriceImpact({
  proposal: autoAddedHeaterProposal,
  target: { kind: 'mainHeater' },
  currentCalculation: autoAddedHeaterCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.equal(autoAddedHeaterResult.status, 'available');
assert.equal(autoAddedHeaterResult.comparisonLabel, 'Compared with no heater');
assert.equal(
  autoAddedHeaterResult.customerPriceChange,
  roundCurrency(
    autoAddedHeaterCalculation.pricing.retailPrice - noHeaterCalculation.pricing.retailPrice
  ),
  'An automatically added heater should show its complete retail impact against no heater.'
);
assert.notEqual(
  autoAddedHeaterResult.customerPriceChange,
  0,
  'An automatically added heater should not collapse to the configured base-heater comparison.'
);
assert.ok(
  autoAddedHeaterResult.directCharges.some((line) => line.label === 'Heater Equipment Set'),
  'The equipment-set heater charge should have a distinct Price Impact label.'
);
assert.ok(
  autoAddedHeaterResult.automaticEffects.some((line) => line.label === 'Heater Electrical'),
  'The heater electrical effect should identify its source category.'
);
assert.ok(
  !autoAddedHeaterResult.automaticEffects.some((line) => line.label === 'Plumbing Heater Set'),
  'A spa-and-heater comparison should hide the confusing plumbing heater-set savings row.'
);

assert.equal(
  getEquipmentPriceImpactLineLabel(
    { kind: 'poolLight', index: 0 },
    'electrical',
    { category: 'Electrical', description: 'Lights', unitPrice: 100, quantity: 1, total: 100 }
  ),
  'Additional Light Electrical',
  'A light Price Impact should identify its additional electrical charge.'
);

const firstPoolLightResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'poolLight', index: 0 },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  !firstPoolLightResult.automaticEffects.some(
    (line) => line.label === 'Additional Light Electrical'
  ),
  'The first pool light should retain the included electrical slot.'
);

const additionalPoolLightResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'poolLight', index: 1 },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  additionalPoolLightResult.automaticEffects.some(
    (line) => line.label === 'Additional Light Electrical'
  ),
  'An additional pool light should include the additional-light electrical charge.'
);

const spaLightResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'spaLight', index: 0 },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  spaLightResult.automaticEffects.some(
    (line) => line.label === 'Additional Light Electrical'
  ),
  'A spa light should be treated as additional when a pool light is present.'
);

const automationResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'automation' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  automationResult.automaticEffects.some((line) => line.label === 'Automation Electrical'),
  'An automation Price Impact should identify its electrical charge.'
);
assert.ok(
  automationResult.automaticEffects.some(
    (line) => line.label === 'Automation Start-Up / Orientation'
  ),
  'An automation Price Impact should identify its start-up and orientation charge.'
);

const additionalSanitationResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'additionalSanitation' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  additionalSanitationResult.automaticEffects.some(
    (line) => line.label === 'Additional Sanitation Electrical'
  ),
  'An additional sanitation Price Impact should identify its electrical charge.'
);

const autoFillResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'autoFill' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  autoFillResult.automaticEffects.some((line) => line.label === 'Auto-Fill Electrical Run'),
  'An auto-fill Price Impact should identify its electrical run charge.'
);

const plumbingTargets: PlumbingPriceImpactTarget[] = [
  { kind: 'run', field: 'skimmerRun' },
  { kind: 'run', field: 'mainDrainRun' },
  { kind: 'run', field: 'spaRun' },
  { kind: 'run', field: 'additionalSkimmers' },
  { kind: 'run', field: 'cleanerRun' },
  { kind: 'run', field: 'autoFillRun' },
  { kind: 'run', field: 'autoFillElectricRun' },
  { kind: 'run', field: 'waterFeature1Run' },
  { kind: 'run', field: 'waterFeature2Run' },
  { kind: 'run', field: 'waterFeature3Run' },
  { kind: 'run', field: 'waterFeature4Run' },
  { kind: 'run', field: 'infloorValveToEQ' },
  { kind: 'run', field: 'infloorValveToPool' },
  { kind: 'run', field: 'gasRun' },
  { kind: 'customOption', index: 0 },
  { kind: 'customOption', index: 1 },
];

plumbingTargets.forEach((target) => {
  let comparisonCalls = 0;
  const targetResult = calculatePlumbingPriceImpact({
    proposal: comprehensiveProposal,
    target,
    currentCalculation: comprehensiveCalculation,
    pricingSnapshot: snapshot,
    calculateProposal: (input) => {
      comparisonCalls += 1;
      return calculate(input);
    },
  });
  const targetName = target.kind === 'run' ? target.field : `customOption:${target.index}`;
  assert.equal(
    targetResult.status,
    'available',
    `${targetName} should produce a complete Plumbing comparison: ${targetResult.message || ''}`
  );
  assert.equal(
    comparisonCalls,
    1,
    `${targetName} should require only one comparison calculation.`
  );
  assert.equal(targetResult.displayBasis, 'retail');
  assert.equal(targetResult.reconciliationDifference, 0);
  targetResult.directCharges.concat(targetResult.automaticEffects).forEach((line) => {
    assert.equal(line.amount, line.retailAmount, `${targetName} should display retail row amounts.`);
  });
});

const mainDrainResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'mainDrainRun' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  mainDrainResult.directCharges.some((line) => line.label === '2.5" Plumbing'),
  'Main Drain Run should use the configured 2.5-inch Plumbing label.'
);

const skimmerRunResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'skimmerRun' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  skimmerRunResult.directCharges.map((line) => line.label),
  ['Skimmer Run Overage', '2" Plumbing'],
  'Total Skimmer Run should include both its overage and core pipe effects.'
);

const spaRunResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'spaRun' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  spaRunResult.directCharges.some((line) => line.label === 'Spa Run Overage'),
  'Spa Run should include its billable overage after the saved allowance.'
);
assert.equal(
  spaRunResult.directCharges.find((line) => line.label === 'Spa Run Overage')?.note,
  `Up to ${snapshot.plumbing.spaOverrunThreshold} LNFT Included`,
  'Spa Run should explain the allowance configured in the saved pricing model.'
);

const includedSpaRunProposal = clone(comprehensiveProposal);
includedSpaRunProposal.plumbing.runs.spaRun = 20;
const includedSpaRunCalculation = withTemporaryPricingSnapshot(snapshot, () =>
  calculate(includedSpaRunProposal)
);
const includedSpaRunResult = calculatePlumbingPriceImpact({
  proposal: includedSpaRunProposal,
  target: { kind: 'run', field: 'spaRun' },
  currentCalculation: includedSpaRunCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  includedSpaRunResult.directCharges.map((line) => [line.label, line.note, line.amount]),
  [['Spa Run Overage', `Up to ${snapshot.plumbing.spaOverrunThreshold} LNFT Included`, 0]],
  'A Spa Run within the allowance should still explain the zero overage charge.'
);

const additionalSkimmersResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'additionalSkimmers' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  additionalSkimmersResult.directCharges.some((line) => line.label === 'Additional Skimmers'),
  'Extra Skimmers should include its per-unit Plumbing charge.'
);

const gasRunResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'gasRun' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  gasRunResult.directCharges.some((line) => line.section === 'gas'),
  'Gas Run should show its gas charges as direct.'
);
assert.ok(
  gasRunResult.automaticEffects.some((line) => line.label === 'Long Gas Run Plumbing'),
  'Gas Run should include its linked long-run Plumbing effect.'
);

const autoFillConduitResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'autoFillElectricRun' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  autoFillConduitResult.directCharges.some(
    (line) => line.label === 'Auto-Fill Electrical/Conduit Run'
  ),
  'Auto-fill conduit should include the linked Electrical charge.'
);

const plumbingOffContractResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'customOption', index: 1 },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  plumbingOffContractResult.directCharges.map((line) => [line.label, line.amount]),
  [['Off-Contract Retail Price', 750]]
);

const plumbingComparison = buildPlumbingPriceImpactComparisonProposal(
  comprehensiveProposal,
  { kind: 'run', field: 'skimmerRun' },
  snapshot
);
assert.ok(plumbingComparison);
assert.equal(plumbingComparison.plumbing.runs.skimmerRun, 0);

const offContractResult = calculateEquipmentPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'customOption', index: 1 },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  offContractResult.directCharges.map((line) => [line.label, line.amount]),
  [['Off-Contract Retail Price', 900]]
);

const packageSnapshot = clone(snapshot);
packageSnapshot.equipment.packageOptions = [
  {
    id: 'fixture-bundle',
    name: 'Fixture Equipment Bundle',
    mode: 'fixed',
    enabled: true,
    basePrice: 2_500,
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
    includedPumpName: pump.name,
    includedPumpQuantity: 1,
    includedFilterName: 'Main Filter',
    includedFilterQuantity: 1,
    includedCleanerName: 'Cleaner',
    includedCleanerQuantity: 1,
    includedHeaterName: 'Gas Heater',
    includedHeaterQuantity: 1,
    includedAutomationName: 'Automation',
    includedAutomationQuantity: 1,
    includedSaltSystemName: 'Upgraded Sanitation',
    includedSaltSystemQuantity: 1,
    includedPoolLightName: 'Pool Light',
    includedPoolLightQuantity: 1,
    includedAutoFillSystemName: 'Powered Auto-fill',
    includedAutoFillSystemQuantity: 1,
    includedSanitationAccessoryName: 'Package Sanitation Accessory',
    includedSanitationAccessoryQuantity: 1,
  },
  {
    id: 'custom',
    name: 'Custom',
    mode: 'custom',
    enabled: true,
    includeCheckValve: true,
    supportsSpa: true,
    allowAdditionalPumps: true,
  },
];
const packageProposal = clone(comprehensiveProposal);
packageProposal.equipment.packageSelectionId = 'fixture-bundle';
packageProposal.equipment.packageSelectionTouched = true;
packageProposal.equipment.additionalSaltSystem = undefined;
packageProposal.equipment.sanitationAccessory = {
  name: 'Package Sanitation Accessory',
  basePrice: 210,
  addCost1: 0,
  addCost2: 0,
  price: 210,
};
packageProposal.equipment.sanitationAccessoryQuantity = 1;
const packageCurrentCalculation = withTemporaryPricingSnapshot(packageSnapshot, () =>
  calculate(packageProposal)
);
const includedPackageTargets: EquipmentPriceImpactTarget[] = [
  { kind: 'mainPump' },
  { kind: 'mainFilter' },
  { kind: 'cleaner' },
  { kind: 'mainHeater' },
  { kind: 'poolLight', index: 0 },
  { kind: 'automation' },
  { kind: 'sanitation' },
  { kind: 'additionalSanitation' },
  { kind: 'autoFill' },
];

includedPackageTargets.forEach((target) => {
  const packageItemResult = calculateEquipmentPriceImpact({
    proposal: packageProposal,
    target,
    currentCalculation: packageCurrentCalculation,
    pricingSnapshot: packageSnapshot,
    calculateProposal: calculate,
  });
  assert.equal(packageItemResult.status, 'available', packageItemResult.message);
  assert.equal(packageItemResult.reconciliationDifference, 0);
  assert.equal(packageItemResult.displayBasis, 'retail');
  assert.equal(
    packageItemResult.directCharges[0]?.amount,
    0,
    `${target.kind} should start with its package-included equipment row.`
  );
  assert.match(packageItemResult.directCharges[0]?.label || '', /included in Fixture Equipment Bundle/i);
  packageItemResult.directCharges.concat(packageItemResult.automaticEffects).forEach((line) => {
    assert.ok(line.amount >= 0, `${target.kind} should not show negative package-item rows.`);
  });
  assert.ok(packageItemResult.overheadAmount >= 0, `${target.kind} overhead should not be negative.`);
  assert.ok(packageItemResult.customerPriceChange >= 0, `${target.kind} total should not be negative.`);
});

const tileSnapshot = clone(snapshot);
tileSnapshot.tileCoping.decking.additionalOptions = [
  {
    id: 'premium-paver',
    name: 'Premium Paver',
    laborRate: 10,
    materialRate: 15,
    wasteNotIncluded: false,
  },
];
tileSnapshot.papDiscountRates.tileCopingLabor = 0.1;
tileSnapshot.papDiscountRates.tileCopingMaterial = 0.05;

const tileProposal = withTemporaryPricingSnapshot(tileSnapshot, () => {
  const next = getDefaultProposal() as Proposal;
  next.poolSpecs = {
    ...next.poolSpecs,
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
  next.tileCopingDecking = {
    ...next.tileCopingDecking,
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
      { deckingType: 'premium-paver', area: 100, isOffContract: false },
    ],
    additionalDeckingType: 'premium-paver',
    additionalDeckingArea: 100,
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
  };
  next.papDiscounts = clone(tileSnapshot.papDiscountRates);
  return next;
});
const tileCurrentCalculation = withTemporaryPricingSnapshot(tileSnapshot, () =>
  calculate(tileProposal)
);
const tileTargets: TileCopingDeckingPriceImpactTarget[] = [
  { kind: 'tileOption' },
  { kind: 'numeric', field: 'additionalTileLength' },
  { kind: 'trimTile' },
  { kind: 'copingType' },
  { kind: 'copingSize' },
  { kind: 'numeric', field: 'bullnoseLnft' },
  { kind: 'numeric', field: 'spillwayLnft' },
  { kind: 'deckingType' },
  { kind: 'additionalDecking', index: 0 },
  { kind: 'additionalDeckingArea', index: 0 },
  { kind: 'numeric', field: 'concreteStepsLength' },
  { kind: 'roughGrading' },
  { kind: 'customOption', index: 0 },
];

tileTargets.forEach((target) => {
  const targetResult = calculateTileCopingDeckingPriceImpact({
    proposal: tileProposal,
    target,
    currentCalculation: tileCurrentCalculation,
    pricingSnapshot: tileSnapshot,
    calculateProposal: calculate,
  });
  assert.equal(
    targetResult.status,
    'available',
    `${JSON.stringify(target)} should have an exact Tile / Coping / Decking comparison: ${targetResult.message}`
  );
  assert.ok(
    Math.abs(targetResult.reconciliationDifference) < 0.02,
    `${JSON.stringify(target)} should reconcile within one cent.`
  );
  assert.ok(targetResult.directCharges.length > 0, `${JSON.stringify(target)} should show a direct charge.`);
  assert.equal(
    targetResult.automaticEffects.length,
    0,
    `${JSON.stringify(target)} should not misclassify its originating category as indirect.`
  );
});

const smallConcreteDeckingProposal = clone(tileProposal);
smallConcreteDeckingProposal.poolSpecs.perimeter = 20;
smallConcreteDeckingProposal.poolSpecs.deckingArea = 20;
smallConcreteDeckingProposal.tileCopingDecking.deckingArea = 20;
const smallConcreteDeckingCalculation = withTemporaryPricingSnapshot(tileSnapshot, () =>
  calculate(smallConcreteDeckingProposal)
);
const smallConcreteDeckingResult = calculateTileCopingDeckingPriceImpact({
  proposal: smallConcreteDeckingProposal,
  target: { kind: 'deckingType' },
  currentCalculation: smallConcreteDeckingCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
const concreteMaterialLines = smallConcreteDeckingResult.directCharges.filter(
  (line) => line.label === 'Concrete Decking Material'
);
assert.equal(
  concreteMaterialLines.length,
  1,
  'Concrete base and area adjustment rows should be combined into one material line.'
);
assert.ok(
  concreteMaterialLines[0].amount > 0,
  'The combined Concrete Decking Material line should show the positive net material cost.'
);
assert.ok(
  smallConcreteDeckingResult.directCharges.every(
    (line) =>
      line.label !== 'Concrete Decking - Base' &&
      line.label !== 'Concrete Decking - Additional'
  ),
  'Price Impact should not expose the internal concrete base and adjustment rows.'
);

const tileUpgradeResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileProposal,
  target: { kind: 'tileOption' },
  currentCalculation: tileCurrentCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.match(tileUpgradeResult.comparisonLabel, /Level 1 base tile/i);
assert.ok(
  tileUpgradeResult.directCharges.some((line) => line.label === 'Pool Tile Material Upgrade'),
  'A tile replacement should show the net material upgrade instead of negative base-option rows.'
);
assert.ok(
  tileUpgradeResult.directCharges.every((line) => line.amount >= 0),
  'The configured Level 2 tile upgrade should not expose negative base-option rows.'
);
assert.ok(
  tileUpgradeResult.directCharges.some((line) => line.label === 'Tile Material Tax'),
  'Tile impact should include material tax.'
);

const tileLabelProposal = clone(tileProposal);
tileLabelProposal.poolSpecs.spaType = 'gunite';
tileLabelProposal.poolSpecs.spaLength = 7;
tileLabelProposal.poolSpecs.spaWidth = 7;
tileLabelProposal.poolSpecs.spaPerimeter = 28;
tileLabelProposal.tileCopingDecking.tileOptionId = 'level1';
tileLabelProposal.tileCopingDecking.tileLevel = 1;
tileLabelProposal.tileCopingDecking.copingType = 'travertine-level1';
tileLabelProposal.tileCopingDecking.copingSize = '12x12';
const tileLabelCalculation = withTemporaryPricingSnapshot(tileSnapshot, () =>
  calculate(tileLabelProposal)
);
const baseTileLabelResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileLabelProposal,
  target: { kind: 'tileOption' },
  currentCalculation: tileLabelCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  baseTileLabelResult.directCharges.some((line) => line.label === 'Level 1 Tile Material'),
  'Pool tile material should be explicitly identified as material.'
);
assert.ok(
  baseTileLabelResult.directCharges.some(
    (line) => line.label === 'Level 1 Tile Material - Spa'
  ),
  'Spa tile material should be explicitly identified as material.'
);

const additionalTileLabelResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileLabelProposal,
  target: { kind: 'numeric', field: 'additionalTileLength' },
  currentCalculation: tileLabelCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  additionalTileLabelResult.directCharges.some(
    (line) => line.label === 'Level 1 Tile Material'
  ),
  'Additional tile length should keep the pool material descriptor.'
);

const copingLaborLabelResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileLabelProposal,
  target: { kind: 'copingType' },
  currentCalculation: tileLabelCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  copingLaborLabelResult.directCharges.some(
    (line) => line.label === 'Travertine - Level 1 Coping Labor'
  ),
  'Coping labor should be explicitly identified as labor.'
);

const roughGradingResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileProposal,
  target: { kind: 'roughGrading' },
  currentCalculation: tileCurrentCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  roughGradingResult.directCharges.map((line) => [line.section, line.label]),
  [['cleanup', 'Rough Grading']],
  'Rough Grading should identify its Cleanup charge as direct.'
);

const tileComparison = buildTileCopingDeckingPriceImpactComparisonProposal(
  tileProposal,
  { kind: 'numeric', field: 'additionalTileLength' },
  tileSnapshot
);
assert.ok(tileComparison);
assert.equal(tileComparison.tileCopingDecking.additionalTileLength, 0);
const tileComparisonCalculation = withTemporaryPricingSnapshot(tileSnapshot, () =>
  calculate(tileComparison)
);
const additionalTileResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileProposal,
  target: { kind: 'numeric', field: 'additionalTileLength' },
  currentCalculation: tileCurrentCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.equal(
  additionalTileResult.customerPriceChange,
  roundCurrency(
    tileCurrentCalculation.pricing.retailPrice -
      tileComparisonCalculation.pricing.retailPrice
  ),
  'Tile / Coping / Decking impact should equal the exact full-engine retail delta.'
);

const offContractDeckingProposal = clone(tileProposal);
offContractDeckingProposal.tileCopingDecking.deckingType = 'travertine-level2';
offContractDeckingProposal.tileCopingDecking.isDeckingOffContract = true;
const offContractDeckingCalculation = withTemporaryPricingSnapshot(tileSnapshot, () =>
  calculate(offContractDeckingProposal)
);
const deckingOffContractResult = calculateTileCopingDeckingPriceImpact({
  proposal: offContractDeckingProposal,
  target: { kind: 'deckingOffContract' },
  currentCalculation: offContractDeckingCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.equal(deckingOffContractResult.status, 'available', deckingOffContractResult.message);
assert.equal(deckingOffContractResult.reconciliationDifference, 0);
assert.ok(
  deckingOffContractResult.directCharges.some(
    (line) => line.label === 'Off-Contract Retail Price' && line.amount > 0
  ),
  'The off-contract switch should show its retail-only amount.'
);
assert.ok(
  deckingOffContractResult.directCharges.some((line) => line.cogsAmount < 0),
  'The off-contract switch should explain which contract COGS are removed.'
);

const tileCogsResult = calculateTileCopingDeckingPriceImpact({
  proposal: tileProposal,
  target: { kind: 'numeric', field: 'bullnoseLnft' },
  displayBasis: 'cogs',
  currentCalculation: tileCurrentCalculation,
  pricingSnapshot: tileSnapshot,
  calculateProposal: calculate,
});
assert.equal(tileCogsResult.displayBasis, 'cogs');
assert.equal(tileCogsResult.customerPriceChange, tileCogsResult.totalCogsChange);

const drainageSnapshot = clone(snapshot);
drainageSnapshot.misc.drainage = {
  baseCost: 150,
  includedFt: 10,
  perFtOver: 12.5,
};
const drainageProposal = clone(proposal);
drainageProposal.drainage = {
  ...drainageProposal.drainage,
  downspoutTotalLF: 20,
  deckDrainTotalLF: 10,
  frenchDrainTotalLF: 35,
  boxDrainTotalLF: 2,
  customOptions: [
    {
      name: 'Drainage Catch Basin',
      description: 'Fixture drainage labor and material',
      laborCost: 150,
      materialCost: 50,
      totalCost: 200,
      isOffContract: false,
    },
    {
      name: 'Off-Contract Drainage Option',
      description: 'Fixture off-contract drainage option',
      laborCost: 200,
      materialCost: 100,
      totalCost: 300,
      isOffContract: true,
    },
  ],
};
const drainageCurrentCalculation = withTemporaryPricingSnapshot(drainageSnapshot, () =>
  calculate(drainageProposal)
);
const drainageTargets: DrainagePriceImpactTarget[] = [
  { kind: 'run', field: 'downspoutTotalLF' },
  { kind: 'run', field: 'deckDrainTotalLF' },
  { kind: 'run', field: 'frenchDrainTotalLF' },
  { kind: 'run', field: 'boxDrainTotalLF' },
  { kind: 'customOption', index: 0 },
  { kind: 'customOption', index: 1 },
];

drainageTargets.forEach((target) => {
  const targetResult = calculateDrainagePriceImpact({
    proposal: drainageProposal,
    target,
    currentCalculation: drainageCurrentCalculation,
    pricingSnapshot: drainageSnapshot,
    calculateProposal: calculate,
  });
  assert.equal(
    targetResult.status,
    'available',
    `${JSON.stringify(target)} should have an exact Drainage comparison: ${targetResult.message}`
  );
  assert.ok(
    Math.abs(targetResult.reconciliationDifference) < 0.02,
    `${JSON.stringify(target)} should reconcile within one cent.`
  );
  assert.ok(targetResult.directCharges.length > 0);
  assert.equal(targetResult.automaticEffects.length, 0);
});

const downspoutResult = calculateDrainagePriceImpact({
  proposal: drainageProposal,
  target: { kind: 'run', field: 'downspoutTotalLF' },
  currentCalculation: drainageCurrentCalculation,
  pricingSnapshot: drainageSnapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  downspoutResult.directCharges.map((line) => [line.label, line.note]),
  [
    ['Downspout Drain Base', undefined],
    ['Downspout Drain Overage', 'Up to 10 LNFT Included'],
  ],
  'Drainage runs should put the included allowance only beneath the overage.'
);
assert.equal(
  roundCurrency(downspoutResult.directCharges.reduce((sum, line) => sum + line.cogsAmount, 0)),
  275,
  'The Drainage display rows should preserve the exact base-plus-overage COGS.'
);

const deckDrainResult = calculateDrainagePriceImpact({
  proposal: drainageProposal,
  target: { kind: 'run', field: 'deckDrainTotalLF' },
  currentCalculation: drainageCurrentCalculation,
  pricingSnapshot: drainageSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  deckDrainResult.directCharges.some(
    (line) => line.label === 'Deck Drain Overage' && line.amount === 0
  ),
  'A run within the included allowance should still explain that its overage is zero.'
);

const drainageCogsResult = calculateDrainagePriceImpact({
  proposal: drainageProposal,
  target: { kind: 'run', field: 'frenchDrainTotalLF' },
  displayBasis: 'cogs',
  currentCalculation: drainageCurrentCalculation,
  pricingSnapshot: drainageSnapshot,
  calculateProposal: calculate,
});
assert.equal(drainageCogsResult.customerPriceChange, drainageCogsResult.totalCogsChange);
assert.ok(
  drainageCogsResult.directCharges.some(
    (line) =>
      line.label === 'French Drain Overage' &&
      line.note === 'Up to 10 LNFT Included' &&
      line.amount === line.cogsAmount
  ),
  'Drainage should preserve its allowance wording and COGS display basis without exposing a unit rate.'
);

const offContractDrainageResult = calculateDrainagePriceImpact({
  proposal: drainageProposal,
  target: { kind: 'customOption', index: 1 },
  currentCalculation: drainageCurrentCalculation,
  pricingSnapshot: drainageSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  offContractDrainageResult.directCharges.some(
    (line) => line.label === 'Off-Contract Retail Price' && line.amount === 300
  ),
  'Off-contract Drainage options should show their retail-only amount.'
);

const noDownspoutProposal = clone(drainageProposal);
noDownspoutProposal.drainage.downspoutTotalLF = 0;
assert.equal(
  buildDrainagePriceImpactComparisonProposal(noDownspoutProposal, {
    kind: 'run',
    field: 'downspoutTotalLF',
  }),
  null,
  'A zero Drainage run should not build a Price Impact comparison.'
);

const waterFeatureSnapshot = clone(snapshot) as any;
waterFeatureSnapshot.plans.waterFeature = 25;
waterFeatureSnapshot.plumbing.waterFeatureRun = {
  setup: 200,
  baseAllowanceFt: 30,
  perFt: 5.5,
};
waterFeatureSnapshot.plumbing.twoInchPipe = 5.5;
waterFeatureSnapshot.plumbing.additionalWaterFeatureRunPerFt = 5.5;
waterFeatureSnapshot.plumbing.conduitPerFt = 2.75;
waterFeatureSnapshot.plumbing.valveActuator = 125;
waterFeatureSnapshot.waterFeatures = {
  retailMargin: 0.7,
  sheerDescents: [
    {
      id: 'impact-sheer',
      name: 'Impact Sheer Descent',
      category: 'Sheer Descent',
      basePrice: 500,
      addCost1: 50,
      addCost2: 0,
      requiresConduit: true,
    },
  ],
  jets: [
    {
      id: 'impact-jet',
      name: 'Impact Deck Jet',
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
        id: 'impact-fire-wok',
        name: 'Impact Fire and Water Wok',
        category: 'Wok Pots - Water & Fire',
        basePrice: 800,
        addCost1: 100,
        addCost2: 0,
      },
    ],
  },
  bubblers: [],
};

const waterFeatureProposal = clone(proposal);
waterFeatureProposal.equipment = {
  ...waterFeatureProposal.equipment,
  additionalPumps: [],
  packageSelectionId: 'custom',
  packageSelectionTouched: true,
};
waterFeatureProposal.waterFeatures = {
  selections: [
    { featureId: 'impact-sheer', quantity: 2, includeValveActuator: true },
    { featureId: 'impact-fire-wok', quantity: 1, includeValveActuator: true },
  ],
  customOptions: [
    {
      name: 'Water Feature Accent',
      description: 'Fixture option',
      laborCost: 100,
      materialCost: 200,
      totalCost: 300,
    },
  ],
  totalCost: 1_400,
};
waterFeatureProposal.plumbing.runs = {
  ...waterFeatureProposal.plumbing.runs,
  waterFeature1Run: 45,
  waterFeature2Run: 40,
  waterFeature3Run: 0,
  waterFeature4Run: 0,
};
waterFeatureProposal.papDiscounts = clone(waterFeatureSnapshot.papDiscountRates);

const waterFeatureCurrentCalculation = withTemporaryPricingSnapshot(
  waterFeatureSnapshot,
  () => calculate(waterFeatureProposal)
);
const waterFeatureTargets: WaterFeaturePriceImpactTarget[] = [
  { kind: 'selection', index: 0 },
  { kind: 'lineItem', index: 0 },
  { kind: 'quantity', index: 0 },
  { kind: 'run', index: 0, field: 'waterFeature1Run' },
  { kind: 'valveActuator', index: 0 },
  { kind: 'customOption', index: 0 },
];

waterFeatureTargets.forEach((target) => {
  const targetResult = calculateWaterFeaturePriceImpact({
    proposal: waterFeatureProposal,
    target,
    currentCalculation: waterFeatureCurrentCalculation,
    pricingSnapshot: waterFeatureSnapshot,
    calculateProposal: calculate,
  });
  assert.equal(
    targetResult.status,
    'available',
    `${JSON.stringify(target)} should have an exact Water Feature comparison: ${targetResult.message}`
  );
  assert.ok(
    Math.abs(targetResult.reconciliationDifference) < 0.02,
    `${JSON.stringify(target)} should reconcile within one cent.`
  );
});

const waterFeatureSelectionResult = calculateWaterFeaturePriceImpact({
  proposal: waterFeatureProposal,
  target: { kind: 'selection', index: 0 },
  currentCalculation: waterFeatureCurrentCalculation,
  pricingSnapshot: waterFeatureSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  waterFeatureSelectionResult.directCharges.some(
    (line) => line.label === 'Impact Sheer Descent Equipment'
  ),
  'A selected Water Feature should expose its equipment charge.'
);

const waterFeatureLineItemResult = calculateWaterFeaturePriceImpact({
  proposal: waterFeatureProposal,
  target: { kind: 'lineItem', index: 0 },
  currentCalculation: waterFeatureCurrentCalculation,
  pricingSnapshot: waterFeatureSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  waterFeatureLineItemResult.automaticEffects.some(
    (line) => line.label === 'Water Feature Run Setup and Overage'
  ),
  'A collapsed Water Feature line item should include its complete run impact.'
);
assert.ok(
  waterFeatureLineItemResult.automaticEffects.some(
    (line) => line.label === 'Water Feature Valve Actuator'
  ),
  'A collapsed Water Feature line item should include its Valve Actuator impact.'
);
assert.ok(
  waterFeatureSelectionResult.directCharges.some((line) => line.label === 'Equipment Tax'),
  'A selected Water Feature should expose its equipment tax.'
);
assert.ok(
  waterFeatureSelectionResult.automaticEffects.some(
    (line) => line.label === 'Water Feature Plans & Engineering'
  ),
  'A selected Water Feature should expose its plans and engineering dependency.'
);
assert.ok(
  waterFeatureSelectionResult.automaticEffects.some(
    (line) => line.label === 'Linked Water Feature Plumbing'
  ),
  'A selected Water Feature should expose linked plumbing.'
);
assert.equal(
  waterFeatureSelectionResult.automaticEffects.filter(
    (line) => line.label === 'Water Feature Run Setup and Overage'
  ).length,
  1,
  'Removing a Water Feature should consolidate run reassignment into one understandable line.'
);

const fireWokSelectionResult = calculateWaterFeaturePriceImpact({
  proposal: waterFeatureProposal,
  target: { kind: 'selection', index: 1 },
  currentCalculation: waterFeatureCurrentCalculation,
  pricingSnapshot: waterFeatureSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  fireWokSelectionResult.automaticEffects.some(
    (line) => line.label === 'Water Feature Gas Setup'
  ),
  'A fire Wok should expose its linked gas setup.'
);
assert.ok(
  fireWokSelectionResult.automaticEffects.some(
    (line) => line.label === 'Water Feature Gas Run Overage'
  ),
  'A fire Wok run beyond the gas allowance should expose its linked gas overage.'
);

const waterFeatureRunResult = calculateWaterFeaturePriceImpact({
  proposal: waterFeatureProposal,
  target: { kind: 'run', index: 0, field: 'waterFeature1Run' },
  currentCalculation: waterFeatureCurrentCalculation,
  pricingSnapshot: waterFeatureSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  waterFeatureRunResult.directCharges.some(
    (line) =>
      line.label === 'Water Feature Run 1 Overage' &&
      line.note === 'Up to 30 LNFT Included'
  ),
  'Water Feature run impact should explain the 30-foot allowance without exposing a unit rate.'
);
assert.ok(
  waterFeatureRunResult.directCharges.some(
    (line) => line.label === 'Water Feature Run 1 Setup'
  ),
  'Water Feature run impact should separate setup from overage.'
);

const waterFeatureActuatorResult = calculateWaterFeaturePriceImpact({
  proposal: waterFeatureProposal,
  target: { kind: 'valveActuator', index: 0 },
  currentCalculation: waterFeatureCurrentCalculation,
  pricingSnapshot: waterFeatureSnapshot,
  calculateProposal: calculate,
});
assert.ok(
  waterFeatureActuatorResult.directCharges.some(
    (line) => line.label === 'Water Feature Valve Actuator'
  ),
  'The Valve Actuator switch should expose its exact plumbing charge.'
);

const fixedPackageSnapshot = clone(waterFeatureSnapshot) as any;
fixedPackageSnapshot.equipment.packageOptions = [
  {
    id: 'impact-water-feature-package',
    name: 'Impact Water Feature Package',
    mode: 'fixed',
    enabled: true,
    basePrice: 1_000,
    includeCheckValve: false,
    supportsSpa: true,
    allowAdditionalPumps: true,
    allowWaterFeatureUpgrade: true,
    includedWaterFeaturesBeforeExtraPump: 1,
    includedPumpName: 'Impact Test Pump',
    includedPumpQuantity: 1,
  },
  { id: 'custom', name: 'Custom', mode: 'custom', enabled: true },
];
const fixedPackageWaterFeatureProposal = clone(waterFeatureProposal);
fixedPackageWaterFeatureProposal.equipment = {
  ...fixedPackageWaterFeatureProposal.equipment,
  packageSelectionId: 'impact-water-feature-package',
  packageSelectionTouched: true,
  additionalPumps: [{ ...pump, autoAddedReason: 'waterFeature' }],
};
const fixedPackageComparison = buildWaterFeaturePriceImpactComparisonProposal(
  fixedPackageWaterFeatureProposal,
  { kind: 'selection', index: 1 },
  fixedPackageSnapshot
);
assert.ok(fixedPackageComparison);
assert.equal(
  fixedPackageComparison?.equipment.additionalPumps?.some(
    (selection) => selection.autoAddedReason === 'waterFeature'
  ),
  false,
  'Removing the category that crossed a fixed-package allowance should remove its auto-added pump in the comparison.'
);
const fixedPackageCurrentCalculation = withTemporaryPricingSnapshot(
  fixedPackageSnapshot,
  () => calculate(fixedPackageWaterFeatureProposal)
);
const fixedPackageWaterFeatureResult = calculateWaterFeaturePriceImpact({
  proposal: fixedPackageWaterFeatureProposal,
  target: { kind: 'selection', index: 1 },
  currentCalculation: fixedPackageCurrentCalculation,
  pricingSnapshot: fixedPackageSnapshot,
  calculateProposal: calculate,
});
assert.equal(fixedPackageWaterFeatureResult.status, 'available');
assert.ok(
  fixedPackageWaterFeatureResult.automaticEffects.some(
    (line) => line.label === 'Auto-Added Water Feature Pump Equipment'
  ),
  'A package-triggered Water Feature pump should be explained as an indirect charge.'
);
assert.equal(
  fixedPackageWaterFeatureResult.directCharges.some(
    (line) => line.label === 'Auto-Added Water Feature Pump Equipment'
  ),
  false,
  'A package-triggered Water Feature pump should not be described as a direct feature charge.'
);

console.log('Price Impact verification passed.');
