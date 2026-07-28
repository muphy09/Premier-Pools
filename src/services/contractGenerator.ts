import { Proposal, PumpSelection, WaterFeatureSelection } from '../types/proposal-new';
import MasterPricingEngine from './masterPricingEngine';
import pricingData from './pricingData';
import { formatMasonryFacingLabel, getMasonryFacingOptions } from '../utils/masonryFacing';
import { countSelectedWaterFeatureZones, flattenWaterFeatures } from '../utils/waterFeatureCost';
import { getEffectivePrimarySanitationSystemName } from '../utils/equipmentPackages';
import { getAdditionalPumpSelections } from '../utils/pumpSelections';
import {
  getAdditionalDeckingSelections,
  getDeckingTypeFullLabel,
  getResolvedProposalPrimaryDeckingArea,
} from '../utils/decking';
import { getCopingOptionLabel, hasTileSelection } from '../utils/tileCopingCatalogs';
import {
  ContractTemplate,
  ContractTemplateId,
  getContractTemplate,
  getContractTemplateIdForProposal,
} from './contractTemplates';
import { isPpasEastFranchiseId } from '../constants/franchises';
import { isPpasEastFranchiseCode } from '../utils/franchiseScope';
import {
  getGroupedCustomFeatureSubcategory,
  hasCustomFeatureContent,
  isGroupedCustomFeature,
  isOffContractCustomFeature,
  normalizeCustomFeatures,
} from '../utils/customFeatures';
import { resolveProposalPapDiscounts } from '../utils/papDiscounts';
import { NORMAL_PRICING_TIER_ID, getProposalPricingTierId } from './pricingTiers';
import { resolveFeenstraMay2026ContractCashPrice } from './legacy/feenstraMay2026Contract';

export type ContractOverrides = Record<string, string | number | null>;

export type ContractFieldRender = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  color: 'blue' | 'yellow';
  value: string;
  autoValue: string;
  isAutoFilled: boolean;
  isOverridden: boolean;
};

type ProposalWithPricing = Proposal & {
  pricing?: Proposal['pricing'] & { retailPrice?: number };
};

const ADDITIONAL_SPEC_FIELD_IDS = [
  'p2_additional_spec_73',
  'p2_additional_spec_74',
  'p2_additional_spec_75',
  'p2_additional_spec_76',
  'p2_additional_spec_77',
  'p2_additional_spec_78',
  'p2_additional_spec_79',
  'p2_additional_spec_80',
  'p2_additional_spec_81',
  'p2_additional_spec_82',
] as const;
const ADDITIONAL_SPEC_FIELD_ID_SET = new Set<string>(ADDITIONAL_SPEC_FIELD_IDS);
const EQUIPMENT_WARRANTY_TEXT = '5 Year Warranty on Equipment';
const EQUIPMENT_WARRANTY_EFFECTIVE_AT = '2026-06-24T00:00:00.000-04:00';
const PLUMBING_RESPONSIBILITY_FIELD_IDS = new Set([
  'p1_39',
  'p1_40',
  'p1_15_resp',
  'p1_16_resp',
  'p1_17_resp',
  'p1_18_resp',
  'p1_19_resp',
  'p2_51',
  'p2_55',
  'p2_57',
]);
const SANITATION_NONE_FIELD_IDS = new Set(['p1_24', 'p1_25']);
const PPAS_EAST_GENERAL_CONSTRUCTION_DEFAULTS: Record<string, string> = {
  p1_gc_1: 'BY BUILDER',
  p1_gc_2: 'BY BUILDER',
  p1_gc_3: 'BY BUILDER',
  p1_gc_4: 'BY BUYER',
  p1_gc_5: 'BY BUYER',
  p1_gc_6: 'BY BUYER',
  p1_gc_7: 'BY BUYER',
  p1_gc_8: 'BY BUYER',
  p1_gc_9: 'BY BUYER',
};
const PPAS_EAST_NO_SPA_VALUES: Record<string, string> = {
  p2_52: 'No Spa',
  p2_spa_dimension_2: '',
  p2_spa_length: 'No Spa',
  p2_spa_width: '',
  p2_53: 'NONE',
  p2_54: '0',
  p2_56: 'NONE',
  p2_58: 'NO',
  p2_59: 'NONE',
  p2_62: 'NO',
  p2_65: 'NO',
  p2_67: 'NO',
  p2_69: 'NONE',
};
const WATER_FEATURE_CATALOG = flattenWaterFeatures(pricingData.waterFeatures);
const WATER_FEATURE_NAME_BY_ID = new Map(WATER_FEATURE_CATALOG.map((item) => [item.id, item.name]));
const WATER_FEATURE_CATEGORY_BY_ID = new Map(WATER_FEATURE_CATALOG.map((item) => [item.id, item.category]));
export const CONTRACT_DEPOSIT_SOURCE_FIELD_IDS = ['p1_deposit_amount', 'p1_pay_deposit'] as const;
export const CONTRACT_DEPOSIT_SCHEDULE_FIELD_IDS = [
  'p1_pay_excavation',
  'p1_pay_shotcete',
  'p1_pay_decking',
  'p1_pay_interior_finish',
] as const;
const CONTRACT_DEPOSIT_SOURCE_FIELD_ID_SET = new Set<string>(CONTRACT_DEPOSIT_SOURCE_FIELD_IDS);
const DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES: Record<string, number> = {
  p1_pay_excavation: 0.3,
  p1_pay_shotcete: 0.3,
  p1_pay_decking: 0.3,
  p1_pay_interior_finish: 0.1,
};
const MIRRORED_CONTRACT_FIELD_GROUPS = [
  ['p1_1', 'p1_body_buyer_name', 'p2_45', 'p3_customer_name', 'p4_customer_name', 'p5_customer_name', 'p6_customer_name'],
  ['p1_1b', 'p1_body_job_site_address', 'p2_45b'],
  ['p1_2', 'p2_46'],
  ['p1_2b', 'p2_46b'],
  ['p1_3', 'p2_47'],
  ['p1_4', 'p2_48'],
  ['p1_5', 'p2_49'],
  ['p1_6', 'p2_50'],
] as const;
const MIRRORED_CONTRACT_FIELD_ID_MAP = new Map<string, readonly string[]>(
  MIRRORED_CONTRACT_FIELD_GROUPS.flatMap((group) => group.map((fieldId) => [fieldId, group] as const))
);
const MANUAL_ONLY_CONTRACT_FIELD_IDS = new Set(['p1_2b', 'p2_46b']);

type MirroredContractOverride = {
  hasOverride: boolean;
  value: string | number | null | undefined;
};

export function getContractDepositSchedulePercentages(
  proposal?: Partial<Proposal>
): Record<string, number> {
  const guniteSchedule = (pricingData as any)?.misc?.contractPaymentSchedule?.gunite || {};
  const fiberglassSchedule = (pricingData as any)?.misc?.contractPaymentSchedule?.fiberglass || {};
  const resolvePercentage = (value: unknown, fallback: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  if (proposal?.poolSpecs?.poolType === 'fiberglass') {
    return {
      p1_pay_excavation: resolvePercentage(
        fiberglassSchedule.permitting,
        DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_excavation
      ),
      p1_pay_shotcete: resolvePercentage(
        fiberglassSchedule.shellDelivery,
        DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_shotcete
      ),
      p1_pay_decking: resolvePercentage(
        fiberglassSchedule.equipmentSet,
        DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_decking
      ),
      p1_pay_interior_finish: resolvePercentage(
        fiberglassSchedule.decking,
        DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_interior_finish
      ),
    };
  }

  return {
    p1_pay_excavation: resolvePercentage(
      guniteSchedule.excavation,
      DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_excavation
    ),
    p1_pay_shotcete: resolvePercentage(
      guniteSchedule.shotcrete,
      DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_shotcete
    ),
    p1_pay_decking: resolvePercentage(
      guniteSchedule.decking,
      DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_decking
    ),
    p1_pay_interior_finish: resolvePercentage(
      guniteSchedule.interiorFinish,
      DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES.p1_pay_interior_finish
    ),
  };
}

export function getMirroredContractFieldIds(fieldId: string): readonly string[] {
  return MIRRORED_CONTRACT_FIELD_ID_MAP.get(fieldId) || [fieldId];
}

function resolveMirroredContractOverride(
  fieldId: string,
  overrides?: ContractOverrides
): MirroredContractOverride {
  if (!overrides) {
    return { hasOverride: false, value: undefined };
  }

  for (const mirroredFieldId of getMirroredContractFieldIds(fieldId)) {
    if (!Object.prototype.hasOwnProperty.call(overrides, mirroredFieldId)) continue;
    return {
      hasOverride: true,
      value: overrides[mirroredFieldId],
    };
  }

  return { hasOverride: false, value: undefined };
}

function normalizeProposal(pr: Proposal): ProposalWithPricing {
  try {
    const calc = MasterPricingEngine.calculateCompleteProposal(
      pr,
      resolveProposalPapDiscounts(pr, pricingData.papDiscountRates)
    );
    return {
      ...pr,
      pricing: calc?.pricing || pr.pricing,
      costBreakdown: calc?.costBreakdown || pr.costBreakdown,
    };
  } catch (error) {
    console.warn('Failed to recalc proposal for contract view; using stored pricing.', error);
    return pr;
  }
}

function normalizePhone(value: any): string {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

function formatYesNo(value: any, defaultValue = 'NO'): string {
  if (value === undefined || value === null) return defaultValue;
  const truthy = typeof value === 'string' ? value.trim().length > 0 && value.toLowerCase() !== 'none' : Boolean(value);
  return truthy ? 'YES' : defaultValue;
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '$0.00';
  return Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

export function getDefaultContractDepositValue(proposal?: Partial<Proposal>): string {
  const feenstraContractCashPrice = proposal
    ? resolveFeenstraMay2026ContractCashPrice(proposal)
    : null;
  if (feenstraContractCashPrice !== null) {
    return formatCurrency(feenstraContractCashPrice * 0.1);
  }

  const isPpasEast =
    isPpasEastFranchiseId(proposal?.franchiseId) ||
    isPpasEastFranchiseCode(proposal?.designerCode);
  return isPpasEast && proposal?.poolSpecs?.poolType === 'fiberglass'
    ? formatCurrency(5000)
    : '';
}

export function normalizeContractDepositInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const trimmed = String(value).trim();
  if (!trimmed || trimmed === '$') return '';
  const withoutLeadingDollar = trimmed.replace(/^\$+\s*/, '');
  return withoutLeadingDollar ? `$${withoutLeadingDollar}` : '';
}

function parseContractMonetaryInput(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = normalizeContractDepositInput(value);
  if (!normalized) return null;

  const numeric = normalized.replace(/[^0-9.-]/g, '');
  if (!numeric || numeric === '-' || numeric === '.' || numeric === '-.') return null;

  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRemainingCashPriceForContractSchedule(
  totalCashPrice: string | number | null | undefined,
  depositValue: string | number | null | undefined
): number | null {
  const depositAmount = parseContractMonetaryInput(depositValue);
  if (depositAmount === null) return null;

  const totalAmount = parseContractMonetaryInput(totalCashPrice);
  if (totalAmount === null) return null;

  return Math.max(totalAmount - depositAmount, 0);
}

export function getContractDepositFieldAutoValue(
  fieldId: string,
  depositValue: string | number | null | undefined,
  totalCashPrice?: string | number | null,
  schedulePercentages: Record<string, number> = DEFAULT_CONTRACT_DEPOSIT_SCHEDULE_PERCENTAGES
): string {
  const normalizedDepositValue = normalizeContractDepositInput(depositValue);

  if (CONTRACT_DEPOSIT_SOURCE_FIELD_ID_SET.has(fieldId)) {
    return normalizedDepositValue;
  }

  const percentage = schedulePercentages[fieldId];
  if (!percentage) return '';

  const remainingCashPrice = getRemainingCashPriceForContractSchedule(totalCashPrice, normalizedDepositValue);
  if (remainingCashPrice === null) return '';

  return formatCurrency(remainingCashPrice * percentage);
}

function resolveContractDepositSourceValue(overrides?: ContractOverrides): string {
  for (const fieldId of CONTRACT_DEPOSIT_SOURCE_FIELD_IDS) {
    const normalized = normalizeContractDepositInput(overrides?.[fieldId]);
    if (normalized) return normalized;
  }
  return '';
}

function formatNumberValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '0';
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
}

function formatFacingValue(value?: string | null): string {
  return formatMasonryFacingLabel(value, getMasonryFacingOptions(pricingData.masonry, 'rbb'));
}

function formatRaisedSpaFacing(value?: string | null): string {
  const label = formatMasonryFacingLabel(value, getMasonryFacingOptions(pricingData.masonry, 'raisedSpa'));
  return label === 'None' ? 'NONE' : label;
}

function stripParenSuffix(value: string): string {
  const idx = value.indexOf('(');
  return (idx >= 0 ? value.slice(0, idx) : value).trim();
}

function isPlaceholderPumpName(value?: string | null): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes('no pump') ||
    normalized.includes('no aux') ||
    normalized.includes('no auxiliary') ||
    normalized.includes('no blower')
  );
}

function getPrimaryPumpContractName(proposal: Proposal, fallback = 'None'): string {
  const selectedPumpName = proposal.equipment?.pump?.name;
  if (!isPlaceholderPumpName(selectedPumpName)) {
    return selectedPumpName!;
  }

  const legacyPrimaryPumpName =
    (proposal.equipment as (Proposal['equipment'] & { primaryPump?: { name?: string } }) | undefined)?.primaryPump?.name;
  if (!isPlaceholderPumpName(legacyPrimaryPumpName)) {
    return legacyPrimaryPumpName!;
  }

  return fallback;
}

function getAuxiliaryPumpSelections(proposal: Proposal): PumpSelection[] {
  const auxPumps = (proposal.equipment?.auxiliaryPumps || []).filter(
    (pump) => pump && !isPlaceholderPumpName(pump.name)
  );

  if (auxPumps.length > 0) {
    return auxPumps;
  }

  const legacyAuxPump = proposal.equipment?.auxiliaryPump;
  return legacyAuxPump && !isPlaceholderPumpName(legacyAuxPump.name) ? [legacyAuxPump] : [];
}

function isSpaAutoAddedAuxiliaryPump(pump: Pick<PumpSelection, 'autoAddedForSpa' | 'autoAddedReason'> | undefined): boolean {
  return Boolean(
    pump?.autoAddedForSpa || pump?.autoAddedReason === 'spa' || pump?.autoAddedReason === 'fiberglass'
  );
}

function getContractBlowerValue(proposal: Proposal): string {
  const blowerSelections = getAuxiliaryPumpSelections(proposal);
  if (blowerSelections.length === 0) return 'NO';
  const preferredBlower = blowerSelections.find((pump) => isSpaAutoAddedAuxiliaryPump(pump)) || blowerSelections[0];
  return preferredBlower?.name || 'NO';
}

function getAdditionalPrimaryPumpContractNames(proposal: Proposal): string[] {
  return getAdditionalPumpSelections(proposal.equipment)
    .filter((pump) => pump && !isPlaceholderPumpName(pump.name))
    .map((pump) => pump.name || '');
}

function getWaterFeatureName(featureId?: string): string {
  if (!featureId) return '';
  return WATER_FEATURE_NAME_BY_ID.get(featureId) || featureId;
}

function getWaterFeatureCategory(featureId?: string): string {
  if (!featureId) return '';
  if (WATER_FEATURE_CATEGORY_BY_ID.has(featureId)) {
    return WATER_FEATURE_CATEGORY_BY_ID.get(featureId) || '';
  }
  const byName = WATER_FEATURE_CATALOG.find((item) => item.name === featureId);
  return byName?.category || '';
}

function isLaminarWaterFeature(featureId?: string): boolean {
  const normalizedId = String(featureId || '').toLowerCase();
  if (normalizedId.includes('laminar')) return true;

  const normalizedName = getWaterFeatureName(featureId).toLowerCase();
  if (normalizedName.includes('laminar')) return true;

  return getWaterFeatureCategory(featureId).toLowerCase().includes('laminar');
}

function isDeckJetWaterFeature(featureId?: string): boolean {
  if (isLaminarWaterFeature(featureId)) return false;

  const normalizedId = String(featureId || '').toLowerCase();
  const normalizedName = getWaterFeatureName(featureId).toLowerCase();
  const normalizedCategory = getWaterFeatureCategory(featureId).toLowerCase();

  return (
    normalizedCategory === 'jets' ||
    normalizedId.includes('deck-jet') ||
    normalizedName.includes('deck jet')
  );
}

function getInteriorFinishLabel(finishType?: string): string {
  if (!finishType) return '';
  const finish = pricingData.interiorFinish?.finishes?.find((item) => item.id === finishType);
  if (finish?.name) return finish.name;
  const byName = pricingData.interiorFinish?.finishes?.find((item) => item.name === finishType);
  return byName?.name || finishType;
}

function groupLightSelections(lights?: Array<{ name?: string }>) {
  const groups: { name: string; count: number }[] = [];
  (lights || []).forEach((light) => {
    const name = (light?.name || '').trim();
    if (!name) return;
    const existing = groups.find((group) => group.name === name);
    if (existing) {
      existing.count += 1;
    } else {
      groups.push({ name, count: 1 });
    }
  });
  return groups;
}

function isProposalCreatedOnOrAfter(proposal: ProposalWithPricing, effectiveDate: string): boolean {
  const createdAt = Date.parse(proposal.createdDate || '');
  const effectiveAt = Date.parse(effectiveDate);
  return Number.isFinite(createdAt) && Number.isFinite(effectiveAt) && createdAt >= effectiveAt;
}

function shouldApplyEquipmentWarrantyLineRule(proposal: ProposalWithPricing): boolean {
  return isProposalCreatedOnOrAfter(proposal, EQUIPMENT_WARRANTY_EFFECTIVE_AT);
}

function shouldIncludeEquipmentWarrantyLine(proposal: ProposalWithPricing): boolean {
  return (
    shouldApplyEquipmentWarrantyLineRule(proposal) &&
    getProposalPricingTierId(proposal) === NORMAL_PRICING_TIER_ID
  );
}

function buildCustomAdditionalSpecificationLines(proposal: ProposalWithPricing): string[] {
  return normalizeCustomFeatures(proposal.customFeatures).features
    .filter((feature) => hasCustomFeatureContent(feature))
    .map((feature, index) => {
      const name = feature.name?.trim() || '';
      const description = feature.description?.trim() || '';
      const subcategory = getGroupedCustomFeatureSubcategory(feature);
      const groupedLabel =
        isGroupedCustomFeature(feature) && subcategory
          ? [subcategory, name || description || `Custom Feature #${index + 1}`].filter(Boolean).join(' - ')
          : '';
      const base = groupedLabel || name || description || `Custom Feature #${index + 1}`;
      return isOffContractCustomFeature(feature) ? `${base} (OFF CONTRACT)` : base;
    });
}

function buildAdditionalSpecificationLines(proposal: ProposalWithPricing): string[] {
  const customLines = buildCustomAdditionalSpecificationLines(proposal);
  if (isPpasEastFranchiseId(proposal.franchiseId)) {
    return customLines.slice(0, ADDITIONAL_SPEC_FIELD_IDS.length);
  }
  const lines = shouldIncludeEquipmentWarrantyLine(proposal)
    ? [
        EQUIPMENT_WARRANTY_TEXT,
        ...customLines.filter(
          (line) => line.trim().toLowerCase() !== EQUIPMENT_WARRANTY_TEXT.toLowerCase()
        ),
      ]
    : shouldApplyEquipmentWarrantyLineRule(proposal)
    ? ['', ...customLines]
    : customLines;

  return lines.slice(0, ADDITIONAL_SPEC_FIELD_IDS.length);
}

function parseZipFromAddress(address?: string | null): string {
  if (!address) return '';
  const zip = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return zip ? zip[0] : '';
}

function pickWaterFeatures(selections: WaterFeatureSelection[] | undefined) {
  const base = selections || [];
  const byType = {
    sheer: [] as WaterFeatureSelection[],
    deckJet: [] as WaterFeatureSelection[],
    laminar: [] as WaterFeatureSelection[],
    bowl: [] as WaterFeatureSelection[],
    sconce: [] as WaterFeatureSelection[],
    bubbler: [] as WaterFeatureSelection[],
    other: [] as WaterFeatureSelection[],
  };

  base.forEach((sel) => {
    const id = sel.featureId || '';
    const category = getWaterFeatureCategory(id).toLowerCase();
    if (category.includes('sheer') || id.includes('sheer')) {
      byType.sheer.push(sel);
    } else if (isLaminarWaterFeature(id)) {
      byType.laminar.push(sel);
    } else if (isDeckJetWaterFeature(id)) {
      byType.deckJet.push(sel);
    } else if (category.includes('bubbler') || id.includes('bubbler')) {
      byType.bubbler.push(sel);
    } else if (category.includes('wok') || category.includes('bowl') || id.includes('wok') || id.includes('bowl')) {
      byType.bowl.push(sel);
    } else if (category.includes('sconce') || category.includes('scupper') || id.includes('sconce') || id.includes('scupper')) {
      byType.sconce.push(sel);
    } else {
      byType.other.push(sel);
    }
  });

  return byType;
}

function defaultFromLabel(label: string): string {
  if (/by builder/i.test(label)) return 'BY BUILDER';
  if (/by buyer/i.test(label)) return 'BY BUYER';
  if (/none/i.test(label)) return 'None';
  if (/responsibility/i.test(label)) return '';
  const qty = label.match(/qty:\s*([\d.-]+)/i);
  if (qty) return qty[1];
  if (/\$0\.00/.test(label)) return '$0.00';
  const num = label.match(/\b\d+\b/);
  if (num) return num[0];
  return '';
}

function getRetailPrice(proposal: ProposalWithPricing): number {
  return (
    proposal.pricing?.retailPrice ??
    proposal.pricing?.baseRetailPrice ??
    proposal.totalCost ??
    proposal.subtotal ??
    0
  );
}

function getContractCashPrice(proposal: ProposalWithPricing): number {
  return resolveFeenstraMay2026ContractCashPrice(proposal) ?? getRetailPrice(proposal);
}

function getContractWaterFeatureSummary(
  selections: WaterFeatureSelection[],
  emptyName = 'None'
): { name: string; quantity: string } {
  const selectedFeatures = selections.filter((selection) => Number(selection.quantity || 0) > 0);
  if (!selectedFeatures.length) {
    return { name: emptyName, quantity: '0' };
  }

  const uniqueNames = Array.from(
    new Set(
      selectedFeatures
        .map((selection) => getWaterFeatureName(selection.featureId))
        .map((name) => name.trim())
        .filter(Boolean)
    )
  );
  const totalQuantity = selectedFeatures.reduce((sum, selection) => sum + (Number(selection.quantity) || 0), 0);
  const primaryName = uniqueNames[0] || emptyName;
  const name = uniqueNames.length <= 1 ? primaryName : `${primaryName} +${uniqueNames.length - 1} more`;

  return {
    name,
    quantity: formatCount(totalQuantity),
  };
}

export function getContractTotalCashPrice(proposal: Proposal): number {
  return getContractCashPrice(proposal);
}

function isMeaningfulAutoValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return normalized !== 'none';
}

function computeAutoValue(field: ContractFieldRender, proposal: ProposalWithPricing): string {
  if (MANUAL_ONLY_CONTRACT_FIELD_IDS.has(field.id)) return '';
  if (SANITATION_NONE_FIELD_IDS.has(field.id)) return 'None';

  const label = field.label.toLowerCase();
  const info = proposal.customerInfo || {};
  const specs = proposal.poolSpecs || ({} as Proposal['poolSpecs']);
  const pricing = getContractCashPrice(proposal);
  const waterFeatures = pickWaterFeatures(proposal.waterFeatures?.selections);
  const additionalSpecificationLines = buildAdditionalSpecificationLines(proposal);
  const bubblerSummary = getContractWaterFeatureSummary(waterFeatures.bubbler);
  const bowlSummary = getContractWaterFeatureSummary(waterFeatures.bowl, 'NONE');

  if (ADDITIONAL_SPEC_FIELD_ID_SET.has(field.id)) {
    const fieldIndex = ADDITIONAL_SPEC_FIELD_IDS.indexOf(field.id as (typeof ADDITIONAL_SPEC_FIELD_IDS)[number]);
    return fieldIndex >= 0 ? additionalSpecificationLines[fieldIndex] || '' : '';
  }

  const overrideDefault = defaultFromLabel(field.label);
  const isPlumbingResponsibilityField = PLUMBING_RESPONSIBILITY_FIELD_IDS.has(field.id);
  const isPpasEast = isPpasEastFranchiseId(proposal.franchiseId);

  if (isPpasEast && Object.prototype.hasOwnProperty.call(PPAS_EAST_GENERAL_CONSTRUCTION_DEFAULTS, field.id)) {
    return PPAS_EAST_GENERAL_CONSTRUCTION_DEFAULTS[field.id];
  }

  if (
    isPpasEast &&
    specs.spaType === 'none' &&
    Object.prototype.hasOwnProperty.call(PPAS_EAST_NO_SPA_VALUES, field.id)
  ) {
    return PPAS_EAST_NO_SPA_VALUES[field.id];
  }

  if (isPpasEast && field.id === 'p2_59') {
    return specs.spaType === 'none' ? 'NONE' : 'Same as Pool';
  }

  if (isPpasEast && (field.id === 'p2_53' || field.id === 'p2_54')) {
    const spaLightGroups = groupLightSelections(proposal.equipment?.spaLights || []);
    const primarySpaLight = spaLightGroups[0];
    return field.id === 'p2_53' ? primarySpaLight?.name || 'NONE' : primarySpaLight ? String(primarySpaLight.count) : '0';
  }

  if (isPlumbingResponsibilityField) {
    if (field.id === 'p1_40') return 'BY BUYER';
    if (field.id === 'p2_51') return 'BY BUILDER';
    if (field.id === 'p2_55') return 'BY BUILDER';
    if (field.id === 'p2_57') return 'BY BUYER';
    if (label.includes('auto-fill')) {
      const hasAutoFillRun = Boolean(proposal.plumbing?.runs?.autoFillRun);
      return hasAutoFillRun ? 'BY BUILDER' : overrideDefault || 'BY BUYER';
    }
    return overrideDefault || 'BY BUILDER';
  }

  if (field.id === 'p2_68') {
    return countSelectedWaterFeatureZones(proposal.waterFeatures?.selections ?? [], pricingData.waterFeatures) > 0
      ? 'YES'
      : 'NO';
  }

  if (field.id === 'p1_33') {
    const facing = proposal.excavation?.rbbLevels?.[0]?.facing;
    return formatFacingValue(facing);
  }

  if (field.id === 'p1_35') {
    const facing = proposal.excavation?.rbbLevels?.[1]?.facing;
    return formatFacingValue(facing);
  }

  const raisedBeamMatch = field.id.match(/^p1_rbb_(\d+)/);
  if (raisedBeamMatch) {
    const height = Number(raisedBeamMatch[1]);
    const levels = proposal.excavation?.rbbLevels || [];
    const total = levels
      .filter((level) => level.height === height)
      .reduce((sum, level) => sum + (Number(level.length) || 0), 0);
    return formatNumberValue(total);
  }

  if (
    field.id === 'p2_70' ||
    field.id === 'p2_71' ||
    field.id === 'p2_72' ||
    field.id === 'p2_73' ||
    field.id === 'p2_74' ||
    field.id === 'p2_75' ||
    field.id === 'p2_76' ||
    field.id === 'p2_77' ||
    field.id === 'p2_78' ||
    field.id === 'p2_79' ||
    field.id === 'p2_80' ||
    field.id === 'p2_81'
  ) {
    const sheerSelections = waterFeatures.sheer;
    const deckJetSelections = waterFeatures.deckJet;
    const laminarSelections = waterFeatures.laminar;
    const sconceSelections = waterFeatures.sconce;
    const sheerOne = sheerSelections[0];
    const sheerTwo = sheerSelections[1];
    const deckJetQty = deckJetSelections.reduce((sum, sel) => sum + (Number(sel.quantity) || 0), 0);
    const laminarQty = laminarSelections.reduce((sum, sel) => sum + (Number(sel.quantity) || 0), 0);
    const sconceQty = sconceSelections.reduce((sum, sel) => sum + (Number(sel.quantity) || 0), 0);

    switch (field.id) {
      case 'p2_70':
        return sheerOne ? getWaterFeatureName(sheerOne.featureId) : 'NONE';
      case 'p2_71':
        return formatCount(sheerOne?.quantity);
      case 'p2_72':
        return sheerTwo ? getWaterFeatureName(sheerTwo.featureId) : 'NONE';
      case 'p2_73':
        return formatCount(sheerTwo?.quantity);
      case 'p2_74':
        return bowlSummary.name;
      case 'p2_75':
        return bowlSummary.quantity;
      case 'p2_76':
        return deckJetQty > 0 ? 'STANDARD' : 'NONE';
      case 'p2_77':
        return formatCount(deckJetQty);
      case 'p2_78':
        return laminarQty > 0 ? getWaterFeatureName(laminarSelections[0]?.featureId) : 'NONE';
      case 'p2_79':
        return formatCount(laminarQty);
      case 'p2_80':
        return sconceQty > 0 ? 'STANDARD' : 'NONE';
      case 'p2_81':
        return formatCount(sconceQty);
      default:
        return '';
    }
  }

  if (['p2_82', 'p2_84', 'p2_86', 'p2_88'].includes(field.id)) {
    if (field.id === 'p2_82') return bubblerSummary.name;
    return 'None';
  }

  if (['p2_83', 'p2_85', 'p2_87', 'p2_89'].includes(field.id)) {
    if (field.id === 'p2_83') return bubblerSummary.quantity;
    return '0';
  }

  if (field.id === 'p2_91') return 'BY BUILDER';
  if (field.id === 'p2_92') return 'BY BUYER';
  if (field.id === 'p2_93') return 'BY BUILDER';
  if (field.id === 'p2_94') return 'YES';
  if (field.id === 'p2_95') return 'INCLUDED';

  if (field.id === 'p2_53' || field.id === 'p2_54') {
    const spaLights = proposal.equipment?.spaLights || [];
    const spaLightCount = spaLights.length;
    if (field.id === 'p2_53') return spaLightCount > 0 ? 'Standard' : 'NONE';
    return formatCount(spaLightCount);
  }

  if (field.id === 'p2_56') return 'NONE';
  if (field.id === 'p2_58') return getContractBlowerValue(proposal);
  if (field.id === 'p2_62') return 'NO';
  if (field.id === 'p2_65') return 'NO';
  if (field.id === 'p2_67') return proposal.poolSpecs?.isRaisedSpa ? 'YES' : 'NO';
  if (field.id === 'p2_69') return formatRaisedSpaFacing(proposal.poolSpecs?.raisedSpaFacing);

  if (field.id === 'p2_60' || field.id === 'p2_61' || field.id === 'p2_63' || field.id === 'p2_64') {
    const groups = groupLightSelections(proposal.equipment?.poolLights || []);
    const primary = groups[0];
    const secondary = groups[1];
    if (field.id === 'p2_60') return primary?.name || 'None';
    if (field.id === 'p2_61') return primary ? String(primary.count) : '0';
    if (field.id === 'p2_63') return secondary?.name || 'None';
    if (field.id === 'p2_64') return secondary ? String(secondary.count) : '0';
  }

  if (field.id === 'p2_66') {
    const automationName = proposal.equipment?.automation?.name || '';
    const automationQty = Number(proposal.equipment?.automationQuantity || 0);
    if (!automationName || automationName.toLowerCase().includes('no automation') || automationQty <= 0) {
      return 'None';
    }
    return stripParenSuffix(automationName) || 'None';
  }

  if (
    [
      'p1_17',
      'p1_18',
      'p1_19',
      'p1_20',
      'p1_house_water_well',
      'p1_house_water_municipal',
      'p1_house_sewer_septic',
      'p1_house_sewer_municipal',
    ].includes(field.id)
  ) {
    return '';
  }

  if (field.id === 'p1_body_buyer_name') return info.customerName || '';
  if (field.id === 'p1_body_job_site_address') return info.address || '';
  if (/job site/.test(label) || /address/.test(label)) return info.address || '';
  if (/customer/.test(label) && /name/.test(label)) return info.customerName || '';
  if (/buyer/.test(label) && /name/.test(label)) return info.customerName || '';
  if (field.id === 'p1_county') return info.county || '';
  if (field.id === 'p1_state') return info.state || 'NC';
  if (/city/.test(label) && !/surface/.test(label)) return info.city || '';
  if (/zip/.test(label)) return parseZipFromAddress(info.address) || '';
  if (/phone/.test(label)) return normalizePhone(info.phone);
  if (field.id === 'p1_5' || field.id === 'p2_49') return info.email || '';
  if (field.id === 'p1_6' || field.id === 'p2_50') return '';
  if (/email/.test(label)) return info.email || '';

  if (/cash price/.test(label) || /retail price/.test(label) || /\$0\.00.*cash/.test(label)) {
    return formatCurrency(pricing);
  }

  if (field.id === 'p1_installment_count') return '4';

  // Payment schedule values are derived from the remaining cash price after subtracting the entered deposit.
  if (field.id.startsWith('p1_pay_')) return '';
  if (/non-refundable deposit/.test(label)) return '';
  if (/prior to shotcete/.test(label) || /prior to excavation/.test(label)) return '';
  if (/prior to decking/.test(label)) return '';
  if (/prior to interior finish/.test(label)) return '';

  if (/construction to substanstially commence/.test(label)) return '';
  if (/construction to be substanstially complete/.test(label)) return '';

  if (field.id === 'p2_spa_length') return specs.spaLength ? String(specs.spaLength) : '';
  if (field.id === 'p2_spa_width') return specs.spaWidth ? String(specs.spaWidth) : '';
  if (/spa perimeter/.test(label)) return specs.spaPerimeter ? String(specs.spaPerimeter) : '';
  if (/perimeter/.test(label) && /surface area/.test(label)) return String(specs.surfaceArea || '');
  if (/perimeter/.test(label)) return String(specs.perimeter || '');
  if (/surface area/.test(label)) return String(specs.surfaceArea || '');
  if (/pool size/.test(label) && field.id === 'p1_12') return String(specs.maxLength || '');
  if (/pool size/.test(label) && field.id === 'p1_13') return String(specs.maxWidth || '');
  if (/pool depth/.test(label) && field.id === 'p1_14') return String(specs.shallowDepth || '');
  if (/pool depth/.test(label) && field.id === 'p1_15') return String(specs.endDepth || '');
  if (/pool depth/.test(label) && field.id === 'p1_16') return '';
  if (field.id === 'p1_pool_style') return specs.poolShape === 'freeform' ? 'Freeform' : 'Geometric';
  if (field.id === 'p1_fiberglass_shell_name') return specs.fiberglassModelName || '';

  if (/hoa approval/.test(label)) return 'YES';
  if (/financing required/.test(label)) return 'NO';

  if (field.id === 'p1_21' || /\b(auxiliary|additional) pump i\b/.test(label)) {
    return getAdditionalPrimaryPumpContractNames(proposal)[0] || 'None';
  }
  if (field.id === 'p1_22' || /\b(auxiliary|additional) pump ii\b/.test(label)) {
    return getAdditionalPrimaryPumpContractNames(proposal)[1] || 'None';
  }
  if (/sanitation i/.test(label)) {
    const sanitationSelections = [
      getEffectivePrimarySanitationSystemName(proposal.equipment as any),
      proposal.equipment?.additionalSaltSystem?.name,
    ].filter(Boolean);
    return sanitationSelections.length ? sanitationSelections.join(' + ') : 'None';
  }
  if (/sanitation ii/.test(label)) return 'None';
  if (/sanitation iii/.test(label)) return 'None';
  if (/cleaner/.test(label)) {
    const cleanerQty = proposal.equipment?.cleanerQuantity ?? 0;
    return cleanerQty > 0 ? proposal.equipment?.cleaner?.name || '' : 'None';
  }
  if (/heater/.test(label)) {
    const heaterQty = proposal.equipment?.heaterQuantity ?? 0;
    return heaterQty > 0 ? proposal.equipment?.heater?.name || '' : 'None';
  }
  if (/gas line/.test(label)) {
    return 'None';
  }
  if (/line type/.test(label)) return 'None';
  if (/waterline tile/.test(label)) {
    return specs.poolType === 'fiberglass'
      ? 'None'
      : hasTileSelection(proposal.tileCopingDecking)
      ? 'Included'
      : 'None';
  }
  if (/accent tile/.test(label)) {
    if (specs.poolType === 'fiberglass') return 'None';
    const hasTile = hasTileSelection(proposal.tileCopingDecking);
    return hasTile && proposal.tileCopingDecking?.hasTrimTileOnSteps ? 'Trim Tile' : 'None';
  }
  if (field.id === 'p1_37_size') return proposal.tileCopingDecking?.copingSize || '';
  const primaryDeckingType = proposal.tileCopingDecking?.deckingType || 'none';
  const primaryDeckingArea = getResolvedProposalPrimaryDeckingArea(proposal);
  const additionalDeckingSelections = getAdditionalDeckingSelections(proposal.tileCopingDecking)
    .map((selection) => ({
      deckingType: String(selection.deckingType || '').trim(),
      area: Number(selection.area || 0),
      isOffContract: Boolean(selection.isOffContract),
    }))
    .filter((selection) => selection.deckingType);
  const formatDeckingContractLabel = (
    deckingType: string,
    isOffContract: boolean,
    prefix?: string
  ): string => {
    if (!deckingType || deckingType === 'none') {
      return isOffContract && !prefix ? 'OFF CONTRACT' : '';
    }
    const baseLabel = prefix
      ? `${prefix} - ${getDeckingTypeFullLabel(deckingType)}`
      : getDeckingTypeFullLabel(deckingType);
    return isOffContract ? `${baseLabel} - OFF CONTRACT` : baseLabel;
  };
  if (/coping/.test(label)) {
    const copingType = String(proposal.tileCopingDecking?.copingType || '').trim();
    return copingType && copingType !== 'none'
      ? getCopingOptionLabel(pricingData.tileCoping, copingType) || copingType
      : 'None';
  }
  if (field.id === 'p1_38_qty') {
    const quantities = [
      primaryDeckingType !== 'none' && primaryDeckingArea > 0 ? formatNumberValue(primaryDeckingArea) : '',
      ...additionalDeckingSelections
        .filter((selection) => selection.area > 0)
        .map((selection) => formatNumberValue(selection.area)),
    ].filter(Boolean);

    if (quantities.length > 0) {
      return quantities.join(' + ');
    }

    return formatNumberValue(primaryDeckingArea);
  }
  if (/decking drainage/.test(label)) return proposal.drainage?.deckDrainTotalLF ? 'BY BUILDER' : overrideDefault;
  if (field.id === 'p1_40_qty') return formatNumberValue(proposal.drainage?.downspoutTotalLF);
  if (/decking\b/i.test(label)) {
    const selections = [
      formatDeckingContractLabel(primaryDeckingType, Boolean(proposal.tileCopingDecking?.isDeckingOffContract)),
      ...additionalDeckingSelections.map((selection) =>
        formatDeckingContractLabel(selection.deckingType, selection.isOffContract, 'Additional Decking')
      ),
    ].filter(Boolean);

    if (selections.length > 0) {
      return selections.join(' + ');
    }

    return primaryDeckingType === 'none' ? 'None' : getDeckingTypeFullLabel(primaryDeckingType);
  }

  if (/skimmer/.test(label)) {
    const additional = proposal.plumbing?.runs?.additionalSkimmers || 0;
    return String(1 + (Number.isFinite(additional) ? additional : 0));
  }
  if (field.id === 'p1_36') return '4';
  if (/surface returns/.test(label)) return '4';
  if (/auto-fill/.test(label)) return formatYesNo(proposal.plumbing?.runs?.autoFillRun, overrideDefault || 'NO');
  if (/circulation pump/.test(label)) {
    return getPrimaryPumpContractName(proposal, overrideDefault || 'None');
  }
  if (/filter/.test(label) && !/interior/.test(label)) return proposal.equipment?.filter?.name || overrideDefault;
  if (/spa light/.test(label)) return proposal.poolSpecs?.spaType !== 'none' ? '1' : '0';
  if (/blower/.test(label)) return getContractBlowerValue(proposal);
  if (/interior finish/.test(label)) {
    const finishType = proposal.interiorFinish?.finishType;
    const finishLabel = finishType
      ? getInteriorFinishLabel(finishType)
      : specs.poolType === 'fiberglass'
      ? specs.fiberglassFinishUpgradeName
        ? `Fiberglass - ${specs.fiberglassFinishUpgradeName}`
        : 'Fiberglass'
      : 'Interior Finish';
    const color = proposal.interiorFinish?.color;
    return color ? `${finishLabel}: ${color}` : finishLabel;
  }
  if (/laminar|sheer|jets|water features/.test(label)) {
    const typeMap: Record<string, WaterFeatureSelection[]> = {
      sheer: waterFeatures.sheer,
      laminar: waterFeatures.laminar,
      'deck jets': waterFeatures.deckJet,
      jets: waterFeatures.deckJet,
      bowl: waterFeatures.bowl,
      sconce: waterFeatures.sconce,
      bubbler: waterFeatures.bubbler,
      other: waterFeatures.other,
    };
    const entry = Object.entries(typeMap).find(([key]) => label.includes(key));
    if (entry) {
      const list = entry[1];
      return list?.[0]?.quantity ? String(list[0].quantity) : overrideDefault;
    }
  }

  if (overrideDefault) return overrideDefault;
  return '';
}

export async function getEditableContractFields(
  proposal: Proposal,
  overrides?: ContractOverrides,
  templateId?: ContractTemplateId,
  templateOverride?: ContractTemplate
): Promise<ContractFieldRender[]> {
  const normalized = normalizeProposal(proposal);
  const resolvedTemplateId = templateId || getContractTemplateIdForProposal(proposal);
  const templateFields = (templateOverride || getContractTemplate(resolvedTemplateId)).fields;
  const depositSourceValue =
    resolveContractDepositSourceValue(overrides) || getDefaultContractDepositValue(normalized);
  const totalCashPrice = getContractCashPrice(normalized);
  const schedulePercentages = getContractDepositSchedulePercentages(normalized);
  const fields: ContractFieldRender[] = templateFields
    .filter((field) => (field.label || '').trim().length > 0)
    .map((field) => {
      const [x0, y0, x1, y1] = field.rect;
      const width = x1 - x0;
      const height = y1 - y0;
      let autoValue = computeAutoValue(
        {
          id: field.id,
          page: field.page,
          x: x0,
          y: y0,
          width,
          height,
          label: field.label,
          color: field.color,
          value: '',
          autoValue: '',
          isAutoFilled: false,
          isOverridden: false,
        },
        normalized
      );
      if (
        CONTRACT_DEPOSIT_SOURCE_FIELD_ID_SET.has(field.id) ||
        Object.prototype.hasOwnProperty.call(schedulePercentages, field.id)
      ) {
        autoValue = getContractDepositFieldAutoValue(field.id, depositSourceValue, totalCashPrice, schedulePercentages);
      }
      if (field.id === 'p1_30') autoValue = '1';
      const { hasOverride, value: overrideVal } = resolveMirroredContractOverride(field.id, overrides);
      const value = hasOverride && overrideVal !== null && overrideVal !== undefined ? String(overrideVal) : autoValue;
      const shouldAutoFill = field.id === 'p1_30' ? false : !hasOverride && isMeaningfulAutoValue(autoValue);
      return {
        id: field.id,
        page: field.page,
        x: x0,
        y: y0,
        width,
        height,
        label: field.label,
        color: field.color,
        value: value || '',
        autoValue,
        isAutoFilled: shouldAutoFill,
        isOverridden: hasOverride,
      };
    });

  return fields;
}

export function validateContractInputs(proposal: Proposal): string[] {
  const warnings: string[] = [];
  const info = proposal.customerInfo || {};
  const specs = proposal.poolSpecs || ({} as Proposal['poolSpecs']);
  const pricing = proposal.pricing || {};

  if (!info.customerName?.trim()) warnings.push('Customer name');
  if (!info.address?.trim()) warnings.push('Job site address');
  if (!info.city?.trim()) warnings.push('City');
  if (!specs.perimeter) warnings.push('Pool perimeter');
  if (!specs.surfaceArea) warnings.push('Surface area');
  if (!specs.maxLength) warnings.push('Pool length');
  if (!specs.maxWidth) warnings.push('Pool width');
  if (!specs.shallowDepth) warnings.push('Shallow depth');
  if (!specs.endDepth) warnings.push('Deep depth');
  if (!(pricing.retailPrice || pricing.baseRetailPrice)) warnings.push('Retail price');

  return warnings;
}
