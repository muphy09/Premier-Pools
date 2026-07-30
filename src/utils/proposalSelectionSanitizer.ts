import pricingData from '../services/pricingData';
import { getVersionRecordStatus } from '../services/proposalWorkflow';
import { HeaterSelection, Proposal, PumpSelection, WaterFeatureSelection } from '../types/proposal-new';
import { getDefaultPoolSpecs, mergePlumbingRuns } from './proposalDefaults';
import { flattenWaterFeatures } from './waterFeatureCost';
import { getAdditionalPumpSelections, normalizePumpSelectionState } from './pumpSelections';
import { normalizeEquipmentLighting } from './lighting';
import { getEquipmentItemCost } from './equipmentCost';
import { isPpasEastProposal } from './franchiseScope';

const SPA_CONTRACT_FIELD_IDS = ['p2_52'];
const SPA_LIGHT_CONTRACT_FIELD_IDS = ['p2_53', 'p2_54'];
const BLOWER_CONTRACT_FIELD_IDS = ['p2_58'];
const RAISED_SPA_CONTRACT_FIELD_IDS = ['p2_67', 'p2_69'];
const FIBERGLASS_TILE_CONTRACT_FIELD_IDS = ['p1_31', 'p1_32'];
const ADDITIONAL_PUMP_CONTRACT_FIELD_IDS = ['p1_21', 'p1_22'];
const SANITATION_CONTRACT_FIELD_IDS = ['p1_23', 'p1_24', 'p1_25'];
const CLEANER_CONTRACT_FIELD_IDS = ['p1_26'];
const HEATER_CONTRACT_FIELD_IDS = ['p1_27', 'p1_28', 'p1_29'];
const POOL_LIGHT_CONTRACT_FIELD_IDS = ['p2_60', 'p2_61', 'p2_63', 'p2_64'];
const AUTOMATION_CONTRACT_FIELD_IDS = ['p2_66'];
const WATER_FEATURE_CONTRACT_FIELD_IDS = [
  'p2_68',
  'p2_70',
  'p2_71',
  'p2_72',
  'p2_73',
  'p2_74',
  'p2_75',
  'p2_76',
  'p2_77',
  'p2_78',
  'p2_79',
  'p2_80',
  'p2_81',
  'p2_82',
  'p2_83',
  'p2_84',
  'p2_85',
  'p2_86',
  'p2_87',
  'p2_88',
  'p2_89',
];

const WATER_FEATURE_CATEGORY_BY_ID = new Map(
  flattenWaterFeatures(pricingData.waterFeatures).map((item) => [item.id, item.category])
);

const normalizePumpName = (name?: string | null) => String(name || '').trim().toLowerCase();

const isPlaceholderPumpName = (name?: string | null) => {
  const normalized = normalizePumpName(name);
  return (
    !normalized ||
    normalized.includes('no pump') ||
    normalized.includes('no aux') ||
    normalized.includes('no auxiliary') ||
    normalized.includes('no blower')
  );
};

const isPlaceholderNamedSelection = (name?: string | null) => {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'none' || normalized.startsWith('no ');
};

const isPlaceholderHeaterName = (name?: string | null) => {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'none' || normalized.includes('no heater');
};

const clonePump = (pump?: PumpSelection | null): PumpSelection | null => {
  if (!pump) return null;
  return {
    ...pump,
  };
};

const buildHeaterSelection = (
  heater: Partial<HeaterSelection> | null | undefined,
  autoAddedForSpa: boolean
): HeaterSelection | null => {
  if (!heater || isPlaceholderHeaterName(heater.name)) return null;
  return {
    name: heater.name || '',
    btu: (heater as any)?.btu,
    basePrice: (heater as any)?.basePrice,
    addCost1: (heater as any)?.addCost1,
    addCost2: (heater as any)?.addCost2,
    price: getEquipmentItemCost(heater as any, 1),
    autoAddedForSpa,
    autoAddedReason: autoAddedForSpa ? 'spa' : undefined,
  };
};

const getFirstSelectableHeater = () =>
  pricingData.equipment.heaters.find((heater) => !isPlaceholderHeaterName(heater.name));

const getNoHeaterSelection = (): HeaterSelection => {
  const noHeater =
    pricingData.equipment.heaters.find((heater) => isPlaceholderHeaterName(heater.name)) ||
    pricingData.equipment.heaters[0];

  return {
    name: noHeater?.name || 'No Heater',
    btu: (noHeater as any)?.btu ?? 0,
    basePrice: (noHeater as any)?.basePrice ?? 0,
    addCost1: (noHeater as any)?.addCost1 ?? 0,
    addCost2: (noHeater as any)?.addCost2 ?? 0,
    price: getEquipmentItemCost(noHeater as any, 1),
  };
};

const hasRequiredHeaterSelection = (equipment?: Proposal['equipment'] | null) =>
  Boolean(
    equipment?.heater?.name &&
      !isPlaceholderHeaterName(equipment.heater.name) &&
      Number(equipment.heaterQuantity || 0) > 0
  );

const isSpaAutoAddedHeater = (heater?: HeaterSelection | null) =>
  Boolean(heater?.autoAddedForSpa || heater?.autoAddedReason === 'spa');

const syncSpaHeaterSelection = (equipment: Proposal['equipment'], hasSpa: boolean): Proposal['equipment'] => {
  if (hasSpa) {
    if (hasRequiredHeaterSelection(equipment)) {
      return equipment;
    }

    const defaultHeater = getFirstSelectableHeater();
    const heaterSelection = buildHeaterSelection(defaultHeater, true);
    if (!heaterSelection) {
      return equipment;
    }

    return {
      ...equipment,
      heater: heaterSelection,
      heaterQuantity: 1,
    };
  }

  if (!isSpaAutoAddedHeater(equipment.heater)) {
    return equipment;
  }

  return {
    ...equipment,
    heater: getNoHeaterSelection(),
    heaterQuantity: 0,
  };
};

const clearOverrideFields = (
  overrides: Record<string, string | number | null> | undefined,
  fieldIds: string[]
) => {
  if (!overrides) return overrides;
  let changed = false;
  const nextOverrides = { ...overrides };
  fieldIds.forEach((fieldId) => {
    if (!Object.prototype.hasOwnProperty.call(nextOverrides, fieldId)) return;
    delete nextOverrides[fieldId];
    changed = true;
  });
  return changed ? nextOverrides : overrides;
};

const groupLightsByName = (lights: Array<{ name?: string | null }> | undefined) => {
  const counts = new Map<string, number>();
  (lights || []).forEach((light) => {
    const name = String(light?.name || '').trim();
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
};

const getWaterFeatureCategory = (selection: WaterFeatureSelection) => {
  if (WATER_FEATURE_CATEGORY_BY_ID.has(selection.featureId)) {
    return String(WATER_FEATURE_CATEGORY_BY_ID.get(selection.featureId) || '');
  }
  return String(selection.featureId || '');
};

const getWaterFeatureSelectionsByCategory = (selections: WaterFeatureSelection[] | undefined) => {
  const next = {
    sheer: [] as WaterFeatureSelection[],
    bowl: [] as WaterFeatureSelection[],
    deckJet: [] as WaterFeatureSelection[],
    laminar: [] as WaterFeatureSelection[],
    sconce: [] as WaterFeatureSelection[],
    bubbler: [] as WaterFeatureSelection[],
  };

  (selections || [])
    .filter((selection) => Math.max(selection?.quantity ?? 0, 0) > 0)
    .forEach((selection) => {
      const category = getWaterFeatureCategory(selection).toLowerCase();
      if (category.includes('sheer')) {
        next.sheer.push(selection);
        return;
      }
      if (category.includes('wok') || category.includes('bowl')) {
        next.bowl.push(selection);
        return;
      }
      if (category.includes('laminar')) {
        next.laminar.push(selection);
        return;
      }
      if (category.includes('sconce') || category.includes('scupper')) {
        next.sconce.push(selection);
        return;
      }
      if (category.includes('bubbler')) {
        next.bubbler.push(selection);
        return;
      }
      if (category.includes('jet')) {
        next.deckJet.push(selection);
      }
    });

  return next;
};

const hasPoolDefinition = (poolSpecs?: Proposal['poolSpecs']) => {
  if (!poolSpecs) return false;
  const hasGuniteDimensions =
    (poolSpecs.surfaceArea ?? 0) > 0 ||
    (poolSpecs.perimeter ?? 0) > 0 ||
    ((poolSpecs.maxLength ?? 0) > 0 && (poolSpecs.maxWidth ?? 0) > 0);
  const hasFiberglassSelection =
    poolSpecs.poolType === 'fiberglass' && (!!poolSpecs.fiberglassSize || !!poolSpecs.fiberglassModelName);
  return hasGuniteDimensions || hasFiberglassSelection;
};

const hasAutomationSelection = (proposal: Proposal) => {
  const name = String(proposal.equipment?.automation?.name || '').trim().toLowerCase();
  const quantity = Number(proposal.equipment?.automationQuantity || 0);
  return Boolean(name) && !name.includes('no automation') && quantity > 0;
};

const hasCleanerSelection = (proposal: Proposal) => {
  const name = String(proposal.equipment?.cleaner?.name || '').trim().toLowerCase();
  const quantity = Number(proposal.equipment?.cleanerQuantity || 0);
  return Boolean(name) && !name.includes('no cleaner') && quantity > 0;
};

const hasHeaterSelection = (proposal: Proposal) => {
  const name = String(proposal.equipment?.heater?.name || '').trim().toLowerCase();
  const quantity = Number(proposal.equipment?.heaterQuantity || 0);
  return Boolean(name) && !name.includes('no heater') && quantity > 0;
};

const getSanitationSelectionCount = (proposal: Proposal) => {
  const names = [
    proposal.equipment?.saltSystem?.name,
    proposal.equipment?.additionalSaltSystem?.name,
  ].filter((name) => !isPlaceholderNamedSelection(name));
  return names.length;
};

const getAdditionalAuxiliarySelections = (proposal: Proposal) => {
  const explicitSelections =
    Array.isArray(proposal.equipment?.auxiliaryPumps) && proposal.equipment.auxiliaryPumps.length > 0
      ? proposal.equipment.auxiliaryPumps.filter((pump) => pump && !isPlaceholderPumpName(pump.name)).slice(0, 1)
      : proposal.equipment?.auxiliaryPump && !isPlaceholderPumpName(proposal.equipment.auxiliaryPump.name)
      ? [proposal.equipment.auxiliaryPump]
      : [];
  return explicitSelections;
};

export function hasFiberglassRequiredSpaEquipment(
  proposal: Pick<Proposal, 'poolSpecs' | 'plumbing'> | null | undefined
) {
  return Boolean(
    proposal?.poolSpecs?.poolType === 'fiberglass' &&
      (proposal?.poolSpecs?.spaType ?? 'none') === 'none' &&
      (proposal?.plumbing?.runs?.spaRun ?? 0) > 0
  );
}

export function getAuxiliaryPumpDependencyLabel(
  pump?: Pick<PumpSelection, 'autoAddedForSpa' | 'autoAddedReason'> | null
) {
  if (pump?.autoAddedReason === 'fiberglass') {
    return 'Required by Fiberglass selection';
  }
  if (pump?.autoAddedForSpa || pump?.autoAddedReason === 'spa') {
    return 'Auto-added for spa';
  }
  return undefined;
}

function buildDependencyPumpSelection(
  pump: PumpSelection | null | undefined,
  reason: 'spa' | 'fiberglass'
): PumpSelection | null {
  if (!pump || isPlaceholderPumpName(pump.name)) return null;
  return {
    ...pump,
    autoAddedForSpa: reason === 'spa',
    autoAddedReason: reason,
  };
}

function syncDependencyAuxiliaryPump(
  proposal: Proposal,
  options?: { defaultAuxiliaryPump?: PumpSelection | null }
) {
  const currentSelections = getAdditionalAuxiliarySelections(proposal);
  const manualSelection = currentSelections.find(
    (pump) => pump && pump.autoAddedReason !== 'spa' && pump.autoAddedReason !== 'fiberglass'
  );
  const dependencySelection = currentSelections.find(
    (pump) => pump && (pump.autoAddedReason === 'spa' || pump.autoAddedReason === 'fiberglass')
  );
  const requiredReason: 'spa' | 'fiberglass' | null =
    proposal.poolSpecs?.spaType !== 'none'
      ? 'spa'
      : hasFiberglassRequiredSpaEquipment(proposal)
      ? 'fiberglass'
      : null;

  let nextSelection: PumpSelection | null = manualSelection ? clonePump(manualSelection) : null;

  if (!nextSelection && requiredReason) {
    nextSelection =
      buildDependencyPumpSelection(clonePump(dependencySelection), requiredReason) ||
      buildDependencyPumpSelection(options?.defaultAuxiliaryPump || null, requiredReason);
  }

  return nextSelection ? [nextSelection] : [];
}

function sanitizeContractOverrides(proposal: Proposal) {
  let nextOverrides = proposal.contractOverrides || {};

  const explicitSpaSelected = (proposal.poolSpecs?.spaType ?? 'none') !== 'none';
  const explicitGuniteSpaSelected = proposal.poolSpecs?.spaType === 'gunite';
  const auxiliarySelections = getAdditionalAuxiliarySelections(proposal);
  const additionalPumps = getAdditionalPumpSelections(proposal.equipment || {});
  const sanitationCount = getSanitationSelectionCount(proposal);
  const poolLightGroups = groupLightsByName(proposal.equipment?.poolLights || []);
  const spaLightCount = proposal.equipment?.spaLights?.length ?? 0;
  const waterFeatureSelections = getWaterFeatureSelectionsByCategory(proposal.waterFeatures?.selections);
  const hasAnyWaterFeatureSelection =
    waterFeatureSelections.sheer.length > 0 ||
    waterFeatureSelections.bowl.length > 0 ||
    waterFeatureSelections.deckJet.length > 0 ||
    waterFeatureSelections.laminar.length > 0 ||
    waterFeatureSelections.sconce.length > 0 ||
    waterFeatureSelections.bubbler.length > 0;
  const hasWaterFeatureValveActuator = (proposal.waterFeatures?.selections || []).some(
    (selection) => Math.max(selection?.quantity ?? 0, 0) > 0 && Boolean(selection?.includeValveActuator)
  );

  if (!explicitSpaSelected) {
    nextOverrides = clearOverrideFields(nextOverrides, SPA_CONTRACT_FIELD_IDS) || {};
  }
  if (spaLightCount === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, SPA_LIGHT_CONTRACT_FIELD_IDS) || {};
  }
  if (auxiliarySelections.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, BLOWER_CONTRACT_FIELD_IDS) || {};
  }
  if (!explicitGuniteSpaSelected || !proposal.poolSpecs?.isRaisedSpa) {
    nextOverrides = clearOverrideFields(nextOverrides, RAISED_SPA_CONTRACT_FIELD_IDS) || {};
  }
  if (proposal.poolSpecs?.poolType === 'fiberglass') {
    nextOverrides = clearOverrideFields(nextOverrides, FIBERGLASS_TILE_CONTRACT_FIELD_IDS) || {};
  }

  if (additionalPumps.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ADDITIONAL_PUMP_CONTRACT_FIELD_IDS) || {};
  } else if (additionalPumps.length === 1) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p1_22']) || {};
  }

  if (sanitationCount === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, SANITATION_CONTRACT_FIELD_IDS) || {};
  } else if (sanitationCount === 1) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p1_24', 'p1_25']) || {};
  } else if (sanitationCount === 2) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p1_25']) || {};
  }

  if (!hasCleanerSelection(proposal)) {
    nextOverrides = clearOverrideFields(nextOverrides, CLEANER_CONTRACT_FIELD_IDS) || {};
  }

  if (!hasHeaterSelection(proposal)) {
    nextOverrides = clearOverrideFields(nextOverrides, HEATER_CONTRACT_FIELD_IDS) || {};
  }

  if (poolLightGroups.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, POOL_LIGHT_CONTRACT_FIELD_IDS) || {};
  } else if (poolLightGroups.length === 1) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_63', 'p2_64']) || {};
  }

  if (!hasAutomationSelection(proposal)) {
    nextOverrides = clearOverrideFields(nextOverrides, AUTOMATION_CONTRACT_FIELD_IDS) || {};
  }

  if (!hasWaterFeatureValveActuator) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_68']) || {};
  }

  if (waterFeatureSelections.sheer.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_70', 'p2_71', 'p2_72', 'p2_73']) || {};
  } else if (waterFeatureSelections.sheer.length === 1) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_72', 'p2_73']) || {};
  }
  if (waterFeatureSelections.bowl.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_74', 'p2_75']) || {};
  }
  if (waterFeatureSelections.deckJet.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_76', 'p2_77']) || {};
  }
  if (waterFeatureSelections.laminar.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_78', 'p2_79']) || {};
  }
  if (waterFeatureSelections.sconce.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_80', 'p2_81']) || {};
  }
  if (waterFeatureSelections.bubbler.length === 0) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_82', 'p2_83']) || {};
  }
  if (!hasAnyWaterFeatureSelection) {
    nextOverrides = clearOverrideFields(nextOverrides, ['p2_84', 'p2_85', 'p2_86', 'p2_87', 'p2_88', 'p2_89']) || {};
  }
  if (!hasAnyWaterFeatureSelection) {
    nextOverrides = clearOverrideFields(nextOverrides, WATER_FEATURE_CONTRACT_FIELD_IDS) || {};
  }

  return nextOverrides;
}

export function sanitizeProposalSelectionState(
  proposal: Proposal,
  options?: { defaultAuxiliaryPump?: PumpSelection | null }
): Proposal {
  const poolDefaults = getDefaultPoolSpecs();
  const poolSpecs = { ...(proposal.poolSpecs || poolDefaults) };
  const plumbing = {
    ...(proposal.plumbing || {}),
    runs: mergePlumbingRuns(proposal.plumbing?.runs),
  } as Proposal['plumbing'];
  const tileCopingDecking = {
    ...(proposal.tileCopingDecking || {}),
  } as Proposal['tileCopingDecking'];

  if (poolSpecs.poolType !== 'fiberglass') {
    poolSpecs.fiberglassSize = undefined;
    poolSpecs.fiberglassModelName = undefined;
    poolSpecs.fiberglassFinishUpgradeName = undefined;
    poolSpecs.fiberglassTanningLedgeName = undefined;
    poolSpecs.needsFiberglassCrane = false;
    poolSpecs.fiberglassModelPrice = undefined;
    poolSpecs.fiberglassPerimeter = undefined;
    poolSpecs.fiberglassCraneOption = poolDefaults.fiberglassCraneOption;
  } else {
    tileCopingDecking.tileLevel = 0;
    tileCopingDecking.tileOptionId = undefined;
    tileCopingDecking.additionalTileLength = 0;
    tileCopingDecking.trimTileOptionId = undefined;
    tileCopingDecking.hasTrimTileOnSteps = false;
  }

  if (poolSpecs.spaType !== 'fiberglass') {
    poolSpecs.spaFiberglassModelName = undefined;
    poolSpecs.needsFiberglassSpaCrane = false;
    poolSpecs.spaFiberglassModelPrice = undefined;
  }

  if (poolSpecs.spaType !== 'gunite') {
    poolSpecs.spaLength = 0;
    poolSpecs.spaWidth = 0;
    poolSpecs.isRaisedSpa = false;
    poolSpecs.raisedSpaFacing = poolDefaults.raisedSpaFacing;
    tileCopingDecking.doubleBullnoseLnft = 0;
  }

  if (poolSpecs.spaType === 'none') {
    poolSpecs.hasSpillover = false;
    if (poolSpecs.poolType !== 'fiberglass') {
      plumbing.runs.spaRun = 0;
    }
  }

  const nextAuxiliarySelections = syncDependencyAuxiliaryPump(
    {
      ...proposal,
      poolSpecs,
      plumbing,
    } as Proposal,
    options
  );

  const equipmentWithDependencies = syncSpaHeaterSelection(
    {
      ...(proposal.equipment || {}),
      auxiliaryPumps: nextAuxiliarySelections,
      auxiliaryPump: nextAuxiliarySelections[0],
    } as Proposal['equipment'],
    poolSpecs.spaType !== 'none'
  );

  const nextEquipment = normalizePumpSelectionState(
    normalizeEquipmentLighting(
      equipmentWithDependencies,
      {
        poolSpecs,
        hasPool: hasPoolDefinition(poolSpecs),
        hasSpa: poolSpecs.spaType !== 'none',
        preserveEmpty: true,
      }
    )
  );

  const nextProposal = {
    ...proposal,
    poolSpecs,
    plumbing,
    tileCopingDecking,
    equipment: nextEquipment,
  } as Proposal;

  if (isPpasEastProposal(nextProposal)) {
    nextProposal.interiorFinish = {
      ...nextProposal.interiorFinish,
      hasWaterproofing: false,
    };
  }

  return {
    ...nextProposal,
    contractOverrides: sanitizeContractOverrides(nextProposal),
  };
}

export function sanitizeEditableProposalVersions(proposal: Proposal): Proposal {
  const sanitizeIfEditable = (entry: Proposal) => {
    const versionStatus = getVersionRecordStatus(entry);
    if (versionStatus === 'signed' || versionStatus === 'completed') {
      return entry;
    }
    return sanitizeProposalSelectionState(entry);
  };

  return {
    ...sanitizeIfEditable(proposal),
    versions: (proposal.versions || []).map((entry) => sanitizeIfEditable(entry as Proposal)),
  };
}
