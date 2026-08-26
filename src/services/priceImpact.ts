import type {
  CostBreakdown,
  CostLineItem,
  PlumbingRuns,
  Proposal,
} from '../types/proposal-new';
import {
  getSelectedEquipmentPackage,
  isFixedEquipmentPackage,
} from '../utils/equipmentPackages';
import {
  getAdditionalDeckingSelections,
  getDeckingTypeFullLabel,
  withAdditionalDeckingSelections,
} from '../utils/decking';
import { isOffContractLineItem } from '../utils/offContractLineItems';
import { getAdditionalPumpSelections } from '../utils/pumpSelections';
import { sanitizeProposalSelectionState } from '../utils/proposalSelectionSanitizer';
import { buildIncludedSaltCellOption } from '../utils/saltCellCompatibility';
import {
  getCopingOptionLabel,
  getDeckingOptionLabel,
  getTileOptionLabel,
  getTileOptions,
  getTileSelectionId,
  getTrimTileSelectionId,
} from '../utils/tileCopingCatalogs';
import MasterPricingEngine from './masterPricingEngine';
import pricingData from './pricingData';
import { withTemporaryPricingSnapshot } from './pricingDataStore';
import type { PricingData } from './pricingTiers';

export type PriceImpactEffect = 'direct' | 'automatic';
export type PriceImpactDisplayBasis = 'retail' | 'cogs';

export type EquipmentPriceImpactTarget =
  | { kind: 'mainPump' }
  | { kind: 'additionalPump'; index: number }
  | { kind: 'blower'; index: number }
  | { kind: 'mainFilter' }
  | { kind: 'additionalFilter'; index: number }
  | { kind: 'cleaner' }
  | { kind: 'mainHeater' }
  | { kind: 'additionalHeater'; index: number }
  | { kind: 'heaterChiller' }
  | { kind: 'poolLight'; index: number }
  | { kind: 'spaLight'; index: number }
  | { kind: 'automation' }
  | { kind: 'sanitation' }
  | { kind: 'additionalSanitation' }
  | { kind: 'autoFill' }
  | { kind: 'customOption'; index: number };

export type PlumbingPriceImpactRunField =
  | 'skimmerRun'
  | 'mainDrainRun'
  | 'spaRun'
  | 'additionalSkimmers'
  | 'cleanerRun'
  | 'autoFillRun'
  | 'autoFillElectricRun'
  | 'waterFeature1Run'
  | 'waterFeature2Run'
  | 'waterFeature3Run'
  | 'waterFeature4Run'
  | 'infloorValveToEQ'
  | 'infloorValveToPool'
  | 'gasRun';

export type PlumbingPriceImpactTarget =
  | { kind: 'run'; field: PlumbingPriceImpactRunField }
  | { kind: 'customOption'; index: number };

export interface PriceImpactLine {
  key: string;
  section: string;
  category: string;
  label: string;
  note?: string;
  amount: number;
  cogsAmount: number;
  retailAmount: number;
  effect: PriceImpactEffect;
  approximate: boolean;
}

export interface PriceImpactResult {
  status: 'available' | 'unavailable';
  displayBasis: PriceImpactDisplayBasis;
  controlLabel: string;
  comparisonLabel: string;
  directCharges: PriceImpactLine[];
  automaticEffects: PriceImpactLine[];
  overheadAmount: number;
  customerPriceChange: number;
  costChangeBeforeOverhead: number;
  totalCogsChange: number;
  overheadCogsAmount: number;
  overheadRetailAmount: number;
  retailMultiplier: number;
  retailOnlyAdjustmentChange: number;
  reconciliationDifference: number;
  calculationDurationMs: number;
  message?: string;
}

export type CompletePricingCalculation = ReturnType<
  typeof MasterPricingEngine.calculateCompleteProposal
>;

type FlattenedCostLine = {
  section: string;
  item: CostLineItem;
  occurrence: number;
};

export interface PriceImpactComparisonOptions {
  currentProposal: Proposal;
  comparisonProposal: Proposal;
  controlLabel: string;
  comparisonLabel: string;
  directSections: ReadonlySet<string>;
  displayBasis?: PriceImpactDisplayBasis;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
  getLineLabel?: (section: string, item: CostLineItem) => string;
  retailAdjustmentLabel?: string;
}

export interface AdditionalPumpPriceImpactOptions {
  proposal: Proposal;
  pumpIndex: number;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
}

export interface EquipmentPriceImpactOptions {
  proposal: Proposal;
  target: EquipmentPriceImpactTarget;
  displayBasis?: PriceImpactDisplayBasis;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
}

export interface PlumbingPriceImpactOptions {
  proposal: Proposal;
  target: PlumbingPriceImpactTarget;
  displayBasis?: PriceImpactDisplayBasis;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
}

export type ElectricalPriceImpactRunField =
  | 'gasRun'
  | 'electricalRun'
  | 'lightRun'
  | 'heatPumpElectricalRun';

export type ElectricalPriceImpactTarget =
  | { kind: 'run'; field: ElectricalPriceImpactRunField }
  | { kind: 'customOption'; index: number };

export interface ElectricalPriceImpactOptions {
  proposal: Proposal;
  target: ElectricalPriceImpactTarget;
  displayBasis?: PriceImpactDisplayBasis;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
}

export type TileCopingDeckingNumericPriceImpactField =
  | 'additionalTileLength'
  | 'bullnoseLnft'
  | 'spillwayLnft'
  | 'concreteStepsLength';

export type TileCopingDeckingPriceImpactTarget =
  | { kind: 'tileOption' }
  | { kind: 'numeric'; field: TileCopingDeckingNumericPriceImpactField }
  | { kind: 'trimTile' }
  | { kind: 'copingType' }
  | { kind: 'copingSize' }
  | { kind: 'deckingType' }
  | { kind: 'deckingOffContract' }
  | { kind: 'additionalDecking'; index: number }
  | { kind: 'additionalDeckingArea'; index: number }
  | { kind: 'additionalDeckingOffContract'; index: number }
  | { kind: 'roughGrading' }
  | { kind: 'customOption'; index: number };

export interface TileCopingDeckingPriceImpactOptions {
  proposal: Proposal;
  target: TileCopingDeckingPriceImpactTarget;
  displayBasis?: PriceImpactDisplayBasis;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
}

export type DrainagePriceImpactRunField =
  | 'downspoutTotalLF'
  | 'deckDrainTotalLF'
  | 'frenchDrainTotalLF'
  | 'boxDrainTotalLF';

export type DrainagePriceImpactTarget =
  | { kind: 'run'; field: DrainagePriceImpactRunField }
  | { kind: 'customOption'; index: number };

export interface DrainagePriceImpactOptions {
  proposal: Proposal;
  target: DrainagePriceImpactTarget;
  displayBasis?: PriceImpactDisplayBasis;
  currentCalculation?: CompletePricingCalculation;
  pricingSnapshot?: PricingData;
  calculateProposal?: (proposal: Proposal) => CompletePricingCalculation;
}

const CURRENCY_EPSILON = 0.005;
const RECONCILIATION_TOLERANCE = 0.02;
const EQUIPMENT_DIRECT_SECTIONS = new Set(['equipmentOrdered', 'equipmentSet']);
const PLUMBING_DIRECT_SECTIONS = new Set(['plumbing']);
const GAS_DIRECT_SECTIONS = new Set(['gas']);
const ELECTRICAL_DIRECT_SECTIONS = new Set(['electrical']);
const TILE_COPING_DECKING_DIRECT_SECTIONS = new Set([
  'tileLabor',
  'tileMaterial',
  'copingDeckingLabor',
  'copingDeckingMaterial',
  'stoneRockworkLabor',
  'stoneRockworkMaterial',
]);
const CLEANUP_DIRECT_SECTIONS = new Set(['cleanup']);
const DRAINAGE_DIRECT_SECTIONS = new Set(['drainage']);

const roundCurrency = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : 0;
};

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const cloneProposal = (proposal: Proposal): Proposal =>
  JSON.parse(JSON.stringify(proposal)) as Proposal;

const flattenCostBreakdown = (costBreakdown?: CostBreakdown | null): FlattenedCostLine[] => {
  const rows: FlattenedCostLine[] = [];
  if (!costBreakdown) return rows;

  Object.entries(costBreakdown).forEach(([section, value]) => {
    if (!Array.isArray(value)) return;
    const occurrences = new Map<string, number>();
    value.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const identity = `${String(item.category || section).trim()}::${String(item.description || '').trim()}`;
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      rows.push({ section, item, occurrence });
    });
  });

  return rows;
};

const getCostLineKey = ({ section, item, occurrence }: FlattenedCostLine): string =>
  [section, item.category || '', item.description || '', occurrence]
    .map((value) => String(value).trim().toLowerCase())
    .join('::');

const compareCostBreakdowns = (
  current: CostBreakdown,
  comparison: CostBreakdown,
  directSections: ReadonlySet<string>,
  getLineLabel?: (section: string, item: CostLineItem) => string
): PriceImpactLine[] => {
  const currentRows = flattenCostBreakdown(current);
  const comparisonRows = flattenCostBreakdown(comparison);
  const currentMap = new Map(currentRows.map((entry) => [getCostLineKey(entry), entry]));
  const comparisonMap = new Map(comparisonRows.map((entry) => [getCostLineKey(entry), entry]));
  const orderedKeys = [
    ...currentRows.map(getCostLineKey),
    ...comparisonRows.map(getCostLineKey).filter((key) => !currentMap.has(key)),
  ];

  return orderedKeys.flatMap((key) => {
    const currentEntry = currentMap.get(key);
    const comparisonEntry = comparisonMap.get(key);
    const currentItem = currentEntry?.item;
    const comparisonItem = comparisonEntry?.item;
    // Off-contract decking remains visible in the cost breakdown for reporting,
    // but it is intentionally excluded from COGS. Compare its effective COGS
    // value so an on/off-contract counterfactual still reconciles exactly.
    const currentAmount = currentItem && !isOffContractLineItem(currentItem)
      ? currentItem.total ?? 0
      : 0;
    const comparisonAmount = comparisonItem && !isOffContractLineItem(comparisonItem)
      ? comparisonItem.total ?? 0
      : 0;
    const amount = roundCurrency(currentAmount - comparisonAmount);
    if (Math.abs(amount) < CURRENCY_EPSILON) return [];

    const entry = currentEntry || comparisonEntry;
    const item = currentItem || comparisonItem;
    if (!entry || !item) return [];
    const effect: PriceImpactEffect = directSections.has(entry.section) ? 'direct' : 'automatic';

    return [
      {
        key,
        section: entry.section,
        category: String(item.category || entry.section || 'Pricing'),
        label: getLineLabel?.(entry.section, item) || item.description || item.category || 'Pricing item',
        amount,
        cogsAmount: amount,
        retailAmount: amount,
        effect,
        approximate: effect === 'automatic',
      },
    ];
  });
};

const calculateWithSnapshot = (
  proposal: Proposal,
  pricingSnapshot: PricingData | undefined,
  calculateProposal: (proposal: Proposal) => CompletePricingCalculation
): CompletePricingCalculation =>
  pricingSnapshot
    ? withTemporaryPricingSnapshot(pricingSnapshot, () => calculateProposal(proposal))
    : calculateProposal(proposal);

const unavailableResult = (
  controlLabel: string,
  comparisonLabel: string,
  message: string,
  displayBasis: PriceImpactDisplayBasis = 'retail'
): PriceImpactResult => ({
  status: 'unavailable',
  displayBasis,
  controlLabel,
  comparisonLabel,
  directCharges: [],
  automaticEffects: [],
  overheadAmount: 0,
  customerPriceChange: 0,
  costChangeBeforeOverhead: 0,
  totalCogsChange: 0,
  overheadCogsAmount: 0,
  overheadRetailAmount: 0,
  retailMultiplier: 1,
  retailOnlyAdjustmentChange: 0,
  reconciliationDifference: 0,
  calculationDurationMs: 0,
  message,
});

export function calculatePriceImpact({
  currentProposal,
  comparisonProposal,
  controlLabel,
  comparisonLabel,
  directSections,
  displayBasis = 'retail',
  currentCalculation,
  pricingSnapshot,
  calculateProposal = (proposal) =>
    MasterPricingEngine.calculateCompleteProposal(proposal, proposal.papDiscounts),
  getLineLabel,
  retailAdjustmentLabel = 'Retail-Only Adjustment',
}: PriceImpactComparisonOptions): PriceImpactResult {
  const startedAt = now();
  const current =
    currentCalculation ||
    calculateWithSnapshot(currentProposal, pricingSnapshot, calculateProposal);
  const comparison = calculateWithSnapshot(
    comparisonProposal,
    pricingSnapshot,
    calculateProposal
  );
  const cogsLines = compareCostBreakdowns(
    current.costBreakdown,
    comparison.costBreakdown,
    directSections,
    getLineLabel
  );
  const lineItemChange = roundCurrency(
    cogsLines.reduce((sum, line) => sum + line.cogsAmount, 0)
  );
  const costChangeBeforeOverhead = roundCurrency(
    current.pricing.totalCostsBeforeOverhead - comparison.pricing.totalCostsBeforeOverhead
  );
  const totalCogsChange = roundCurrency(
    current.pricing.totalCOGS - comparison.pricing.totalCOGS
  );
  const overheadCogsAmount = roundCurrency(totalCogsChange - costChangeBeforeOverhead);
  const exactRetailPriceChange = roundCurrency(
    current.pricing.retailPrice - comparison.pricing.retailPrice
  );
  const targetMargin = Number(current.pricing.targetMargin);
  const retailMultiplier = targetMargin > 0 ? 1 / targetMargin : 1;
  const overheadRetailAmount = roundCurrency(overheadCogsAmount * retailMultiplier);
  const retailOnlyAdjustmentChange = roundCurrency(
    ((current.pricing.manualAdjustmentsTotal ?? 0) -
      (comparison.pricing.manualAdjustmentsTotal ?? 0)) +
      ((current.pricing.discountAmount ?? 0) - (comparison.pricing.discountAmount ?? 0))
  );
  const lines = cogsLines.map((line) => {
    const retailAmount = roundCurrency(line.cogsAmount * retailMultiplier);
    return {
      ...line,
      retailAmount,
      amount: displayBasis === 'retail' ? retailAmount : line.cogsAmount,
    };
  });
  if (displayBasis === 'retail' && Math.abs(retailOnlyAdjustmentChange) >= CURRENCY_EPSILON) {
    lines.push({
      key: 'pricing::retail-only-adjustment',
      section: 'retailAdjustments',
      category: 'Pricing',
      label: retailAdjustmentLabel,
      amount: retailOnlyAdjustmentChange,
      cogsAmount: 0,
      retailAmount: retailOnlyAdjustmentChange,
      effect: 'direct',
      approximate: false,
    });
  }
  const overheadAmount =
    displayBasis === 'retail' ? overheadRetailAmount : overheadCogsAmount;
  const customerPriceChange =
    displayBasis === 'retail' ? exactRetailPriceChange : totalCogsChange;
  const reconciliationDifference = roundCurrency(
    costChangeBeforeOverhead - lineItemChange
  );
  const calculationDurationMs = Math.max(0, now() - startedAt);

  if (
    !Number.isFinite(customerPriceChange) ||
    !Number.isFinite(costChangeBeforeOverhead) ||
    Math.abs(reconciliationDifference) >= RECONCILIATION_TOLERANCE
  ) {
    return {
      ...unavailableResult(
        controlLabel,
        comparisonLabel,
        'The complete price impact could not be reconciled with this proposal version.',
        displayBasis
      ),
      reconciliationDifference,
      calculationDurationMs,
    };
  }

  return {
    status: 'available',
    displayBasis,
    controlLabel,
    comparisonLabel,
    directCharges: lines.filter((line) => line.effect === 'direct'),
    automaticEffects: lines.filter((line) => line.effect === 'automatic'),
    overheadAmount,
    customerPriceChange,
    costChangeBeforeOverhead,
    totalCogsChange,
    overheadCogsAmount,
    overheadRetailAmount,
    retailMultiplier,
    retailOnlyAdjustmentChange,
    reconciliationDifference,
    calculationDurationMs,
  };
}

type EquipmentComparisonBuild = {
  controlLabel: string;
  comparisonLabel: string;
  comparisonProposal: Proposal | null;
  message?: string;
  retailAdjustmentLabel?: string;
};

type IncludedPackageSelection = {
  packageName: string;
  selectionName: string;
};

const zeroSelection = (name: string) => ({
  name,
  basePrice: 0,
  addCost1: 0,
  addCost2: 0,
  price: 0,
});

const hasSelection = (name?: string, emptyPhrase = 'no '): boolean => {
  const normalized = String(name || '').trim().toLowerCase();
  return Boolean(normalized) && !normalized.includes(emptyPhrase);
};

const getEquipmentSnapshot = (snapshot?: PricingData): PricingData => snapshot || pricingData;

const getIncludedPackageSelection = (
  proposal: Proposal,
  target: EquipmentPriceImpactTarget
): IncludedPackageSelection | null => {
  const equipment = proposal.equipment;
  const selectedPackage = getSelectedEquipmentPackage(equipment);
  if (!selectedPackage || !isFixedEquipmentPackage(selectedPackage)) return null;

  const included = (quantity?: number) => Math.max(Number(quantity) || 0, 0) > 0;
  let selectionName: string | undefined;

  switch (target.kind) {
    case 'mainPump':
      if (included(selectedPackage.includedPumpQuantity)) {
        selectionName = selectedPackage.includedPumpName || equipment.pump?.name || 'Pump';
      }
      break;
    case 'mainFilter':
      if (included(selectedPackage.includedFilterQuantity)) {
        selectionName = selectedPackage.includedFilterName || equipment.filter?.name || 'Filter';
      }
      break;
    case 'cleaner':
      if (included(selectedPackage.includedCleanerQuantity)) {
        selectionName = selectedPackage.includedCleanerName || equipment.cleaner?.name || 'Cleaner';
      }
      break;
    case 'mainHeater':
      if (included(selectedPackage.includedHeaterQuantity)) {
        selectionName = selectedPackage.includedHeaterName || equipment.heater?.name || 'Heater';
      }
      break;
    case 'poolLight':
      if (target.index < Math.max(Number(selectedPackage.includedPoolLightQuantity) || 0, 0)) {
        selectionName =
          selectedPackage.includedPoolLightName || equipment.poolLights?.[target.index]?.name || 'Pool Light';
      }
      break;
    case 'spaLight':
      if (target.index < Math.max(Number(selectedPackage.includedSpaLightQuantity) || 0, 0)) {
        selectionName =
          selectedPackage.includedSpaLightName || equipment.spaLights?.[target.index]?.name || 'Spa Light';
      }
      break;
    case 'automation':
      if (included(selectedPackage.includedAutomationQuantity)) {
        selectionName = selectedPackage.includedAutomationName || equipment.automation?.name || 'Automation';
      }
      break;
    case 'sanitation':
      if (included(selectedPackage.includedSaltSystemQuantity)) {
        selectionName =
          selectedPackage.includedSaltSystemName || equipment.saltSystem?.name || 'Sanitation System';
      }
      break;
    case 'additionalSanitation':
      if (included(selectedPackage.includedSanitationAccessoryQuantity)) {
        selectionName =
          selectedPackage.includedSanitationAccessoryName ||
          equipment.sanitationAccessory?.name ||
          'Additional Sanitation Option';
      }
      break;
    case 'autoFill':
      if (included(selectedPackage.includedAutoFillSystemQuantity)) {
        selectionName =
          selectedPackage.includedAutoFillSystemName || equipment.autoFillSystem?.name || 'Auto-fill System';
      }
      break;
    default:
      break;
  }

  return selectionName
    ? { packageName: selectedPackage.name, selectionName }
    : null;
};

export const getEquipmentPriceImpactTargetKey = (
  target: EquipmentPriceImpactTarget
): string => `${target.kind}${'index' in target ? `:${target.index}` : ''}`;

const withPricingSnapshot = <T,>(snapshot: PricingData | undefined, callback: () => T): T =>
  snapshot ? withTemporaryPricingSnapshot(snapshot, callback) : callback();

const buildEquipmentComparison = (
  proposal: Proposal,
  target: EquipmentPriceImpactTarget,
  snapshot?: PricingData
): EquipmentComparisonBuild => {
  const equipment = proposal.equipment;
  const sourcePricing = getEquipmentSnapshot(snapshot);
  const comparison = cloneProposal(proposal);
  const nextEquipment = comparison.equipment;
  const noComparison = (
    controlLabel: string,
    comparisonLabel: string,
    message: string
  ): EquipmentComparisonBuild => ({
    controlLabel,
    comparisonLabel,
    comparisonProposal: null,
    message,
  });
  const finish = (
    controlLabel: string,
    comparisonLabel: string,
    options?: { retailAdjustmentLabel?: string; sanitize?: boolean }
  ): EquipmentComparisonBuild => ({
    controlLabel,
    comparisonLabel,
    comparisonProposal:
      options?.sanitize === false
        ? comparison
        : sanitizeProposalSelectionState(comparison),
    retailAdjustmentLabel: options?.retailAdjustmentLabel,
  });

  switch (target.kind) {
    case 'mainPump': {
      const controlLabel = 'Main Pump';
      const comparisonLabel = 'Compared with no main pump';
      if (!hasSelection(equipment.pump?.name, 'no pump') || (equipment.pumpQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'A main pump is not selected.');
      }
      nextEquipment.pump = zeroSelection('No Pump (Price Impact comparison)');
      nextEquipment.pumpQuantity = 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'additionalPump': {
      const controlLabel = `Additional Pump ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      const pumps = getAdditionalPumpSelections(equipment);
      const selected = pumps[target.index];
      if (!selected) {
        return noComparison(controlLabel, comparisonLabel, 'This additional pump is not selected.');
      }
      nextEquipment.additionalPumps = getAdditionalPumpSelections(nextEquipment).filter(
        (_, index) => index !== target.index
      );
      return finish(controlLabel, comparisonLabel, {
        sanitize: !selected.autoAddedReason,
      });
    }
    case 'blower': {
      const controlLabel = `Blower ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      const blowers = equipment.auxiliaryPumps?.length
        ? equipment.auxiliaryPumps
        : equipment.auxiliaryPump
          ? [equipment.auxiliaryPump]
          : [];
      const selected = blowers[target.index];
      if (!selected) return noComparison(controlLabel, comparisonLabel, 'This blower is not selected.');
      const remaining = blowers.filter((_, index) => index !== target.index);
      nextEquipment.auxiliaryPumps = remaining;
      nextEquipment.auxiliaryPump = remaining[0];
      return finish(controlLabel, comparisonLabel, {
        sanitize: !(selected.autoAddedForSpa || selected.autoAddedReason),
      });
    }
    case 'mainFilter': {
      const controlLabel = 'Main Filter';
      const comparisonLabel = 'Compared with no main filter';
      if (!hasSelection(equipment.filter?.name, 'no filter') || (equipment.filterQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'A main filter is not selected.');
      }
      nextEquipment.filter = zeroSelection('No Filter (Price Impact comparison)');
      nextEquipment.filterQuantity = 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'additionalFilter': {
      const controlLabel = `Additional Filter ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      if (!equipment.additionalFilters?.[target.index]) {
        return noComparison(controlLabel, comparisonLabel, 'This additional filter is not selected.');
      }
      nextEquipment.additionalFilters = (nextEquipment.additionalFilters || []).filter(
        (_, index) => index !== target.index
      );
      return finish(controlLabel, comparisonLabel);
    }
    case 'cleaner': {
      const controlLabel = 'Cleaner';
      const comparisonLabel = 'Compared with no cleaner';
      if (!hasSelection(equipment.cleaner?.name, 'no cleaner') || (equipment.cleanerQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'A cleaner is not selected.');
      }
      nextEquipment.cleaner = zeroSelection('No Cleaner (Price Impact comparison)');
      nextEquipment.cleanerQuantity = 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'mainHeater': {
      const controlLabel = 'Main Heater';
      const comparisonLabel = 'Compared with no heater';
      if (!hasSelection(equipment.heater?.name, 'no heater') || (equipment.heaterQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'A main heater is not selected.');
      }
      const heaterWasAutomaticallyAdded = Boolean(
        equipment.heater.autoAddedForSpa || equipment.heater.autoAddedReason
      );
      if (heaterWasAutomaticallyAdded) {
        nextEquipment.heater = zeroSelection('No Heater (Price Impact comparison)');
        nextEquipment.heaterQuantity = 0;
        return finish(controlLabel, comparisonLabel, { sanitize: false });
      }
      const heaterIsRequired = proposal.poolSpecs?.spaType !== 'none';
      if (heaterIsRequired) {
        const baseHeater = ((sourcePricing as any).equipment?.heaters || []).find(
          (heater: any) => hasSelection(heater?.name, 'no heater')
        );
        if (!baseHeater) {
          return noComparison(
            controlLabel,
            'Compared with the configured base heater',
            'A valid base heater is not configured for this spa selection.'
          );
        }
        nextEquipment.heater = {
          ...baseHeater,
          autoAddedForSpa: true,
          autoAddedReason: 'spa',
        };
        nextEquipment.heaterQuantity = 1;
        return finish(controlLabel, 'Compared with the configured base heater');
      }
      nextEquipment.heater = zeroSelection('No Heater (Price Impact comparison)');
      nextEquipment.heaterQuantity = 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'additionalHeater': {
      const controlLabel = `Additional Heater ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      if (!equipment.additionalHeaters?.[target.index]) {
        return noComparison(controlLabel, comparisonLabel, 'This additional heater is not selected.');
      }
      nextEquipment.additionalHeaters = (nextEquipment.additionalHeaters || []).filter(
        (_, index) => index !== target.index
      );
      return finish(controlLabel, comparisonLabel);
    }
    case 'heaterChiller': {
      const controlLabel = 'Heater Chiller';
      const comparisonLabel = 'Compared with no heater chiller';
      if (!equipment.heaterChiller || (equipment.heaterChillerQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'A heater chiller is not selected.');
      }
      nextEquipment.heaterChiller = undefined;
      nextEquipment.heaterChillerQuantity = 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'poolLight': {
      const controlLabel = target.index === 0 ? 'Pool Light 1' : `Additional Pool Light ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      if (!equipment.poolLights?.[target.index]) {
        return noComparison(controlLabel, comparisonLabel, 'This pool light is not selected.');
      }
      const remaining = (nextEquipment.poolLights || []).filter((_, index) => index !== target.index);
      const remainingLightCount = remaining.length + (nextEquipment.spaLights?.length ?? 0);
      const preserveIncludedElectricalSlot = target.index === 0 && remainingLightCount > 0;
      nextEquipment.poolLights = preserveIncludedElectricalSlot
        ? [
            {
              type: 'pool',
              ...zeroSelection('Pool Light (Price Impact electrical allocation)'),
            },
            ...remaining,
          ]
        : remaining;
      nextEquipment.includePoolLights = nextEquipment.poolLights.length > 0;
      nextEquipment.numberOfLights = Math.max(nextEquipment.poolLights.length - 1, 0);
      nextEquipment.applyCustomPackageDefaultPoolLights = false;
      return finish(controlLabel, comparisonLabel);
    }
    case 'spaLight': {
      const controlLabel = target.index === 0 ? 'Spa Light 1' : `Additional Spa Light ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      if (!equipment.spaLights?.[target.index]) {
        return noComparison(controlLabel, comparisonLabel, 'This spa light is not selected.');
      }
      const remaining = (nextEquipment.spaLights || []).filter((_, index) => index !== target.index);
      const poolLightCount = nextEquipment.poolLights?.length ?? 0;
      const preserveIncludedElectricalSlot =
        poolLightCount === 0 && target.index === 0 && remaining.length > 0;
      nextEquipment.spaLights = preserveIncludedElectricalSlot
        ? [
            {
              type: 'spa',
              ...zeroSelection('Spa Light (Price Impact electrical allocation)'),
            },
            ...remaining,
          ]
        : remaining;
      nextEquipment.includeSpaLights = nextEquipment.spaLights.length > 0;
      nextEquipment.hasSpaLight = nextEquipment.spaLights.length > 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'automation': {
      const controlLabel = 'Automation System';
      const comparisonLabel = 'Compared with no automation system';
      if (!hasSelection(equipment.automation?.name, 'no automation') || (equipment.automationQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'An automation system is not selected.');
      }
      nextEquipment.automation = {
        ...zeroSelection('No Automation (Price Impact comparison)'),
        zones: 0,
        includesSaltCell: false,
      };
      nextEquipment.automationQuantity = 0;
      if (nextEquipment.saltSystem?.includedSaltCellPlaceholder) {
        nextEquipment.saltSystem = undefined;
        nextEquipment.saltSystemQuantity = 0;
        nextEquipment.additionalSaltSystem = undefined;
        nextEquipment.sanitationAccessory = undefined;
        nextEquipment.sanitationAccessoryQuantity = 0;
      }
      return finish(controlLabel, comparisonLabel);
    }
    case 'sanitation': {
      const controlLabel = 'Sanitation System';
      const selected = equipment.saltSystem;
      if (!selected || !hasSelection(selected.name, 'no salt')) {
        return noComparison(controlLabel, 'Compared with no sanitation system', 'A sanitation system is not selected.');
      }
      const includedPackageSelection = getIncludedPackageSelection(proposal, target);
      if (selected.includedSaltCellPlaceholder && !includedPackageSelection) {
        return noComparison(
          controlLabel,
          'Compared with the included sanitation system',
          'This sanitation system is included by the selected automation or equipment package.'
        );
      }
      if (includedPackageSelection) {
        nextEquipment.saltSystem = undefined;
        nextEquipment.saltSystemQuantity = 0;
        return finish(controlLabel, 'Compared with this included selection omitted from the package contents');
      }
      const automationIsActive =
        hasSelection(equipment.automation?.name, 'no automation') &&
        (equipment.automationQuantity ?? 0) > 0;
      if (automationIsActive) {
        if (equipment.automation?.includesSaltCell) {
          nextEquipment.saltSystem = buildIncludedSaltCellOption();
          nextEquipment.saltSystemQuantity = 0;
          return finish(controlLabel, 'Compared with the automation-included salt cell');
        }
        const baseSystem = ((sourcePricing as any).equipment?.saltSystem || []).find(
          (system: any) =>
            hasSelection(system?.name, 'no salt') &&
            !system?.excludedFromSaltCell &&
            !system?.includedSaltCellPlaceholder
        );
        if (!baseSystem) {
          return noComparison(
            controlLabel,
            'Compared with the configured base sanitation system',
            'A valid base sanitation system is not configured for this automation selection.'
          );
        }
        nextEquipment.saltSystem = { ...baseSystem };
        nextEquipment.saltSystemQuantity = 1;
        return finish(controlLabel, 'Compared with the configured base sanitation system');
      }
      nextEquipment.saltSystem = undefined;
      nextEquipment.saltSystemQuantity = 0;
      nextEquipment.additionalSaltSystem = undefined;
      nextEquipment.sanitationAccessory = undefined;
      nextEquipment.sanitationAccessoryQuantity = 0;
      return finish(controlLabel, 'Compared with no sanitation system');
    }
    case 'additionalSanitation': {
      const controlLabel = 'Additional Sanitation Option';
      const comparisonLabel = 'Compared with no additional sanitation option';
      if (!equipment.additionalSaltSystem && !equipment.sanitationAccessory) {
        return noComparison(controlLabel, comparisonLabel, 'An additional sanitation option is not selected.');
      }
      nextEquipment.additionalSaltSystem = undefined;
      nextEquipment.sanitationAccessory = undefined;
      nextEquipment.sanitationAccessoryQuantity = 0;
      return finish(controlLabel, comparisonLabel);
    }
    case 'autoFill': {
      const controlLabel = 'Auto-fill System';
      const comparisonLabel = 'Compared with no auto-fill system';
      if (!equipment.autoFillSystem || (equipment.autoFillSystemQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'An auto-fill system is not selected.');
      }
      nextEquipment.autoFillSystem = undefined;
      nextEquipment.autoFillSystemQuantity = 0;
      nextEquipment.hasAutoFill = false;
      return finish(controlLabel, comparisonLabel);
    }
    case 'customOption': {
      const selected = equipment.customOptions?.[target.index];
      const controlLabel = selected?.name?.trim() || `Equipment Custom Option ${target.index + 1}`;
      const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
      if (!selected) return noComparison(controlLabel, comparisonLabel, 'This custom option is not selected.');
      nextEquipment.customOptions = (nextEquipment.customOptions || []).filter(
        (_, index) => index !== target.index
      );
      return finish(controlLabel, comparisonLabel, {
        retailAdjustmentLabel: selected.isOffContract
          ? 'Off-Contract Retail Price'
          : undefined,
      });
    }
  }
};

export const getEquipmentPriceImpactLineLabel = (
  target: EquipmentPriceImpactTarget,
  section: string,
  item: CostLineItem
): string => {
  // Generated Price Impact charge labels use clean Title Case and natural spacing.
  // Preserve punctuation only when it belongs to an established term or product name.
  const description = String(item.description || '').trim();
  if (description === 'Equipment Tax') return 'Equipment Tax';
  if (section === 'equipmentSet' && /add(?:itional|['’]l) pump/i.test(description)) {
    return 'Additional Pump Setup';
  }
  if (section === 'equipmentSet' && description === 'Base Equipment Set') {
    return 'Base Equipment Setup';
  }
  if (section === 'equipmentSet' && description === 'Heater') return 'Heater Equipment Set';
  if (section === 'equipmentSet' && description === 'Heat Pump Set') return 'Heat Pump Setup';
  if (section === 'plumbing' && description === 'Heater Set') return 'Plumbing Heater Set';
  if (section === 'electrical' && description === 'Lights') return 'Additional Light Electrical';
  if (section === 'electrical' && description === 'Heater') return 'Heater Electrical';
  if (section === 'electrical' && description === 'Automation') return 'Automation Electrical';
  if (section === 'electrical' && description === 'Additional Sanitation System') {
    return 'Additional Sanitation Electrical';
  }
  if (section === 'electrical' && description === 'Auto-Fill Run') {
    return 'Auto-Fill Electrical Run';
  }
  if (section === 'startupOrientation' && description === 'Add Automation') {
    return 'Automation Start-Up / Orientation';
  }
  if (
    target.kind === 'additionalPump' &&
    section === 'equipmentOrdered' &&
    /^additional pump\b/i.test(description)
  ) {
    return 'Pump Equipment';
  }
  if (section === 'plumbing' && description === '2.5" Plumbing') {
    return target.kind === 'additionalPump'
      ? 'Second Main Drain Plumbing Run'
      : 'Main Drain Plumbing Runs';
  }
  if (section === 'plumbing' && /add(?:itional|['’]l) main drain/i.test(description)) {
    return 'Additional Main Drain';
  }
  if (section === 'interiorFinish' && description.startsWith('Fittings')) {
    return 'Interior Finish Fittings';
  }
  return description || item.category || 'Pricing Item';
};

export function buildEquipmentPriceImpactComparisonProposal(
  proposal: Proposal,
  target: EquipmentPriceImpactTarget,
  pricingSnapshot?: PricingData
): Proposal | null {
  return withPricingSnapshot(
    pricingSnapshot,
    () => buildEquipmentComparison(proposal, target, pricingSnapshot).comparisonProposal
  );
}

export function calculateEquipmentPriceImpact({
  proposal,
  target,
  displayBasis = 'retail',
  currentCalculation,
  pricingSnapshot,
  calculateProposal,
}: EquipmentPriceImpactOptions): PriceImpactResult {
  const includedPackageSelection = withPricingSnapshot(
    pricingSnapshot,
    () => getIncludedPackageSelection(proposal, target)
  );
  const built = withPricingSnapshot(
    pricingSnapshot,
    () => buildEquipmentComparison(proposal, target, pricingSnapshot)
  );
  if (!built.comparisonProposal) {
    return unavailableResult(
      built.controlLabel,
      built.comparisonLabel,
      built.message || 'A valid comparison could not be created for this equipment selection.',
      displayBasis
    );
  }

  const result = calculatePriceImpact({
    currentProposal: proposal,
    comparisonProposal: built.comparisonProposal,
    controlLabel: built.controlLabel,
    comparisonLabel: built.comparisonLabel,
    directSections: EQUIPMENT_DIRECT_SECTIONS,
    displayBasis,
    currentCalculation,
    pricingSnapshot,
    calculateProposal,
    getLineLabel: (section, item) => getEquipmentPriceImpactLineLabel(target, section, item),
    retailAdjustmentLabel: built.retailAdjustmentLabel,
  });

  const hasSpaAndHeater =
    (proposal.poolSpecs?.spaType ?? 'none') !== 'none' &&
    hasSelection(proposal.equipment?.heater?.name, 'no heater') &&
    Math.max(proposal.equipment?.heaterQuantity ?? 0, 0) > 0;
  const displayResult = result.status === 'available' && hasSpaAndHeater
    ? {
        ...result,
        automaticEffects: result.automaticEffects.filter(
          (line) => !(
            line.section === 'plumbing' &&
            line.label === 'Plumbing Heater Set' &&
            line.amount < 0
          )
        ),
      }
    : result;

  if (displayResult.status !== 'available' || !includedPackageSelection) return displayResult;

  return {
    ...displayResult,
    comparisonLabel: `Compared with this included selection omitted while ${includedPackageSelection.packageName} remains selected`,
    directCharges: [
      {
        key: `package-included::${getEquipmentPriceImpactTargetKey(target)}`,
        section: 'equipmentOrdered',
        category: 'Equipment Package',
        label: `${includedPackageSelection.selectionName} — included in ${includedPackageSelection.packageName}`,
        amount: 0,
        cogsAmount: 0,
        retailAmount: 0,
        effect: 'direct',
        approximate: false,
      },
      ...displayResult.directCharges,
    ],
  };
}

type PlumbingComparisonBuild = {
  controlLabel: string;
  comparisonLabel: string;
  comparisonProposal: Proposal | null;
  message?: string;
  retailAdjustmentLabel?: string;
};

const PLUMBING_RUN_METADATA: Record<
  PlumbingPriceImpactRunField,
  { controlLabel: string; unit: 'LNFT' | 'ea' }
> = {
  skimmerRun: { controlLabel: 'Total Skimmer Run', unit: 'LNFT' },
  mainDrainRun: { controlLabel: 'Main Drain Run', unit: 'LNFT' },
  spaRun: { controlLabel: 'Spa Run', unit: 'LNFT' },
  additionalSkimmers: { controlLabel: 'Extra Skimmers', unit: 'ea' },
  cleanerRun: { controlLabel: 'Cleaner Run', unit: 'LNFT' },
  autoFillRun: { controlLabel: 'Auto-fill Plumbing Run', unit: 'LNFT' },
  autoFillElectricRun: { controlLabel: 'Auto-fill Conduit Run', unit: 'LNFT' },
  waterFeature1Run: { controlLabel: 'Water Feature Run 1', unit: 'LNFT' },
  waterFeature2Run: { controlLabel: 'Water Feature Run 2', unit: 'LNFT' },
  waterFeature3Run: { controlLabel: 'Water Feature Run 3', unit: 'LNFT' },
  waterFeature4Run: { controlLabel: 'Water Feature Run 4', unit: 'LNFT' },
  infloorValveToEQ: { controlLabel: 'In-floor Valve to Equipment Run', unit: 'LNFT' },
  infloorValveToPool: { controlLabel: 'In-floor Valve to Pool Run', unit: 'LNFT' },
  gasRun: { controlLabel: 'Gas Run', unit: 'LNFT' },
};

export const getPlumbingPriceImpactTargetKey = (
  target: PlumbingPriceImpactTarget
): string => target.kind === 'run' ? `run:${target.field}` : `customOption:${target.index}`;

const getPlumbingDirectSections = (
  target: PlumbingPriceImpactTarget
): ReadonlySet<string> => {
  if (target.kind === 'run' && target.field === 'gasRun') return GAS_DIRECT_SECTIONS;
  if (target.kind === 'run' && target.field === 'autoFillElectricRun') {
    return ELECTRICAL_DIRECT_SECTIONS;
  }
  return PLUMBING_DIRECT_SECTIONS;
};

const buildPlumbingComparison = (
  proposal: Proposal,
  target: PlumbingPriceImpactTarget
): PlumbingComparisonBuild => {
  const comparison = cloneProposal(proposal);

  if (target.kind === 'run') {
    const metadata = PLUMBING_RUN_METADATA[target.field];
    const currentValue = Math.max(Number(proposal.plumbing?.runs?.[target.field]) || 0, 0);
    const comparisonLabel = metadata.unit === 'ea'
      ? `Current ${currentValue} compared with no additional units`
      : `Current ${currentValue} ${metadata.unit} compared with 0 ${metadata.unit}`;
    if (currentValue <= 0) {
      return {
        controlLabel: metadata.controlLabel,
        comparisonLabel,
        comparisonProposal: null,
        message: `${metadata.controlLabel} does not currently have a billable value.`,
      };
    }

    comparison.plumbing = {
      ...comparison.plumbing,
      runs: {
        ...comparison.plumbing.runs,
        [target.field]: 0,
      } as PlumbingRuns,
    };
    return {
      controlLabel: metadata.controlLabel,
      comparisonLabel,
      comparisonProposal: comparison,
    };
  }

  const selected = proposal.plumbing?.customOptions?.[target.index];
  const controlLabel = selected?.name?.trim() || `Plumbing Custom Option ${target.index + 1}`;
  const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
  if (!selected) {
    return {
      controlLabel,
      comparisonLabel,
      comparisonProposal: null,
      message: 'This plumbing custom option is not selected.',
    };
  }

  comparison.plumbing = {
    ...comparison.plumbing,
    customOptions: (comparison.plumbing.customOptions || []).filter(
      (_, index) => index !== target.index
    ),
  };
  return {
    controlLabel,
    comparisonLabel,
    comparisonProposal: comparison,
    retailAdjustmentLabel: selected.isOffContract
      ? 'Off-Contract Retail Price'
      : undefined,
  };
};

const getPlumbingLineLabel = (
  target: PlumbingPriceImpactTarget,
  section: string,
  item: CostLineItem
): string => {
  const description = String(item.description || '').trim();
  if (description === 'PAP Discount') return 'Plumbing Discount';
  if (description.startsWith('Fiberglass Plumbing Multiplier')) {
    return 'Fiberglass Plumbing Adjustment';
  }
  if (description === 'Pool Overrun') return 'Skimmer Run Overage';
  if (description === 'Spa Base') return 'Spa Base Plumbing';
  if (description === 'Spa Overrun') return 'Spa Run Overage';
  if (description === 'Additional Skimmers') return 'Additional Skimmers';
  if (description === 'Cleaner Line') return 'Cleaner Line';
  if (description === 'Auto-Fill') return 'Auto-Fill Plumbing Run';
  if (description === 'Auto-Fill Run') return 'Auto-Fill Electrical/Conduit Run';
  if (description === 'Additional Water Feature Run') return 'Linked Water Feature Plumbing';
  if (description === 'Water Feature Conduit Run') return 'Water Feature Conduit Run';
  if (description === 'Infloor Plumbing') return 'In-Floor Plumbing';
  if (description === 'Base Gas Set') return 'Base Gas Setup';
  if (description === 'Gas Overrun') return 'Gas Run Overage';
  if (description === '3.0" Plumbing') return 'Long Gas Run Plumbing';
  if (description === '2.5" Plumbing' && target.kind === 'run' && target.field === 'mainDrainRun') {
    return '2.5" Plumbing';
  }
  if (description === '2.0" Plumbing' && target.kind === 'run') {
    if (target.field === 'skimmerRun') return '2" Plumbing';
    if (target.field === 'cleanerRun') return 'Cleaner Run 2" Plumbing';
    if (target.field === 'infloorValveToEQ' || target.field === 'infloorValveToPool') {
      return 'In-Floor 2" Plumbing';
    }
  }
  if (/^Water Feature \d+$/i.test(description)) {
    return `${description} Setup and Overage`;
  }
  if (section === 'plumbing' && target.kind === 'customOption') {
    return description || item.category || 'Plumbing Custom Option';
  }
  return description || item.category || 'Pricing Item';
};

export function buildPlumbingPriceImpactComparisonProposal(
  proposal: Proposal,
  target: PlumbingPriceImpactTarget,
  pricingSnapshot?: PricingData
): Proposal | null {
  return withPricingSnapshot(
    pricingSnapshot,
    () => buildPlumbingComparison(proposal, target).comparisonProposal
  );
}

export function calculatePlumbingPriceImpact({
  proposal,
  target,
  displayBasis = 'retail',
  currentCalculation,
  pricingSnapshot,
  calculateProposal,
}: PlumbingPriceImpactOptions): PriceImpactResult {
  const built = withPricingSnapshot(
    pricingSnapshot,
    () => buildPlumbingComparison(proposal, target)
  );
  if (!built.comparisonProposal) {
    return unavailableResult(
      built.controlLabel,
      built.comparisonLabel,
      built.message || 'A valid comparison could not be created for this plumbing selection.',
      displayBasis
    );
  }

  const calculate = calculateProposal || ((input: Proposal) =>
    MasterPricingEngine.calculateCompleteProposal(input, input.papDiscounts));
  const resolvedCurrentCalculation = currentCalculation || calculateWithSnapshot(
    proposal,
    pricingSnapshot,
    calculate
  );
  const result = calculatePriceImpact({
    currentProposal: proposal,
    comparisonProposal: built.comparisonProposal,
    controlLabel: built.controlLabel,
    comparisonLabel: built.comparisonLabel,
    directSections: getPlumbingDirectSections(target),
    displayBasis,
    currentCalculation: resolvedCurrentCalculation,
    pricingSnapshot,
    calculateProposal: calculate,
    getLineLabel: (section, item) => getPlumbingLineLabel(target, section, item),
    retailAdjustmentLabel: built.retailAdjustmentLabel,
  });
  if (result.status !== 'available') return result;

  const configuredSpaAllowance = Number(
    (pricingSnapshot || pricingData).plumbing?.spaOverrunThreshold
  );
  if (
    target.kind !== 'run' ||
    target.field !== 'spaRun' ||
    !Number.isFinite(configuredSpaAllowance)
  ) {
    return result;
  }

  const allowanceNote = `Up to ${configuredSpaAllowance} LNFT Included`;
  const hasSpaOverageLine = result.directCharges.some(
    (line) => line.label === 'Spa Run Overage'
  );
  const directCharges = hasSpaOverageLine
    ? result.directCharges.map((line) =>
        line.label === 'Spa Run Overage' ? { ...line, note: allowanceNote } : line
      )
    : [
        ...result.directCharges,
        {
          key: 'plumbing::spa-run-overage::included-allowance',
          section: 'plumbing',
          category: 'Plumbing',
          label: 'Spa Run Overage',
          note: allowanceNote,
          amount: 0,
          cogsAmount: 0,
          retailAmount: 0,
          effect: 'direct' as const,
          approximate: false,
        },
      ];

  return {
    ...result,
    directCharges,
  };
}

type ElectricalComparisonBuild = {
  controlLabel: string;
  comparisonLabel: string;
  comparisonProposal: Proposal | null;
  message?: string;
  retailAdjustmentLabel?: string;
};

const ELECTRICAL_RUN_METADATA: Record<
  ElectricalPriceImpactRunField,
  { controlLabel: string }
> = {
  gasRun: { controlLabel: 'Gas Run' },
  electricalRun: { controlLabel: 'Main Electrical Run' },
  lightRun: { controlLabel: 'Light Run' },
  heatPumpElectricalRun: { controlLabel: 'Heat Pump Electrical Run' },
};

export const getElectricalPriceImpactTargetKey = (
  target: ElectricalPriceImpactTarget
): string => target.kind === 'run' ? `run:${target.field}` : `customOption:${target.index}`;

const getElectricalDirectSections = (
  target: ElectricalPriceImpactTarget
): ReadonlySet<string> =>
  target.kind === 'run' && target.field === 'gasRun'
    ? GAS_DIRECT_SECTIONS
    : ELECTRICAL_DIRECT_SECTIONS;

const buildElectricalComparison = (
  proposal: Proposal,
  target: ElectricalPriceImpactTarget
): ElectricalComparisonBuild => {
  const comparison = cloneProposal(proposal);

  if (target.kind === 'run') {
    const metadata = ELECTRICAL_RUN_METADATA[target.field];
    const currentValue = Math.max(
      Number(
        target.field === 'gasRun'
          ? proposal.plumbing?.runs?.gasRun
          : proposal.electrical?.runs?.[target.field]
      ) || 0,
      0
    );
    const comparisonLabel = `Current ${currentValue} LNFT compared with 0 LNFT`;
    if (currentValue <= 0) {
      return {
        controlLabel: metadata.controlLabel,
        comparisonLabel,
        comparisonProposal: null,
        message: `${metadata.controlLabel} does not currently have a billable value.`,
      };
    }

    if (target.field === 'gasRun') {
      comparison.plumbing = {
        ...comparison.plumbing,
        runs: {
          ...comparison.plumbing.runs,
          gasRun: 0,
        },
      };
    } else {
      comparison.electrical = {
        ...comparison.electrical,
        runs: {
          ...comparison.electrical.runs,
          [target.field]: 0,
        },
      };
    }

    return {
      controlLabel: metadata.controlLabel,
      comparisonLabel,
      comparisonProposal: comparison,
    };
  }

  const selected = proposal.electrical?.customOptions?.[target.index];
  const controlLabel = selected?.name?.trim() || `Electrical Custom Option ${target.index + 1}`;
  const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
  if (!selected) {
    return {
      controlLabel,
      comparisonLabel,
      comparisonProposal: null,
      message: 'This electrical custom option is not selected.',
    };
  }

  comparison.electrical = {
    ...comparison.electrical,
    customOptions: (comparison.electrical.customOptions || []).filter(
      (_, index) => index !== target.index
    ),
  };
  return {
    controlLabel,
    comparisonLabel,
    comparisonProposal: comparison,
    retailAdjustmentLabel: selected.isOffContract
      ? 'Off-Contract Retail Price'
      : undefined,
  };
};

const getElectricalLineLabel = (
  target: ElectricalPriceImpactTarget,
  section: string,
  item: CostLineItem
): string => {
  const description = String(item.description || '').trim();
  if (section === 'gas' && description === 'Base Gas Set') return 'Base Gas Setup';
  if (section === 'gas' && description === 'Gas Overrun') return 'Gas Run Overage';
  if (section === 'electrical' && description === 'Homerun') {
    return 'Main Electrical Run Overage';
  }
  if (section === 'electrical' && description === 'Heat Pump Electrical') {
    return 'Heat Pump Electrical Setup';
  }
  if (section === 'electrical' && description === 'Heat Pump Electrical Overrun') {
    return 'Heat Pump Electrical Run Overage';
  }
  if (section === 'electrical' && description === 'PAP Discount') {
    return 'Electrical Discount';
  }
  if (section === 'plumbing' && description === '3.0" Plumbing') {
    return 'Long Gas Run Plumbing';
  }
  if (section === 'plumbing' && description === 'Conduit' && target.kind === 'run') {
    if (target.field === 'electricalRun') return 'Main Electrical Plumbing Conduit';
    if (target.field === 'lightRun') return 'Light Run Plumbing Conduit';
  }
  return description || item.category || 'Pricing Item';
};

const addElectricalAllowanceNote = (
  result: PriceImpactResult,
  target: ElectricalPriceImpactTarget,
  pricingSnapshot?: PricingData
): PriceImpactResult => {
  if (target.kind !== 'run' || target.field === 'lightRun') return result;
  const snapshot = pricingSnapshot || pricingData;
  const allowance = target.field === 'gasRun'
    ? Number(snapshot.plumbing?.gasOverrunThreshold)
    : target.field === 'electricalRun'
      ? Number(snapshot.electrical?.overrunThreshold)
      : Number(snapshot.electrical?.heatPumpOverrunThreshold);
  if (!Number.isFinite(allowance)) return result;

  const label = target.field === 'gasRun'
    ? 'Gas Run Overage'
    : target.field === 'electricalRun'
      ? 'Main Electrical Run Overage'
      : 'Heat Pump Electrical Run Overage';
  const note = `Up to ${allowance} LNFT Included`;
  const hasAllowanceLine = result.directCharges.some((line) => line.label === label);
  const directCharges = hasAllowanceLine
    ? result.directCharges.map((line) =>
        line.label === label ? { ...line, note } : line
      )
    : [
        ...result.directCharges,
        {
          key: `electrical::${target.field}::included-allowance`,
          section: target.field === 'gasRun' ? 'gas' : 'electrical',
          category: target.field === 'gasRun' ? 'Gas' : 'Electrical',
          label,
          note,
          amount: 0,
          cogsAmount: 0,
          retailAmount: 0,
          effect: 'direct' as const,
          approximate: false,
        },
      ];

  return { ...result, directCharges };
};

export function buildElectricalPriceImpactComparisonProposal(
  proposal: Proposal,
  target: ElectricalPriceImpactTarget,
  pricingSnapshot?: PricingData
): Proposal | null {
  return withPricingSnapshot(
    pricingSnapshot,
    () => buildElectricalComparison(proposal, target).comparisonProposal
  );
}

export function calculateElectricalPriceImpact({
  proposal,
  target,
  displayBasis = 'retail',
  currentCalculation,
  pricingSnapshot,
  calculateProposal,
}: ElectricalPriceImpactOptions): PriceImpactResult {
  const built = withPricingSnapshot(
    pricingSnapshot,
    () => buildElectricalComparison(proposal, target)
  );
  if (!built.comparisonProposal) {
    return unavailableResult(
      built.controlLabel,
      built.comparisonLabel,
      built.message || 'A valid comparison could not be created for this electrical selection.',
      displayBasis
    );
  }

  const calculate = calculateProposal || ((input: Proposal) =>
    MasterPricingEngine.calculateCompleteProposal(input, input.papDiscounts));
  const resolvedCurrentCalculation = currentCalculation || calculateWithSnapshot(
    proposal,
    pricingSnapshot,
    calculate
  );
  const result = calculatePriceImpact({
    currentProposal: proposal,
    comparisonProposal: built.comparisonProposal,
    controlLabel: built.controlLabel,
    comparisonLabel: built.comparisonLabel,
    directSections: getElectricalDirectSections(target),
    displayBasis,
    currentCalculation: resolvedCurrentCalculation,
    pricingSnapshot,
    calculateProposal: calculate,
    getLineLabel: (section, item) => getElectricalLineLabel(target, section, item),
    retailAdjustmentLabel: built.retailAdjustmentLabel,
  });
  if (result.status !== 'available') return result;
  return addElectricalAllowanceNote(result, target, pricingSnapshot);
}

type TileCopingDeckingComparisonBuild = {
  controlLabel: string;
  comparisonLabel: string;
  comparisonProposal: Proposal | null;
  message?: string;
  retailAdjustmentLabel?: string;
  tileReplacementLabels?: { current: string; baseline: string };
};

const TILE_COPING_NUMERIC_METADATA: Record<
  TileCopingDeckingNumericPriceImpactField,
  { controlLabel: string; unit: 'LNFT' }
> = {
  additionalTileLength: { controlLabel: 'Additional Tile Length', unit: 'LNFT' },
  bullnoseLnft: { controlLabel: 'Bullnose', unit: 'LNFT' },
  spillwayLnft: { controlLabel: 'Spillway Length', unit: 'LNFT' },
  concreteStepsLength: { controlLabel: 'Concrete Steps Length', unit: 'LNFT' },
};

export const getTileCopingDeckingPriceImpactTargetKey = (
  target: TileCopingDeckingPriceImpactTarget
): string => {
  if (target.kind === 'numeric') return `numeric:${target.field}`;
  if (
    target.kind === 'additionalDecking' ||
    target.kind === 'additionalDeckingArea' ||
    target.kind === 'additionalDeckingOffContract' ||
    target.kind === 'customOption'
  ) {
    return `${target.kind}:${target.index}`;
  }
  return target.kind;
};

const getTileLevelForSelection = (selectionId: string): 0 | 1 | 2 | 3 => {
  if (selectionId === 'level2') return 2;
  if (selectionId === 'level3') return 3;
  return selectionId ? 1 : 0;
};

const buildTileCopingDeckingComparison = (
  proposal: Proposal,
  target: TileCopingDeckingPriceImpactTarget,
  snapshot?: PricingData
): TileCopingDeckingComparisonBuild => {
  const comparison = cloneProposal(proposal);
  const current = proposal.tileCopingDecking;
  const next = comparison.tileCopingDecking;
  const sourcePricing = snapshot || pricingData;
  const noComparison = (
    controlLabel: string,
    comparisonLabel: string,
    message: string
  ): TileCopingDeckingComparisonBuild => ({
    controlLabel,
    comparisonLabel,
    comparisonProposal: null,
    message,
  });
  const finish = (
    controlLabel: string,
    comparisonLabel: string,
    options?: Pick<
      TileCopingDeckingComparisonBuild,
      'retailAdjustmentLabel' | 'tileReplacementLabels'
    >
  ): TileCopingDeckingComparisonBuild => ({
    controlLabel,
    comparisonLabel,
    comparisonProposal: comparison,
    ...options,
  });

  switch (target.kind) {
    case 'tileOption': {
      const selectedId = getTileSelectionId(current);
      const controlLabel = 'Tile Option';
      if (!selectedId) {
        return noComparison(controlLabel, 'Compared with no tile', 'A tile option is not selected.');
      }

      const selectedLabel =
        getTileOptionLabel(sourcePricing.tileCoping, selectedId) || selectedId;
      const tileOptions = getTileOptions(sourcePricing.tileCoping);
      const configuredBase =
        tileOptions.find((option) => option.id === 'level1') || tileOptions[0];
      if (configuredBase && configuredBase.id !== selectedId) {
        next.tileOptionId = configuredBase.id;
        next.tileLevel = getTileLevelForSelection(configuredBase.id);
        return finish(
          controlLabel,
          `Compared with ${configuredBase.name} base tile`,
          {
            tileReplacementLabels: {
              current: selectedLabel,
              baseline: configuredBase.name,
            },
          }
        );
      }

      next.tileOptionId = undefined;
      next.tileLevel = 0;
      return finish(controlLabel, 'Compared with no tile');
    }
    case 'numeric': {
      const metadata = TILE_COPING_NUMERIC_METADATA[target.field];
      const currentValue = Math.max(Number(current[target.field]) || 0, 0);
      const comparisonLabel = `Current ${currentValue} ${metadata.unit} compared with 0 ${metadata.unit}`;
      if (currentValue <= 0) {
        return noComparison(
          metadata.controlLabel,
          comparisonLabel,
          `${metadata.controlLabel} does not currently have a billable value.`
        );
      }
      next[target.field] = 0;
      return finish(metadata.controlLabel, comparisonLabel);
    }
    case 'trimTile': {
      const selectionId = getTrimTileSelectionId(current);
      const controlLabel = 'Trim Tile on Steps & Bench';
      if (!selectionId) {
        return noComparison(
          controlLabel,
          'Compared with no trim tile',
          'A trim tile option is not selected.'
        );
      }
      next.trimTileOptionId = undefined;
      next.hasTrimTileOnSteps = false;
      return finish(controlLabel, 'Compared with no trim tile');
    }
    case 'copingType': {
      const selectedId = String(current.copingType || '').trim();
      const controlLabel = 'Coping Type';
      if (!selectedId || selectedId === 'none') {
        return noComparison(controlLabel, 'Compared with no coping', 'A coping type is not selected.');
      }
      next.copingType = 'none';
      const selectionLabel =
        getCopingOptionLabel(sourcePricing.tileCoping, selectedId) || selectedId;
      return finish(selectionLabel, 'Compared with no coping');
    }
    case 'copingSize': {
      const currentSize = current.copingSize || '12x12';
      const controlLabel = 'Coping Size';
      if (currentSize === '12x12') {
        return noComparison(
          controlLabel,
          'Compared with 12x12 coping',
          'The selected coping size is the base size and has no separate price impact.'
        );
      }
      next.copingSize = '12x12';
      return finish(controlLabel, 'Compared with 12x12 coping');
    }
    case 'deckingType': {
      const selectedId = String(current.deckingType || '').trim();
      const controlLabel = 'Decking Type';
      if (!selectedId || selectedId === 'none') {
        return noComparison(controlLabel, 'Compared with no decking', 'A decking type is not selected.');
      }
      next.deckingType = 'none';
      next.isDeckingOffContract = false;
      const selectionLabel =
        getDeckingOptionLabel(sourcePricing.tileCoping, selectedId) ||
        getDeckingTypeFullLabel(selectedId);
      return finish(selectionLabel, 'Compared with no primary decking', {
        retailAdjustmentLabel: current.isDeckingOffContract
          ? 'Off-Contract Retail Price'
          : undefined,
      });
    }
    case 'deckingOffContract': {
      const selectedId = String(current.deckingType || '').trim();
      const primaryArea = Math.max(
        Number(proposal.poolSpecs?.deckingArea || current.deckingArea) || 0,
        0
      );
      const perimeter = Math.max(Number(proposal.poolSpecs?.perimeter) || 0, 0);
      const hasPricedDeckingGeometry =
        primaryArea > 0 ||
        (perimeter > 0 && (
          selectedId === 'concrete' || proposal.poolSpecs?.poolType === 'fiberglass'
        ));
      const controlLabel = 'Primary Decking Off-Contract';
      if (
        !current.isDeckingOffContract ||
        !selectedId ||
        selectedId === 'none' ||
        !hasPricedDeckingGeometry
      ) {
        return noComparison(
          controlLabel,
          'Compared with the same decking included in the contract',
          'Primary decking is not currently marked off-contract.'
        );
      }
      next.isDeckingOffContract = false;
      return finish(
        controlLabel,
        'Compared with the same decking included in the contract',
        { retailAdjustmentLabel: 'Off-Contract Retail Price' }
      );
    }
    case 'additionalDecking':
    case 'additionalDeckingArea':
    case 'additionalDeckingOffContract': {
      const selections = getAdditionalDeckingSelections(current);
      const selected = selections[target.index];
      const rowLabel = target.index === 0
        ? 'Additional Decking'
        : `Additional Decking ${target.index + 1}`;
      const selectedLabel = selected?.deckingType
        ? getDeckingTypeFullLabel(selected.deckingType)
        : rowLabel;
      if (!selected || !selected.deckingType || selected.area <= 0) {
        return noComparison(
          rowLabel,
          `Compared with no ${rowLabel.toLowerCase()}`,
          'This additional decking selection does not currently have a billable area.'
        );
      }

      if (target.kind === 'additionalDecking') {
        comparison.tileCopingDecking = withAdditionalDeckingSelections(
          next,
          selections.filter((_, index) => index !== target.index)
        );
        return finish(selectedLabel, `Compared with no ${rowLabel.toLowerCase()}`, {
          retailAdjustmentLabel: selected.isOffContract
            ? 'Off-Contract Retail Price'
            : undefined,
        });
      }

      if (target.kind === 'additionalDeckingArea') {
        comparison.tileCopingDecking = withAdditionalDeckingSelections(
          next,
          selections.map((selection, index) =>
            index === target.index ? { ...selection, area: 0 } : selection
          )
        );
        return finish(
          `${rowLabel} SQFT`,
          `Current ${selected.area} SQFT compared with 0 SQFT`,
          {
            retailAdjustmentLabel: selected.isOffContract
              ? 'Off-Contract Retail Price'
              : undefined,
          }
        );
      }

      if (!selected.isOffContract) {
        return noComparison(
          `${rowLabel} Off-Contract`,
          'Compared with the same decking included in the contract',
          'This additional decking selection is not currently marked off-contract.'
        );
      }
      comparison.tileCopingDecking = withAdditionalDeckingSelections(
        next,
        selections.map((selection, index) =>
          index === target.index ? { ...selection, isOffContract: false } : selection
        )
      );
      return finish(
        `${rowLabel} Off-Contract`,
        'Compared with the same decking included in the contract',
        { retailAdjustmentLabel: 'Off-Contract Retail Price' }
      );
    }
    case 'roughGrading': {
      const controlLabel = 'Rough Grading';
      if (!current.hasRoughGrading) {
        return noComparison(
          controlLabel,
          'Compared with no rough grading',
          'Rough grading is not selected.'
        );
      }
      next.hasRoughGrading = false;
      return finish(controlLabel, 'Compared with no rough grading');
    }
    case 'customOption': {
      const selected = current.customOptions?.[target.index];
      const controlLabel =
        selected?.name?.trim() || `Tile / Coping / Decking Custom Option ${target.index + 1}`;
      if (!selected) {
        return noComparison(
          controlLabel,
          `Compared with no ${controlLabel.toLowerCase()}`,
          'This Tile / Coping / Decking custom option is not selected.'
        );
      }
      next.customOptions = (next.customOptions || []).filter(
        (_, index) => index !== target.index
      );
      return finish(controlLabel, `Compared with no ${controlLabel.toLowerCase()}`, {
        retailAdjustmentLabel: selected.isOffContract
          ? 'Off-Contract Retail Price'
          : undefined,
      });
    }
  }
};

const getTileCopingDeckingDirectSections = (
  target: TileCopingDeckingPriceImpactTarget
): ReadonlySet<string> =>
  target.kind === 'roughGrading'
    ? CLEANUP_DIRECT_SECTIONS
    : TILE_COPING_DECKING_DIRECT_SECTIONS;

const getTileCopingDeckingLineLabel = (
  section: string,
  item: CostLineItem
): string => {
  const description = String(item.description || '').trim();
  if (description === 'PAP Discount') {
    if (section === 'tileLabor') return 'Tile / Coping / Decking Labor Discount';
    if (section === 'tileMaterial') return 'Tile / Coping / Decking Material Discount';
  }
  if (description === 'Tile Materials Tax') return 'Tile Material Tax';
  if (section === 'tileMaterial' && description.endsWith(' Tile - Spa')) {
    return `${description.slice(0, -' Tile - Spa'.length)} Tile Material - Spa`;
  }
  if (section === 'tileMaterial' && description.endsWith(' Tile')) {
    return `${description} Material`;
  }
  if (
    section === 'copingDeckingLabor' &&
    item.category === 'Coping Labor' &&
    description.endsWith(' Coping')
  ) {
    return `${description} Labor`;
  }
  if (description === 'Concrete Pump') return 'Concrete Decking Pump';
  if (description === 'Concrete Steps' && section === 'copingDeckingLabor') {
    return 'Concrete Steps Labor';
  }
  if (description === 'Bullnose' && section === 'stoneRockworkLabor') {
    return 'Bullnose Labor';
  }
  if (description === '16x16 coping') return '16x16 Coping Material Adjustment';
  if (description === '12x24') return '12x24 Coping Adjustment';
  return description.replace(/\bAddl\b/g, 'Additional') || item.category || 'Pricing Item';
};

const consolidateTileReplacementLines = (
  result: PriceImpactResult,
  labels?: { current: string; baseline: string }
): PriceImpactResult => {
  if (result.status !== 'available' || !labels) return result;
  const prefixes = [labels.current, labels.baseline]
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
  const consolidated: PriceImpactLine[] = [];
  const aggregates = new Map<string, PriceImpactLine>();

  result.directCharges.forEach((line) => {
    const normalizedLabel = line.label.trim().toLowerCase();
    const isReplacementLine =
      (line.section === 'tileLabor' || line.section === 'tileMaterial') &&
      prefixes.some((prefix) => normalizedLabel.startsWith(`${prefix} `));
    if (!isReplacementLine) {
      consolidated.push(line);
      return;
    }

    const isSpa = normalizedLabel.endsWith(' - spa');
    const groupKey = `${line.section}:${isSpa ? 'spa' : 'pool'}`;
    const existing = aggregates.get(groupKey);
    if (existing) {
      existing.amount = roundCurrency(existing.amount + line.amount);
      existing.cogsAmount = roundCurrency(existing.cogsAmount + line.cogsAmount);
      existing.retailAmount = roundCurrency(existing.retailAmount + line.retailAmount);
      return;
    }

    const label = line.section === 'tileLabor'
      ? `${isSpa ? 'Spa' : 'Pool'} Tile Labor Upgrade`
      : `${isSpa ? 'Spa' : 'Pool'} Tile Material Upgrade`;
    const aggregate: PriceImpactLine = {
      ...line,
      key: `tile-replacement::${groupKey}`,
      label,
      amount: roundCurrency(line.amount),
      cogsAmount: roundCurrency(line.cogsAmount),
      retailAmount: roundCurrency(line.retailAmount),
    };
    aggregates.set(groupKey, aggregate);
    consolidated.push(aggregate);
  });

  return {
    ...result,
    directCharges: consolidated.filter(
      (line) => Math.abs(line.amount) >= CURRENCY_EPSILON
    ),
  };
};

const consolidateConcreteDeckingMaterialLines = (
  result: PriceImpactResult
): PriceImpactResult => {
  if (result.status !== 'available') return result;

  const concreteMaterialLabels = new Set([
    'Concrete Decking - Base',
    'Concrete Decking - Additional',
  ]);
  const consolidated: PriceImpactLine[] = [];
  let concreteMaterial: PriceImpactLine | undefined;

  result.directCharges.forEach((line) => {
    const isConcreteMaterial =
      line.section === 'copingDeckingMaterial' &&
      concreteMaterialLabels.has(line.label);
    if (!isConcreteMaterial) {
      consolidated.push(line);
      return;
    }

    if (concreteMaterial) {
      concreteMaterial.amount = roundCurrency(concreteMaterial.amount + line.amount);
      concreteMaterial.cogsAmount = roundCurrency(
        concreteMaterial.cogsAmount + line.cogsAmount
      );
      concreteMaterial.retailAmount = roundCurrency(
        concreteMaterial.retailAmount + line.retailAmount
      );
      return;
    }

    concreteMaterial = {
      ...line,
      key: 'concrete-decking::material',
      label: 'Concrete Decking Material',
      amount: roundCurrency(line.amount),
      cogsAmount: roundCurrency(line.cogsAmount),
      retailAmount: roundCurrency(line.retailAmount),
    };
    consolidated.push(concreteMaterial);
  });

  return {
    ...result,
    directCharges: consolidated.filter(
      (line) => Math.abs(line.amount) >= CURRENCY_EPSILON
    ),
  };
};

export function buildTileCopingDeckingPriceImpactComparisonProposal(
  proposal: Proposal,
  target: TileCopingDeckingPriceImpactTarget,
  pricingSnapshot?: PricingData
): Proposal | null {
  return withPricingSnapshot(
    pricingSnapshot,
    () => buildTileCopingDeckingComparison(proposal, target, pricingSnapshot).comparisonProposal
  );
}

export function calculateTileCopingDeckingPriceImpact({
  proposal,
  target,
  displayBasis = 'retail',
  currentCalculation,
  pricingSnapshot,
  calculateProposal,
}: TileCopingDeckingPriceImpactOptions): PriceImpactResult {
  const built = withPricingSnapshot(
    pricingSnapshot,
    () => buildTileCopingDeckingComparison(proposal, target, pricingSnapshot)
  );
  if (!built.comparisonProposal) {
    return unavailableResult(
      built.controlLabel,
      built.comparisonLabel,
      built.message || 'A valid comparison could not be created for this selection.',
      displayBasis
    );
  }

  const calculate = calculateProposal || ((input: Proposal) =>
    MasterPricingEngine.calculateCompleteProposal(input, input.papDiscounts));
  const resolvedCurrentCalculation = currentCalculation || calculateWithSnapshot(
    proposal,
    pricingSnapshot,
    calculate
  );
  const result = calculatePriceImpact({
    currentProposal: proposal,
    comparisonProposal: built.comparisonProposal,
    controlLabel: built.controlLabel,
    comparisonLabel: built.comparisonLabel,
    directSections: getTileCopingDeckingDirectSections(target),
    displayBasis,
    currentCalculation: resolvedCurrentCalculation,
    pricingSnapshot,
    calculateProposal: calculate,
    getLineLabel: getTileCopingDeckingLineLabel,
    retailAdjustmentLabel: built.retailAdjustmentLabel,
  });

  return consolidateConcreteDeckingMaterialLines(
    consolidateTileReplacementLines(result, built.tileReplacementLabels)
  );
}

type DrainageComparisonBuild = {
  controlLabel: string;
  comparisonLabel: string;
  comparisonProposal: Proposal | null;
  message?: string;
  retailAdjustmentLabel?: string;
};

const DRAINAGE_RUN_METADATA: Record<
  DrainagePriceImpactRunField,
  { controlLabel: string }
> = {
  downspoutTotalLF: { controlLabel: 'Downspout Drain' },
  deckDrainTotalLF: { controlLabel: 'Deck Drain' },
  frenchDrainTotalLF: { controlLabel: 'French Drain' },
  boxDrainTotalLF: { controlLabel: 'Box Drain' },
};

export const getDrainagePriceImpactTargetKey = (
  target: DrainagePriceImpactTarget
): string => target.kind === 'run'
  ? `run:${target.field}`
  : `customOption:${target.index}`;

const buildDrainageComparison = (
  proposal: Proposal,
  target: DrainagePriceImpactTarget
): DrainageComparisonBuild => {
  const comparison = cloneProposal(proposal);

  if (target.kind === 'run') {
    const metadata = DRAINAGE_RUN_METADATA[target.field];
    const currentValue = Math.max(Number(proposal.drainage?.[target.field]) || 0, 0);
    const comparisonLabel = `Current ${currentValue} LNFT compared with 0 LNFT`;
    if (currentValue <= 0) {
      return {
        controlLabel: metadata.controlLabel,
        comparisonLabel,
        comparisonProposal: null,
        message: `${metadata.controlLabel} does not currently have a billable value.`,
      };
    }

    comparison.drainage = {
      ...comparison.drainage,
      [target.field]: 0,
    };
    return {
      controlLabel: metadata.controlLabel,
      comparisonLabel,
      comparisonProposal: comparison,
    };
  }

  const selected = proposal.drainage?.customOptions?.[target.index];
  const controlLabel = selected?.name?.trim() || `Drainage Custom Option ${target.index + 1}`;
  const comparisonLabel = `Compared with no ${controlLabel.toLowerCase()}`;
  if (!selected) {
    return {
      controlLabel,
      comparisonLabel,
      comparisonProposal: null,
      message: 'This drainage custom option is not selected.',
    };
  }

  comparison.drainage = {
    ...comparison.drainage,
    customOptions: (comparison.drainage.customOptions || []).filter(
      (_, index) => index !== target.index
    ),
  };
  return {
    controlLabel,
    comparisonLabel,
    comparisonProposal: comparison,
    retailAdjustmentLabel: selected.isOffContract
      ? 'Off-Contract Retail Price'
      : undefined,
  };
};

const splitDrainageRunLine = (
  result: PriceImpactResult,
  target: DrainagePriceImpactTarget,
  pricingSnapshot?: PricingData
): PriceImpactResult => {
  if (result.status !== 'available' || target.kind !== 'run') return result;

  const controlLabel = DRAINAGE_RUN_METADATA[target.field].controlLabel;
  const runLineIndex = result.directCharges.findIndex(
    (line) => line.section === 'drainage' && line.label === controlLabel
  );
  if (runLineIndex < 0) return result;

  const snapshot = pricingSnapshot || pricingData;
  const drainagePricing = snapshot.misc.drainage;
  const includedLength = Math.max(Number(drainagePricing.includedFt) || 0, 0);
  const runLine = result.directCharges[runLineIndex];
  const baseCogsAmount = roundCurrency(
    Math.min(Math.max(Number(drainagePricing.baseCost) || 0, 0), runLine.cogsAmount)
  );
  const overageCogsAmount = roundCurrency(runLine.cogsAmount - baseCogsAmount);
  const baseRetailAmount = roundCurrency(baseCogsAmount * result.retailMultiplier);
  const overageRetailAmount = roundCurrency(runLine.retailAmount - baseRetailAmount);
  const baseLine: PriceImpactLine = {
    ...runLine,
    key: `drainage::${target.field}::base`,
    label: `${controlLabel} Base`,
    note: undefined,
    amount: result.displayBasis === 'retail' ? baseRetailAmount : baseCogsAmount,
    cogsAmount: baseCogsAmount,
    retailAmount: baseRetailAmount,
  };
  const overageLine: PriceImpactLine = {
    ...runLine,
    key: `drainage::${target.field}::overage`,
    label: `${controlLabel} Overage`,
    note: `Up to ${includedLength} LNFT Included`,
    amount: result.displayBasis === 'retail' ? overageRetailAmount : overageCogsAmount,
    cogsAmount: overageCogsAmount,
    retailAmount: overageRetailAmount,
  };
  const directCharges = [...result.directCharges];
  directCharges.splice(runLineIndex, 1, baseLine, overageLine);

  return { ...result, directCharges };
};

export function buildDrainagePriceImpactComparisonProposal(
  proposal: Proposal,
  target: DrainagePriceImpactTarget
): Proposal | null {
  return buildDrainageComparison(proposal, target).comparisonProposal;
}

export function calculateDrainagePriceImpact({
  proposal,
  target,
  displayBasis = 'retail',
  currentCalculation,
  pricingSnapshot,
  calculateProposal,
}: DrainagePriceImpactOptions): PriceImpactResult {
  const built = buildDrainageComparison(proposal, target);
  if (!built.comparisonProposal) {
    return unavailableResult(
      built.controlLabel,
      built.comparisonLabel,
      built.message || 'A valid comparison could not be created for this drainage selection.',
      displayBasis
    );
  }

  const calculate = calculateProposal || ((input: Proposal) =>
    MasterPricingEngine.calculateCompleteProposal(input, input.papDiscounts));
  const resolvedCurrentCalculation = currentCalculation || calculateWithSnapshot(
    proposal,
    pricingSnapshot,
    calculate
  );
  const result = calculatePriceImpact({
    currentProposal: proposal,
    comparisonProposal: built.comparisonProposal,
    controlLabel: built.controlLabel,
    comparisonLabel: built.comparisonLabel,
    directSections: DRAINAGE_DIRECT_SECTIONS,
    displayBasis,
    currentCalculation: resolvedCurrentCalculation,
    pricingSnapshot,
    calculateProposal: calculate,
    retailAdjustmentLabel: built.retailAdjustmentLabel,
  });

  return splitDrainageRunLine(result, target, pricingSnapshot);
}

export function buildAdditionalPumpComparisonProposal(
  proposal: Proposal,
  pumpIndex: number
): Proposal | null {
  return buildEquipmentPriceImpactComparisonProposal(proposal, {
    kind: 'additionalPump',
    index: pumpIndex,
  });
}

export function calculateAdditionalPumpPriceImpact({
  proposal,
  pumpIndex,
  currentCalculation,
  pricingSnapshot,
  calculateProposal,
}: AdditionalPumpPriceImpactOptions): PriceImpactResult {
  return calculateEquipmentPriceImpact({
    proposal,
    target: { kind: 'additionalPump', index: pumpIndex },
    displayBasis: 'retail',
    currentCalculation,
    pricingSnapshot,
    calculateProposal,
  });
}
