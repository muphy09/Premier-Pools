// ============================================================================
// PRICING DATA - Extracted from Excel Spreadsheet
// ============================================================================

import type { MasonryFacingOption } from '../utils/masonryFacing';

const defaultRbbFacingOptions: MasonryFacingOption[] = [
  { id: 'tile', name: 'Tile', materialCost: 0, laborCost: 0 },
  { id: 'panel-ledge', name: 'Panel Ledge', materialCost: 13, laborCost: 12.5 },
  { id: 'stacked-stone', name: 'Stacked Stone', materialCost: 27, laborCost: 16 },
];

const defaultRaisedSpaFacingOptions: MasonryFacingOption[] = [
  { id: 'tile', name: 'Tile', materialCost: 0, laborCost: 0 },
  { id: 'ledgestone', name: 'Ledgestone', materialCost: 13, laborCost: 12.5 },
  { id: 'stacked-stone', name: 'Stacked Stone', materialCost: 27, laborCost: 16 },
];

const defaultExcavationBasePricingRows = [
  { id: 'base-range-400', breakpointRange: '0-400 SQFT', max: 400, price: 2700, kind: 'range' },
  { id: 'base-range-450', breakpointRange: '401-450 SQFT', max: 450, price: 2700, kind: 'range' },
  { id: 'base-range-500', breakpointRange: '451-500 SQFT', max: 500, price: 2700, kind: 'range' },
  { id: 'base-range-550', breakpointRange: '501-550 SQFT', max: 550, price: 2700, kind: 'range' },
  { id: 'base-range-600', breakpointRange: '551-600 SQFT', max: 600, price: 2700, kind: 'range' },
  { id: 'base-range-650', breakpointRange: '601-650 SQFT', max: 650, price: 2700, kind: 'range' },
  { id: 'base-range-700', breakpointRange: '651-700 SQFT', max: 700, price: 2700, kind: 'range' },
  { id: 'base-range-750', breakpointRange: '701-750 SQFT', max: 750, price: 2700, kind: 'range' },
  { id: 'base-range-800', breakpointRange: '751-800 SQFT', max: 800, price: 2750, kind: 'range' },
  { id: 'base-range-850', breakpointRange: '801-850 SQFT', max: 850, price: 3000, kind: 'range' },
  { id: 'base-range-900', breakpointRange: '851-900 SQFT', max: 900, price: 3100, kind: 'range' },
  { id: 'base-range-950', breakpointRange: '901-950 SQFT', max: 950, price: 3150, kind: 'range' },
  { id: 'base-range-1000', breakpointRange: '951-1,000 SQFT', max: 1000, price: 3150, kind: 'range' },
  { id: 'base-range-over-1000', breakpointRange: 'Over 1,000 SQFT', price: 4900, kind: 'overage' },
];

const defaultExcavationRaisedBondBeamRows = [
  { id: 'rbb-6', rbbSize: '6" RBB', height: 6, price: 5 },
  { id: 'rbb-12', rbbSize: '12" RBB', height: 12, price: 6.5 },
  { id: 'rbb-18', rbbSize: '18" RBB', height: 18, price: 7.5 },
  { id: 'rbb-24', rbbSize: '24" RBB', height: 24, price: 8.5 },
  { id: 'rbb-30', rbbSize: '30" RBB', height: 30, price: 9 },
  { id: 'rbb-36', rbbSize: '36" RBB', height: 36, price: 10 },
];

const defaultExcavationExposedPoolWallRows = defaultExcavationRaisedBondBeamRows.map((row) => ({
  id: `exposed-pool-wall-${row.height}`,
  rbbSize: `${row.height}" Out of Ground`,
  height: row.height,
  price: row.price,
}));

const defaultExcavationBaseRanges = defaultExcavationBasePricingRows
  .filter((row) => row.kind === 'range')
  .map(({ max, price }) => ({ max, price }));

const defaultExcavationOver1000Sqft =
  defaultExcavationBasePricingRows.find((row) => row.kind === 'overage')?.price ?? 0;

const getDefaultExcavationRaisedBondBeamPrice = (height: number) =>
  defaultExcavationRaisedBondBeamRows.find((row) => row.height === height)?.price ?? 0;

const getDefaultExcavationExposedPoolWallPrice = (height: number) =>
  defaultExcavationExposedPoolWallRows.find((row) => row.height === height)?.price ?? 0;

const defaultFiberglassSmallModels = [
  { name: 'Caeser', shellPrice: 11325, freight: 950, crane: 550, install: 9000, gravel: 1900 },
  { name: 'Chateau & Gayla 12', shellPrice: 14825, freight: 950, crane: 550, install: 9000, gravel: 1900 },
  { name: 'Gayla 12/Freeport', shellPrice: 14375, freight: 950, crane: 550, install: 9000, gravel: 1900 },
  { name: 'Lotus 12/Bermuda', shellPrice: 15375, freight: 950, crane: 550, install: 9000, gravel: 1900 },
  { name: 'Santorini & Bliss 12', shellPrice: 12825, freight: 950, crane: 550, install: 9000, gravel: 1900 },
];

const defaultFiberglassMediumModels = [
  { name: 'Belvedere', shellPrice: 22801, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
  { name: 'Martinique Grand', shellPrice: 23825, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
  { name: 'Noveau 14', shellPrice: 23625, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
  { name: 'Lotus 14', shellPrice: 20650, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
  { name: 'Renaissance 14', shellPrice: 23625, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
  { name: 'Sovereign & Gayla 14', shellPrice: 21275, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
  { name: 'Belvedere/Olympia 14', shellPrice: 24100, freight: 1100, crane: 2000, install: 9000, gravel: 2650 },
];

const defaultFiberglassLargeModels = [
  { name: 'Aristocrat', shellPrice: 25075, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Lotus XL', shellPrice: 26100, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Elysium Grand', shellPrice: 25600, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Grand Palace', shellPrice: 30000, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Imperial', shellPrice: 21700, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Gayla 16', shellPrice: 24000, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Oasis 16', shellPrice: 23300, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Gayla XDL', shellPrice: 27725, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Versailles', shellPrice: 30500, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
  { name: 'Villa Reale', shellPrice: 29600, freight: 1200, crane: 2600, install: 9000, gravel: 3110 },
];

const defaultFiberglassSpaOptions = [
  { name: 'Meridian', price: 4794, crane: 150 },
  { name: 'Mystic', price: 4575, crane: 150 },
  { name: 'Regal', price: 5000, crane: 150 },
  { name: 'Royal', price: 5000, crane: 150 },
  { name: 'Shasta', price: 4150, crane: 150 },
];

const defaultFiberglassTanningLedgeOptions = [
  { name: 'Gemini', price: 2838 },
  { name: 'Genesis', price: 4262 },
  { name: 'Hermosa', price: 3514 },
  { name: 'Picasso', price: 3264 },
  { name: 'Rectangle', price: 5205 },
  { name: 'Semi-Circle', price: 4805 },
];

const defaultFiberglassFinishUpgrades = [
  { name: 'Crystite G2', price: 1000 },
  { name: 'Crystite G3', price: 1500 },
];

const pricingData = {
  // PAP (Preferred Approved Provider) Discount Rates
  // These are admin pricing-model settings. Keep code defaults neutral so
  // older or partial pricing models do not receive accidental discounts.
  papDiscountRates: {
    excavation: 0.00,
    plumbing: 0.00,
    steel: 0.00,
    electrical: 0.00,
    shotcrete: 0.00,
    tileCopingLabor: 0.00,
    tileCopingMaterial: 0.00,
    equipment: 0.00,
    interiorFinish: 0.00,
    startup: 0.00,
    fiberglassShell: 0.00,
  },
  // Manual retail adjustments (designer-facing)
  manualAdjustments: {
    positive1: 0,
    positive2: 0,
    negative1: 0,
    negative2: 0,
  },
  pricingDefaults: {
    targetMargin: 0.7, // Displayed as 70% in Admin Pricing; retail = COGS / targetMargin
  },
  // Proposal-builder toggle state used only when a new proposal is created.
  // Existing proposals retain the selections stored on the proposal itself.
  additionalFeatureDefaults: {
    siltFence: true,
    tanningShelf: false,
    automaticCover: false,
    gravelInstall: true,
    dirtHaul: true,
    soilSampleEngineer: false,
    doubleCurtain: false,
    additionalSitePrep: false,
    tightAccessJob: false,
    waterproofing: false,
  },
  plans: {
    poolOnly: 410,
    spa: 80,
    waterfall: 15,
    waterFeature: 10,
    soilSampleEngineer: 750,
  },
  excavation: {
    // Base pricing table from EXC sheet (surface area breakpoints)
    baseExcavationTable: defaultExcavationBasePricingRows.map((row) => ({ ...row })),
    baseRanges: defaultExcavationBaseRanges.map((row) => ({ ...row })),
    over1000Sqft: defaultExcavationOver1000Sqft,
    additional6InchDepth: 90,
    raisedBondBeamTable: defaultExcavationRaisedBondBeamRows.map((row) => ({ ...row })),
    exposedPoolWallFormingTable: defaultExcavationExposedPoolWallRows.map((row) => ({ ...row })),
    rbb6: getDefaultExcavationRaisedBondBeamPrice(6),
    rbb12: getDefaultExcavationRaisedBondBeamPrice(12),
    rbb18: getDefaultExcavationRaisedBondBeamPrice(18),
    rbb24: getDefaultExcavationRaisedBondBeamPrice(24),
    rbb30: getDefaultExcavationRaisedBondBeamPrice(30),
    rbb36: getDefaultExcavationRaisedBondBeamPrice(36),
    exposedPoolWall6: getDefaultExcavationExposedPoolWallPrice(6),
    exposedPoolWall12: getDefaultExcavationExposedPoolWallPrice(12),
    exposedPoolWall18: getDefaultExcavationExposedPoolWallPrice(18),
    exposedPoolWall24: getDefaultExcavationExposedPoolWallPrice(24),
    exposedPoolWall30: getDefaultExcavationExposedPoolWallPrice(30),
    exposedPoolWall36: getDefaultExcavationExposedPoolWallPrice(36),
    baseSpa: 200,
    raisedSpa: 350,
    sitePrep: 200,
    tightAccessJob: 6400,
    backfill: 600,
    gravelPerSqft: 2.75,
    dirtHaulPerYard: 18,
    coverBox: 450,
    travelPerMile: 7,
    misc: 75,
    poolBonding: {
      pricePerLnft: 2,
      markup: 0.1,
    },
  },
  plumbing: {
    shortStub: 550,
    spaBase: 750,
    fiberglassMultiplier: 0.4,
    poolOverrunPerFt: 25,
    poolOverrunThreshold: 33,
    spaOverrunPerFt: 22,
    spaOverrunThreshold: 30,
    gasOverrunPerFt: 11,
    gasOverrunThreshold: 25,
    heaterSet: 300,
    waterFeatureRun: {
      setup: 200,
      baseAllowanceFt: 30,
      perFt: 5.5,
    },
    additionalWaterFeatureRunPerFt: 5.5,
    spaPlumbing: 5,
    threeQuarterInchPipe: 3,
    onePointFiveInchPipe: 4.5,
    twoInchPipe: 5.5,
    twoPointFiveInchPipe: 7,
    threeInchPipe: 8.75,
    infloorPerFt: 10,
    conduitPerFt: 2.75,
    manifold: 175,
    stripForms: 700,
    stripFormsRbbAdditional: 2.5,
    exposedPoolWallStripFormsAdditional: 2.5,
    cleanerPerFt: 3.25,
    autoFillPerFt: 3.5,
    additionalSkimmer: 275,
    valveActuator: 0,
    addlMainDrainWhenAuxPump: 0,
    travelPerMile: 5,
  },
  waterFeatures: {
    // Pricing pulled from Regular pricing.xlsx, Equip tab (Name + Base + Adders)
    retailMargin: 0.7, // Normal 70% retail margin applied to COGS
    sheerDescents: [
      { id: 'sheer-12', name: '12" Sheer Descent', basePrice: 760, addCost1: 0, addCost2: 0, note: 'Cascading Water Feature' },
      { id: 'sheer-18', name: '18" Sheer Descent', basePrice: 780, addCost1: 0, addCost2: 0, note: 'Cascading Water Feature' },
      { id: 'sheer-2', name: "2' Sheer Descent", basePrice: 820, addCost1: 0, addCost2: 0, note: 'Cascading Water Feature' },
      { id: 'sheer-3', name: "3' Sheer Descent", basePrice: 880, addCost1: 0, addCost2: 0, note: 'Cascading Water Feature' },
      { id: 'sheer-4', name: "4' Sheer Descent", basePrice: 1000, addCost1: 0, addCost2: 0, note: 'Cascading Water Feature' },
      { id: 'sheer-5', name: "5' Sheer Descent (Requires 2nd Pump)", basePrice: 1120, addCost1: 0, addCost2: 0, note: 'Requires second pump' },
      { id: 'sheer-6', name: "6' Sheer Descent (Requires 2nd Pump)", basePrice: 1300, addCost1: 0, addCost2: 0, note: 'Requires second pump' },
    ],
    jets: [
      { id: 'deck-jet', name: 'Deck Jet', basePrice: 420, addCost1: 0, addCost2: 0 },
      { id: 'laminar-jet', name: 'Laminar Jet', basePrice: 1760, addCost1: 0, addCost2: 0 },
    ],
    woks: {
      waterOnly: [
        { id: 'wok-water-30', name: '30" Precast Wok - Water Only', basePrice: 1920, addCost1: 0, addCost2: 0 },
        { id: 'wok-water-32', name: '32" Precast Wok - Water Only', basePrice: 2060, addCost1: 0, addCost2: 0 },
        { id: 'wok-water-36', name: '36" Precast Wok - Water Only', basePrice: 2260, addCost1: 0, addCost2: 0, note: 'Add $500 for Copper' },
      ],
      fireOnly: [
        { id: 'wok-fire-30', name: '30" Precast Wok - Fire Only', basePrice: 1760, addCost1: 0, addCost2: 0, note: 'Match throw add $588, auto add $2134, add $500 for copper' },
        { id: 'wok-fire-36', name: '36" Precast Wok - Fire Only', basePrice: 2100, addCost1: 0, addCost2: 0, note: 'Match throw add $588, auto add $2134, add $500 for copper' },
      ],
      waterAndFire: [
        { id: 'wok-fire-water-30', name: '30" Precast Wok - Water & Fire', basePrice: 5060, addCost1: 0, addCost2: 0, note: 'Match throw add $588, auto add $2134, add $500 for copper' },
        { id: 'wok-fire-water-36', name: '36" Precast Wok - Water & Fire', basePrice: 6020, addCost1: 0, addCost2: 0, note: 'Match throw add $588, auto add $2134, add $500 for copper' },
      ],
    },
    bubblers: [
      { id: 'led-bubbler', name: 'LED Bubbler (with light)', basePrice: 1380, addCost1: 0, addCost2: 0, note: 'Includes bubbler and light; add matching light run + water feature run', needsPoolLight: false },
    ],
  },
  electrical: {
      baseElectrical: 1650, // Includes first 65ft of electric run
      overrunPerFt: 18, // Excel ELEC!B5
      overrunThreshold: 65,
      spaElectrical: 255, // Heater electrical cost (ELEC!Row7)
      heaterElectrical: 255, // alias for naming clarity/backward compatibility
      lightAdditionalPerLight: 100, // Each light beyond the first
      lightRunPerFt: 2.75,
      lightRunConduitMultiplier: 1.25,
      baseGas: 1500,
      gasPerFtOverThreshold: 11,
      heatPumpElectricalBase: 450,
      heatPumpElectrical: 450,
      heatPumpOverrunThreshold: 40,
      heatPumpPerFtOver: 6,
      saltSystem: 200,
      automation: 250,
      bonding: 300,
      outlet: 85,
      travelPerMile: 7,
      autoFillPerFt: 3,
    },
  steel: {
    poolBase: 25,
    spaBase: 450,
    fourBarBeam: 100,
    poolBonding: 500,
    raisedSpa: 150,
    stepsPerLnft: 8,
    tanningShelf: 275,
    depthOver8Ft: 80,
    rbb6PerLnft: 3,
    rbb12PerLnft: 4,
    rbb18PerLnft: 5,
    rbb24PerLnft: 6,
    rbb30PerLnft: 7,
    rbb36PerLnft: 7,
    doubleCurtainPerLnft: 35,
    spaDoubleCurtain: 75,
    muckOut: 100, // Unit price (Excel: $100 × 2 qty = $200)
    muckOutQty: 2,
    automaticCover: 0,
    travelPerMile: 7,
  },
  shotcrete: {
    labor: {
      poolBase: 90,
      minimumYards: 32,
      spa: 250,
      autoCover: 250,
      distance250to300: 500,
      distance300to350: 1000,
      travelPerMile: 7,
    },
    material: {
      perYard: 228,
      cleanOut: 125,
      envFuelPerYard: 25,
      autoCover: 0,
      misc: 125, // Fixed: Excel shows $125, not $150
      travelPerMile: 7,
      taxRate: 0.0725, // Legacy alias for misc.taxRate
    },
  },
  tileCoping: {
    materialTaxRate: 0.0725,
    tileMaterialTaxRate: 0.0725,
    flagstoneQuantityMultiplier: 1.1, // 10% overage for flagstone materials (Excel rows 192-197)
    rockworkMaterialWaste: {
      panelLedge: 1.15, // 15% material overage on panel ledge (matches TILE COPING sheet)
    },
    tile: {
      options: [
        { id: 'level1', name: 'Level 1', materialRate: 7, laborRate: 10 },
        { id: 'level2', name: 'Level 2', materialRate: 27, laborRate: 10 },
        { id: 'level3', name: 'Level 3', materialRate: 57, laborRate: 10 },
      ],
      stepTrimOptions: [
        { id: 'default-trim-tile', name: 'Default Trim Tile', materialRate: 4, laborRate: 10 },
      ],
      labor: {
        level1: 10,
        level2: 10,
        level3: 10,
        stepTrim: 10,
      },
      material: {
        level1: 7,
        level2Upgrade: 20,
        level3Upgrade: 50,
        stepTrim: 4,
      },
    },
    coping: {
      options: [
        { id: 'cantilever', name: 'Cantilever', materialRate: 0, laborRate: 0 },
        { id: 'flagstone', name: 'Flagstone', materialRate: 25, laborRate: 15 },
        { id: 'paver', name: 'Paver', materialRate: 9, laborRate: 12 },
        { id: 'travertine-level1', name: 'Travertine - Level 1', materialRate: 11, laborRate: 12 },
        { id: 'travertine-level2', name: 'Travertine - Level 2', materialRate: 12, laborRate: 12 },
        { id: 'concrete', name: 'Concrete', materialRate: 0, laborRate: 0 },
      ],
      cantilever: 0,
      flagstone: 15,
      pavers: 12,
      travertineLevel1: 12,
      travertineLevel2: 12,
      concrete: 0,
      bullnoseLabor: 8,
      doubleBullnoseLabor: 8,
      spillwayLabor: 150,
    },
    decking: {
      options: [
        { id: 'paver', name: 'Paver', materialRate: 7, laborRate: 8 },
        { id: 'travertine-level1', name: 'Travertine - Level 1', materialRate: 7.5, laborRate: 8 },
        { id: 'travertine-level2', name: 'Travertine - Level 2', materialRate: 9.75, laborRate: 8 },
        { id: 'travertine-level3', name: 'Travertine - Level 3', materialRate: 11.25, laborRate: 8 },
        { id: 'concrete', name: 'Concrete', materialRate: 7, laborRate: 16.5 },
      ],
      additionalOptions: [],
      labor: {
        pavers: 8,
        travertine: 8,
        concrete: 16.5,
        concreteSteps: 27,
      },
      material: {
        pavers: 7,
        travertineLevel1: 7.5,
        travertineLevel2: 9.75,
        travertineLevel3: 11.25,
        concrete: 7,
        concreteSteps: 7.5,
        flagstone: 25,
        coping: {
        paver: 9,
        travertineLevel1: 11,
        travertineLevel2: 12,
        travertinelevel1: 11,
        travertinelevel2: 12,
        concrete: 0,
      },
        rockwork: {
          panelLedge: 13,
          stackedStone: 27,
          tile: 0,
        },
        bullnose: 0,
        doubleBullnose: 0,
        spillway: 0,
      },
      rockworkLabor: {
        panelLedge: 12.5,
        stackedStone: 16,
        tile: 0,
      },
      bullnoseLabor: 8,
      doubleBullnoseLabor: 8,
      spillwayLabor: 150,
      spillwayMaterial: 150,
    },
    specialtyOptions: [
      { id: 'bullnose', name: 'Bullnose', materialRate: 0, laborRate: 8 },
      { id: 'spillway', name: 'Spillway', materialRate: 150, laborRate: 150 },
    ],
  },
  equipment: {
    pumpOverheadMultiplier: 1.1, // Legacy fallback when a pump entry has no overhead multiplier
    pumps: [
      { name: 'No Pump (Select pump)', basePrice: 0, addCost1: 0, addCost2: 0, overheadMultiplier: 1.1 },
    ],
    auxiliaryPumps: [
      { name: 'No Blower (Select blower)', basePrice: 0, addCost1: 0, addCost2: 0, overheadMultiplier: 1.1, defaultAuxiliaryPump: false },
    ],
    filters: [
      { name: 'No Filter (Select filter)', sqft: 0, basePrice: 0, addCost1: 0, addCost2: 0 },
    ],
    cleaners: [
      { name: 'No Cleaner', basePrice: 0, addCost1: 0, addCost2: 0, defaultCleaner: false },
    ],
    heaters: [
      { name: 'No Heater (Select heater)', btu: 0, basePrice: 0, addCost1: 0, addCost2: 0 },
    ],
    heaterChillers: [
      { name: 'No Heater Chiller (Select heater chiller)', btu: 0, basePrice: 0, addCost1: 0, addCost2: 0 },
    ],
    lights: {
      // Light catalogs must come from the active pricing model.
      // Do not fall back to legacy baked-in options here.
      poolLights: [] as Array<{
        name: string;
        basePrice?: number;
        addCost1?: number;
        addCost2?: number;
        defaultLightChoice?: boolean;
      }>,
      spaLights: [] as Array<{
        name: string;
        basePrice?: number;
        addCost1?: number;
        addCost2?: number;
        defaultLightChoice?: boolean;
      }>,
    },
    automation: [
      // Automation prices include the 6614 base panel and any required install adders (matches EQUIP sheet rows 61-69)
      { name: 'No Automation', basePrice: 0, addCost1: 0, addCost2: 0, addCost3: 0, includesSaltCell: false },
    ],
    automationZoneAddon: 365, // Per additional zone
    saltSystem: [
      { name: 'No Salt System', model: 'None', basePrice: 0, addCost1: 0, addCost2: 0, excludedFromSaltCell: false },
    ],
    autoFillSystem: [
      { name: 'No Auto-Fill System', basePrice: 0, addCost1: 0, addCost2: 0, requiresElectricRun: false },
    ],
    sanitationAccessories: [
      { name: 'No Sanitation Accessory', basePrice: 0, addCost1: 0, addCost2: 0 },
    ],
    blanketReel: 0,
    solarBlanket: 0,
    autoFill: 0,
    handrail: 0,
    startupChemicals: 0,
    checkValve: 48.04,
    baseWhiteGoods: 1046.1,
    taxRate: 0.0725, // Legacy alias for misc.taxRate
    packageOptions: [
      {
        id: 'custom',
        name: 'Custom',
        mode: 'custom',
        enabled: true,
        description: 'Choose each equipment line item individually for maximum flexibility.',
        basePrice: 0,
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
        includedWaterFeaturesBeforeExtraPump: 0,
        defaultPoolLightName: '',
        defaultPoolLightQuantity: 0,
        notes: 'Uses normal itemized equipment pricing plus the package check valve cost.',
      },
    ],
  },
  interiorFinish: {
    minimumChargeSqft: 850,
    finishes: [
      {
        id: 'ivory-quartz',
        name: 'Ivory Quartz',
        costPerSqft: 5.5,
        spaFinishCost: 850,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-tec-l1',
        name: 'Pebble Tec - Level 1',
        costPerSqft: 6.3,
        spaFinishCost: 1150,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-tec-l2',
        name: 'Pebble Tec - Level 2',
        costPerSqft: 7.9,
        spaFinishCost: 1150,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-tec-l3',
        name: 'Pebble Tec - Level 3',
        costPerSqft: 8.85,
        spaFinishCost: 1150,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-sheen-l1',
        name: 'Pebble Sheen - Level 1',
        costPerSqft: 6.75,
        spaFinishCost: 1250,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-sheen-l2',
        name: 'Pebble Sheen - Level 2',
        costPerSqft: 7.85,
        spaFinishCost: 1250,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-sheen-l3',
        name: 'Pebble Sheen - Level 3',
        costPerSqft: 9.25,
        spaFinishCost: 1250,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-fina-l1',
        name: 'Pebble Fina - Level 1',
        costPerSqft: 7.75,
        spaFinishCost: 1050,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-fina-l2',
        name: 'Pebble Fina - Level 2',
        costPerSqft: 10,
        spaFinishCost: 1675,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-brilliance',
        name: 'Pebble Brilliance',
        costPerSqft: 17,
        spaFinishCost: 1050,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-breeze',
        name: 'Pebble Breeze',
        costPerSqft: 23,
        spaFinishCost: 1150,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
      {
        id: 'pebble-essence',
        name: 'Pebble Essence',
        costPerSqft: 17.5,
        spaFinishCost: 1150,
        colors: ['Bordeaux', 'Desert Gold', 'French Grey', 'Irish Mist', 'White Diamonds', 'HighTech Carribean Blue'],
      },
    ],
    waterTruck: {
      base: 490,
      loadSizeGallons: 7000,
    },
    extras: {
      poolPrepBase: 750,
      poolPrepThreshold: 1200,
      poolPrepOverRate: 1,
      spaPrep: 100,
      misc: 100,
      travelPerMile: 10,
      stepDetailPerLnftOver20: 20,
      waterproofingPerSqft: 1.95, // Waterproofing rate per sqft (INT sheet)
      waterproofingRaisedSpa: 300,
    },
  },
  cleanup: {
    basePool: 700,
    spa: 100,
    perSqftOver500: 0.5,
    rbbPerSqft: 2.5,
    travelPerMile: 7,
    roughGrading: 700,
  },
  fiberglass: {
    poolModels: {
      small: defaultFiberglassSmallModels,
      medium: defaultFiberglassMediumModels,
      large: defaultFiberglassLargeModels,
    },
    spaOptions: defaultFiberglassSpaOptions,
    tanningLedgeOptions: defaultFiberglassTanningLedgeOptions,
    finishUpgrades: defaultFiberglassFinishUpgrades,
    spillover: 525,
    spaInstall: 2600,
    shellTaxRate: 0.0725, // Legacy alias for misc.taxRate
    equipmentPadCost: 250,
    small: 12192,
    medium: 15120,
    large: 18228,
    crystite: 16632,
    spaSmall: 8727,
    spaMedium: 10242,
    spaLarge: 13857,
    spilloverLegacy: 1000,
    crane: 2500,
    noCrane: 150, // FIBER!D66 (applies when fiberglass is not selected)
    freight: 900, // Per shell (Excel: SUM(FIBER!G62:G64))
    surcharge2022: 0, // 2022 surcharge per shell (Excel: FIBER!C65)
    discountRate: 0.10, // 10% discount on shell costs
    taxRate: 0.0725, // Legacy alias for misc.taxRate
    fiberglassInstall: {
      labor: 2500, // Installation labor
      gravel: 600, // Gravel for base
    },
    spaModels: defaultFiberglassSpaOptions,
    models: [
      { name: 'Caeser', size: 'small', price: 11325, perimeter: 48 },
      { name: 'Chateau & Gayla 12', size: 'small', price: 14825, perimeter: 70 },
      { name: 'Gayla 12/Freeport', size: 'small', price: 14375, perimeter: 64 },
      { name: 'Lotus 12/Bermuda', size: 'small', price: 15375, perimeter: 73 },
      { name: 'Santorini & Bliss 12', size: 'small', price: 12825, perimeter: 59 },
      { name: 'Belvedere', size: 'medium', price: 22801, perimeter: 84 },
      { name: 'Martinique Grand', size: 'medium', price: 23825, perimeter: 92 },
      { name: 'Noveau 14', size: 'medium', price: 23625, perimeter: 83 },
      { name: 'Lotus 14', size: 'medium', price: 20650, perimeter: 74 },
      { name: 'Renaissance 14', size: 'medium', price: 23625, perimeter: 81 },
      { name: 'Sovereign & Gayla 14', size: 'medium', price: 21275, perimeter: 90 },
      { name: 'Belvedere/Olympia 14', size: 'medium', price: 24100, perimeter: 85 },
      { name: 'Aristocrat', size: 'large', price: 25075, perimeter: 104 },
      { name: 'Lotus XL', size: 'large', price: 26100, perimeter: 101 },
      { name: 'Elysium Grand', size: 'large', price: 25600, perimeter: 114 },
      { name: 'Grand Palace', size: 'large', price: 30000, perimeter: 137 },
      { name: 'Imperial', size: 'large', price: 21700, perimeter: 94 },
      { name: 'Gayla 16', size: 'large', price: 24000, perimeter: 96 },
      { name: 'Oasis 16', size: 'large', price: 23300, perimeter: 87 },
      { name: 'Gayla XDL', size: 'large', price: 27725, perimeter: 83 },
      { name: 'Versailles', size: 'large', price: 30500, perimeter: 108 },
      { name: 'Villa Reale', size: 'large', price: 29600, perimeter: 107 },
    ],
    spas: [
      { name: 'Meridian', price: 4794 },
      { name: 'Mystic', price: 4575 },
      { name: 'Regal', price: 5000 },
      { name: 'Royal', price: 5000 },
    ],
  },
  misc: {
    taxRate: 0.0725,
    layout: {
      poolOnly: 50,
      spa: 15,
      siltFencing: 500,
    },
    permit: {
      poolOnly: 850,
      spa: 150,
      permitRunner: 75,
    },
    equipmentSet: {
      base: 750,
      additionalPump: 150,
      ozoneBase: 200,
      heater: 200,
    },
    drainage: {
      baseCost: 150, // includes first 10 ft
      includedFt: 10,
      perFtOver: 12.5,
    },
    waterTruck: {
      base: 490,
      loadSizeGallons: 7000,
    },
    contractPaymentSchedule: {
      gunite: {
        excavation: 0.3,
        shotcrete: 0.3,
        decking: 0.3,
        interiorFinish: 0.1,
      },
      fiberglass: {
        permitting: 0.3,
        shellDelivery: 0.3,
        equipmentSet: 0.3,
        decking: 0.1,
      },
    },
    startup: {
      base: 700,
      automationAdd: 300,
      fiveYearWarranty: 800,
      premium: 800,
      taxRate: 0.0725,
    },
  },
  customFeatures: {
    groupedSubcategories: [],
    groupedOptions: [],
  },
  masonry: {
    columnBase: 500,
    rbbFacingOptions: defaultRbbFacingOptions,
    backsideFacingOptions: [],
    raisedSpaFacingOptions: defaultRaisedSpaFacingOptions,
    labor: {
      rbbFacing: {
        tile: 0,
        panelLedge: 12.5,
        stackedStone: 16,
      },
      raisedSpaFacing: {
        tile: 0,
        ledgestone: 12.5,
        stackedStone: 16,
      },
      spillway: 150,
    },
    raisedSpaFacing: {
      tile: 350,
      ledgestone: 400,
      stackedStone: 450,
    },
    rbbFacing: {
      tile: 300,
      panelLedge: 350,
      stackedStone: 400,
    },
    material: {
      rbbFacing: {
        tile: 0,
        panelLedge: 13,
        stackedStone: 27,
      },
      raisedSpaFacing: {
        tile: 0,
        ledgestone: 13,
        stackedStone: 27,
      },
      spillway: 150,
    },
    raisedSpaWasteMultiplier: 1.125, // Waste factor applied to raised spa facing area
    raisedSpaMaterialWaste: 1.15, // Material overage for raised spa facing
    retainingWalls: [
      { name: 'No Retaining Wall', heightFt: 0, costPerSqft: 0 },
      { name: '12" High - Standard', heightFt: 2, costPerSqft: 50 },
      { name: '24" High - Standard', heightFt: 3, costPerSqft: 50 },
      { name: '36" High - Standard', heightFt: 4, costPerSqft: 50 },
      { name: '48" High - Standard', heightFt: 5, costPerSqft: 50 },
      { name: '12" High - CMU - Veneer Facing - 1-Side', heightFt: 2, costPerSqft: 65 },
      { name: '24" High - CMU - Veneer Facing - 1-Side', heightFt: 3, costPerSqft: 65 },
      { name: '36" High - CMU - Veneer Facing - 1-Side', heightFt: 4, costPerSqft: 65 },
      { name: '48" High - CMU - Veneer Facing - 1-Side', heightFt: 5, costPerSqft: 65 },
      { name: '12" High - CMU - Veneer Facing - 2-Sides', heightFt: 2, costPerSqft: 75 },
      { name: '24" High - CMU - Veneer Facing - 2-Sides', heightFt: 3, costPerSqft: 75 },
      { name: '36" High - CMU - Veneer Facing - 2-Sides', heightFt: 4, costPerSqft: 75 },
      { name: '48" High - CMU - Veneer Facing - 2-Sides', heightFt: 5, costPerSqft: 75 },
    ],
  },
};

export default pricingData;
