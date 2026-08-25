import assert from 'node:assert/strict';
import pricingData from '../src/services/pricingData';
import MasterPricingEngine from '../src/services/masterPricingEngine';
import {
  buildAdditionalPumpComparisonProposal,
  buildPlumbingPriceImpactComparisonProposal,
  calculateAdditionalPumpPriceImpact,
  calculateEquipmentPriceImpact,
  calculatePlumbingPriceImpact,
  type EquipmentPriceImpactTarget,
  type PlumbingPriceImpactTarget,
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
    ['Pump equipment', 1_000, 1_428.57],
    ['Equipment tax', 80, 114.29],
    ['Additional-pump setup', 150, 214.29],
  ]
);
assert.deepEqual(
  result.automaticEffects.map((line) => [line.label, line.cogsAmount, line.amount]),
  [
    ['Second main-drain plumbing run', 350, 500],
    ['Additional main drain', 100, 142.86],
    ['Interior-finish fittings', 30, 42.86],
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
  assert.equal(targetResult.reconciliationDifference, 0);
  targetResult.directCharges.concat(targetResult.automaticEffects).forEach((line) => {
    assert.equal(line.amount, line.retailAmount, `${target.kind} should display retail row amounts.`);
  });
});

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
    target.kind === 'run' ? 2 : 1,
    `${targetName} should calculate only its total and, for runs, current unit comparison.`
  );
  assert.equal(targetResult.displayBasis, 'retail');
  assert.equal(targetResult.reconciliationDifference, 0);
  if (target.kind === 'run') {
    assert.ok(targetResult.unitImpact, `${targetName} should include its current per-unit impact.`);
    assert.equal(targetResult.unitImpact.amount, targetResult.unitImpact.retailAmount);
  }
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
  mainDrainResult.directCharges.some((line) =>
    /Main-drain plumbing \(2 pump runs\)/i.test(line.label)
  ),
  'Main Drain Run should explain the repeated run created by the additional pump.'
);

const skimmerRunResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'skimmerRun' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.deepEqual(
  skimmerRunResult.directCharges
    .filter((line) => /Skimmer-run/i.test(line.label))
    .map((line) => line.label),
  ['Skimmer-run overage', 'Skimmer-run 2-inch plumbing'],
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
  spaRunResult.directCharges.some((line) => line.label === 'Spa-run overage'),
  'Spa Run should include its billable overage after the saved allowance.'
);
assert.equal(
  spaRunResult.unitImpact?.note,
  `Up to ${snapshot.plumbing.spaOverrunThreshold} LNFT Included`,
  'Spa Run should explain the allowance configured in the saved pricing model.'
);

const additionalSkimmersResult = calculatePlumbingPriceImpact({
  proposal: comprehensiveProposal,
  target: { kind: 'run', field: 'additionalSkimmers' },
  currentCalculation: comprehensiveCalculation,
  pricingSnapshot: snapshot,
  calculateProposal: calculate,
});
assert.ok(
  additionalSkimmersResult.directCharges.some((line) => line.label === 'Additional skimmers'),
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
  gasRunResult.automaticEffects.some((line) => line.label === 'Long gas-run plumbing'),
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
    (line) => line.label === 'Auto-fill electrical/conduit run'
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
  [['Off-contract retail price', 750]]
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
  [['Off-contract retail price', 900]]
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

console.log('Price Impact verification passed.');
