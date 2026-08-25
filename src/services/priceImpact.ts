import type { CostBreakdown, CostLineItem, Proposal } from '../types/proposal-new';
import {
  getSelectedEquipmentPackage,
  isFixedEquipmentPackage,
} from '../utils/equipmentPackages';
import { getAdditionalPumpSelections } from '../utils/pumpSelections';
import { sanitizeProposalSelectionState } from '../utils/proposalSelectionSanitizer';
import { buildIncludedSaltCellOption } from '../utils/saltCellCompatibility';
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

export interface PriceImpactLine {
  key: string;
  section: string;
  category: string;
  label: string;
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

const CURRENCY_EPSILON = 0.005;
const RECONCILIATION_TOLERANCE = 0.02;
const EQUIPMENT_DIRECT_SECTIONS = new Set(['equipmentOrdered', 'equipmentSet']);

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
    const amount = roundCurrency((currentItem?.total ?? 0) - (comparisonItem?.total ?? 0));
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
  retailAdjustmentLabel = 'Retail-only adjustment',
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
      const comparisonLabel = 'Compared with no main heater';
      if (!hasSelection(equipment.heater?.name, 'no heater') || (equipment.heaterQuantity ?? 0) <= 0) {
        return noComparison(controlLabel, comparisonLabel, 'A main heater is not selected.');
      }
      const heaterIsRequired =
        proposal.poolSpecs?.spaType !== 'none' ||
        equipment.heater.autoAddedForSpa ||
        equipment.heater.autoAddedReason === 'spa';
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
      nextEquipment.poolLights = remaining;
      nextEquipment.includePoolLights = remaining.length > 0;
      nextEquipment.numberOfLights = Math.max(remaining.length - 1, 0);
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
      nextEquipment.spaLights = remaining;
      nextEquipment.includeSpaLights = remaining.length > 0;
      nextEquipment.hasSpaLight = remaining.length > 0;
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
          ? 'Off-contract retail price'
          : undefined,
      });
    }
  }
};

const getEquipmentLineLabel = (
  target: EquipmentPriceImpactTarget,
  section: string,
  item: CostLineItem
): string => {
  const description = String(item.description || '').trim();
  if (description === 'Equipment Tax') return 'Equipment tax';
  if (section === 'equipmentSet' && /add(?:itional|['’]l) pump/i.test(description)) {
    return 'Additional-pump setup';
  }
  if (section === 'equipmentSet' && description === 'Base Equipment Set') {
    return 'Base equipment setup';
  }
  if (section === 'equipmentSet' && description === 'Heater') return 'Heater setup';
  if (section === 'equipmentSet' && description === 'Heat Pump Set') return 'Heat-pump setup';
  if (
    target.kind === 'additionalPump' &&
    section === 'equipmentOrdered' &&
    /^additional pump\b/i.test(description)
  ) {
    return 'Pump equipment';
  }
  if (section === 'plumbing' && description === '2.5" Plumbing') {
    return target.kind === 'additionalPump'
      ? 'Second main-drain plumbing run'
      : 'Main-drain plumbing runs';
  }
  if (section === 'plumbing' && /add(?:itional|['’]l) main drain/i.test(description)) {
    return 'Additional main drain';
  }
  if (section === 'interiorFinish' && description.startsWith('Fittings')) {
    return 'Interior-finish fittings';
  }
  return description || item.category || 'Pricing item';
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
    getLineLabel: (section, item) => getEquipmentLineLabel(target, section, item),
    retailAdjustmentLabel: built.retailAdjustmentLabel,
  });

  if (result.status !== 'available' || !includedPackageSelection) return result;

  return {
    ...result,
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
      ...result.directCharges,
    ],
  };
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
