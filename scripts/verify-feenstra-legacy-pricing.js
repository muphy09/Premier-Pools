const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildSync } = require('esbuild');

const root = path.resolve(__dirname, '..');
const testSource = `
  import assert from 'node:assert/strict';
  import fs from 'node:fs';
  import { getDefaultProposal } from './src/utils/proposalDefaults';
  import { createVersionFromProposal, listAllVersions } from './src/utils/proposalVersions';
  import MasterPricingEngine from './src/services/masterPricingEngine';
  import pricingData from './src/services/pricingData';
  import feenstraMay2026Pricing from './src/services/legacy/feenstraMay2026Pricing.generated.json';
  import { normalizeCostBreakdownForDisplay } from './src/utils/costBreakdownDisplay';
  import { calculateFeenstraMay2026Proposal } from './src/services/legacy/feenstraMay2026Engine.generated.js';
  import { resolveFeenstraMay2026CustomerBreakdown } from './src/services/legacy/feenstraMay2026CustomerBreakdown';
  import { resolveFeenstraMay2026ContractCashPrice } from './src/services/legacy/feenstraMay2026Contract';
  import {
    getContractDepositFieldAutoValue,
    getContractTotalCashPrice,
    getDefaultContractDepositValue,
  } from './src/services/contractGenerator';
  import {
    FEENSTRA_FRANCHISE_ID,
    FEENSTRA_MAY_2026_COMPATIBILITY_REVISION,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE,
    FEENSTRA_PRICING_MODEL_ID,
    FEENSTRA_PRICING_MODEL_REVISION_ID,
    FEENSTRA_PROPOSAL_NUMBER,
    shouldUseFeenstraMay2026Pricing,
  } from './src/services/legacy/feenstraMay2026Profile';

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const base = getDefaultProposal();
  const legacyProposal = {
    ...clone(base),
    proposalNumber: FEENSTRA_PROPOSAL_NUMBER,
    franchiseId: FEENSTRA_FRANCHISE_ID,
    pricingModelId: FEENSTRA_PRICING_MODEL_ID,
    pricingModelRevisionId: FEENSTRA_PRICING_MODEL_REVISION_ID,
    calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
    poolSpecs: {
      ...clone(base.poolSpecs),
      poolType: 'gunite',
      poolShape: 'geometric',
      maxLength: 30,
      maxWidth: 15,
      surfaceArea: 450,
      perimeter: 90,
      shallowDepth: 3.5,
      endDepth: 6,
    },
  };

  assert.equal(shouldUseFeenstraMay2026Pricing(legacyProposal), true);
  assert.equal(
    shouldUseFeenstraMay2026Pricing({
      ...legacyProposal,
      proposalNumber: 'PROP-NOT-FEENSTRA',
    }),
    false
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        pricingModelRevisionId: 'wrong-revision',
    }),
    /locked to the May 11 pricing model/
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        franchiseId: 'wrong-franchise',
      }),
    /locked to the May 11 pricing model/
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        pricingModelId: 'wrong-model',
      }),
    /locked to the May 11 pricing model/
  );
  assert.throws(
    () =>
      shouldUseFeenstraMay2026Pricing({
        ...legacyProposal,
        pricingTierId: 'bronze',
      }),
    /locked to the May 11 pricing model/
  );

  const pricingBefore = clone(pricingData);
  const dispatched = MasterPricingEngine.calculateCompleteProposal(
    legacyProposal,
    legacyProposal.papDiscounts
  );
  const directLegacy = calculateFeenstraMay2026Proposal(
    legacyProposal,
    legacyProposal.papDiscounts,
    feenstraMay2026Pricing
  );
  assert.deepEqual(dispatched, directLegacy);
  assert.deepEqual(pricingData, pricingBefore);
  assert.equal(dispatched.totalCost, 61160);
  assert.equal(dispatched.pricing.totalCOGS, 42811.806775);
  assert.equal(dispatched.subtotal, 42387.9275);

  pricingData.shotcrete.material.taxRate = 0.0825;
  pricingData.tileCoping.tileMaterialTaxRate = 0.0825;
  pricingData.equipment.taxRate = 0.0825;
  pricingData.misc.startup.fiveYearWarranty = 800;
  assert.deepEqual(
    MasterPricingEngine.calculateCompleteProposal(
      legacyProposal,
      legacyProposal.papDiscounts
    ),
    dispatched
  );
  Object.keys(pricingData).forEach((key) => delete pricingData[key]);
  Object.assign(pricingData, clone(pricingBefore));

  const ordinary = {
    ...clone(legacyProposal),
    proposalNumber: 'PROP-ORDINARY',
    calculationProfile: undefined,
  };
  const ordinaryWithCopiedProfile = {
    ...ordinary,
    calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
  };
  const ordinaryCalculation = MasterPricingEngine.calculateCompleteProposal(
    ordinary,
    ordinary.papDiscounts
  );
  assert.equal(dispatched.taxRate, 0);
  assert.equal(ordinaryCalculation.taxRate, 0.0725);
  assert.deepEqual(
    ordinaryCalculation,
    MasterPricingEngine.calculateCompleteProposal(
      ordinaryWithCopiedProfile,
      ordinaryWithCopiedProfile.papDiscounts
    )
  );

  const copied = createVersionFromProposal(
    legacyProposal,
    { mode: 'copy', sourceVersionId: legacyProposal.versionId },
    'Legacy copy'
  );
  assert.equal(
    copied.newVersion.calculationProfile,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE
  );

  const scratch = createVersionFromProposal(
    legacyProposal,
    { mode: 'scratch' },
    'Legacy scratch'
  );
  assert.equal(
    scratch.newVersion.calculationProfile,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE
  );
  assert.equal(scratch.newVersion.pricingModelId, FEENSTRA_PRICING_MODEL_ID);
  assert.equal(
    scratch.newVersion.pricingModelRevisionId,
    FEENSTRA_PRICING_MODEL_REVISION_ID
  );
  assert.equal(scratch.newVersion.pricingTierId, 'normal');
  assert.equal(shouldUseFeenstraMay2026Pricing(scratch.newVersion), true);
  assert.equal(
    listAllVersions(scratch.container).find(
      (version) => version.versionId === scratch.newVersion.versionId
    )?.calculationProfile,
    FEENSTRA_MAY_2026_CALCULATION_PROFILE
  );
  assert.equal(scratch.newVersion.versionCreationMode, 'copy');
  assert.equal(scratch.newVersion.versionSourceId, legacyProposal.versionId);
  assert.equal(
    scratch.newVersion.compatibilityRevision,
    FEENSTRA_MAY_2026_COMPATIBILITY_REVISION
  );
  assert.equal(scratch.newVersion.versionLocked, false);
  assert.deepEqual(scratch.newVersion.poolSpecs, legacyProposal.poolSpecs);

  const expectedCustomerTotals = {
    'Plans & Engineering': 606,
    Layout: 793.57,
    Permit: 1334.64,
    Excavation: 10304.4,
    Plumbing: 8921.53,
    Gas: 2164.29,
    Steel: 4104.93,
    Electrical: 3441.22,
    'Shotcrete Labor': 4155.43,
    'Shotcrete Material': 12915.16,
    'Tile Labor': 1183.14,
    'Tile Material': 890.32,
    'Coping Labor': 1575.6,
    'Coping Material': 2060.19,
    'Stone/Rockwork': 0,
    Drainage: 1118.22,
    'Equipment Ordered': 6776.97,
    'Equipment Set': 1082.14,
    'Water Features': 434.5,
    Cleanup: 2209.38,
    'Interior Finish': 9688.8,
    'Water Truck': 2121,
    'Fiberglass Shell': 0,
    'Fiberglass Install': 0,
    'Startup/Orientation': 2018.57,
    'Custom Features': 0,
  };
  const customerRowKeys = [
    ['Plans & Engineering', 'plansAndEngineering'],
    ['Layout', 'layout'],
    ['Permit', 'permit'],
    ['Excavation', 'excavation'],
    ['Plumbing', 'plumbing'],
    ['Gas', 'gas'],
    ['Steel', 'steel'],
    ['Electrical', 'electrical'],
    ['Shotcrete Labor', 'shotcreteLabor'],
    ['Shotcrete Material', 'shotcreteMaterial'],
    ['Tile Labor', 'tileLabor'],
    ['Tile Material', 'tileMaterial'],
    ['Coping Labor', 'copingDeckingLabor'],
    ['Coping Material', 'copingDeckingMaterial'],
    ['Stone/Rockwork', 'stoneRockwork'],
    ['Drainage', 'drainage'],
    ['Equipment Ordered', 'equipmentOrdered'],
    ['Equipment Set', 'equipmentSet'],
    ['Water Features', 'waterFeatures'],
    ['Cleanup', 'cleanup'],
    ['Interior Finish', 'interiorFinish'],
    ['Water Truck', 'waterTruck'],
    ['Fiberglass Shell', 'fiberglassShell'],
    ['Fiberglass Install', 'fiberglassInstall'],
    ['Startup/Orientation', 'startupOrientation'],
    ['Custom Features', 'customFeatures'],
  ];
  const assertSignedCustomerBreakdown = (proposal, pricing, totals) => {
    const rows = customerRowKeys.map(([label, key]) => ({
      label,
      cost:
        key === 'stoneRockwork'
          ? (totals.stoneRockworkLabor || 0) + (totals.stoneRockworkMaterial || 0)
          : totals[key] || 0,
    }));
    const adjustmentTotal = (proposal.retailAdjustments || []).reduce(
      (total, adjustment) => total + (Number(adjustment.amount) || 0),
      0
    );
    const resolved = resolveFeenstraMay2026CustomerBreakdown(
      proposal,
      pricing,
      rows,
      adjustmentTotal
    );
    assert.ok(resolved);
    rows.forEach((row, index) => {
      assert.equal(
        resolved.categoryValues[index],
        expectedCustomerTotals[row.label],
        row.label
      );
    });
    assert.equal(resolved.offContractTotal, 22358);
    assert.equal(resolved.retailPrice, 96258);
    const categoryTotal = Math.round(
      resolved.categoryValues.reduce((total, value) => total + value, 0) * 100
    ) / 100;
    assert.equal(categoryTotal, 79900);
    assert.equal(
      categoryTotal +
        resolved.offContractTotal +
        adjustmentTotal,
      resolved.retailPrice
    );
  };
  const signedCustomerProposal = {
    ...legacyProposal,
    totalCost: 96258,
    retailAdjustments: [
      { name: 'Off contract items include contracted work', amount: 0 },
      { name: 'Line Item 2', amount: -6000 },
    ],
  };
  assertSignedCustomerBreakdown(
    signedCustomerProposal,
    {
      ...dispatched.pricing,
      offContractTotal: 20744.2375,
      retailPrice: 96258,
    },
    {
      plansAndEngineering: 420,
      layout: 550,
      permit: 925,
      excavation: 7491.1,
      plumbing: 6218.73,
      gas: 1500,
      steel: 3795,
      electrical: 2385,
      shotcreteLabor: 3150,
      shotcreteMaterial: 9765.11,
      tileLabor: 880,
      tileMaterial: 662.2,
      copingDeckingLabor: 1164,
      copingDeckingMaterial: 1522,
      stoneRockworkLabor: 0,
      stoneRockworkMaterial: 0,
      drainage: 775,
      equipmentOrdered: 4696.9,
      equipmentSet: 750,
      waterFeatures: 301.14,
      cleanup: 1535,
      interiorFinish: 6808,
      waterTruck: 1470,
      fiberglassShell: 0,
      fiberglassInstall: 0,
      startupOrientation: 1399,
      customFeatures: -1400,
    }
  );
  const customerDeltaRows = customerRowKeys.map(([label, key]) => ({
    label,
    cost:
      key === 'plansAndEngineering'
        ? 520
        : key === 'stoneRockwork'
        ? 0
        : ({
            layout: 550,
            permit: 925,
            excavation: 7491.1,
            plumbing: 6218.73,
            gas: 1500,
            steel: 3795,
            electrical: 2385,
            shotcreteLabor: 3150,
            shotcreteMaterial: 9765.11,
            tileLabor: 880,
            tileMaterial: 662.2,
            copingDeckingLabor: 1164,
            copingDeckingMaterial: 1522,
            drainage: 775,
            equipmentOrdered: 4696.9,
            equipmentSet: 750,
            waterFeatures: 301.14,
            cleanup: 1535,
            interiorFinish: 6808,
            waterTruck: 1470,
            fiberglassShell: 0,
            fiberglassInstall: 0,
            startupOrientation: 1399,
            customFeatures: -1400,
          })[key] || 0,
  }));
  const customerDelta = resolveFeenstraMay2026CustomerBreakdown(
    signedCustomerProposal,
    {
      ...dispatched.pricing,
      offContractTotal: 20744.2375,
      retailPrice: 96402.29,
    },
    customerDeltaRows,
    -6000
  );
  assert.ok(customerDelta);
  assert.equal(customerDelta.categoryValues[0], 750.29);
  assert.equal(customerDelta.categoryValues[1], 793.57);
  assert.equal(customerDelta.offContractTotal, 22358);
  assert.equal(customerDelta.retailPrice, 96402.29);

  const customerWithDiscardedResidual = resolveFeenstraMay2026CustomerBreakdown(
    signedCustomerProposal,
    {
      ...dispatched.pricing,
      offContractTotal: 20744.2375,
      retailPrice: 96544,
    },
    customerDeltaRows.map((row) =>
      row.label === 'Plans & Engineering' ? { ...row, cost: 420 } : row
    ),
    -6000
  );
  assert.ok(customerWithDiscardedResidual);
  assert.equal(customerWithDiscardedResidual.categoryValues[0], 606);
  assert.equal(customerWithDiscardedResidual.categoryValues[16], 6776.97);
  assert.equal(customerWithDiscardedResidual.categoryValues[24], 2018.57);
  assert.equal(customerWithDiscardedResidual.offContractTotal, 22358);
  assert.equal(customerWithDiscardedResidual.retailPrice, 96544);
  assert.equal(
    Math.round(
      (customerWithDiscardedResidual.categoryValues.reduce(
        (total, value) => total + value,
        0
      ) +
        customerWithDiscardedResidual.offContractTotal -
        6000) *
        100
    ) / 100,
    96258
  );

  const correctedFeenstraContractProposal = {
    ...signedCustomerProposal,
    totalCost: 96544,
    manualAdjustments: {
      ...signedCustomerProposal.manualAdjustments,
      negative1: 730.2375,
    },
    pricing: {
      ...dispatched.pricing,
      retailPrice: 96544,
      offContractTotal: 20744.2375,
    },
  };
  const feenstraContractCashPrice = resolveFeenstraMay2026ContractCashPrice(
    correctedFeenstraContractProposal
  );
  assert.equal(feenstraContractCashPrice, 75800);
  assert.equal(getContractTotalCashPrice(correctedFeenstraContractProposal), 75800);
  assert.equal(
    getDefaultContractDepositValue(correctedFeenstraContractProposal),
    '$7,580.00'
  );
  assert.equal(
    getContractDepositFieldAutoValue(
      'p1_pay_excavation',
      '$7,580.00',
      feenstraContractCashPrice
    ),
    '$20,466.00'
  );
  assert.equal(
    getContractDepositFieldAutoValue(
      'p1_pay_interior_finish',
      '$7,580.00',
      feenstraContractCashPrice
    ),
    '$6,822.00'
  );
  assert.equal(
    resolveFeenstraMay2026ContractCashPrice({
      ...correctedFeenstraContractProposal,
      totalCost: 96258,
      manualAdjustments: {
        ...correctedFeenstraContractProposal.manualAdjustments,
        negative1: 1016.2375,
      },
      pricing: {
        ...correctedFeenstraContractProposal.pricing,
        retailPrice: 96258,
      },
    }),
    75800
  );
  const laterEditableFeenstraCopy = {
    ...correctedFeenstraContractProposal,
    totalCost: 97495,
    pricing: {
      ...correctedFeenstraContractProposal.pricing,
      totalCOGS: 57684.30975475001,
      retailPrice: 97495,
      offContractTotal: 23215.2375,
    },
  };
  assert.equal(
    resolveFeenstraMay2026ContractCashPrice(laterEditableFeenstraCopy),
    75800,
    'Later editable-copy pricing must not reprice the signed Feenstra contract.'
  );
  assert.equal(getContractTotalCashPrice(laterEditableFeenstraCopy), 75800);
  assert.equal(getDefaultContractDepositValue(laterEditableFeenstraCopy), '$7,580.00');
  assert.equal(
    resolveFeenstraMay2026ContractCashPrice({
      ...correctedFeenstraContractProposal,
      proposalNumber: 'PROP-ORDINARY-CONTRACT',
      calculationProfile: undefined,
    }),
    null
  );
  const feenstraContractDeposit = 7580;
  const feenstraContractBalance = feenstraContractCashPrice - feenstraContractDeposit;
  assert.equal(feenstraContractDeposit, 7580);
  assert.equal(feenstraContractBalance * 0.3, 20466);
  assert.equal(feenstraContractBalance * 0.1, 6822);

  const productionSnapshotPath = process.env.FEENSTRA_PRODUCTION_SNAPSHOT;
  if (productionSnapshotPath && fs.existsSync(productionSnapshotPath)) {
    const rows = JSON.parse(
      fs.readFileSync(productionSnapshotPath, 'utf8').replace(/^\\uFEFF/, '')
    );
    assert.equal(rows.length, 1);
    const snapshot = rows[0].snapshot;
    const current = snapshot.proposal.proposal_json;
    const currentVersions = [current, ...(current.versions || [])];
    const protectedBaseline = currentVersions.find(
      (version) =>
        version.versionId === 'original' &&
        version.calculationProfile === FEENSTRA_MAY_2026_CALCULATION_PROFILE
    );
    let may11Baseline;

    if (protectedBaseline) {
      may11Baseline = clone(protectedBaseline);
      assert.equal(may11Baseline.versionId, 'original');
      assert.equal(may11Baseline.versionName, 'May 11 Contract Baseline');
      assert.equal(
        may11Baseline.compatibilityRevision,
        FEENSTRA_MAY_2026_COMPATIBILITY_REVISION
      );
      assert.equal(may11Baseline.manualAdjustments.negative1, 1016.2375);
      assert.equal(may11Baseline.pricing.offContractTotal, 20744.2375);
      assert.equal(
        may11Baseline.customFeatures.features.some((feature) =>
          String(feature.name || '').toLowerCase().includes('removing existing pavers')
        ),
        false
      );
    } else {
      const versionTwo = current.versions.find(
        (version) => version.versionId === 'version-7efhqtl'
      );
      const original = current.versions.find(
        (version) => version.versionId === 'original'
      );
      assert.ok(versionTwo);
      assert.ok(original);

      const featureByName = new Map();
      [
        ...(original.customFeatures?.features || []),
        ...(versionTwo.customFeatures?.features || []),
      ].forEach((feature) => {
        const key = String(feature.name || '').trim().toLowerCase();
        if (key && !featureByName.has(key)) {
          featureByName.set(key, clone(feature));
        }
      });
      const featureList = Array.from(featureByName.values()).filter(
        (feature) =>
          ![
            'removing existing pavers',
            'removal of 10 x 10 cement patio and haul away',
          ].includes(String(feature.name || '').trim().toLowerCase())
      );

      may11Baseline = {
        ...clone(original),
        proposalNumber: FEENSTRA_PROPOSAL_NUMBER,
        franchiseId: FEENSTRA_FRANCHISE_ID,
        versionId: 'original',
        versionName: 'May 11 Contract Baseline',
        activeVersionId: 'original',
        isOriginalVersion: true,
        versions: [],
        calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
        compatibilityRevision: FEENSTRA_MAY_2026_COMPATIBILITY_REVISION,
        pricingModelId: FEENSTRA_PRICING_MODEL_ID,
        pricingModelRevisionId: FEENSTRA_PRICING_MODEL_REVISION_ID,
        pricingTierId: 'normal',
        manualAdjustments: {
          ...clone(original.manualAdjustments),
          negative1: 1016.2375,
        },
        retailAdjustments: clone(versionTwo.retailAdjustments),
        customFeatures: {
          ...clone(original.customFeatures),
          features: featureList,
          totalCost: featureList.reduce(
            (total, feature) => total + (Number(feature.totalCost) || 0),
            0
          ),
        },
        electrical: clone(versionTwo.electrical),
        equipment: clone(versionTwo.equipment),
        plumbing: {
          ...clone(original.plumbing),
          runs: {
            ...clone(original.plumbing.runs),
            gasRun: versionTwo.plumbing.runs.gasRun,
          },
        },
      };
    }

    const may11Result = calculateFeenstraMay2026Proposal(
      may11Baseline,
      may11Baseline.papDiscounts,
      feenstraMay2026Pricing
    );
    const display = normalizeCostBreakdownForDisplay(
      may11Result.costBreakdown,
      may11Baseline
    );
    const rounded = (value) => Math.round(Number(value) * 100) / 100;
    const expectedDisplayTotals = {
      plansAndEngineering: 420,
      layout: 550,
      permit: 925,
      excavation: 7491.1,
      plumbing: 6218.73,
      gas: 1500,
      steel: 3795,
      electrical: 2385,
      shotcreteLabor: 3150,
      shotcreteMaterial: 9765.11,
      tileLabor: 880,
      tileMaterial: 662.2,
      copingDeckingLabor: 1164,
      copingDeckingMaterial: 1522,
      drainage: 775,
      equipmentOrdered: 4696.9,
      equipmentSet: 750,
      waterFeatures: 301.14,
      cleanup: 1535,
      interiorFinish: 6808,
      waterTruck: 1470,
      startupOrientation: 1399,
      customFeatures: -1400,
      grandTotal: 56763.18,
    };
    Object.entries(expectedDisplayTotals).forEach(([key, expected]) => {
      assert.equal(rounded(display.totals[key]), expected, key);
    });
    assert.equal(rounded(may11Result.totalCost), 96258);
    assert.equal(rounded(may11Result.pricing.totalCOGS), 58744.81);
    assert.equal(rounded(may11Result.pricing.offContractTotal), 20744.24);
    assertSignedCustomerBreakdown(
      may11Baseline,
      may11Result.pricing,
      display.totals
    );
    console.log('Feenstra production baseline matched the May COGS and customer sheets.');
  }

  console.log(
    JSON.stringify({
      legacyRetail: dispatched.totalCost,
      legacyCogs: dispatched.pricing.totalCOGS,
      legacySubtotal: dispatched.subtotal,
    })
  );
`;

const result = buildSync({
  stdin: {
    contents: testSource,
    loader: 'ts',
    resolveDir: root,
    sourcefile: 'feenstra-legacy-pricing.verification.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: {
    'import.meta.url': JSON.stringify(
      pathToFileURL(path.join(root, 'src/services/contractTemplates.ts')).href
    ),
  },
  write: false,
  logLevel: 'silent',
});

const output = result.outputFiles?.[0]?.text;
assert.ok(output, 'The Feenstra legacy pricing verification bundle was not generated.');

const testModule = { exports: {} };
const execute = new Function('require', 'module', 'exports', '__filename', '__dirname', output);
execute(require, testModule, testModule.exports, __filename, __dirname);

console.log('Feenstra legacy pricing verification passed.');
