// ============================================================================
// PROPOSAL DEFAULTS - Initial values for new proposals
// ============================================================================

import {
  Proposal,
  PoolSpecs,
  Excavation,
  Plumbing,
  Electrical,
  TileCopingDecking,
  Drainage,
  Equipment,
  WaterFeatures,
  CustomFeatures,
  Masonry,
  InteriorFinish,
  CostBreakdown,
  PAPDiscounts,
  ManualAdjustments,
  RetailAdjustment,
  PlumbingRuns,
} from '../types/proposal-new';
import pricingData from '../services/pricingData';
import { CURRENT_CONTRACT_TEMPLATE_REVISION } from '../services/contractTemplateUpgrade';
import { NORMAL_PRICING_TIER_ID, getPricingTierName } from '../services/pricingTiers';
import { getEquipmentItemCost } from './equipmentCost';
import { getDefaultCleanerOption, getNoCleanerOption } from './cleanerDefaults';
import { getNoPumpSelection } from './pumpDefaults';
import { normalizePapDiscounts } from './papDiscounts';
import { CURRENT_PRICING_ENGINE_VERSION } from './pricingEngineCompatibility';

const isAdditionalFeatureEnabled = (key: string, fallback: boolean) => {
  const configured = (pricingData as any)?.additionalFeatureDefaults?.[key];
  return typeof configured === 'boolean' ? configured : fallback;
};

export function getDefaultPoolSpecs(): PoolSpecs {
  return {
    poolType: 'gunite',
    poolShape: 'geometric',
    perimeter: 0,
    surfaceArea: 0,
    shallowDepth: 0,
    endDepth: 0,
    fiberglassSize: undefined,
    fiberglassModelName: undefined,
    fiberglassFinishUpgradeName: undefined,
    fiberglassTanningLedgeName: undefined,
    needsFiberglassCrane: false,
    fiberglassModelPrice: undefined,
    fiberglassPerimeter: undefined,
    fiberglassCraneOption: 'no-crane',
    maxWidth: 0,
    maxLength: 0,
    totalStepsAndBench: 0,
    hasTanningShelf: isAdditionalFeatureEnabled('tanningShelf', false),
    spaType: 'none',
    spaLength: 0,
    spaWidth: 0,
    spaShape: 'round',
    spaPerimeter: 0,
    spaFiberglassModelName: undefined,
    needsFiberglassSpaCrane: false,
    spaFiberglassModelPrice: undefined,
    isRaisedSpa: false,
    raisedSpaFacing: 'none',
    hasSpillover: false,
    deckingArea: 0,
    travelDistance: 0,
    poolToStreetDistance: 0,
    hasSiltFence: isAdditionalFeatureEnabled('siltFence', true),
    hasAutomaticCover: isAdditionalFeatureEnabled('automaticCover', false),
    automaticCoverManufacturerCost: 0,
    waterfallCount: 0,
    approximateGallons: 0,
  };
}

export function getDefaultExcavation(): Excavation {
  const hasGravelInstall = isAdditionalFeatureEnabled('gravelInstall', true);
  const hasDirtHaul = isAdditionalFeatureEnabled('dirtHaul', true);
  return {
    rbbLevels: [],
    totalRBBSqft: 0,
    exposedPoolWallLevels: [],
    columns: {
      count: 0,
      width: 0,
      depth: 0,
      height: 0,
      facing: 'none',
    },
    additionalSitePrepHours: 0,
    hasAdditionalSitePrep: isAdditionalFeatureEnabled('additionalSitePrep', false),
    hasTightAccessJob: isAdditionalFeatureEnabled('tightAccessJob', false),
    hasGravelInstall,
    gravelInstallQuantity: hasGravelInstall ? 1 : 0,
    hasDirtHaul,
    dirtHaulQuantity: hasDirtHaul ? 1 : 0,
    additionalBench: 0,
    doubleCurtainLength: 0,
    hasDoubleCurtain: isAdditionalFeatureEnabled('doubleCurtain', false),
    needsSoilSampleEngineer: isAdditionalFeatureEnabled('soilSampleEngineer', false),
    retainingWalls: [],
    retainingWallType: 'None',
    retainingWallLength: 0,
    customOptions: [],
    cost: 0,
  };
}

export function getDefaultPlumbingRuns(): PlumbingRuns {
  return {
    skimmerRun: 0,
    additionalSkimmers: 0,
    mainDrainRun: 0,
    cleanerRun: 0,
    autoFillRun: 0,
    autoFillElectricRun: 0,
    waterFeature1Run: 0,
    waterFeature2Run: 0,
    waterFeature3Run: 0,
    waterFeature4Run: 0,
    infloorValveToEQ: 0,
    infloorValveToPool: 0,
    gasRun: 0,
    spaRun: 0,
  };
}

export function mergePlumbingRuns(input?: Partial<PlumbingRuns>): PlumbingRuns {
  const defaultRuns = getDefaultPlumbingRuns();
  if (!input) return defaultRuns;

  const hasAutoFillElectricRun = Object.prototype.hasOwnProperty.call(input, 'autoFillElectricRun');

  return {
    ...defaultRuns,
    ...input,
    autoFillElectricRun: hasAutoFillElectricRun ? input.autoFillElectricRun ?? 0 : input.autoFillRun ?? 0,
  };
}

export function getDefaultPlumbing(): Plumbing {
  return {
    runs: getDefaultPlumbingRuns(),
    customOptions: [],
    cost: 0,
  };
}

export function getDefaultElectrical(): Electrical {
  return {
    runs: {
      electricalRun: 0,
      lightRun: 0,
      heatPumpElectricalRun: 0,
    },
    customOptions: [],
    cost: 0,
  };
}

export function getDefaultTileCopingDecking(): TileCopingDecking {
  return {
    tileLevel: 1,
    tileOptionId: 'level1',
    additionalTileLength: 0,
    hasTrimTileOnSteps: false,
    copingType: 'travertine-level1',
    copingSize: '12x12',
    copingLength: 0,
    deckingType: 'travertine-level1',
    deckingArea: 0,
    additionalDeckingSelections: [],
    additionalDeckingType: '',
    additionalDeckingArea: 0,
    concreteStepsLength: 0,
    isDeckingOffContract: false,
    isDeckingWasteRemoved: false,
    isAdditionalDeckingOffContract: false,
    isAdditionalDeckingWasteRemoved: false,
    deckingOffContractCost: 0,
    bullnoseLnft: 0,
    doubleBullnoseLnft: 0,
    spillwayLnft: 0,
    rockworkPanelLedgeSqft: 0,
    rockworkPanelLedgeMaterialSqft: 0,
    rockworkStackedStoneSqft: 0,
    rockworkTileSqft: 0,
    hasRoughGrading: true,
    customOptions: [],
    cost: 0,
  };
}

export function getDefaultDrainage(): Drainage {
  return {
    downspoutTotalLF: 0,
    deckDrainTotalLF: 0,
    frenchDrainTotalLF: 0,
    boxDrainTotalLF: 0,
    customOptions: [],
    cost: 0,
  };
}

export function getDefaultEquipment(): Equipment {
  const pumpOverhead = (pricingData as any).equipment?.pumpOverheadMultiplier ?? 1;
  const pickDefault = <T extends { name: string }>(list: T[], multiplier: number = 1) =>
    list.find(item => getEquipmentItemCost(item as any, multiplier) === 0) || list[0];

  const defaultPump = getNoPumpSelection(pumpOverhead);
  const defaultFilter = pickDefault(pricingData.equipment.filters, 1);
  const defaultCleaner =
    getNoCleanerOption(pricingData.equipment.cleaners) ||
    getDefaultCleanerOption(pricingData.equipment.cleaners) ||
    pickDefault(pricingData.equipment.cleaners, 1);
  const defaultHeater = pickDefault(pricingData.equipment.heaters, 1);
  const defaultAutomation = pickDefault(pricingData.equipment.automation, 1);
  const otherOverhead = 1;

  return {
    pump: { ...defaultPump },
    pumpQuantity: 0,
    additionalPumps: [],
    auxiliaryPumps: [],
    filter: {
      name: defaultFilter.name,
      sqft: (defaultFilter as any).sqft,
      basePrice: (defaultFilter as any).basePrice,
      addCost1: (defaultFilter as any).addCost1,
      addCost2: (defaultFilter as any).addCost2,
      price: getEquipmentItemCost(defaultFilter as any, otherOverhead),
    },
    filterQuantity: 0,
    additionalFilters: [],
    cleaner: {
      name: defaultCleaner.name,
      basePrice: (defaultCleaner as any).basePrice,
      addCost1: (defaultCleaner as any).addCost1,
      addCost2: (defaultCleaner as any).addCost2,
      price: getEquipmentItemCost(defaultCleaner as any, otherOverhead),
    },
    cleanerQuantity: 0,
    heater: {
      name: defaultHeater.name,
      btu: (defaultHeater as any).btu,
      basePrice: (defaultHeater as any).basePrice,
      addCost1: (defaultHeater as any).addCost1,
      addCost2: (defaultHeater as any).addCost2,
      price: getEquipmentItemCost(defaultHeater as any, otherOverhead),
    },
    heaterQuantity: 0,
    additionalHeaters: [],
    heaterChiller: undefined,
    heaterChillerQuantity: 0,
    poolLights: [],
    spaLights: [],
    applyCustomPackageDefaultPoolLights: false,
    numberOfLights: 0,
    hasSpaLight: false,
    automation: {
      name: defaultAutomation.name,
      basePrice: (defaultAutomation as any).basePrice,
      addCost1: (defaultAutomation as any).addCost1,
      addCost2: (defaultAutomation as any).addCost2,
      addCost3: (defaultAutomation as any).addCost3,
      includesSaltCell: (defaultAutomation as any).includesSaltCell,
      price: getEquipmentItemCost(defaultAutomation as any, otherOverhead),
      zones: 0,
    },
    automationQuantity: 0,
    saltSystem: undefined,
    saltSystemQuantity: undefined,
    additionalSaltSystem: undefined,
    autoFillSystem: undefined,
    autoFillSystemQuantity: undefined,
    sanitationAccessory: undefined,
    sanitationAccessoryQuantity: 0,
    hasBlanketReel: false,
    hasSolarBlanket: false,
    hasAutoFill: false,
    hasHandrail: false,
    hasStartupChemicals: false,
    packageSelectionId: undefined,
    packageSelectionTouched: undefined,
    customOptions: [],
    totalCost: 0,
    hasBeenEdited: false,
  };
}

export function getDefaultWaterFeatures(): WaterFeatures {
  return {
    selections: [],
    customOptions: [],
    totalCost: 0,
  };
}

export function getDefaultCustomFeatures(): CustomFeatures {
  return {
    features: [],
    totalCost: 0,
  };
}

export function getDefaultMasonry(): Masonry {
  return {
    columnCost: 0,
    rbbFacingCost: 0,
    raisedSpaFacingCost: 0,
    totalCost: 0,
  };
}

export function getDefaultInteriorFinish(): InteriorFinish {
  const defaultFinishId = pricingData.interiorFinish.finishes?.[0]?.id || 'pebble-tec-l1';
  return {
    finishType: defaultFinishId,
    color: '',
    surfaceArea: 0,
    hasSpa: false,
    hasWaterproofing: isAdditionalFeatureEnabled('waterproofing', false),
    customOptions: [],
    cost: 0,
  };
}

export function getDefaultCostBreakdown(): CostBreakdown {
  return {
    plansAndEngineering: [],
    layout: [],
    permit: [],
    excavation: [],
    plumbing: [],
    gas: [],
    steel: [],
    electrical: [],
    shotcreteLabor: [],
    shotcreteMaterial: [],
    tileLabor: [],
    tileMaterial: [],
    copingDeckingLabor: [],
    copingDeckingMaterial: [],
    stoneRockworkLabor: [],
    stoneRockworkMaterial: [],
    drainage: [],
    equipmentOrdered: [],
    equipmentSet: [],
    waterFeatures: [],
    cleanup: [],
    interiorFinish: [],
    waterTruck: [],
    fiberglassShell: [],
    fiberglassInstall: [],
    startupOrientation: [],
    customFeatures: [],
    totals: {
      plansAndEngineering: 0,
      layout: 0,
      permit: 0,
      excavation: 0,
      plumbing: 0,
      gas: 0,
      steel: 0,
      electrical: 0,
      shotcreteLabor: 0,
      shotcreteMaterial: 0,
      tileLabor: 0,
      tileMaterial: 0,
      copingDeckingLabor: 0,
      copingDeckingMaterial: 0,
      stoneRockworkLabor: 0,
      stoneRockworkMaterial: 0,
      drainage: 0,
      equipmentOrdered: 0,
      equipmentSet: 0,
      waterFeatures: 0,
      cleanup: 0,
      interiorFinish: 0,
      waterTruck: 0,
      fiberglassShell: 0,
      fiberglassInstall: 0,
      startupOrientation: 0,
      customFeatures: 0,
      grandTotal: 0,
    },
  };
}

export function getDefaultPAPDiscounts(): PAPDiscounts {
  return {
    excavation: 0,
    plumbing: 0,
    steel: 0,
    electrical: 0,
    shotcrete: 0,
    tileCopingLabor: 0,
    tileCopingMaterial: 0,
    equipment: 0,
    interiorFinish: 0,
    startup: 0,
    fiberglassShell: 0,
  };
}

export function getDefaultManualAdjustments(): ManualAdjustments {
  const defaults = (pricingData as any).manualAdjustments || {};
  return {
    positive1: defaults.positive1 ?? 0,
    positive2: defaults.positive2 ?? 0,
    negative1: defaults.negative1 ?? 0,
    negative2: defaults.negative2 ?? 0,
  };
}

export function getDefaultRetailAdjustments(): RetailAdjustment[] {
  return [
    { name: '', amount: 0 },
    { name: '', amount: 0 },
  ];
}

export function mergeRetailAdjustments(input?: RetailAdjustment[]): RetailAdjustment[] {
  const defaults = getDefaultRetailAdjustments();
  if (!Array.isArray(input)) return defaults;
  return defaults.map((base, index) => {
    const source = input[index];
    return {
      name: typeof source?.name === 'string' ? source.name : base.name,
      amount: Number.isFinite(Number((source as any)?.amount)) ? Number((source as any).amount) : base.amount,
    };
  });
}

export function getDefaultProposal(): Partial<Proposal> {
  return {
    proposalNumber: `PROP-${Date.now()}`,
    createdDate: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    status: 'draft',
    versionId: 'original',
    versionName: 'Original Version',
    activeVersionId: 'original',
    versions: [],
    isOriginalVersion: true,
    pricingEngineVersion: CURRENT_PRICING_ENGINE_VERSION,
    historicalPricingAdjustment: 0,
    pricingTierId: NORMAL_PRICING_TIER_ID,
    pricingTierName: getPricingTierName(NORMAL_PRICING_TIER_ID),
    customerInfo: {
      customerName: '',
      city: '',
      state: 'NC',
    },
    poolSpecs: getDefaultPoolSpecs(),
    excavation: getDefaultExcavation(),
    plumbing: getDefaultPlumbing(),
    electrical: getDefaultElectrical(),
    tileCopingDecking: getDefaultTileCopingDecking(),
    drainage: getDefaultDrainage(),
    equipment: getDefaultEquipment(),
    waterFeatures: getDefaultWaterFeatures(),
    customFeatures: getDefaultCustomFeatures(),
    masonry: getDefaultMasonry(),
    interiorFinish: getDefaultInteriorFinish(),
    manualAdjustments: getDefaultManualAdjustments(),
    retailAdjustments: getDefaultRetailAdjustments(),
    papDiscounts: normalizePapDiscounts(pricingData.papDiscountRates || getDefaultPAPDiscounts()),
    costBreakdown: getDefaultCostBreakdown(),
    subtotal: 0,
    taxRate: 0,
    taxAmount: 0,
    totalCost: 0,
    contractOverrides: {},
    contractTemplateRevision: CURRENT_CONTRACT_TEMPLATE_REVISION,
    warrantySections: null,
  };
}
