import pricingData from './pricingData';
import { getSessionFranchiseCode } from './session';
import { isPpasEastFranchiseCode } from '../utils/franchiseScope';
import { removeHardcodedPapDiscountsFromPricing } from '../utils/papDiscounts';
import { DEFAULT_TAX_RATE, normalizeTaxRate, syncLegacyTaxRateAliases } from './taxRate';
import {
  loadPricingModel as loadPricingModelRemote,
  loadInitialPricingModelRevisionId,
  listPricingModels as listPricingModelsRemote,
  loadDefaultFranchisePricing,
  savePricingModel as savePricingModelRemote,
} from './pricingModelsAdapter';
import { ensureMasonryFacingCatalogs } from '../utils/masonryFacing';
import { ensureTileCopingDeckingCatalogs } from '../utils/tileCopingCatalogs';
import {
  BRONZE_PRICING_TIER_ID,
  NORMAL_PRICING_TIER_ID,
  getPricingTierName,
  isBronzeLockedPricingPath,
  normalizePricingTierId,
  normalizePricingTiers,
  removePricingTierOverride,
  resolvePricingForTier,
  upsertPricingTierOverride,
  withoutPricingRuntimeFields,
  type PricingData as TieredPricingData,
  type PricingTierId,
} from './pricingTiers';

type PricingData = TieredPricingData;
type PricingLoadState = {
  franchiseId: string;
  pricing: PricingData;
  basePricing: PricingData;
  pricingTierId: PricingTierId;
  pricingTierName: string;
  pricingModelId: string | null;
  pricingModelName: string | null;
  pricingModelFranchiseId: string | null;
  pricingModelRevisionId: string | null;
  pricingModelRevisionNumber: number | null;
  isDefault: boolean;
};

const STORAGE_VERSION = '2025-03-interior-finish-catalog';
const LEGACY_STORAGE_KEY = `pricingDataOverrides-${STORAGE_VERSION}`;
const DEFAULT_FRANCHISE_ID = 'default';

const getTierResolutionOptions = () => ({
  bronzeIncludesGravel: isPpasEastFranchiseCode(getSessionFranchiseCode()),
});
const EXCAVATION_RBB_HEIGHTS = [6, 12, 18, 24, 30, 36];
export const ASSIGN_LATER_INTERIOR_FINISH_COLOR = 'Assign Later';

const FIXED_PACKAGE_CATALOG_DEPENDENCIES: Record<
  string,
  { nameKey: string; quantityKey: string; usesPumpOverhead?: boolean }
> = {
  'equipment.pumps': {
    nameKey: 'includedPumpName',
    quantityKey: 'includedPumpQuantity',
    usesPumpOverhead: true,
  },
  'equipment.filters': {
    nameKey: 'includedFilterName',
    quantityKey: 'includedFilterQuantity',
  },
  'equipment.cleaners': {
    nameKey: 'includedCleanerName',
    quantityKey: 'includedCleanerQuantity',
  },
  'equipment.heaters': {
    nameKey: 'includedHeaterName',
    quantityKey: 'includedHeaterQuantity',
  },
  'equipment.automation': {
    nameKey: 'includedAutomationName',
    quantityKey: 'includedAutomationQuantity',
  },
  'equipment.saltSystem': {
    nameKey: 'includedSaltSystemName',
    quantityKey: 'includedSaltSystemQuantity',
  },
  'equipment.autoFillSystem': {
    nameKey: 'includedAutoFillSystemName',
    quantityKey: 'includedAutoFillSystemQuantity',
  },
  'equipment.lights.poolLights': {
    nameKey: 'includedPoolLightName',
    quantityKey: 'includedPoolLightQuantity',
  },
  'equipment.lights.spaLights': {
    nameKey: 'includedSpaLightName',
    quantityKey: 'includedSpaLightQuantity',
  },
  'equipment.sanitationAccessories': {
    nameKey: 'includedSanitationAccessoryName',
    quantityKey: 'includedSanitationAccessoryQuantity',
  },
};

const PACKAGE_DEPENDENCY_COST_FIELDS = new Set([
  'basePrice',
  'addCost1',
  'addCost2',
  'addCost3',
  'price',
  'percentIncrease',
  'overheadMultiplier',
]);

let loadingPromise: Promise<void> | null = null;
let latestLoadRequestId = 0;
let activeFranchiseId = DEFAULT_FRANCHISE_ID;
let activePricingModelId: string | null = null;
let activePricingModelName: string | null = null;
let activePricingModelFranchiseId: string | null = null;
let activePricingModelRevisionId: string | null = null;
let activePricingModelRevisionNumber: number | null = null;
let activePricingModelIsDefault = true;
let activePricingTierId: PricingTierId = NORMAL_PRICING_TIER_ID;
const defaultSnapshot: PricingData = deepClone(pricingData);
let basePricingState: PricingData = normalizePricingTiers(deepClone(pricingData));
let pricingState: PricingData = resolvePricingForTier(
  basePricingState,
  activePricingTierId,
  getTierResolutionOptions()
);
const listeners = new Set<(data: PricingData) => void>();

function normalizePricingState(snapshot: PricingData, source?: any): PricingData {
  const normalized = removeHardcodedPapDiscountsFromPricing(deepClone(snapshot));
  ensureMasonryFacingCatalogs(normalized, source, defaultSnapshot);
  ensureTileCopingDeckingCatalogs(normalized, source, defaultSnapshot);
  syncLegacyFiberglassPricing(normalized, source);
  syncLegacyMiscPricing(normalized, source);
  syncGlobalTaxRatePricing(normalized, source);
  syncOutOfGroundPlumbingPricing(normalized, source);
  syncExcavationAdminTables(normalized, source);
  syncBlowerCatalog(normalized);
  syncInteriorFinishColorOptions(normalized);
  return normalizePricingTiers(normalized);
}

function syncInteriorFinishColorOptions(target: PricingData) {
  if (!isPpasEastFranchiseCode(getSessionFranchiseCode())) return;
  const finishes = (target as any)?.interiorFinish?.finishes;
  if (!Array.isArray(finishes)) return;

  finishes.forEach((finish: any) => {
    const configuredColors = Array.isArray(finish?.colors)
      ? finish.colors
      : typeof finish?.colors === 'string'
        ? finish.colors.split(',')
        : [];
    const seen = new Set<string>();
    const colors = configuredColors
      .map((color: unknown) => String(color || '').trim())
      .filter((color: string) => {
        if (!color) return false;
        const normalized = color.toLowerCase();
        if (normalized === ASSIGN_LATER_INTERIOR_FINISH_COLOR.toLowerCase() || seen.has(normalized)) {
          return false;
        }
        seen.add(normalized);
        return true;
      });

    // Interior finish colors have no incremental pricing; Assign Later is always a $0 choice.
    finish.colors = [ASSIGN_LATER_INTERIOR_FINISH_COLOR, ...colors];
  });
}

function syncGlobalTaxRatePricing(target: PricingData, source?: any) {
  const sourceMiscTaxRate = source?.misc?.taxRate;
  const sourceEquipmentTaxRate = source?.equipment?.taxRate;
  const taxRate = Number.isFinite(Number(sourceMiscTaxRate))
    ? normalizeTaxRate(sourceMiscTaxRate)
    : Number.isFinite(Number(sourceEquipmentTaxRate))
      ? normalizeTaxRate(sourceEquipmentTaxRate)
      : normalizeTaxRate((target as any)?.misc?.taxRate, DEFAULT_TAX_RATE);

  syncLegacyTaxRateAliases(target, taxRate);
}

function syncBlowerCatalog(target: PricingData) {
  const blowerCatalog = (target as any)?.equipment?.auxiliaryPumps;
  if (!Array.isArray(blowerCatalog)) return;

  blowerCatalog.forEach((entry: any) => {
    const normalizedName = String(entry?.name || '').trim().toLowerCase();
    if (
      normalizedName.includes('no aux') ||
      normalizedName.includes('no auxiliary') ||
      normalizedName.includes('select aux pump') ||
      normalizedName.includes('select auxiliary pump') ||
      normalizedName.includes('no blower')
    ) {
      entry.name = 'No Blower (Select blower)';
    }
  });
}

function syncLegacyFiberglassPricing(target: PricingData, source?: any) {
  const legacyFiberglass = source?.fiberglass;
  if (!legacyFiberglass || typeof legacyFiberglass !== 'object') {
    return;
  }

  const targetFiberglass = (target as any).fiberglass;
  if (!targetFiberglass || typeof targetFiberglass !== 'object') {
    return;
  }

  const hasSourcePoolModels = ['small', 'medium', 'large'].some((size) =>
    Array.isArray(legacyFiberglass?.poolModels?.[size])
  );

  if (!hasSourcePoolModels && Array.isArray(legacyFiberglass.models)) {
    const nextPoolModels: Record<'small' | 'medium' | 'large', any[]> = {
      small: [],
      medium: [],
      large: [],
    };

    legacyFiberglass.models.forEach((model: any) => {
      const size = String(model?.size || '').trim();
      if (size !== 'small' && size !== 'medium' && size !== 'large') {
        return;
      }

      const seededDefaults = Array.isArray(targetFiberglass.poolModels?.[size]) ? targetFiberglass.poolModels[size][0] : null;
      nextPoolModels[size].push({
        name: model?.name || '',
        shellPrice: Number(model?.price) || 0,
        freight: Number(seededDefaults?.freight) || 0,
        crane: Number(seededDefaults?.crane) || 0,
        install: Number(seededDefaults?.install) || 0,
        gravel: Number(seededDefaults?.gravel) || 0,
      });
    });

    targetFiberglass.poolModels = nextPoolModels;
  }

  const hasSourceSpaOptions = Array.isArray(legacyFiberglass.spaOptions);
  if (!hasSourceSpaOptions) {
    const legacySpaOptions = Array.isArray(legacyFiberglass.spaModels)
      ? legacyFiberglass.spaModels
      : Array.isArray(legacyFiberglass.spas)
        ? legacyFiberglass.spas
        : [];

    if (legacySpaOptions.length > 0) {
      targetFiberglass.spaOptions = legacySpaOptions.map((option: any) => ({
        name: option?.name || '',
        price: Number(option?.price) || 0,
      }));
    }
  }

  if (
    (!Array.isArray(legacyFiberglass.finishUpgrades) || legacyFiberglass.finishUpgrades.length === 0) &&
    Number.isFinite(Number(legacyFiberglass.crystite))
  ) {
    targetFiberglass.finishUpgrades = [
      {
        name: 'Crystite',
        price: Number(legacyFiberglass.crystite) || 0,
      },
    ];
  }

  if (!Number.isFinite(Number(legacyFiberglass.shellTaxRate)) && Number.isFinite(Number(legacyFiberglass.taxRate))) {
    targetFiberglass.shellTaxRate = Number(legacyFiberglass.taxRate) || 0;
  }
}

function syncLegacyMiscPricing(target: PricingData, source?: any) {
  const configuredWaterTruck = source?.misc?.waterTruck;
  const legacyWaterTruck = source?.interiorFinish?.waterTruck;
  const resolvedWaterTruck = configuredWaterTruck ?? legacyWaterTruck;

  if (resolvedWaterTruck && typeof resolvedWaterTruck === 'object') {
    target.misc.waterTruck = mergeDeep(target.misc.waterTruck ?? {}, resolvedWaterTruck);
  }

  if (target.interiorFinish?.waterTruck && target.misc?.waterTruck) {
    target.interiorFinish.waterTruck = deepClone(target.misc.waterTruck);
  }

  const configuredWarranty = source?.misc?.startup?.fiveYearWarranty;
  const legacyWarranty = source?.misc?.startup?.premium;
  const resolvedWarranty =
    typeof configuredWarranty === 'number' && Number.isFinite(configuredWarranty)
      ? configuredWarranty
      : typeof legacyWarranty === 'number' && Number.isFinite(legacyWarranty)
        ? legacyWarranty
        : undefined;

  if (resolvedWarranty !== undefined) {
    target.misc.startup.fiveYearWarranty = resolvedWarranty;
    target.misc.startup.premium = resolvedWarranty;
  }
}

function syncOutOfGroundPlumbingPricing(target: PricingData, source?: any) {
  const sourcePlumbing = source?.plumbing && typeof source.plumbing === 'object' ? source.plumbing : undefined;
  const targetPlumbing = (target as any).plumbing;
  if (!targetPlumbing || typeof targetPlumbing !== 'object') {
    return;
  }

  if (
    sourcePlumbing &&
    !Number.isFinite(Number(sourcePlumbing.exposedPoolWallStripFormsAdditional)) &&
    Number.isFinite(Number(sourcePlumbing.stripFormsRbbAdditional))
  ) {
    targetPlumbing.exposedPoolWallStripFormsAdditional = Number(sourcePlumbing.stripFormsRbbAdditional);
  }
}

function toFiniteNumber(value: any, fallback: number = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatExcavationBreakpointRange(min: number, max: number) {
  return `${min.toLocaleString('en-US')}-${max.toLocaleString('en-US')} SQFT`;
}

function parseExcavationRbbHeight(value: any, fallback?: number): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && EXCAVATION_RBB_HEIGHTS.includes(numeric)) {
    return numeric;
  }

  const match = String(value ?? '').match(/(\d+)/);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && EXCAVATION_RBB_HEIGHTS.includes(parsed)) {
      return parsed;
    }
  }

  if (fallback !== undefined && EXCAVATION_RBB_HEIGHTS.includes(fallback)) {
    return fallback;
  }

  return null;
}

function buildExcavationBaseTableRows(
  rangeRows: Array<{ id?: string; max: number; price: number }>,
  overagePrice: number
) {
  const normalizedRows: Array<{
    id: string;
    breakpointRange: string;
    kind: string;
    max?: number;
    price: number;
  }> = [];
  let previousMax = 0;
  [...rangeRows]
    .filter((row) => Number.isFinite(Number(row?.max)))
    .sort((left, right) => Number(left.max) - Number(right.max))
    .forEach((row, index) => {
      const max = toFiniteNumber(row.max);
      const min = index === 0 ? 0 : previousMax + 1;
      previousMax = max;
      normalizedRows.push({
        id: row.id || `base-range-${max}`,
        breakpointRange: formatExcavationBreakpointRange(min, max),
        kind: 'range',
        max,
        price: toFiniteNumber(row.price),
      });
    });

  normalizedRows.push({
    id: 'base-range-over-1000',
    breakpointRange: 'Over 1,000 SQFT',
    kind: 'overage',
    price: toFiniteNumber(overagePrice),
  });

  return normalizedRows;
}

function buildExcavationBaseTableFromLegacy(excavation: any) {
  const rangeRows = (((excavation?.baseRanges as any[]) || []) as any[])
    .map((row, index) => ({
      id: String(row?.id || `base-range-${index + 1}`),
      max: toFiniteNumber(row?.max, Number.NaN),
      price: toFiniteNumber(row?.price),
    }))
    .filter((row) => Number.isFinite(row.max));

  return buildExcavationBaseTableRows(rangeRows, toFiniteNumber(excavation?.over1000Sqft));
}

function buildExcavationBaseTableFromTable(tableRows: any[], excavation: any) {
  const rangeRows = (tableRows || [])
    .map((row, index) => ({
      id: String(row?.id || `base-range-${index + 1}`),
      kind: String(row?.kind || '').trim().toLowerCase(),
      max: toFiniteNumber(row?.max, Number.NaN),
      price: toFiniteNumber(row?.price),
      label: String(row?.breakpointRange || '').trim().toLowerCase(),
    }))
    .filter((row) => row.kind !== 'overage' && Number.isFinite(row.max));

  const overageRow = (tableRows || []).find((row) => {
    const kind = String(row?.kind || '').trim().toLowerCase();
    const label = String(row?.breakpointRange || '').trim().toLowerCase();
    return kind === 'overage' || label.includes('over 1,000') || label.includes('over 1000');
  });

  if (!rangeRows.length) {
    return buildExcavationBaseTableFromLegacy(excavation);
  }

  return buildExcavationBaseTableRows(
    rangeRows.map(({ id, max, price }) => ({ id, max, price })),
    toFiniteNumber(overageRow?.price, toFiniteNumber(excavation?.over1000Sqft))
  );
}

function buildRaisedBondBeamTableRows(pricesByHeight: Map<number, number>) {
  return EXCAVATION_RBB_HEIGHTS.map((height) => ({
    id: `rbb-${height}`,
    rbbSize: `${height}" RBB`,
    height,
    price: toFiniteNumber(pricesByHeight.get(height)),
  }));
}

function buildRaisedBondBeamTableFromLegacy(excavation: any) {
  const pricesByHeight = new Map<number, number>();
  EXCAVATION_RBB_HEIGHTS.forEach((height) => {
    pricesByHeight.set(height, toFiniteNumber(excavation?.[`rbb${height}`]));
  });
  return buildRaisedBondBeamTableRows(pricesByHeight);
}

function buildRaisedBondBeamTableFromTable(tableRows: any[], excavation: any) {
  const pricesByHeight = new Map<number, number>();
  EXCAVATION_RBB_HEIGHTS.forEach((height) => {
    pricesByHeight.set(height, toFiniteNumber(excavation?.[`rbb${height}`]));
  });

  (tableRows || []).forEach((row, index) => {
    const height = parseExcavationRbbHeight(row?.height ?? row?.rbbSize, EXCAVATION_RBB_HEIGHTS[index]);
    if (height === null) {
      return;
    }
    pricesByHeight.set(height, toFiniteNumber(row?.price, pricesByHeight.get(height) ?? 0));
  });

  return buildRaisedBondBeamTableRows(pricesByHeight);
}

function buildExposedPoolWallFormingTableRows(pricesByHeight: Map<number, number>) {
  return EXCAVATION_RBB_HEIGHTS.map((height) => ({
    id: `exposed-pool-wall-${height}`,
    rbbSize: `${height}" Out of Ground`,
    height,
    price: toFiniteNumber(pricesByHeight.get(height)),
  }));
}

function buildExposedPoolWallFormingTableFromFallback(rows: any[], excavation: any) {
  const pricesByHeight = new Map<number, number>();
  EXCAVATION_RBB_HEIGHTS.forEach((height) => {
    pricesByHeight.set(
      height,
      toFiniteNumber(excavation?.[`exposedPoolWall${height}`], toFiniteNumber(excavation?.[`rbb${height}`]))
    );
  });

  (rows || []).forEach((row, index) => {
    const height = parseExcavationRbbHeight(row?.height ?? row?.rbbSize, EXCAVATION_RBB_HEIGHTS[index]);
    if (height === null) {
      return;
    }
    pricesByHeight.set(height, toFiniteNumber(row?.price, pricesByHeight.get(height) ?? 0));
  });

  return buildExposedPoolWallFormingTableRows(pricesByHeight);
}

function buildExposedPoolWallFormingTableFromRaisedBondBeam(raisedBondBeamTable: any[]) {
  const pricesByHeight = new Map<number, number>();
  (raisedBondBeamTable || []).forEach((row, index) => {
    const height = parseExcavationRbbHeight(row?.height ?? row?.rbbSize, EXCAVATION_RBB_HEIGHTS[index]);
    if (height === null) {
      return;
    }
    pricesByHeight.set(height, toFiniteNumber(row?.price));
  });

  return buildExposedPoolWallFormingTableRows(pricesByHeight);
}

function syncExcavationAdminTables(target: PricingData, source?: any) {
  const targetExcavation = (target as any).excavation;
  if (!targetExcavation || typeof targetExcavation !== 'object') {
    return;
  }

  const sourceExcavation = source?.excavation && typeof source.excavation === 'object' ? source.excavation : undefined;

  const baseExcavationTable = Array.isArray(sourceExcavation?.baseExcavationTable)
    ? buildExcavationBaseTableFromTable(sourceExcavation.baseExcavationTable, targetExcavation)
    : buildExcavationBaseTableFromLegacy(targetExcavation);
  targetExcavation.baseExcavationTable = baseExcavationTable;
  targetExcavation.baseRanges = baseExcavationTable
    .filter((row: any) => row?.kind === 'range' && Number.isFinite(Number(row?.max)))
    .map((row: any) => ({
      max: toFiniteNumber(row.max),
      price: toFiniteNumber(row.price),
    }));
  targetExcavation.over1000Sqft = toFiniteNumber(
    baseExcavationTable.find((row: any) => row?.kind === 'overage')?.price
  );

  const raisedBondBeamTable = Array.isArray(sourceExcavation?.raisedBondBeamTable)
    ? buildRaisedBondBeamTableFromTable(sourceExcavation.raisedBondBeamTable, targetExcavation)
    : buildRaisedBondBeamTableFromLegacy(targetExcavation);
  targetExcavation.raisedBondBeamTable = raisedBondBeamTable;
  raisedBondBeamTable.forEach((row: any) => {
    const height = parseExcavationRbbHeight(row?.height);
    if (height === null) {
      return;
    }
    targetExcavation[`rbb${height}`] = toFiniteNumber(row?.price);
  });

  const exposedPoolWallFormingTable = Array.isArray(sourceExcavation?.exposedPoolWallFormingTable)
    ? buildExposedPoolWallFormingTableFromFallback(sourceExcavation.exposedPoolWallFormingTable, targetExcavation)
    : buildExposedPoolWallFormingTableFromRaisedBondBeam(raisedBondBeamTable);
  targetExcavation.exposedPoolWallFormingTable = exposedPoolWallFormingTable;
  exposedPoolWallFormingTable.forEach((row: any) => {
    const height = parseExcavationRbbHeight(row?.height);
    if (height === null) {
      return;
    }
    targetExcavation[`exposedPoolWall${height}`] = toFiniteNumber(row?.price);
  });
}

function isExcavationAdminTablePath(path: (string | number)[]) {
  return (
    path[0] === 'excavation' &&
    (
      path[1] === 'baseExcavationTable' ||
      path[1] === 'raisedBondBeamTable' ||
      path[1] === 'exposedPoolWallFormingTable'
    )
  );
}

function getLocalStorageKey(franchiseId: string) {
  return `pricingDataOverrides-${franchiseId}-${STORAGE_VERSION}`;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function getDeep(target: any, path: (string | number)[]) {
  return path.reduce((acc, key) => (acc ? acc[key] : undefined), target);
}

function normalizeCatalogName(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function calculateCatalogItemCost(
  item: any,
  dependency: { usesPumpOverhead?: boolean },
  equipmentPricing: any
) {
  if (!item) return 0;
  const hasParts = ['basePrice', 'addCost1', 'addCost2', 'addCost3'].some(
    (field) => item[field] !== undefined
  );
  let cost = hasParts
    ? ['basePrice', 'addCost1', 'addCost2', 'addCost3'].reduce(
        (total, field) => total + (Number(item[field]) || 0),
        0
      )
    : Number(item.price) || 0;
  if (hasParts && Number.isFinite(Number(item.percentIncrease))) {
    const divisor = Number(item.percentIncrease) / 100;
    if (divisor !== 0) cost /= divisor;
  }
  if (dependency.usesPumpOverhead) {
    const itemOverhead = Number(item.overheadMultiplier);
    const fallbackOverhead = Number(equipmentPricing?.pumpOverheadMultiplier);
    const overhead =
      Number.isFinite(itemOverhead) && itemOverhead > 0
        ? itemOverhead
        : Number.isFinite(fallbackOverhead) && fallbackOverhead > 0
          ? fallbackOverhead
          : 1;
    cost *= overhead;
  }
  return Number.isFinite(cost) ? cost : 0;
}

function cascadeCatalogCostChangeToFixedPackages(
  path: (string | number)[],
  index: number,
  key: string,
  value: any
) {
  if (!PACKAGE_DEPENDENCY_COST_FIELDS.has(key)) return;
  const dependency = FIXED_PACKAGE_CATALOG_DEPENDENCIES[path.join('.')];
  if (!dependency) return;
  const catalog = getDeep(pricingState, path);
  const currentItem = Array.isArray(catalog) ? catalog[index] : null;
  if (!currentItem?.name) return;
  const nextItem = { ...currentItem, [key]: value };
  const equipmentPricing = (pricingState as any)?.equipment || {};
  const previousCost = calculateCatalogItemCost(currentItem, dependency, equipmentPricing);
  const nextCost = calculateCatalogItemCost(nextItem, dependency, equipmentPricing);
  const unitDelta = nextCost - previousCost;
  if (!Number.isFinite(unitDelta) || Math.abs(unitDelta) < 0.000001) return;

  const packages = Array.isArray(equipmentPricing.packageOptions)
    ? equipmentPricing.packageOptions
    : [];
  let changed = false;
  const nextPackages = packages.map((option: any) => {
    if (!option || (option.mode || 'fixed') !== 'fixed') return option;
    const includedName = normalizeCatalogName(option[dependency.nameKey]);
    if (!includedName || includedName !== normalizeCatalogName(currentItem.name)) return option;
    const quantity = Math.max(Number(option[dependency.quantityKey]) || 0, 0);
    if (quantity <= 0) return option;
    changed = true;
    return {
      ...option,
      basePrice: Math.round(((Number(option.basePrice) || 0) + unitDelta * quantity) * 100) / 100,
    };
  });
  if (!changed) return;

  basePricingState = upsertPricingTierOverride(
    basePricingState,
    activePricingTierId,
    ['equipment', 'packageOptions'],
    nextPackages
  );
}

function syncBaseFromSnapshot(snapshot: PricingData) {
  // Replace pricingData contents so existing references see updated values
  Object.keys(pricingData).forEach((key) => {
    // @ts-expect-error dynamic delete
    delete pricingData[key];
  });
  Object.entries(snapshot).forEach(([key, value]) => {
    // @ts-expect-error dynamic assign
    pricingData[key] = deepClone(value);
  });
}

function syncBaseFromState() {
  syncBaseFromSnapshot(pricingState);
}

function mergeDeep(target: any, source: any): any {
  if (typeof source !== 'object' || source === null) return source;
  const output = Array.isArray(target) ? [...target] : { ...target };
  Object.keys(source).forEach((key) => {
    const sourceVal = source[key];
    if (Array.isArray(sourceVal)) {
      output[key] = sourceVal.map((item: any, index: number) => {
        if (typeof item === 'object' && item !== null && Array.isArray(output[key])) {
          return mergeDeep(output[key][index], item);
        }
        return deepClone(item);
      });
    } else if (typeof sourceVal === 'object' && sourceVal !== null) {
      output[key] = mergeDeep(output[key] ?? {}, sourceVal);
    } else {
      output[key] = sourceVal;
    }
  });
  return output;
}

async function resolveTargetFranchiseId(franchiseId?: string) {
  let targetId = franchiseId || DEFAULT_FRANCHISE_ID;
  if (!franchiseId && window?.electron?.getActiveFranchise) {
    try {
      const active = await window.electron.getActiveFranchise();
      if (active?.id) {
        targetId = active.id;
      }
    } catch (error) {
      console.warn('Unable to read active franchise from database:', error);
    }
  }
  return targetId;
}

async function fetchPersistedPricing(franchiseId: string): Promise<{
  pricing: PricingData | null;
  pricingModelId: string | null;
  pricingModelName: string | null;
  pricingModelFranchiseId: string | null;
  pricingModelRevisionId: string | null;
  pricingModelRevisionNumber: number | null;
  isDefault: boolean;
}> {
  try {
    const result = await loadDefaultFranchisePricing(franchiseId);
    if (result?.pricing) {
      return {
        pricing: result.pricing as PricingData,
        pricingModelId: result.pricingModelId || null,
        pricingModelName: result.pricingModelName || null,
        pricingModelFranchiseId: result.pricingModelId ? result.franchiseId || franchiseId : null,
        pricingModelRevisionId: result.revisionId || null,
        pricingModelRevisionNumber: result.revisionNumber || null,
        isDefault: Boolean(result.isDefault),
      };
    }
  } catch (error) {
    console.warn('Unable to load franchise pricing from database:', error);
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const key = getLocalStorageKey(franchiseId);
      let raw = localStorage.getItem(key);
      if (!raw && franchiseId === DEFAULT_FRANCHISE_ID) {
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (raw) {
          localStorage.setItem(key, raw);
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
      if (raw) {
        return {
          pricing: JSON.parse(raw),
          pricingModelId: null,
          pricingModelName: null,
          pricingModelFranchiseId: null,
          pricingModelRevisionId: null,
          pricingModelRevisionNumber: null,
          isDefault: true,
        };
      }
    }
  } catch (error) {
    console.warn('Unable to load saved pricing data overrides:', error);
  }

  return {
    pricing: null,
    pricingModelId: null,
    pricingModelName: null,
    pricingModelFranchiseId: null,
    pricingModelRevisionId: null,
    pricingModelRevisionNumber: null,
    isDefault: true,
  };
}

function notify() {
  const snapshot = getPricingDataSnapshot();
  listeners.forEach((listener) => listener(snapshot));
}

async function resolvePricingState(
  franchiseId: string,
  pricingModelId?: string,
  pricingModelFranchiseId?: string,
  pricingTierId?: string | null,
  pricingModelRevisionId?: string | null
): Promise<PricingLoadState> {
  const resolvedTierId = normalizePricingTierId(pricingTierId);
  try {
    if (pricingModelId) {
      const sourceFranchiseId = pricingModelFranchiseId || franchiseId;
      const result = await loadPricingModelRemote(sourceFranchiseId, pricingModelId, pricingModelRevisionId);
      if (result?.pricing) {
        const basePricing = normalizePricingState(
          mergeDeep(defaultSnapshot, result.pricing ?? {}),
          result.pricing
        );
        return {
          franchiseId,
          pricing: resolvePricingForTier(basePricing, resolvedTierId, getTierResolutionOptions()),
          basePricing,
          pricingTierId: resolvedTierId,
          pricingTierName: getPricingTierName(resolvedTierId),
          pricingModelId: result.pricingModelId || pricingModelId,
          pricingModelName: result.pricingModelName || null,
          pricingModelFranchiseId: result.franchiseId || sourceFranchiseId,
          pricingModelRevisionId: result.revisionId || null,
          pricingModelRevisionNumber: result.revisionNumber || null,
          isDefault: Boolean(result.isDefault),
        };
      }
    }
  } catch (error) {
    console.warn('Unable to load specific pricing model:', error);
  }

  const saved = await fetchPersistedPricing(franchiseId);
  const basePricing = normalizePricingState(mergeDeep(defaultSnapshot, saved.pricing ?? {}), saved.pricing);
  return {
    franchiseId,
    pricing: resolvePricingForTier(basePricing, resolvedTierId, getTierResolutionOptions()),
    basePricing,
    pricingTierId: resolvedTierId,
    pricingTierName: getPricingTierName(resolvedTierId),
    pricingModelId: saved.pricingModelId,
    pricingModelName: saved.pricingModelName,
    pricingModelFranchiseId: saved.pricingModelFranchiseId,
    pricingModelRevisionId: saved.pricingModelRevisionId,
    pricingModelRevisionNumber: saved.pricingModelRevisionNumber,
    isDefault: saved.isDefault,
  };
}

function applyPricingState(state: PricingLoadState) {
  basePricingState = normalizePricingTiers(deepClone(state.basePricing));
  pricingState = state.pricing;
  activeFranchiseId = state.franchiseId;
  activePricingModelId = state.pricingModelId;
  activePricingModelName = state.pricingModelName;
  activePricingModelFranchiseId = state.pricingModelFranchiseId;
  activePricingModelRevisionId = state.pricingModelRevisionId;
  activePricingModelRevisionNumber = state.pricingModelRevisionNumber;
  activePricingModelIsDefault = state.isDefault;
  activePricingTierId = state.pricingTierId;
  syncBaseFromState();
  notify();
}

async function loadPricingForFranchise(
  franchiseId: string,
  pricingModelId?: string,
  pricingModelFranchiseId?: string,
  pricingTierId?: string | null,
  pricingModelRevisionId?: string | null
) {
  const requestId = ++latestLoadRequestId;
  const resolved = await resolvePricingState(
    franchiseId,
    pricingModelId,
    pricingModelFranchiseId,
    pricingTierId,
    pricingModelRevisionId
  );
  if (requestId !== latestLoadRequestId) {
    return resolved;
  }
  applyPricingState(resolved);
  return resolved;
}

export async function initPricingDataStore(
  franchiseId?: string,
  pricingModelId?: string,
  pricingModelFranchiseId?: string,
  pricingTierId?: string | null,
  pricingModelRevisionId?: string | null
) {
  if (loadingPromise && !franchiseId && !pricingModelId && !pricingModelFranchiseId && !pricingTierId && !pricingModelRevisionId) return loadingPromise;

  const currentPromise = (async () => {
    const targetId = await resolveTargetFranchiseId(franchiseId);
    await loadPricingForFranchise(targetId, pricingModelId, pricingModelFranchiseId, pricingTierId, pricingModelRevisionId);
  })();

  loadingPromise = currentPromise;
  try {
    await currentPromise;
  } finally {
    if (loadingPromise === currentPromise) {
      loadingPromise = null;
    }
  }
}

export function getActiveFranchiseId() {
  return activeFranchiseId;
}

export async function setActiveFranchiseId(franchiseId: string) {
  const targetId = franchiseId || DEFAULT_FRANCHISE_ID;
  if (window?.electron?.setActiveFranchise) {
    try {
      await window.electron.setActiveFranchise(targetId);
    } catch (error) {
      console.warn('Unable to set active franchise in database:', error);
    }
  }
  await loadPricingForFranchise(targetId);
}

export function getActivePricingModelMeta() {
  return {
    pricingModelId: activePricingModelId,
    pricingModelName: activePricingModelName,
    pricingModelFranchiseId: activePricingModelFranchiseId,
    pricingModelRevisionId: activePricingModelRevisionId,
    pricingModelRevisionNumber: activePricingModelRevisionNumber,
    isDefault: activePricingModelIsDefault,
    pricingTierId: activePricingTierId,
    pricingTierName: getPricingTierName(activePricingTierId),
  };
}

export async function setActivePricingModel(
  pricingModelId: string,
  pricingModelFranchiseId?: string,
  pricingTierId?: string | null,
  pricingModelRevisionId?: string | null
) {
  if (!pricingModelId) return;
  await loadPricingForFranchise(
    activeFranchiseId,
    pricingModelId,
    pricingModelFranchiseId,
    pricingTierId ?? activePricingTierId,
    pricingModelRevisionId
  );
}

export async function setActivePricingTier(pricingTierId: string | null | undefined) {
  const nextTierId = normalizePricingTierId(pricingTierId);
  activePricingTierId = nextTierId;
  pricingState = resolvePricingForTier(basePricingState, activePricingTierId, getTierResolutionOptions());
  syncBaseFromState();
  notify();
}

export async function loadPricingSnapshotForFranchise(
  franchiseId?: string,
  pricingModelId?: string,
  pricingModelFranchiseId?: string,
  pricingTierId?: string | null,
  pricingModelRevisionId?: string | null
) {
  const targetId = await resolveTargetFranchiseId(franchiseId);
  const resolved = await resolvePricingState(
    targetId,
    pricingModelId,
    pricingModelFranchiseId,
    pricingTierId,
    pricingModelRevisionId
  );
  return {
    ...resolved,
    pricing: deepClone(resolved.pricing),
    basePricing: deepClone(resolved.basePricing),
  };
}

// Existing records that predate revision metadata must always fall back to the
// model's first immutable revision, never whatever happens to be current now.
export async function loadPricingSnapshotForExistingProposal(
  franchiseId?: string,
  pricingModelId?: string,
  pricingModelFranchiseId?: string,
  pricingTierId?: string | null,
  pricingModelRevisionId?: string | null
) {
  const sourceFranchiseId = pricingModelFranchiseId || franchiseId || DEFAULT_FRANCHISE_ID;
  let resolvedModelId = pricingModelId || null;
  let resolvedRevisionId = pricingModelRevisionId || null;
  if (!resolvedModelId) {
    try {
      const models = await listPricingModelsRemote(sourceFranchiseId);
      resolvedModelId = models.find((model) => model.isDefault)?.id || models[0]?.id || null;
    } catch (error) {
      console.warn('Unable to resolve legacy proposal pricing model:', error);
    }
  }
  if (!resolvedRevisionId && resolvedModelId) {
    resolvedRevisionId = await loadInitialPricingModelRevisionId(
      sourceFranchiseId,
      resolvedModelId
    );
  }
  return loadPricingSnapshotForFranchise(
    franchiseId,
    resolvedModelId || undefined,
    pricingModelFranchiseId,
    pricingTierId,
    resolvedRevisionId
  );
}

export function withTemporaryPricingSnapshot<T>(snapshot: PricingData, callback: () => T): T {
  // Preserve the snapshot that is actually loaded, which may itself be a
  // proposal's selected/pinned model inside another temporary calculation.
  // pricingState represents the franchise's active model and would otherwise
  // replace that selected model too early in nested calculation paths.
  const previousSnapshot = deepClone(pricingData);
  syncBaseFromSnapshot(snapshot);
  try {
    return callback();
  } finally {
    syncBaseFromSnapshot(previousSnapshot);
  }
}

export function clearActivePricingModelMeta() {
  activePricingModelId = null;
  activePricingModelName = null;
  activePricingModelFranchiseId = null;
  activePricingModelRevisionId = null;
  activePricingModelRevisionNumber = null;
  activePricingModelIsDefault = false;
  activePricingTierId = NORMAL_PRICING_TIER_ID;
}

export async function savePricingModelSnapshot(options: {
  name: string;
  setDefault?: boolean;
  isHiddenFromView?: boolean;
  updatedBy?: string | null;
  createNew?: boolean;
}) {
  syncInteriorFinishColorOptions(basePricingState);
  return savePricingModelRemote({
    franchiseId: activeFranchiseId,
    pricing: withoutPricingRuntimeFields(basePricingState),
    version: STORAGE_VERSION,
    name: options.name,
    pricingModelId: options.createNew ? undefined : activePricingModelId || undefined,
    setDefault: options.setDefault ?? false,
    isHiddenFromView: options.isHiddenFromView ?? false,
    updatedBy: options.updatedBy ?? null,
    createNew: options.createNew ?? false,
  });
}

export function getPricingDataSnapshot(): PricingData {
  return deepClone(pricingState);
}

export function getNormalPricingDataSnapshot(): PricingData {
  return deepClone(basePricingState);
}

export function getActivePricingTierId(): PricingTierId {
  return activePricingTierId;
}

export function resetPricingTierOverride(path: (string | number)[]) {
  if (activePricingTierId === NORMAL_PRICING_TIER_ID) return;
  basePricingState = removePricingTierOverride(basePricingState, activePricingTierId, path);
  refreshEffectivePricingState();
}

export function isActiveBronzeLockedPricingPath(path: (string | number)[]) {
  const isEastGravel =
    isPpasEastFranchiseCode(getSessionFranchiseCode()) && path.join('.') === 'excavation.gravelPerSqft';
  return (
    activePricingTierId === BRONZE_PRICING_TIER_ID &&
    !isEastGravel &&
    isBronzeLockedPricingPath(path)
  );
}

function refreshEffectivePricingState() {
  syncInteriorFinishColorOptions(basePricingState);
  basePricingState = normalizePricingTiers(basePricingState);
  pricingState = resolvePricingForTier(basePricingState, activePricingTierId, getTierResolutionOptions());
  syncInteriorFinishColorOptions(pricingState);
  syncBaseFromState();
  notify();
}

export function updatePricingValue(path: (string | number)[], value: any) {
  basePricingState = upsertPricingTierOverride(basePricingState, activePricingTierId, path, value);

  const pathKey = path.join('.');
  if (pathKey.startsWith('misc.waterTruck.')) {
    const legacyPath = ['interiorFinish', 'waterTruck', path[path.length - 1] as string];
    basePricingState = upsertPricingTierOverride(basePricingState, activePricingTierId, legacyPath, value);
  }
  if (pathKey === 'misc.startup.fiveYearWarranty') {
    const legacyPath = ['misc', 'startup', 'premium'];
    basePricingState = upsertPricingTierOverride(basePricingState, activePricingTierId, legacyPath, value);
  }
  if (pathKey === 'misc.taxRate' && activePricingTierId === NORMAL_PRICING_TIER_ID) {
    syncLegacyTaxRateAliases(basePricingState, value);
  }
  if (isExcavationAdminTablePath(path)) {
    syncExcavationAdminTables(basePricingState, basePricingState);
  }

  refreshEffectivePricingState();
}

export function updatePricingListItem(
  path: (string | number)[],
  index: number,
  key: string,
  value: any
) {
  const list = getDeep(pricingState, path);
  if (!Array.isArray(list) || !list[index]) return;
  cascadeCatalogCostChangeToFixedPackages(path, index, key, value);
  basePricingState = upsertPricingTierOverride(basePricingState, activePricingTierId, [...path, index, key], value);
  if (isExcavationAdminTablePath(path)) {
    syncExcavationAdminTables(basePricingState, basePricingState);
  }
  refreshEffectivePricingState();
}

export function addPricingListItem(path: (string | number)[], item: any) {
  const list = getDeep(pricingState, path) || [];
  const nextList = [...list, item];
  basePricingState = upsertPricingTierOverride(basePricingState, activePricingTierId, path, nextList);
  if (isExcavationAdminTablePath(path)) {
    syncExcavationAdminTables(basePricingState, basePricingState);
  }
  refreshEffectivePricingState();
}

export function removePricingListItem(path: (string | number)[], index: number) {
  const list = getDeep(pricingState, path);
  if (!Array.isArray(list)) return;
  const nextList = list.filter((_: any, i: number) => i !== index);
  basePricingState = upsertPricingTierOverride(basePricingState, activePricingTierId, path, nextList);
  if (isExcavationAdminTablePath(path)) {
    syncExcavationAdminTables(basePricingState, basePricingState);
  }
  refreshEffectivePricingState();
}

export function subscribeToPricingData(listener: (data: PricingData) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
