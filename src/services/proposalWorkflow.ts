import {
  type CostLineItem,
  type Proposal,
  type ProposalActorRole,
  type ProposalWorkflowActor,
  type ProposalWorkflowEvent,
  type ProposalWorkflowReason,
  type ProposalWorkflowState,
  type ProposalWorkflowStatus,
} from '../types/proposal-new';
import {
  getSessionApprovalMarginThreshold,
  getSessionAlwaysRequireApproval,
  getSessionDiscountAllowanceThreshold,
  readSession,
  type UserSession,
} from './session';
import { listAllVersions, ORIGINAL_VERSION_ID } from '../utils/proposalVersions';
import pricingData from './pricingData';
import {
  getAdditionalDeckingSelections,
  getDeckingTypeFullLabel,
  getResolvedProposalPrimaryDeckingArea,
} from '../utils/decking';
import {
  getCopingOptionLabel,
  getTileOptionLabel,
  getTileSelectionId,
  getTrimTileOptionLabel,
  getTrimTileSelectionId,
  isLegacyTrimTileSelection,
} from '../utils/tileCopingCatalogs';
import { getPricingTierName } from './pricingTiers';
import { getExcavationOptionQuantity } from '../utils/excavationOptionQuantities';
import { isPpasEastProposal } from '../utils/franchiseScope';

export type SubmissionRequest = {
  manualReviewRequested?: boolean;
  message?: string;
};

export type VersionDiffFieldChange = {
  label: string;
  before: string | null;
  after: string | null;
  kind: 'added' | 'removed' | 'changed';
};

export type VersionDiffCostChange = {
  label: string;
  category: string;
  beforeQuantity: number;
  afterQuantity: number;
  beforeUnitPrice: number;
  afterUnitPrice: number;
  beforeTotal: number;
  afterTotal: number;
  delta: number;
  kind: 'added' | 'removed' | 'changed';
};

export type VersionDiffCategory = {
  key: string;
  label: string;
  totalDelta: number;
  changeCount: number;
  fieldChanges: VersionDiffFieldChange[];
  costChanges: VersionDiffCostChange[];
};

export type VersionDiffSummary = {
  reviewVersionId: string;
  compareVersionId?: string | null;
  approvedVersionId?: string | null;
  reviewVersionName: string;
  compareVersionName?: string | null;
  comparisonKind: 'initial_submission' | 'proposal_addendum' | 'signed_addendum';
  changedSections: string[];
  retailDelta: number;
  costDelta: number;
  grossProfitDelta: number;
  grossMarginDelta: number;
  discountDelta: number;
  contractOverrideDelta: number;
  noteIndicator: boolean;
  categories: VersionDiffCategory[];
};

export type WorkflowSubmissionPreview = {
  reasons: ProposalWorkflowReason[];
  requiresApproval: boolean;
  willAutoApprove: boolean;
  approvalRequiredByUserSetting: boolean;
};

export type ProposalSelectionField = {
  key: string;
  label: string;
  value: string | null;
};

export type ProposalSelectionCategory = {
  key: string;
  label: string;
  fields: ProposalSelectionField[];
};

type WorkflowFieldExtractOptions = {
  includeEmpty?: boolean;
};

type WorkflowFieldSnapshot = {
  key: string;
  label: string;
  value: string;
};

type WorkflowDiffGroupDefinition = {
  key: string;
  label: string;
  costKeys: Array<keyof Proposal['costBreakdown']>;
  extractFields: (proposal: Proposal, options?: WorkflowFieldExtractOptions) => WorkflowFieldSnapshot[];
};

const REVIEW_PENDING_STATUSES: ProposalWorkflowStatus[] = ['needs_approval', 'changes_requested'];
const COST_DIFF_GROUPS: WorkflowDiffGroupDefinition[] = [];

function randomId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value?: string | null) {
  return String(value || '').trim();
}

function normalizeRole(value?: string | null): ProposalActorRole {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'master') return 'master';
  if (normalized === 'owner') return 'owner';
  if (normalized === 'admin') return 'admin';
  if (normalized === 'bookkeeper') return 'bookkeeper';
  return 'designer';
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getCurrentSession(session?: UserSession | null) {
  return session ?? readSession();
}

function isPendingReviewStatus(status?: ProposalWorkflowStatus | null) {
  return REVIEW_PENDING_STATUSES.includes((status || 'draft') as ProposalWorkflowStatus);
}

function dedupeVersionIds(ids?: Array<string | null | undefined>, fallbackId?: string | null) {
  const seen = new Set<string>();
  return [...(ids || []), fallbackId]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function getVersionById(proposal: Proposal, versionId?: string | null) {
  const targetId = normalizeText(versionId);
  if (!targetId) return null;
  return (
    listAllVersions(proposal).find((entry) => (entry.versionId || ORIGINAL_VERSION_ID) === targetId) ||
    null
  );
}

function normalizeHistory(history?: ProposalWorkflowEvent[] | null) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      ...entry,
      id: entry.id || randomId('workflow'),
      createdAt: entry.createdAt || nowIso(),
      readByUserIds: Array.isArray(entry.readByUserIds) ? entry.readByUserIds.filter(Boolean) : [],
    }));
}

function hasRevokedApproval(
  history: ProposalWorkflowEvent[] | null | undefined,
  versionId?: string | null
) {
  const targetId = normalizeText(versionId);
  if (!targetId) return false;

  let lastApprovedIndex = -1;
  let lastChangesRequestedIndex = -1;
  normalizeHistory(history).forEach((entry, index) => {
    const entryVersionId = normalizeText(entry.versionId) || ORIGINAL_VERSION_ID;
    if (entryVersionId !== targetId) return;
    if (entry.type === 'approved') lastApprovedIndex = index;
    if (entry.type === 'changes_requested') lastChangesRequestedIndex = index;
  });

  return lastApprovedIndex >= 0 && lastChangesRequestedIndex > lastApprovedIndex;
}

function getEffectiveApprovedVersionIds(
  history: ProposalWorkflowEvent[] | null | undefined,
  ids?: Array<string | null | undefined>,
  fallbackId?: string | null
) {
  return dedupeVersionIds(ids, fallbackId).filter((versionId) => !hasRevokedApproval(history, versionId));
}

function getEffectiveSignedAddendumVersionIds(ids?: Array<string | null | undefined>) {
  return dedupeVersionIds(ids);
}

function getNonPapDiscountTotal(proposal: Partial<Proposal>) {
  const retailAdjustments = Array.isArray(proposal.retailAdjustments) ? proposal.retailAdjustments : [];
  const retailDiscountTotal = retailAdjustments.reduce((sum, adjustment) => {
    const amount = toFiniteNumber(adjustment?.amount);
    return amount < 0 ? sum + Math.abs(amount) : sum;
  }, 0);
  const manualAdjustments = proposal.manualAdjustments || ({} as Proposal['manualAdjustments']);
  const manualDiscountTotal =
    Math.abs(Math.min(0, toFiniteNumber((manualAdjustments as any).negative1))) +
    Math.abs(Math.min(0, toFiniteNumber((manualAdjustments as any).negative2)));
  return retailDiscountTotal + manualDiscountTotal;
}

function formatNumber(value: unknown, suffix = '') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })}${suffix}`;
}

function formatCurrencyValue(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric);
}

function formatBoolean(value: unknown) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return '';
}

function compactSnapshots(
  entries: WorkflowFieldSnapshot[],
  options?: WorkflowFieldExtractOptions
) {
  if (options?.includeEmpty) {
    return entries.map((entry) => ({
      ...entry,
      value: normalizeText(entry.value),
    }));
  }
  return entries.filter((entry) => normalizeText(entry.value).length > 0);
}

function compareSnapshots(currentEntries: WorkflowFieldSnapshot[], previousEntries: WorkflowFieldSnapshot[]) {
  const currentMap = new Map(currentEntries.map((entry) => [entry.key, entry]));
  const previousMap = new Map(previousEntries.map((entry) => [entry.key, entry]));
  const keys = Array.from(new Set([...currentMap.keys(), ...previousMap.keys()]));

  return keys
    .map((key) => {
      const current = currentMap.get(key);
      const previous = previousMap.get(key);
      const after = normalizeText(current?.value) || null;
      const before = normalizeText(previous?.value) || null;
      if (before === after) return null;
      return {
        label: current?.label || previous?.label || key,
        before,
        after,
        kind: before && after ? 'changed' : after ? 'added' : 'removed',
      } as VersionDiffFieldChange;
    })
    .filter((entry): entry is VersionDiffFieldChange => Boolean(entry));
}

function collectCostItems(proposal?: Partial<Proposal> | null, keys?: Array<keyof Proposal['costBreakdown']>) {
  if (!proposal?.costBreakdown || !keys?.length) return [] as CostLineItem[];
  return keys.flatMap((key) => {
    const items = proposal.costBreakdown?.[key];
    return Array.isArray(items) ? items : [];
  });
}

function compareCostItems(
  currentItems: CostLineItem[],
  previousItems: CostLineItem[]
) {
  const keyFor = (item: CostLineItem) => `${normalizeText(item.category)}::${normalizeText(item.description)}`;
  const currentMap = new Map(currentItems.map((item) => [keyFor(item), item]));
  const previousMap = new Map(previousItems.map((item) => [keyFor(item), item]));
  const keys = Array.from(new Set([...currentMap.keys(), ...previousMap.keys()]));

  return keys
    .map((key) => {
      const current = currentMap.get(key);
      const previous = previousMap.get(key);
      const beforeQuantity = toFiniteNumber(previous?.quantity);
      const afterQuantity = toFiniteNumber(current?.quantity);
      const beforeUnitPrice = toFiniteNumber(previous?.unitPrice);
      const afterUnitPrice = toFiniteNumber(current?.unitPrice);
      const beforeTotal = toFiniteNumber(previous?.total);
      const afterTotal = toFiniteNumber(current?.total);

      if (
        beforeQuantity === afterQuantity &&
        beforeUnitPrice === afterUnitPrice &&
        beforeTotal === afterTotal
      ) {
        return null;
      }

      return {
        label: normalizeText(current?.description || previous?.description) || 'Cost Item',
        category: normalizeText(current?.category || previous?.category) || 'Cost',
        beforeQuantity,
        afterQuantity,
        beforeUnitPrice,
        afterUnitPrice,
        beforeTotal,
        afterTotal,
        delta: afterTotal - beforeTotal,
        kind: previous && current ? 'changed' : current ? 'added' : 'removed',
      } as VersionDiffCostChange;
    })
    .filter((entry): entry is VersionDiffCostChange => Boolean(entry))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.label.localeCompare(b.label));
}

function normalizeVisibleVersionList(proposal: Proposal, versionIds: string[]) {
  const allVersions = listAllVersions(proposal);
  return versionIds
    .map((versionId) =>
      allVersions.find((entry) => (entry.versionId || ORIGINAL_VERSION_ID) === versionId) || null
    )
    .filter((entry): entry is Proposal => Boolean(entry));
}

function isLikelyPostSignAddendumVersion(
  version: Partial<Proposal> | null | undefined,
  signedAt?: string | null
) {
  const versionName = normalizeText(version?.versionName).toLowerCase();
  if (versionName.includes('addendum')) return true;

  const signedTimestamp = Date.parse(normalizeText(signedAt));
  const versionTimestamp = Date.parse(normalizeText(version?.createdDate || version?.lastModified));
  return Number.isFinite(signedTimestamp) && Number.isFinite(versionTimestamp) && versionTimestamp > signedTimestamp;
}

function shouldDowngradeLegacySignedProposal(proposal: Proposal) {
  const rawStatus = normalizeText(proposal.status).toLowerCase();
  if (rawStatus !== 'signed') return false;

  const workflow = proposal.workflow || ({} as ProposalWorkflowState);
  const signedVersionId =
    normalizeText(workflow.signedVersionId) ||
    normalizeText(proposal.activeVersionId) ||
    normalizeText(proposal.versionId) ||
    ORIGINAL_VERSION_ID;
  if (!signedVersionId) return false;

  if (getEffectiveSignedAddendumVersionIds(workflow.signedAddendumVersionIds).length > 0) return false;

  const approvedVersionId = normalizeText(workflow.approvedVersionId);
  const reviewVersionId = normalizeText(workflow.reviewVersionId);
  if ((approvedVersionId && approvedVersionId !== signedVersionId) || (reviewVersionId && reviewVersionId !== signedVersionId)) {
    return false;
  }

  const extraVersions = listAllVersions(proposal).filter(
    (entry) => (entry.versionId || ORIGINAL_VERSION_ID) !== signedVersionId
  );
  if (!extraVersions.length) return false;

  const signedAt = normalizeText(workflow.signedAt || proposal.versionLockedAt || null);
  return !extraVersions.some((entry) => isLikelyPostSignAddendumVersion(entry, signedAt));
}

function buildDetailedDiffCategories(current: Proposal, previous: Proposal) {
  return COST_DIFF_GROUPS
    .map((group) => {
      const fieldChanges = compareSnapshots(group.extractFields(current), group.extractFields(previous));
      const costChanges = compareCostItems(
        collectCostItems(current, group.costKeys),
        collectCostItems(previous, group.costKeys)
      );
      const totalDelta = costChanges.reduce((sum, entry) => sum + entry.delta, 0);
      const changeCount = fieldChanges.length + costChanges.length;
      if (!changeCount) return null;
      return {
        key: group.key,
        label: group.label,
        totalDelta,
        changeCount,
        fieldChanges,
        costChanges,
      } as VersionDiffCategory;
    })
    .filter((entry): entry is VersionDiffCategory => Boolean(entry));
}

function formatNamedSelection(selection?: { name?: string | null } | null, noneToken?: string) {
  const name = normalizeText(selection?.name);
  if (!name) return 'None';
  if (noneToken && name.toLowerCase().includes(noneToken)) return 'None';
  return name;
}

function summarizeNamedList(
  entries: Array<string | null | undefined>,
  options?: {
    noneValue?: string;
  }
) {
  const counts = new Map<string, number>();
  entries
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .forEach((entry) => {
      counts.set(entry, (counts.get(entry) || 0) + 1);
    });

  const labels = Array.from(counts.entries()).map(([entry, count]) => (count > 1 ? `${entry} x${count}` : entry));
  return labels.length ? labels.join(', ') : options?.noneValue || 'None';
}

function summarizeCustomOptions(options?: Proposal['customFeatures']['features'] | Proposal['equipment']['customOptions']) {
  if (!Array.isArray(options) || options.length === 0) return 'None';
  return summarizeNamedList(options.map((entry) => entry?.name));
}

function summarizeRbbLevels(levels?: Proposal['excavation']['rbbLevels']) {
  if (!Array.isArray(levels) || levels.length === 0) return 'None';
  return levels
    .map((level) => {
      const height = Number.isFinite(level?.height) ? `${level.height}"` : '';
      const length = formatNumber(level?.length, ' LF');
      const facing = normalizeText(level?.facing);
      const backsideFacing = normalizeText(level?.backsideFacing);
      const backside =
        backsideFacing && backsideFacing.toLowerCase() !== 'none'
          ? `Backside: ${backsideFacing}`
          : level?.hasBacksideFacing
            ? 'Backside: same facing'
            : '';
      return [height, length, facing, backside].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

function summarizeColumns(columns?: Proposal['excavation']['columns']) {
  if (!columns || !Number.isFinite(columns.count) || columns.count <= 0) return 'None';
  return `${columns.count} columns at ${formatNumber(columns.width, ' ft')} x ${formatNumber(columns.depth, ' ft')} x ${formatNumber(columns.height, ' ft')}`;
}

function summarizeRetainingWalls(walls?: Proposal['excavation']['retainingWalls']) {
  if (!Array.isArray(walls) || walls.length === 0) return 'None';
  return walls
    .map((wall) => {
      const type = normalizeText(wall?.type);
      const length = formatNumber(wall?.length, ' LF');
      return [type, length].filter(Boolean).join(' ');
    })
    .filter(Boolean)
    .join(', ');
}

function summarizeWaterFeatureSelections(waterFeatures?: Proposal['waterFeatures']) {
  const selections = Array.isArray(waterFeatures?.selections) ? waterFeatures?.selections : [];
  if (!selections.length) return 'None';
  return selections
    .map((selection) => {
      const featureId = normalizeText(selection?.featureId) || 'Feature';
      const quantity = Math.max(toFiniteNumber(selection?.quantity), 0);
      const actuator = selection?.includeValveActuator ? ' + actuator' : '';
      return `${featureId} x${quantity || 1}${actuator}`;
    })
    .join(', ');
}

function summarizeCustomFeatures(features?: Proposal['customFeatures']['features']) {
  if (!Array.isArray(features) || features.length === 0) return 'None';
  return features
    .map((feature) => {
      const name = normalizeText(feature?.name) || 'Custom Feature';
      const sqft = toFiniteNumber(feature?.groupedSqft);
      return sqft > 0 ? `${name} (${formatNumber(sqft, ' SQFT')})` : name;
    })
    .join(', ');
}

function summarizeRetailAdjustments(adjustments?: Proposal['retailAdjustments']) {
  if (!Array.isArray(adjustments) || adjustments.length === 0) return 'None';
  return adjustments
    .map((adjustment) => `${normalizeText(adjustment?.name) || 'Adjustment'} ${formatCurrencyValue(adjustment?.amount)}`)
    .join(', ');
}

function summarizeContractOverrides(overrides?: Proposal['contractOverrides']) {
  const entries = Object.entries(overrides || {}).filter(([, value]) => value !== null && value !== undefined && normalizeText(String(value)) !== '');
  if (!entries.length) return 'None';
  return `${entries.length} overridden field${entries.length === 1 ? '' : 's'}`;
}

function summarizeWarrantySections(sections?: Proposal['warrantySections']) {
  if (!Array.isArray(sections) || sections.length === 0) return 'None';
  return summarizeNamedList(sections.map((section) => section?.title), { noneValue: 'None' });
}

function summarizePumpArray(
  pumps?: Array<{ name?: string | null; autoAddedReason?: 'spa' | 'waterFeature' | 'fiberglass' | null }>
) {
  if (!Array.isArray(pumps) || pumps.length === 0) return 'None';
  return pumps
    .map((pump) => {
      const name = normalizeText(pump?.name) || 'Pump';
      const reason =
        pump?.autoAddedReason === 'spa'
          ? 'auto for spa'
          : pump?.autoAddedReason === 'fiberglass'
          ? 'required by fiberglass'
          : pump?.autoAddedReason === 'waterFeature'
          ? 'auto for water feature'
          : '';
      return reason ? `${name} (${reason})` : name;
    })
    .join(', ');
}

function extractPoolSpecsFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const specs = proposal.poolSpecs || ({} as Proposal['poolSpecs']);
  return compactSnapshots([
    { key: 'poolType', label: 'Pool Type', value: normalizeText(specs.poolType) },
    { key: 'poolShape', label: 'Pool Shape', value: normalizeText(specs.poolShape) },
    { key: 'fiberglassSize', label: 'Fiberglass Size', value: normalizeText(specs.fiberglassSize) },
    { key: 'fiberglassModel', label: 'Fiberglass Model', value: normalizeText(specs.fiberglassModelName) },
    { key: 'fiberglassFinishUpgrade', label: 'Finish Upgrade', value: normalizeText(specs.fiberglassFinishUpgradeName) },
    { key: 'perimeter', label: 'Pool Perimeter', value: formatNumber(specs.perimeter, ' LF') },
    { key: 'surfaceArea', label: 'Pool Surface Area', value: formatNumber(specs.surfaceArea, ' SQFT') },
    { key: 'maxWidth', label: 'Max Width', value: formatNumber(specs.maxWidth, ' FT') },
    { key: 'maxLength', label: 'Max Length', value: formatNumber(specs.maxLength, ' FT') },
    { key: 'shallowDepth', label: 'Shallow Depth', value: formatNumber(specs.shallowDepth, ' FT') },
    { key: 'endDepth', label: 'End Depth', value: formatNumber(specs.endDepth, ' FT') },
    { key: 'stepsBench', label: 'Steps / Bench', value: formatNumber(specs.totalStepsAndBench, ' LF') },
    { key: 'tanningShelf', label: 'Tanning Shelf', value: formatBoolean(specs.hasTanningShelf) },
    { key: 'fiberglassTanningLedge', label: 'Fiberglass Tanning Ledge', value: normalizeText(specs.fiberglassTanningLedgeName) },
    { key: 'spaType', label: 'Spa Type', value: normalizeText(specs.spaType) || 'None' },
    { key: 'fiberglassSpa', label: 'Fiberglass Spa', value: normalizeText(specs.spaFiberglassModelName) },
    { key: 'spaSize', label: 'Spa Size', value: [formatNumber(specs.spaLength, ' FT'), formatNumber(specs.spaWidth, ' FT')].filter(Boolean).join(' x ') },
    { key: 'spaPerimeter', label: 'Spa Perimeter', value: formatNumber(specs.spaPerimeter, ' LF') },
    { key: 'raisedSpa', label: 'Raised Spa', value: formatBoolean(specs.isRaisedSpa) },
    { key: 'raisedSpaFacing', label: 'Raised Spa Facing', value: normalizeText(specs.raisedSpaFacing) },
    { key: 'spillover', label: 'Spa Spillover', value: formatBoolean(specs.hasSpillover) },
    { key: 'deckingArea', label: 'Decking Area', value: formatNumber(specs.deckingArea, ' SQFT') },
    { key: 'travelDistance', label: 'Travel Distance', value: formatNumber(specs.travelDistance, ' MI') },
    { key: 'streetDistance', label: 'Pool To Street Distance', value: formatNumber(specs.poolToStreetDistance) },
    { key: 'automaticCover', label: 'Automatic Cover', value: formatBoolean(specs.hasAutomaticCover) },
    { key: 'waterfallCount', label: 'Waterfall Count', value: formatNumber(specs.waterfallCount) },
  ], options);
}

function extractExcavationFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const excavation = proposal.excavation || ({} as Proposal['excavation']);
  return compactSnapshots([
    { key: 'rbbSqft', label: 'Raised Bond Beam Area', value: formatNumber(excavation.totalRBBSqft, ' SQFT') },
    { key: 'rbbLevels', label: 'Raised Bond Beam Levels', value: summarizeRbbLevels(excavation.rbbLevels) },
    { key: 'exposedPoolWalls', label: 'Exposed Pool Walls', value: summarizeRbbLevels(excavation.exposedPoolWallLevels) },
    { key: 'columns', label: 'Columns', value: summarizeColumns(excavation.columns) },
    { key: 'sitePrepHours', label: 'Site Prep Hours', value: formatNumber(excavation.additionalSitePrepHours, ' HRS') },
    {
      key: 'gravelInstall',
      label: 'Gravel Install',
      value: excavation.hasGravelInstall
        ? `Yes (x${getExcavationOptionQuantity(true, excavation.gravelInstallQuantity)})`
        : 'No',
    },
    {
      key: 'dirtHaul',
      label: 'Dirt Haul',
      value: excavation.hasDirtHaul
        ? `Yes (x${getExcavationOptionQuantity(true, excavation.dirtHaulQuantity)})`
        : 'No',
    },
    { key: 'additionalBench', label: 'Additional Bench', value: formatNumber(excavation.additionalBench, ' LF') },
    { key: 'doubleCurtain', label: 'Double Curtain', value: formatNumber(excavation.doubleCurtainLength, ' LF') },
    { key: 'tightAccessJob', label: 'Tight Access Job', value: formatBoolean(excavation.hasTightAccessJob) },
    { key: 'soilEngineer', label: 'Soil Sample / Engineer', value: formatBoolean(excavation.needsSoilSampleEngineer) },
    { key: 'retainingWalls', label: 'Retaining Walls', value: summarizeRetainingWalls(excavation.retainingWalls) },
    { key: 'customOptions', label: 'Excavation Options', value: summarizeCustomOptions(excavation.customOptions) },
  ], options);
}

function extractPlumbingFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const plumbing = proposal.plumbing || ({} as Proposal['plumbing']);
  const runs = plumbing.runs || ({} as Proposal['plumbing']['runs']);
  return compactSnapshots([
    { key: 'skimmerRun', label: 'Skimmer Run', value: formatNumber(runs.skimmerRun, ' LF') },
    { key: 'additionalSkimmers', label: 'Additional Skimmers', value: formatNumber(runs.additionalSkimmers) },
    { key: 'mainDrainRun', label: 'Main Drain Run', value: formatNumber(runs.mainDrainRun, ' LF') },
    { key: 'cleanerRun', label: 'Cleaner Run', value: formatNumber(runs.cleanerRun, ' LF') },
    { key: 'autoFillRun', label: 'Auto-Fill Run', value: formatNumber(runs.autoFillRun, ' LF') },
    { key: 'autoFillElectricRun', label: 'Auto-Fill Conduit Run', value: formatNumber(runs.autoFillElectricRun, ' LF') },
    { key: 'waterFeature1Run', label: 'Water Feature 1 Run', value: formatNumber(runs.waterFeature1Run, ' LF') },
    { key: 'waterFeature2Run', label: 'Water Feature 2 Run', value: formatNumber(runs.waterFeature2Run, ' LF') },
    { key: 'waterFeature3Run', label: 'Water Feature 3 Run', value: formatNumber(runs.waterFeature3Run, ' LF') },
    { key: 'waterFeature4Run', label: 'Water Feature 4 Run', value: formatNumber(runs.waterFeature4Run, ' LF') },
    { key: 'infloorValveToEq', label: 'Infloor Valve To Equipment', value: formatNumber(runs.infloorValveToEQ, ' LF') },
    { key: 'infloorValveToPool', label: 'Infloor Valve To Pool', value: formatNumber(runs.infloorValveToPool, ' LF') },
    { key: 'spaRun', label: 'Spa Run', value: formatNumber(runs.spaRun, ' LF') },
    { key: 'customOptions', label: 'Plumbing Options', value: summarizeCustomOptions(plumbing.customOptions) },
  ], options);
}

function extractElectricalFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const electrical = proposal.electrical || ({} as Proposal['electrical']);
  const runs = electrical.runs || ({} as Proposal['electrical']['runs']);
  const plumbingRuns = proposal.plumbing?.runs || ({} as Proposal['plumbing']['runs']);
  return compactSnapshots([
    { key: 'gasRun', label: 'Gas Run', value: formatNumber(plumbingRuns.gasRun, ' LF') },
    { key: 'electricalRun', label: 'Equipment Electrical Run', value: formatNumber(runs.electricalRun, ' LF') },
    { key: 'lightRun', label: 'Light Run', value: formatNumber(runs.lightRun, ' LF') },
    { key: 'heatPumpElectricalRun', label: 'Heat Pump Electrical Run', value: formatNumber(runs.heatPumpElectricalRun, ' LF') },
    { key: 'customOptions', label: 'Electrical Options', value: summarizeCustomOptions(electrical.customOptions) },
  ], options);
}

function extractTileCopingDeckingFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const tile = proposal.tileCopingDecking || ({} as Proposal['tileCopingDecking']);
  const additionalDeckingSelections = getAdditionalDeckingSelections(tile);
  const primaryDeckingArea = getResolvedProposalPrimaryDeckingArea(proposal);
  const isFiberglass = proposal.poolSpecs?.poolType === 'fiberglass';
  const tileSelectionId = isFiberglass ? '' : getTileSelectionId(tile);
  const trimTileSelectionId = isFiberglass ? '' : getTrimTileSelectionId(tile);
  return compactSnapshots([
    {
      key: 'tileOption',
      label: 'Tile Option',
      value: tileSelectionId ? getTileOptionLabel(pricingData.tileCoping, tileSelectionId) : 'None',
    },
    {
      key: 'additionalTileLength',
      label: 'Additional Tile Length',
      value: formatNumber(isFiberglass ? 0 : tile.additionalTileLength, ' LF'),
    },
    {
      key: 'trimTile',
      label: 'Trim Tile On Steps',
      value: trimTileSelectionId
        ? isLegacyTrimTileSelection(tile)
          ? formatBoolean(true)
          : getTrimTileOptionLabel(pricingData.tileCoping, trimTileSelectionId)
        : 'None',
    },
    {
      key: 'copingType',
      label: 'Coping Type',
      value: tile.copingType && tile.copingType !== 'none'
        ? getCopingOptionLabel(pricingData.tileCoping, tile.copingType)
        : 'None',
    },
    { key: 'copingSize', label: 'Coping Size', value: normalizeText(tile.copingSize) },
    { key: 'copingLength', label: 'Coping Length', value: formatNumber(tile.copingLength, ' LF') },
    {
      key: 'deckingType',
      label: 'Decking Type',
      value: tile.deckingType && tile.deckingType !== 'none' ? getDeckingTypeFullLabel(tile.deckingType) : 'None',
    },
    { key: 'deckingArea', label: 'Decking Area', value: formatNumber(primaryDeckingArea, ' SQFT') },
    {
      key: 'additionalDecking',
      label: 'Additional Decking',
      value: additionalDeckingSelections.length
        ? additionalDeckingSelections
            .map((selection) => `${getDeckingTypeFullLabel(selection?.deckingType) || 'Decking'} ${formatNumber(selection?.area, ' SQFT')}`)
            .join(', ')
        : 'None',
    },
    { key: 'concreteSteps', label: 'Concrete Steps', value: formatNumber(tile.concreteStepsLength, ' LF') },
    { key: 'bullnose', label: 'Bullnose', value: formatNumber(tile.bullnoseLnft, ' LF') },
    { key: 'doubleBullnose', label: 'Double Bullnose', value: formatNumber(tile.doubleBullnoseLnft, ' LF') },
    { key: 'spillway', label: 'Spillway', value: formatNumber(tile.spillwayLnft, ' LF') },
    { key: 'panelLedgeRockwork', label: 'Panel Ledge Rockwork', value: formatNumber(tile.rockworkPanelLedgeSqft, ' SQFT') },
    { key: 'stackedStone', label: 'Stacked Stone', value: formatNumber(tile.rockworkStackedStoneSqft, ' SQFT') },
    { key: 'tileRockwork', label: 'Tile Rockwork', value: formatNumber(tile.rockworkTileSqft, ' SQFT') },
    { key: 'roughGrading', label: 'Rough Grading', value: formatBoolean(tile.hasRoughGrading) },
    { key: 'customOptions', label: 'Tile / Decking Options', value: summarizeCustomOptions(tile.customOptions) },
  ], options);
}

function extractDrainageFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const drainage = proposal.drainage || ({} as Proposal['drainage']);
  return compactSnapshots([
    { key: 'downspouts', label: 'Downspouts', value: formatNumber(drainage.downspoutTotalLF, ' LF') },
    { key: 'deckDrain', label: 'Deck Drain', value: formatNumber(drainage.deckDrainTotalLF, ' LF') },
    { key: 'frenchDrain', label: 'French Drain', value: formatNumber(drainage.frenchDrainTotalLF, ' LF') },
    { key: 'boxDrain', label: 'Box Drain', value: formatNumber(drainage.boxDrainTotalLF, ' LF') },
    { key: 'customOptions', label: 'Drainage Options', value: summarizeCustomOptions(drainage.customOptions) },
  ], options);
}

function extractEquipmentFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const equipment = proposal.equipment || ({} as Proposal['equipment']);
  const poolLights = Array.isArray(equipment.poolLights) ? equipment.poolLights : [];
  const spaLights = Array.isArray(equipment.spaLights) ? equipment.spaLights : [];
  return compactSnapshots([
    { key: 'pump', label: 'Pump', value: formatNamedSelection(equipment.pump, 'no pump') },
    { key: 'pumpQty', label: 'Pump Quantity', value: formatNumber(equipment.pumpQuantity) },
    { key: 'additionalPumps', label: 'Additional Pumps', value: summarizePumpArray(equipment.additionalPumps) },
    { key: 'auxiliaryPumps', label: 'Blowers', value: summarizePumpArray(equipment.auxiliaryPumps) },
    { key: 'filter', label: 'Filter', value: formatNamedSelection(equipment.filter, 'no filter') },
    { key: 'filterQty', label: 'Filter Quantity', value: formatNumber(equipment.filterQuantity) },
    { key: 'additionalFilters', label: 'Additional Filters', value: summarizePumpArray(equipment.additionalFilters) },
    { key: 'cleaner', label: 'Cleaner', value: formatNamedSelection(equipment.cleaner, 'no cleaner') },
    { key: 'cleanerQty', label: 'Cleaner Quantity', value: formatNumber(equipment.cleanerQuantity) },
    { key: 'heater', label: 'Heater', value: formatNamedSelection(equipment.heater, 'no heater') },
    { key: 'heaterQty', label: 'Heater Quantity', value: formatNumber(equipment.heaterQuantity) },
    { key: 'additionalHeaters', label: 'Additional Heaters', value: summarizePumpArray(equipment.additionalHeaters) },
    { key: 'heaterChiller', label: 'Heater Chiller', value: formatNamedSelection(equipment.heaterChiller, 'no heater chiller') },
    { key: 'heaterChillerQty', label: 'Heater Chiller Quantity', value: formatNumber(equipment.heaterChillerQuantity) },
    { key: 'automation', label: 'Automation', value: formatNamedSelection(equipment.automation, 'no automation') },
    { key: 'automationQty', label: 'Automation Quantity', value: formatNumber(equipment.automationQuantity) },
    { key: 'automationZones', label: 'Automation Zones', value: formatNumber(equipment.automation?.zones) },
    { key: 'saltSystem', label: 'Salt System', value: formatNamedSelection(equipment.saltSystem, 'no salt') },
    { key: 'saltQty', label: 'Salt System Quantity', value: formatNumber(equipment.saltSystemQuantity) },
    { key: 'additionalSaltSystem', label: 'Additional Salt System', value: formatNamedSelection(equipment.additionalSaltSystem, 'no salt') },
    { key: 'autoFillSystem', label: 'Auto-Fill System', value: formatNamedSelection(equipment.autoFillSystem, 'no auto') },
    { key: 'autoFillQty', label: 'Auto-Fill Quantity', value: formatNumber(equipment.autoFillSystemQuantity) },
    { key: 'sanitationAccessory', label: 'Sanitation Accessory', value: formatNamedSelection(equipment.sanitationAccessory) },
    { key: 'sanitationAccessoryQty', label: 'Sanitation Accessory Quantity', value: formatNumber(equipment.sanitationAccessoryQuantity) },
    { key: 'poolLights', label: 'Pool Lights', value: summarizeNamedList(poolLights.map((entry) => entry?.name), { noneValue: 'None' }) },
    { key: 'spaLights', label: 'Spa Lights', value: summarizeNamedList(spaLights.map((entry) => entry?.name), { noneValue: 'None' }) },
    { key: 'blanketReel', label: 'Blanket Reel', value: formatBoolean(equipment.hasBlanketReel) },
    { key: 'solarBlanket', label: 'Solar Blanket', value: formatBoolean(equipment.hasSolarBlanket) },
    { key: 'handrail', label: 'Handrail', value: formatBoolean(equipment.hasHandrail) },
    { key: 'startupChemicals', label: 'Startup Chemicals', value: formatBoolean(equipment.hasStartupChemicals) },
    { key: 'customOptions', label: 'Equipment Options', value: summarizeCustomOptions(equipment.customOptions) },
  ], options);
}

function extractWaterFeatureFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const waterFeatures = proposal.waterFeatures || ({} as Proposal['waterFeatures']);
  return compactSnapshots([
    { key: 'selections', label: 'Selections', value: summarizeWaterFeatureSelections(waterFeatures) },
    { key: 'customOptions', label: 'Water Feature Options', value: summarizeCustomOptions(waterFeatures.customOptions) },
  ], options);
}

function extractCustomFeatureFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const customFeatures = proposal.customFeatures || ({} as Proposal['customFeatures']);
  return compactSnapshots([
    { key: 'features', label: 'Custom Features', value: summarizeCustomFeatures(customFeatures.features) },
    { key: 'totalCost', label: 'Custom Feature Total', value: formatCurrencyValue(customFeatures.totalCost) },
  ], options);
}

function extractInteriorFinishFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const finish = proposal.interiorFinish || ({} as Proposal['interiorFinish']);
  return compactSnapshots([
    { key: 'finishType', label: 'Finish Type', value: normalizeText(finish.finishType) },
    { key: 'color', label: 'Finish Color', value: normalizeText(finish.color) },
    { key: 'surfaceArea', label: 'Finish Surface Area', value: formatNumber(finish.surfaceArea, ' SQFT') },
    { key: 'hasSpa', label: 'Interior Finish Includes Spa', value: formatBoolean(finish.hasSpa) },
    ...(!isPpasEastProposal(proposal)
      ? [{ key: 'waterproofing', label: 'Waterproofing', value: formatBoolean(finish.hasWaterproofing) }]
      : []),
    { key: 'customOptions', label: 'Interior Finish Options', value: summarizeCustomOptions(finish.customOptions) },
  ], options);
}

function extractPricingAdjustmentFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  const manual = proposal.manualAdjustments;
  return compactSnapshots([
    { key: 'pricingTier', label: 'Pricing Tier', value: getPricingTierName(proposal.pricingTierId || proposal.pricingTierName) },
    { key: 'manualPositive1', label: 'Manual Positive 1', value: formatCurrencyValue(manual?.positive1) },
    { key: 'manualPositive2', label: 'Manual Positive 2', value: formatCurrencyValue(manual?.positive2) },
    { key: 'manualNegative1', label: 'Manual Negative 1', value: formatCurrencyValue(manual?.negative1) },
    { key: 'manualNegative2', label: 'Manual Negative 2', value: formatCurrencyValue(manual?.negative2) },
    { key: 'retailAdjustments', label: 'Retail Adjustments', value: summarizeRetailAdjustments(proposal.retailAdjustments) },
    { key: 'contractOverrides', label: 'Contract Overrides', value: summarizeContractOverrides(proposal.contractOverrides) },
  ], options);
}

function extractWarrantyFields(
  proposal: Proposal,
  options?: WorkflowFieldExtractOptions
): WorkflowFieldSnapshot[] {
  return compactSnapshots([
    { key: 'warrantySections', label: 'Warranty Sections', value: summarizeWarrantySections(proposal.warrantySections) },
  ], options);
}

COST_DIFF_GROUPS.push(
  {
    key: 'poolSpecs',
    label: 'Pool Specs',
    costKeys: ['plansAndEngineering', 'layout', 'permit', 'shotcreteLabor', 'shotcreteMaterial', 'fiberglassShell', 'fiberglassInstall', 'startupOrientation'],
    extractFields: extractPoolSpecsFields,
  },
  {
    key: 'excavation',
    label: 'Excavation',
    costKeys: ['excavation', 'steel', 'cleanup'],
    extractFields: extractExcavationFields,
  },
  {
    key: 'plumbing',
    label: 'Plumbing',
    costKeys: ['plumbing'],
    extractFields: extractPlumbingFields,
  },
  {
    key: 'electrical',
    label: 'Gas / Electrical',
    costKeys: ['gas', 'electrical'],
    extractFields: extractElectricalFields,
  },
  {
    key: 'tileCopingDecking',
    label: 'Tile / Coping / Decking',
    costKeys: ['tileLabor', 'tileMaterial', 'copingDeckingLabor', 'copingDeckingMaterial', 'stoneRockworkLabor', 'stoneRockworkMaterial'],
    extractFields: extractTileCopingDeckingFields,
  },
  {
    key: 'drainage',
    label: 'Drainage',
    costKeys: ['drainage'],
    extractFields: extractDrainageFields,
  },
  {
    key: 'equipment',
    label: 'Equipment',
    costKeys: ['equipmentOrdered', 'equipmentSet'],
    extractFields: extractEquipmentFields,
  },
  {
    key: 'waterFeatures',
    label: 'Water Features',
    costKeys: ['waterFeatures'],
    extractFields: extractWaterFeatureFields,
  },
  {
    key: 'customFeatures',
    label: 'Custom Features',
    costKeys: ['customFeatures'],
    extractFields: extractCustomFeatureFields,
  },
  {
    key: 'interiorFinish',
    label: 'Interior Finish',
    costKeys: ['interiorFinish', 'waterTruck'],
    extractFields: extractInteriorFinishFields,
  },
  {
    key: 'pricingAdjustments',
    label: 'Pricing Adjustments',
    costKeys: [],
    extractFields: extractPricingAdjustmentFields,
  },
  {
    key: 'warranty',
    label: 'Warranty',
    costKeys: [],
    extractFields: extractWarrantyFields,
  }
);

const PROPOSAL_SELECTION_GROUP_KEYS = new Set([
  'poolSpecs',
  'excavation',
  'plumbing',
  'electrical',
  'tileCopingDecking',
  'drainage',
  'equipment',
  'waterFeatures',
  'interiorFinish',
  'customFeatures',
]);

export function buildProposalSelectionCategories(proposal: Proposal): ProposalSelectionCategory[] {
  const normalized = ensureProposalWorkflow(proposal);
  return COST_DIFF_GROUPS.filter((group) => PROPOSAL_SELECTION_GROUP_KEYS.has(group.key)).map((group) => ({
    key: group.key,
    label: group.label,
    fields: group.extractFields(normalized, { includeEmpty: true }).map((field) => ({
      key: field.key,
      label: field.label,
      value: normalizeText(field.value) || null,
    })),
  }));
}

export function buildWorkflowActor(session?: UserSession | null): ProposalWorkflowActor {
  const current = getCurrentSession(session);
  return {
    userId: current?.userId,
    name: current?.userName || current?.userEmail || 'User',
    email: current?.userEmail || null,
    role: normalizeRole(current?.role),
  };
}

export function getSignedVersionId(proposal?: Partial<Proposal> | null) {
  return normalizeText(proposal?.workflow?.signedVersionId) || null;
}

export function getSignedAddendumVersionIds(proposal?: Partial<Proposal> | null) {
  const signedVersionId = getSignedVersionId(proposal);
  return getEffectiveSignedAddendumVersionIds(proposal?.workflow?.signedAddendumVersionIds).filter(
    (versionId) => versionId !== signedVersionId
  );
}

export function willSigningRemoveNonActiveVersions(proposal?: Partial<Proposal> | null) {
  return !Boolean(getSignedVersionId(proposal));
}

export function getLatestSignedAddendumVersionId(proposal?: Partial<Proposal> | null) {
  const signedAddendumVersionIds = getSignedAddendumVersionIds(proposal);
  return signedAddendumVersionIds[signedAddendumVersionIds.length - 1] || null;
}

export function getLatestSignedBaselineVersionId(proposal?: Partial<Proposal> | null) {
  return getLatestSignedAddendumVersionId(proposal) || getSignedVersionId(proposal);
}

export function getWorkflowStatus(proposal?: Partial<Proposal> | null): ProposalWorkflowStatus {
  const status = normalizeText(proposal?.workflow?.status || proposal?.status).toLowerCase();
  const hasSignedBaseline = Boolean(getSignedVersionId(proposal));
  const latestSignedBaselineVersionId = getLatestSignedBaselineVersionId(proposal);
  const approvedVersionId = getApprovedVersionId(proposal);
  const hasApprovedBaseline = Boolean(proposal?.workflow?.approved === true || approvedVersionId);
  const hasPendingReview = Boolean(normalizeText(proposal?.workflow?.reviewVersionId));
  const hasUnsignedApprovedVersion =
    Boolean(approvedVersionId) &&
    approvedVersionId !== latestSignedBaselineVersionId &&
    !hasPendingReview;
  if (status === 'completed') return 'completed';
  if (status === 'needs_approval') return 'needs_approval';
  if (status === 'changes_requested') return 'changes_requested';
  if (hasUnsignedApprovedVersion) return 'approved';
  if (status === 'signed') return hasPendingReview ? 'needs_approval' : 'signed';
  if (hasSignedBaseline && !hasPendingReview) return 'signed';
  if (status === 'approved') return 'approved';
  if (hasApprovedBaseline && !hasPendingReview) return 'approved';
  if (status === 'submitted' && proposal?.workflow?.approved === true) return 'approved';
  if (status === 'submitted') return 'submitted';
  return 'draft';
}

export function isApprovedButNotSigned(proposal?: Partial<Proposal> | null) {
  return getWorkflowStatus(proposal) === 'approved' && !getSignedVersionId(proposal);
}

export function getVersionRecordStatus(proposal?: Partial<Proposal> | null): ProposalWorkflowStatus {
  const status = normalizeText(proposal?.status).toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'needs_approval') return 'needs_approval';
  if (status === 'changes_requested') return 'changes_requested';
  if (status === 'signed') return 'signed';
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'submitted';
  return 'draft';
}

export function isVersionPermanentlyLocked(proposal?: Partial<Proposal> | null) {
  const status = getVersionRecordStatus(proposal);
  return proposal?.versionLocked === true || status === 'signed' || status === 'completed';
}

export function ensureProposalWorkflow(proposal: Proposal): Proposal {
  const workflow = proposal.workflow || ({} as ProposalWorkflowState);
  const history = normalizeHistory(workflow.history);
  const shouldDowngradeLegacySigned = shouldDowngradeLegacySignedProposal(proposal);
  const rawStatus = shouldDowngradeLegacySigned
    ? 'approved'
    : normalizeText(proposal.status).toLowerCase();
  const hasWorkflowState = Boolean(
    proposal.workflow &&
      (
        proposal.workflow.status ||
        proposal.workflow.reviewVersionId ||
        proposal.workflow.submittedAt ||
        proposal.workflow.approvedVersionId ||
        proposal.workflow.signedVersionId ||
        proposal.workflow.signedAt ||
        (proposal.workflow.signedAddendumVersionIds && proposal.workflow.signedAddendumVersionIds.length > 0) ||
        (proposal.workflow.history && proposal.workflow.history.length > 0)
      )
  );
  const shouldResetLegacySubmittedProposal =
    !hasWorkflowState &&
    (rawStatus === 'submitted' || rawStatus === 'approved' || rawStatus === 'rejected');
  const currentVersionId = proposal.activeVersionId || proposal.versionId || ORIGINAL_VERSION_ID;
  const legacyApprovedVersionId = shouldDowngradeLegacySigned
    ? normalizeText(
        workflow.approvedVersionId ||
          workflow.submittedVersionId ||
          workflow.signedVersionId ||
          currentVersionId
      ) || currentVersionId
    : null;
  const shouldClearSignedLock = shouldResetLegacySubmittedProposal || shouldDowngradeLegacySigned;
  let signedVersionId = shouldClearSignedLock
    ? null
    : normalizeText(
        workflow.signedVersionId ||
          (rawStatus === 'signed'
            ? workflow.approvedVersionId || workflow.submittedVersionId || currentVersionId
            : null)
      ) || null;
  const signedAddendumVersionIds = shouldClearSignedLock
    ? []
    : getEffectiveSignedAddendumVersionIds(workflow.signedAddendumVersionIds).filter(
        (versionId) => versionId !== signedVersionId
      );
  const latestSignedBaselineVersionId =
    signedAddendumVersionIds[signedAddendumVersionIds.length - 1] || signedVersionId;
  let approvedVersionId = shouldResetLegacySubmittedProposal
    ? null
    : normalizeText(
        workflow.approvedVersionId ||
          legacyApprovedVersionId ||
          (workflow.approved === true || rawStatus === 'completed' || rawStatus === 'signed'
            ? workflow.submittedVersionId ||
              workflow.reviewVersionId ||
              latestSignedBaselineVersionId ||
              currentVersionId
            : null)
      ) || null;
  let approvedVersionIds = shouldResetLegacySubmittedProposal
    ? []
    : getEffectiveApprovedVersionIds(history, workflow.approvedVersionIds, approvedVersionId);
  if (!approvedVersionIds.length && latestSignedBaselineVersionId) {
    approvedVersionIds = [latestSignedBaselineVersionId];
  }
  if (!approvedVersionId || !approvedVersionIds.includes(approvedVersionId)) {
    approvedVersionId =
      approvedVersionIds[approvedVersionIds.length - 1] || latestSignedBaselineVersionId || null;
  }
  let pendingReviewVersionId = shouldResetLegacySubmittedProposal
    ? null
    : normalizeText(
        workflow.reviewVersionId ||
          (rawStatus === 'submitted' ||
          rawStatus === 'needs_approval' ||
          rawStatus === 'changes_requested'
            ? workflow.submittedVersionId
            : null)
      ) || null;

  const hasUnsignedApprovedVersion = Boolean(
    approvedVersionId &&
    approvedVersionId !== latestSignedBaselineVersionId
  );

  let normalizedStatus: ProposalWorkflowStatus = shouldResetLegacySubmittedProposal
    ? 'draft'
    : rawStatus === 'completed'
    ? 'completed'
    : rawStatus === 'changes_requested'
    ? 'changes_requested'
    : pendingReviewVersionId
    ? 'needs_approval'
    : hasUnsignedApprovedVersion
    ? 'approved'
    : signedVersionId
    ? 'signed'
    : approvedVersionId
    ? 'approved'
    : rawStatus === 'submitted'
    ? 'submitted'
    : 'draft';

  if (!pendingReviewVersionId && normalizedStatus === 'changes_requested') {
    normalizedStatus = signedVersionId ? 'signed' : approvedVersionId ? 'approved' : 'draft';
  }

  if (!isPendingReviewStatus(normalizedStatus)) {
    pendingReviewVersionId = null;
  }

  if (!approvedVersionId && normalizedStatus === 'completed') {
    approvedVersionId =
      normalizeText(
        workflow.submittedVersionId ||
          workflow.reviewVersionId ||
          latestSignedBaselineVersionId ||
          currentVersionId
      ) || null;
    approvedVersionIds = getEffectiveApprovedVersionIds(history, approvedVersionIds, approvedVersionId);
  }

  if (!signedVersionId && normalizedStatus === 'signed') {
    signedVersionId = approvedVersionId || normalizeText(workflow.submittedVersionId) || currentVersionId;
  }

  const approved = Boolean(approvedVersionId || signedVersionId);
  const submittedVersionId =
    pendingReviewVersionId ||
    normalizeText(workflow.submittedVersionId) ||
    latestSignedBaselineVersionId ||
    approvedVersionId ||
    null;

  return {
    ...proposal,
    status: normalizedStatus,
    versionLocked: shouldClearSignedLock ? false : proposal.versionLocked === true,
    versionLockedAt: shouldClearSignedLock ? null : proposal.versionLockedAt || null,
    versionSubmittedAt: shouldResetLegacySubmittedProposal ? null : proposal.versionSubmittedAt || null,
    versionSubmittedBy: shouldResetLegacySubmittedProposal ? null : proposal.versionSubmittedBy || null,
    workflow: {
      status: normalizedStatus,
      reviewVersionId: pendingReviewVersionId,
      submittedVersionId,
      approvedVersionId,
      approvedVersionIds,
      approvalNotRequired: shouldResetLegacySubmittedProposal ? false : workflow.approvalNotRequired === true,
      submittedAt: shouldResetLegacySubmittedProposal ? null : workflow.submittedAt || null,
      submittedBy: shouldResetLegacySubmittedProposal ? null : workflow.submittedBy || null,
      manualReviewRequested: shouldResetLegacySubmittedProposal ? false : workflow.manualReviewRequested === true,
      manualReviewMessage: shouldResetLegacySubmittedProposal ? null : workflow.manualReviewMessage || null,
      needsApproval: shouldResetLegacySubmittedProposal ? false : isPendingReviewStatus(normalizedStatus),
      approvalReasons: shouldResetLegacySubmittedProposal ? [] : Array.isArray(workflow.approvalReasons) ? workflow.approvalReasons : [],
      approved,
      approvedAt: shouldResetLegacySubmittedProposal || !approved ? null : workflow.approvedAt || workflow.signedAt || null,
      approvedBy: shouldResetLegacySubmittedProposal || !approved ? null : workflow.approvedBy || workflow.signedBy || null,
      signedVersionId,
      signedAddendumVersionIds,
      signedAt: shouldClearSignedLock || !signedVersionId ? null : workflow.signedAt || null,
      signedBy: shouldClearSignedLock || !signedVersionId ? null : workflow.signedBy || null,
      completedAt: shouldResetLegacySubmittedProposal ? null : workflow.completedAt || null,
      completedBy: shouldResetLegacySubmittedProposal ? null : workflow.completedBy || null,
      history: shouldResetLegacySubmittedProposal ? [] : history,
    },
  };
}

export function getPendingReviewVersionId(proposal?: Partial<Proposal> | null) {
  const status = getWorkflowStatus(proposal);
  if (!isPendingReviewStatus(status)) return null;
  return normalizeText(proposal?.workflow?.reviewVersionId || proposal?.workflow?.submittedVersionId) || null;
}

export function getApprovedVersionIds(proposal?: Partial<Proposal> | null) {
  return getEffectiveApprovedVersionIds(
    proposal?.workflow?.history,
    proposal?.workflow?.approvedVersionIds,
    proposal?.workflow?.approvedVersionId
  );
}

export function getApprovedVersionId(proposal?: Partial<Proposal> | null) {
  const approvedVersionIds = getApprovedVersionIds(proposal);
  return approvedVersionIds[approvedVersionIds.length - 1] || getLatestSignedBaselineVersionId(proposal);
}

export function getReviewVersionId(proposal?: Partial<Proposal> | null) {
  return (
    getPendingReviewVersionId(proposal) ||
    getApprovedVersionId(proposal) ||
    normalizeText(proposal?.workflow?.submittedVersionId) ||
    proposal?.activeVersionId ||
    proposal?.versionId ||
    ORIGINAL_VERSION_ID
  );
}

export function getPendingReviewVersion(proposal: Proposal): Proposal | null {
  const normalized = ensureProposalWorkflow(proposal);
  return getVersionById(normalized, getPendingReviewVersionId(normalized));
}

export function getApprovedVersion(proposal: Proposal): Proposal | null {
  const normalized = ensureProposalWorkflow(proposal);
  return getVersionById(normalized, getApprovedVersionId(normalized));
}

export function getSignedVersion(proposal: Proposal): Proposal | null {
  const normalized = ensureProposalWorkflow(proposal);
  return getVersionById(normalized, getSignedVersionId(normalized));
}

export function getSignedAddendumVersions(proposal: Proposal) {
  const normalized = ensureProposalWorkflow(proposal);
  return getSignedAddendumVersionIds(normalized)
    .map((versionId) => getVersionById(normalized, versionId))
    .filter((version): version is Proposal => Boolean(version));
}

export function getReviewerVisibleVersions(proposal: Proposal) {
  const normalized = ensureProposalWorkflow(proposal);
  if (getWorkflowStatus(normalized) === 'signed') {
    const versionIds = dedupeVersionIds(
      [getSignedVersionId(normalized), ...getSignedAddendumVersionIds(normalized)],
      getLatestSignedBaselineVersionId(normalized)
    );
    return normalizeVisibleVersionList(normalized, versionIds);
  }
  const approvedVersionIds = getApprovedVersionIds(normalized);
  const pendingReviewVersionId = getPendingReviewVersionId(normalized);
  const versionIds = dedupeVersionIds(
    [...approvedVersionIds, pendingReviewVersionId],
    approvedVersionIds.length === 0 && !pendingReviewVersionId ? getReviewVersionId(normalized) : null
  );
  return normalizeVisibleVersionList(normalized, versionIds);
}

export function getReviewerPrimaryVersionId(proposal?: Partial<Proposal> | null) {
  return (
    getPendingReviewVersionId(proposal) ||
    getApprovedVersionId(proposal) ||
    getReviewVersionId(proposal)
  );
}

export function isSubmittedVersionLocked(proposal?: Partial<Proposal> | null) {
  return proposal?.versionLocked === true || Boolean(proposal?.versionSubmittedAt);
}

export function hasVersionSubmissionHistory(
  proposal?: Partial<Proposal> | null,
  versionId?: string | null
) {
  const targetId = normalizeText(versionId) || ORIGINAL_VERSION_ID;
  const history = normalizeHistory(proposal?.workflow?.history);
  if (
    history.some(
      (entry) =>
        (entry.versionId || ORIGINAL_VERSION_ID) === targetId &&
        (entry.type === 'submitted' || entry.type === 'approved')
    )
  ) {
    return true;
  }
  const matchingVersion =
    proposal && 'versionId' in proposal && proposal
      ? getVersionById(ensureProposalWorkflow(proposal as Proposal), targetId)
      : null;
  return Boolean(matchingVersion?.versionSubmittedAt);
}

export function resetWorkflowAfterVersionEdit(
  proposal: Proposal,
  versionId?: string | null
): Proposal {
  const normalized = ensureProposalWorkflow(proposal);
  if (getWorkflowStatus(normalized) === 'completed') {
    return normalized;
  }

  const targetVersionId =
    normalizeText(versionId) ||
    normalized.activeVersionId ||
    normalized.versionId ||
    ORIGINAL_VERSION_ID;
  const workflow = normalized.workflow as ProposalWorkflowState;
  const signedVersionId = getSignedVersionId(normalized);
  const signedAddendumVersionIds = getSignedAddendumVersionIds(normalized);
  const latestSignedBaselineVersionId = getLatestSignedBaselineVersionId(normalized);
  const hasSignedBaseline = Boolean(signedVersionId);
  const nextStatus: ProposalWorkflowStatus = hasSignedBaseline ? 'signed' : 'draft';

  const updatedVersions = listAllVersions(normalized).map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;
    if (entryId === targetVersionId) {
      return setVersionWorkflowState(entry, 'draft', {
        locked: false,
        submittedAt: null,
        submittedBy: null,
      });
    }
    if (hasSignedBaseline && signedVersionId && entryId === signedVersionId) {
      return setVersionWorkflowState(entry, 'signed', {
        locked: true,
        submittedAt: entry.versionSubmittedAt || workflow.signedAt || workflow.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || workflow.signedBy || workflow.submittedBy || null,
      });
    }
    if (hasSignedBaseline && signedAddendumVersionIds.includes(entryId)) {
      return setVersionWorkflowState(entry, 'signed', {
        locked: true,
        submittedAt: entry.versionSubmittedAt || workflow.approvedAt || workflow.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || workflow.approvedBy || workflow.submittedBy || null,
      });
    }
    return setVersionWorkflowState(entry, 'draft', {
      locked: false,
      submittedAt: null,
      submittedBy: null,
    });
  });

  const nextWorkflow: ProposalWorkflowState = {
    ...workflow,
    status: nextStatus,
    reviewVersionId: null,
    submittedVersionId: hasSignedBaseline ? latestSignedBaselineVersionId : null,
    approvedVersionId: hasSignedBaseline ? latestSignedBaselineVersionId : null,
    approvedVersionIds: hasSignedBaseline
      ? dedupeVersionIds([signedVersionId, ...signedAddendumVersionIds], latestSignedBaselineVersionId)
      : [],
    approvalNotRequired: false,
    manualReviewRequested: false,
    manualReviewMessage: null,
    needsApproval: false,
    approvalReasons: [],
    approved: hasSignedBaseline,
    approvedAt: hasSignedBaseline ? workflow.approvedAt || null : null,
    approvedBy: hasSignedBaseline ? workflow.approvedBy || null : null,
    signedVersionId: hasSignedBaseline ? signedVersionId : null,
    signedAddendumVersionIds: hasSignedBaseline ? signedAddendumVersionIds : [],
    signedAt: hasSignedBaseline ? workflow.signedAt || null : null,
    signedBy: hasSignedBaseline ? workflow.signedBy || null : null,
    history: normalizeHistory(workflow.history),
  };

  return mergeVersionsIntoContainer(
    normalized,
    updatedVersions,
    normalized.activeVersionId,
    nextStatus,
    nextWorkflow
  );
}

export function reconcileWorkflowVersionStates(proposal: Proposal): Proposal {
  const normalized = ensureProposalWorkflow(proposal);
  const status = getWorkflowStatus(normalized);
  const pendingReviewVersionId = getPendingReviewVersionId(normalized);
  const approvedVersionIds = new Set(getApprovedVersionIds(normalized));
  const approvedVersionId = getApprovedVersionId(normalized);
  const signedVersionId = getSignedVersionId(normalized);
  const signedAddendumVersionIds = new Set(getSignedAddendumVersionIds(normalized));
  const allVersions = listAllVersions(normalized);

  const updatedVersions = allVersions.map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;

    if (pendingReviewVersionId && entryId === pendingReviewVersionId) {
      return setVersionWorkflowState(entry, status, {
        locked: false,
        submittedAt: entry.versionSubmittedAt || normalized.workflow?.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || normalized.workflow?.submittedBy || null,
      });
    }

    if (signedVersionId && entryId === signedVersionId) {
      return setVersionWorkflowState(entry, status === 'completed' ? 'completed' : 'signed', {
        locked: true,
        submittedAt:
          entry.versionSubmittedAt ||
          normalized.workflow?.signedAt ||
          normalized.workflow?.submittedAt ||
          null,
        submittedBy:
          entry.versionSubmittedBy ||
          normalized.workflow?.signedBy ||
          normalized.workflow?.submittedBy ||
          null,
      });
    }

    if (signedAddendumVersionIds.has(entryId)) {
      return setVersionWorkflowState(entry, status === 'completed' && entryId === approvedVersionId ? 'completed' : 'signed', {
        locked: true,
        submittedAt:
          entry.versionSubmittedAt ||
          normalized.workflow?.approvedAt ||
          normalized.workflow?.submittedAt ||
          null,
        submittedBy:
          entry.versionSubmittedBy ||
          normalized.workflow?.approvedBy ||
          normalized.workflow?.submittedBy ||
          null,
      });
    }

    if (approvedVersionIds.has(entryId)) {
      const baselineStatus =
        status === 'completed' && !pendingReviewVersionId && entryId === approvedVersionId
          ? 'completed'
          : 'approved';
      return setVersionWorkflowState(entry, baselineStatus, {
        locked: entry.versionLocked === true || baselineStatus === 'completed',
        submittedAt:
          entry.versionSubmittedAt ||
          normalized.workflow?.approvedAt ||
          normalized.workflow?.submittedAt ||
          null,
        submittedBy:
          entry.versionSubmittedBy ||
          normalized.workflow?.approvedBy ||
          normalized.workflow?.submittedBy ||
          null,
      });
    }

    return preserveSiblingVersionState(entry, {
      workflow: normalized.workflow as ProposalWorkflowState,
    });
  });

  return mergeVersionsIntoContainer(
    normalized,
    updatedVersions,
    normalized.activeVersionId,
    status,
    normalized.workflow as ProposalWorkflowState
  );
}

export function collapseApprovedProposalVersions(proposal: Proposal): Proposal {
  return ensureProposalWorkflow(proposal);
}

function createWorkflowEvent(
  type: ProposalWorkflowEvent['type'],
  actor: ProposalWorkflowActor,
  options?: {
    message?: string;
    versionId?: string;
    fromStatus?: ProposalWorkflowStatus | null;
    toStatus?: ProposalWorkflowStatus | null;
    metadata?: Record<string, unknown>;
  }
): ProposalWorkflowEvent {
  return {
    id: randomId('workflow'),
    type,
    createdAt: nowIso(),
    actor,
    message: normalizeText(options?.message) || undefined,
    versionId: options?.versionId,
    fromStatus: options?.fromStatus ?? null,
    toStatus: options?.toStatus ?? null,
    metadata: options?.metadata,
    readByUserIds: actor.userId ? [actor.userId] : [],
  };
}

function mergeVersionsIntoContainer(
  container: Proposal,
  versions: Proposal[],
  activeVersionId?: string | null,
  nextStatus?: ProposalWorkflowStatus,
  nextWorkflow?: ProposalWorkflowState
): Proposal {
  const desiredActiveVersionId =
    activeVersionId || container.activeVersionId || container.versionId || ORIGINAL_VERSION_ID;
  const active =
    versions.find((entry) => (entry.versionId || ORIGINAL_VERSION_ID) === desiredActiveVersionId) ||
    versions[0];
  const others = versions.filter(
    (entry) => (entry.versionId || ORIGINAL_VERSION_ID) !== (active?.versionId || ORIGINAL_VERSION_ID)
  );

  return ensureProposalWorkflow({
    ...(active || container),
    status: nextStatus || getWorkflowStatus(container),
    activeVersionId: desiredActiveVersionId,
    versions: others.map((entry) => ({ ...entry, versions: [] })),
    workflow: nextWorkflow || container.workflow,
  } as Proposal);
}

function setVersionWorkflowState(
  version: Proposal,
  nextStatus: ProposalWorkflowStatus,
  options: {
    locked: boolean;
    submittedAt?: string | null;
    submittedBy?: ProposalWorkflowActor | null;
  }
) {
  return {
    ...version,
    status: nextStatus,
    versionLocked: options.locked,
    versionLockedAt: options.locked ? version.versionLockedAt || nowIso() : null,
    versionSubmittedAt: options.submittedAt ?? null,
    versionSubmittedBy: options.submittedBy ?? null,
    versions: [],
  };
}

function preserveSiblingVersionState(
  version: Proposal,
  options: {
    workflow: ProposalWorkflowState;
    approvedVersionIds?: Set<string>;
    signedVersionId?: string | null;
    signedAddendumVersionIds?: Set<string>;
  }
) {
  const versionId = version.versionId || ORIGINAL_VERSION_ID;
  const versionStatus = getVersionRecordStatus(version);

  if (options.signedVersionId && versionId === options.signedVersionId) {
    return setVersionWorkflowState(version, 'signed', {
      locked: true,
      submittedAt: version.versionSubmittedAt || options.workflow.signedAt || options.workflow.submittedAt || null,
      submittedBy: version.versionSubmittedBy || options.workflow.signedBy || options.workflow.submittedBy || null,
    });
  }

  if (options.signedAddendumVersionIds?.has(versionId)) {
    return setVersionWorkflowState(version, 'signed', {
      locked: true,
      submittedAt: version.versionSubmittedAt || options.workflow.approvedAt || options.workflow.submittedAt || null,
      submittedBy: version.versionSubmittedBy || options.workflow.approvedBy || options.workflow.submittedBy || null,
    });
  }

  if (options.approvedVersionIds?.has(versionId)) {
    return setVersionWorkflowState(version, 'approved', {
      locked: version.versionLocked === true,
      submittedAt: version.versionSubmittedAt || options.workflow.approvedAt || options.workflow.submittedAt || null,
      submittedBy: version.versionSubmittedBy || options.workflow.approvedBy || options.workflow.submittedBy || null,
    });
  }

  return setVersionWorkflowState(version, versionStatus === 'completed' ? 'completed' : 'draft', {
    locked: version.versionLocked === true || versionStatus === 'completed',
    submittedAt: version.versionSubmittedAt || null,
    submittedBy: version.versionSubmittedBy || null,
  });
}

export function collectApprovalReasons(
  proposal: Proposal,
  options?: SubmissionRequest,
  session?: UserSession | null
): ProposalWorkflowReason[] {
  const current = getCurrentSession(session);
  const reasons: ProposalWorkflowReason[] = [];
  const marginThreshold = Number.isFinite(Number(current?.approvalMarginThresholdPercent))
    ? Number(current?.approvalMarginThresholdPercent)
    : getSessionApprovalMarginThreshold();
  const discountThreshold = Number.isFinite(Number(current?.discountAllowanceThresholdPercent))
    ? Number(current?.discountAllowanceThresholdPercent)
    : getSessionDiscountAllowanceThreshold();
  const grossMargin = toFiniteNumber(proposal.pricing?.grossProfitMargin);
  const retailPrice = Math.max(toFiniteNumber(proposal.pricing?.retailPrice || proposal.totalCost), 0);
  const discountTotal = getNonPapDiscountTotal(proposal);
  const discountPercent = retailPrice > 0 ? (discountTotal / retailPrice) * 100 : 0;

  if (Number.isFinite(grossMargin) && grossMargin < marginThreshold) {
    reasons.push({
      code: 'margin_below_threshold',
      label: 'Gross margin is below the designer threshold',
      detail: `${grossMargin.toFixed(2)}% vs ${marginThreshold.toFixed(2)}% required`,
    });
  }

  if (Number.isFinite(discountPercent) && discountPercent > discountThreshold) {
    reasons.push({
      code: 'discount_above_allowance',
      label: 'Discount allowance is above the designer threshold',
      detail: `${discountPercent.toFixed(2)}% vs ${discountThreshold.toFixed(2)}% allowed`,
    });
  }

  if ((current?.alwaysRequireApproval ?? getSessionAlwaysRequireApproval()) === true) {
    reasons.push({
      code: 'always_require_approval',
      label: 'Approval is required for this user',
    });
  }

  if (options?.manualReviewRequested) {
    reasons.push({
      code: 'manual_review',
      label: 'Designer requested manual review',
    });
  }

  return reasons;
}

export function getWorkflowSubmissionPreview(
  proposal: Proposal,
  options?: SubmissionRequest,
  session?: UserSession | null
): WorkflowSubmissionPreview {
  const reasons = collectApprovalReasons(proposal, options, session);
  const willAutoApprove = shouldAutoApproveWorkflowSubmission(reasons);
  return {
    reasons,
    requiresApproval: !willAutoApprove,
    willAutoApprove,
    approvalRequiredByUserSetting: reasons.some((reason) => reason.code === 'always_require_approval'),
  };
}

function shouldAutoApproveWorkflowSubmission(reasons: ProposalWorkflowReason[]) {
  return reasons.length === 0;
}

export function submitProposalForWorkflow(
  proposal: Proposal,
  versionId: string,
  options?: SubmissionRequest,
  session?: UserSession | null
): Proposal {
  const normalized = ensureProposalWorkflow(proposal);
  const actor = buildWorkflowActor(session);
  const allVersions = listAllVersions(normalized).map((entry) => ({ ...entry, versions: [] }));
  const targetId = versionId || normalized.activeVersionId || normalized.versionId || ORIGINAL_VERSION_ID;
  const targetVersion =
    allVersions.find((entry) => (entry.versionId || ORIGINAL_VERSION_ID) === targetId) || allVersions[0];
  if (!targetVersion) {
    return normalized;
  }

  const workflow = normalized.workflow as ProposalWorkflowState;
  const isSignedWorkflow = Boolean(getSignedVersionId(normalized));
  const currentApprovedVersionId = getApprovedVersionId(normalized);
  const currentApprovedVersionIds = getApprovedVersionIds(normalized);
  const currentSignedVersionId = getSignedVersionId(normalized);
  const currentSignedAddendumVersionIds = getSignedAddendumVersionIds(normalized);
  const currentSignedBaselineVersionId = getLatestSignedBaselineVersionId(normalized);
  const reviewKind = isSignedWorkflow ? 'proposal_addendum' : 'initial_submission';
  const reasons = collectApprovalReasons(targetVersion, options, session);
  const shouldAutoApprove = shouldAutoApproveWorkflowSubmission(reasons);
  const nextStatus: ProposalWorkflowStatus = shouldAutoApprove ? 'approved' : 'needs_approval';
  const submittedAt = nowIso();
  const nextHistory = [
    ...normalizeHistory(workflow.history),
    createWorkflowEvent('submitted', actor, {
      message: options?.message,
      versionId: targetVersion.versionId || ORIGINAL_VERSION_ID,
      fromStatus: getWorkflowStatus(normalized),
      toStatus: nextStatus,
      metadata: {
        reasons,
        reviewKind,
        approvalNotRequired: shouldAutoApprove,
      },
    }),
  ];
  if (shouldAutoApprove) {
    nextHistory.push(
      createWorkflowEvent('approved', actor, {
        versionId: targetVersion.versionId || ORIGINAL_VERSION_ID,
        fromStatus: 'submitted',
        toStatus: nextStatus,
        metadata: {
          reviewKind,
          approvalNotRequired: true,
        },
      })
    );
  }

  const nextSignedAddendumVersionIds = currentSignedAddendumVersionIds;
  const approvedVersionIdSet = new Set(currentApprovedVersionIds);
  const targetVersionShouldBeLocked = false;

  const updatedVersions = allVersions.map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;
    if (entryId === (targetVersion.versionId || ORIGINAL_VERSION_ID)) {
      return setVersionWorkflowState(entry, nextStatus, {
        locked: targetVersionShouldBeLocked,
        submittedAt,
        submittedBy: actor,
      });
    }

    return preserveSiblingVersionState(entry, {
      workflow,
      approvedVersionIds: approvedVersionIdSet,
      signedVersionId: isSignedWorkflow ? currentSignedVersionId : null,
      signedAddendumVersionIds: isSignedWorkflow ? new Set(currentSignedAddendumVersionIds) : undefined,
    });
  });

  const nextWorkflow: ProposalWorkflowState = {
    ...workflow,
    status: nextStatus,
    reviewVersionId: shouldAutoApprove ? null : targetVersion.versionId || ORIGINAL_VERSION_ID,
    submittedVersionId: targetVersion.versionId || ORIGINAL_VERSION_ID,
    approvedVersionId: shouldAutoApprove
      ? targetVersion.versionId || ORIGINAL_VERSION_ID
      : isSignedWorkflow
      ? currentSignedBaselineVersionId || currentApprovedVersionId
      : currentApprovedVersionId,
    approvedVersionIds: shouldAutoApprove
      ? dedupeVersionIds(
          [...currentApprovedVersionIds, targetVersion.versionId || ORIGINAL_VERSION_ID],
          isSignedWorkflow ? currentSignedBaselineVersionId || currentApprovedVersionId : undefined
        )
      : isSignedWorkflow
      ? dedupeVersionIds(currentApprovedVersionIds, currentSignedBaselineVersionId || currentApprovedVersionId)
      : currentApprovedVersionIds,
    approvalNotRequired: shouldAutoApprove,
    submittedAt,
    submittedBy: actor,
    manualReviewRequested: options?.manualReviewRequested === true,
    manualReviewMessage: normalizeText(options?.message) || null,
    needsApproval: !shouldAutoApprove,
    approvalReasons: reasons,
    approved: shouldAutoApprove || currentApprovedVersionIds.length > 0 || Boolean(isSignedWorkflow ? currentSignedBaselineVersionId : null),
    approvedAt: shouldAutoApprove ? submittedAt : workflow.approvedAt || null,
    approvedBy: shouldAutoApprove ? actor : workflow.approvedBy || null,
    signedVersionId: currentSignedVersionId,
    signedAddendumVersionIds: nextSignedAddendumVersionIds,
    signedAt: workflow.signedAt || null,
    signedBy: workflow.signedBy || null,
    history: nextHistory,
  };

  const nextActiveVersionId = isSignedWorkflow
    ? normalized.activeVersionId || currentSignedBaselineVersionId || currentSignedVersionId || ORIGINAL_VERSION_ID
    : targetVersion.versionId || normalized.activeVersionId;

  return mergeVersionsIntoContainer(
    normalized,
    updatedVersions,
    nextActiveVersionId,
    nextStatus,
    nextWorkflow
  );
}

function updateReviewVersionStatus(proposal: Proposal, nextStatus: ProposalWorkflowStatus) {
  const normalized = ensureProposalWorkflow(proposal);
  const reviewVersionId = getPendingReviewVersionId(normalized) || getReviewVersionId(normalized);
  const approvedVersionIds = new Set(getApprovedVersionIds(normalized));
  const signedVersionId = getSignedVersionId(normalized);
  const signedAddendumVersionIds = new Set(getSignedAddendumVersionIds(normalized));
  const reviewVersionShouldBeLocked = nextStatus === 'signed' || nextStatus === 'completed';
  return listAllVersions(normalized).map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;
    if (entryId === reviewVersionId) {
      return setVersionWorkflowState(entry, nextStatus, {
        locked: reviewVersionShouldBeLocked,
        submittedAt: entry.versionSubmittedAt || normalized.workflow?.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || normalized.workflow?.submittedBy || null,
      });
    }
    return preserveSiblingVersionState(entry, {
      workflow: normalized.workflow as ProposalWorkflowState,
      approvedVersionIds,
      signedVersionId,
      signedAddendumVersionIds,
    });
  });
}

function appendWorkflowEvent(
  proposal: Proposal,
  type: ProposalWorkflowEvent['type'],
  options: {
    message?: string;
    toStatus?: ProposalWorkflowStatus | null;
    metadata?: Record<string, unknown>;
  },
  session?: UserSession | null
) {
  const normalized = ensureProposalWorkflow(proposal);
  const actor = buildWorkflowActor(session);
  const workflow = normalized.workflow as ProposalWorkflowState;
  const event = createWorkflowEvent(type, actor, {
    message: options.message,
    versionId: getReviewVersionId(normalized),
    fromStatus: getWorkflowStatus(normalized),
    toStatus: options.toStatus ?? getWorkflowStatus(normalized),
    metadata: options.metadata,
  });
  return {
    normalized,
    workflow: {
      ...workflow,
      history: [...normalizeHistory(workflow.history), event],
    } as ProposalWorkflowState,
  };
}

export function addWorkflowNote(
  proposal: Proposal,
  message: string,
  session?: UserSession | null
): Proposal {
  const trimmedMessage = normalizeText(message);
  if (!trimmedMessage) return ensureProposalWorkflow(proposal);
  const { normalized, workflow } = appendWorkflowEvent(
    proposal,
    'note',
    { message: trimmedMessage },
    session
  );
  return mergeVersionsIntoContainer(normalized, listAllVersions(normalized), normalized.activeVersionId, undefined, workflow);
}

export function approveWorkflowProposal(
  proposal: Proposal,
  message?: string,
  session?: UserSession | null
): Proposal {
  const normalizedForState = ensureProposalWorkflow(proposal);
  const isSignedWorkflow = Boolean(getSignedVersionId(normalizedForState));
  const nextStatus: ProposalWorkflowStatus = 'approved';
  const { normalized, workflow } = appendWorkflowEvent(
    proposal,
    'approved',
    { message, toStatus: nextStatus },
    session
  );
  const actor = buildWorkflowActor(session);
  const pendingReviewVersionId = getPendingReviewVersionId(normalized);
  const targetApprovedVersionId = pendingReviewVersionId || getReviewVersionId(normalized);
  const currentApprovedVersionIds = getApprovedVersionIds(normalized);
  const currentSignedVersionId = getSignedVersionId(normalized);
  const currentSignedAddendumVersionIds = getSignedAddendumVersionIds(normalized);
  const nextSignedAddendumVersionIds = currentSignedAddendumVersionIds;
  const targetVersionShouldBeLocked = false;
  const updatedVersions = listAllVersions(normalized).map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;
    if (entryId === targetApprovedVersionId) {
      return setVersionWorkflowState(entry, nextStatus, {
        locked: targetVersionShouldBeLocked,
        submittedAt: entry.versionSubmittedAt || normalized.workflow?.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || normalized.workflow?.submittedBy || null,
      });
    }
    return preserveSiblingVersionState(entry, {
      workflow: normalized.workflow as ProposalWorkflowState,
      approvedVersionIds: new Set(currentApprovedVersionIds),
      signedVersionId: isSignedWorkflow ? currentSignedVersionId : null,
      signedAddendumVersionIds: isSignedWorkflow ? new Set(currentSignedAddendumVersionIds) : undefined,
    });
  });
  const nextWorkflow: ProposalWorkflowState = {
    ...workflow,
    status: nextStatus,
    reviewVersionId: null,
    submittedVersionId: targetApprovedVersionId,
    approvedVersionId: targetApprovedVersionId,
    approvedVersionIds: dedupeVersionIds(
      [...currentApprovedVersionIds, targetApprovedVersionId],
      isSignedWorkflow ? currentSignedVersionId || targetApprovedVersionId : undefined
    ),
    approvalNotRequired: false,
    needsApproval: false,
    approved: true,
    approvedAt: nowIso(),
    approvedBy: actor,
    signedVersionId: currentSignedVersionId,
    signedAddendumVersionIds: nextSignedAddendumVersionIds,
    signedAt: workflow.signedAt || null,
    signedBy: workflow.signedBy || null,
  };
  const nextActiveVersionId = isSignedWorkflow
    ? normalized.activeVersionId || currentSignedVersionId || ORIGINAL_VERSION_ID
    : targetApprovedVersionId;
  return mergeVersionsIntoContainer(
    normalized,
    updatedVersions,
    nextActiveVersionId,
    nextStatus,
    nextWorkflow
  );
}

export function requestWorkflowChanges(
  proposal: Proposal,
  message: string,
  session?: UserSession | null
): Proposal {
  const { normalized, workflow } = appendWorkflowEvent(
    proposal,
    'changes_requested',
    { message, toStatus: 'changes_requested' },
    session
  );
  const currentReviewVersionId = getPendingReviewVersionId(normalized) || getReviewVersionId(normalized);
  const currentSignedVersionId = getSignedVersionId(normalized);
  const currentSignedAddendumVersionIds = getSignedAddendumVersionIds(normalized);
  const currentApprovedVersionIds = getApprovedVersionIds(normalized);
  const currentApprovedVersionId = getApprovedVersionId(normalized);
  const updatedVersions = updateReviewVersionStatus(normalized, 'changes_requested');
  const nextWorkflow: ProposalWorkflowState = {
    ...workflow,
    status: 'changes_requested',
    reviewVersionId: currentReviewVersionId,
    submittedVersionId: currentReviewVersionId,
    approvedVersionId: currentApprovedVersionId,
    approvedVersionIds: currentSignedVersionId
      ? dedupeVersionIds(currentApprovedVersionIds, currentApprovedVersionId)
      : currentApprovedVersionIds,
    approvalNotRequired: false,
    needsApproval: false,
    approved: currentApprovedVersionIds.length > 0 || Boolean(currentSignedVersionId),
    approvedAt: workflow.approvedAt || null,
    approvedBy: workflow.approvedBy || null,
    signedVersionId: currentSignedVersionId,
    signedAddendumVersionIds: currentSignedAddendumVersionIds,
    signedAt: workflow.signedAt || null,
    signedBy: workflow.signedBy || null,
  };
  return mergeVersionsIntoContainer(
    normalized,
    updatedVersions,
    normalized.activeVersionId,
    'changes_requested',
    nextWorkflow
  );
}

export function completeWorkflowProposal(
  proposal: Proposal,
  message?: string,
  session?: UserSession | null
): Proposal {
  const currentProposal = ensureProposalWorkflow(proposal);
  if (getWorkflowStatus(currentProposal) !== 'signed') {
    return currentProposal;
  }

  const { normalized, workflow } = appendWorkflowEvent(
    currentProposal,
    'completed',
    { message, toStatus: 'completed' },
    session
  );
  const actor = buildWorkflowActor(session);
  const signedVersionId = getSignedVersionId(normalized);
  const signedAddendumVersionIds = new Set(getSignedAddendumVersionIds(normalized));
  const targetVersionId =
    getLatestSignedBaselineVersionId(normalized) ||
    getApprovedVersionId(normalized) ||
    getReviewVersionId(normalized);
  const updatedVersions = listAllVersions(normalized).map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;
    if (signedVersionId && entryId === signedVersionId && entryId !== targetVersionId) {
      return setVersionWorkflowState(entry, 'signed', {
        locked: true,
        submittedAt: entry.versionSubmittedAt || normalized.workflow?.signedAt || normalized.workflow?.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || normalized.workflow?.signedBy || normalized.workflow?.submittedBy || null,
      });
    }
    if (signedAddendumVersionIds.has(entryId) && entryId !== targetVersionId) {
      return setVersionWorkflowState(entry, 'signed', {
        locked: true,
        submittedAt: entry.versionSubmittedAt || normalized.workflow?.approvedAt || normalized.workflow?.submittedAt || null,
        submittedBy: entry.versionSubmittedBy || normalized.workflow?.approvedBy || normalized.workflow?.submittedBy || null,
      });
    }
    if (entryId !== targetVersionId) {
      return setVersionWorkflowState(entry, 'draft', {
        locked: false,
        submittedAt: null,
        submittedBy: null,
      });
    }
    return setVersionWorkflowState(entry, 'completed', {
      locked: true,
      submittedAt: entry.versionSubmittedAt || normalized.workflow?.submittedAt || null,
      submittedBy: entry.versionSubmittedBy || normalized.workflow?.submittedBy || null,
    });
  });
  const nextWorkflow: ProposalWorkflowState = {
    ...workflow,
    status: 'completed',
    reviewVersionId: null,
    submittedVersionId: targetVersionId,
    completedAt: nowIso(),
    completedBy: actor,
  };
  return mergeVersionsIntoContainer(normalized, updatedVersions, normalized.activeVersionId, 'completed', nextWorkflow);
}

export function markProposalAsSigned(
  proposal: Proposal,
  session?: UserSession | null,
  versionId?: string | null
): Proposal {
  const normalized = ensureProposalWorkflow(proposal);
  const currentStatus = getWorkflowStatus(normalized);
  if (currentStatus !== 'approved') {
    return normalized;
  }

  const actor = buildWorkflowActor(session);
  const approvedVersionIds = getApprovedVersionIds(normalized);
  const resolvedTargetVersionId = normalizeText(versionId);
  const targetVersionId =
    (resolvedTargetVersionId && approvedVersionIds.includes(resolvedTargetVersionId)
      ? resolvedTargetVersionId
      : null) ||
    getApprovedVersionId(normalized) ||
    getReviewVersionId(normalized);
  const targetVersion = getVersionById(normalized, targetVersionId);
  const currentSignedVersionId = getSignedVersionId(normalized);
  const currentSignedAddendumVersionIds = getSignedAddendumVersionIds(normalized);
  if (!targetVersion) {
    return normalized;
  }

  const signedAt = nowIso();
  const history = [
    ...normalizeHistory(normalized.workflow?.history),
    createWorkflowEvent('signed', actor, {
      versionId: targetVersionId,
      fromStatus: currentStatus,
      toStatus: 'signed',
    }),
  ];
  const nextSignedVersionId = currentSignedVersionId || targetVersionId;
  const nextSignedAddendumVersionIds =
    currentSignedVersionId && targetVersionId !== currentSignedVersionId
      ? dedupeVersionIds([...currentSignedAddendumVersionIds, targetVersionId])
      : currentSignedAddendumVersionIds;
  const updatedVersions = listAllVersions(normalized).map((entry) => {
    const entryId = entry.versionId || ORIGINAL_VERSION_ID;
    if (entryId === targetVersionId) {
      return setVersionWorkflowState(entry, 'signed', {
        locked: true,
        submittedAt:
          entry.versionSubmittedAt ||
          normalized.workflow?.approvedAt ||
          normalized.workflow?.submittedAt ||
          null,
        submittedBy:
          entry.versionSubmittedBy ||
          normalized.workflow?.approvedBy ||
          normalized.workflow?.submittedBy ||
          null,
      });
    }

    if (!currentSignedVersionId) {
      return setVersionWorkflowState(entry, getVersionRecordStatus(entry), {
        locked: true,
        submittedAt: entry.versionSubmittedAt || null,
        submittedBy: entry.versionSubmittedBy || null,
      });
    }

    return preserveSiblingVersionState(entry, {
      workflow: normalized.workflow as ProposalWorkflowState,
      approvedVersionIds: new Set(approvedVersionIds),
      signedVersionId: currentSignedVersionId,
      signedAddendumVersionIds: new Set(currentSignedAddendumVersionIds),
    });
  });
  const nextWorkflow: ProposalWorkflowState = {
    ...(normalized.workflow as ProposalWorkflowState),
    status: 'signed',
    reviewVersionId: null,
    submittedVersionId: targetVersionId,
    approvedVersionId: targetVersionId,
    approvedVersionIds: currentSignedVersionId
      ? dedupeVersionIds(
          [...approvedVersionIds, targetVersionId],
          currentSignedVersionId || targetVersionId
        )
      : [targetVersionId],
    needsApproval: false,
    approved: true,
    approvedAt: (normalized.workflow as ProposalWorkflowState).approvedAt || signedAt,
    approvedBy: (normalized.workflow as ProposalWorkflowState).approvedBy || actor,
    signedVersionId: nextSignedVersionId,
    signedAddendumVersionIds: nextSignedAddendumVersionIds,
    signedAt,
    signedBy: actor,
    history,
  };

  return mergeVersionsIntoContainer(
    normalized,
    updatedVersions,
    targetVersionId,
    'signed',
    nextWorkflow
  );
}

export function markWorkflowRead(proposal: Proposal, userId?: string | null): Proposal {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return ensureProposalWorkflow(proposal);
  const normalized = ensureProposalWorkflow(proposal);
  const workflow = normalized.workflow as ProposalWorkflowState;
  let changed = false;
  const nextHistory = normalizeHistory(workflow.history).map((entry) => {
    if ((entry.actor?.userId || '') === normalizedUserId) return entry;
    const readByUserIds = Array.isArray(entry.readByUserIds) ? [...entry.readByUserIds] : [];
    if (readByUserIds.includes(normalizedUserId)) return entry;
    changed = true;
    return {
      ...entry,
      readByUserIds: [...readByUserIds, normalizedUserId],
    };
  });

  if (!changed) return normalized;
  return {
    ...normalized,
    workflow: {
      ...workflow,
      history: nextHistory,
    },
  };
}

function getWorkflowNotificationVersionIds(proposal: Proposal) {
  const normalized = ensureProposalWorkflow(proposal);
  const status = getWorkflowStatus(normalized);
  if (status === 'draft' || status === 'changes_requested') return [];

  const latestSignedBaselineVersionId = getLatestSignedBaselineVersionId(normalized);
  const approvedVersionId = getApprovedVersionId(normalized);
  const unsignedApprovedVersionId =
    approvedVersionId && approvedVersionId !== latestSignedBaselineVersionId ? approvedVersionId : null;

  return dedupeVersionIds(
    [
      getSignedVersionId(normalized),
      ...getSignedAddendumVersionIds(normalized),
      getPendingReviewVersionId(normalized),
      unsignedApprovedVersionId,
    ],
    getReviewVersionId(normalized)
  );
}

function isWorkflowEventUnreadForUser(entry: ProposalWorkflowEvent, userId: string) {
  if ((entry.actor?.userId || '') === userId) return false;
  return !(entry.readByUserIds || []).includes(userId);
}

// A proposal version should only contribute one unread notification, even if it
// has moved through submitted, approved, signed, or completed while still unseen.
function hasUnreadWorkflowNotificationForVersion(
  history: ProposalWorkflowEvent[],
  versionId: string,
  userId: string
) {
  const matchingEvents = history.filter(
    (entry) => (normalizeText(entry.versionId) || ORIGINAL_VERSION_ID) === versionId
  );
  if (matchingEvents.length === 0) return false;

  const submittedEvents = matchingEvents.filter((entry) => entry.type === 'submitted');
  if (submittedEvents.length > 0) {
    return submittedEvents.some((entry) => isWorkflowEventUnreadForUser(entry, userId));
  }

  return matchingEvents.some((entry) => {
    if (entry.type === 'note' || entry.type === 'changes_requested') return false;
    return isWorkflowEventUnreadForUser(entry, userId);
  });
}

export function countUnreadWorkflowEvents(proposal: Proposal, userId?: string | null) {
  const normalizedUserId = normalizeText(userId);
  if (!normalizedUserId) return 0;
  const normalized = ensureProposalWorkflow(proposal);
  const history = normalizeHistory(normalized.workflow?.history);
  return getWorkflowNotificationVersionIds(normalized).filter((versionId) =>
    hasUnreadWorkflowNotificationForVersion(history, versionId, normalizedUserId)
  ).length;
}

export function hasUnreadWorkflowEvents(proposal: Proposal, userId?: string | null) {
  return countUnreadWorkflowEvents(proposal, userId) > 0;
}

function getVersionName(version?: Partial<Proposal> | null) {
  const id = version?.versionId || ORIGINAL_VERSION_ID;
  if (normalizeText(version?.versionName)) return normalizeText(version?.versionName);
  return id === ORIGINAL_VERSION_ID ? 'Original Version' : 'Version';
}

function getSubmittedReviewKind(proposal: Proposal) {
  const normalized = ensureProposalWorkflow(proposal);
  const reviewVersionId = getPendingReviewVersionId(normalized);
  if (!reviewVersionId) return null;

  const matchingSubmission = [...normalizeHistory(normalized.workflow?.history)]
    .reverse()
    .find((entry) => {
      if (entry.type !== 'submitted') return false;
      return (entry.versionId || ORIGINAL_VERSION_ID) === reviewVersionId;
    });
  const reviewKind = normalizeText(String(matchingSubmission?.metadata?.reviewKind || ''));
  if (reviewKind === 'proposal_addendum' || reviewKind === 'initial_submission') {
    return reviewKind as VersionDiffSummary['comparisonKind'];
  }
  return null;
}

function getWorkflowComparisonVersions(proposal: Proposal) {
  const normalized = ensureProposalWorkflow(proposal);
  const approvedVersion = getApprovedVersion(normalized);
  const reviewVersion = getPendingReviewVersion(normalized);
  if (!approvedVersion || !reviewVersion) return null;
  if ((approvedVersion.versionId || ORIGINAL_VERSION_ID) === (reviewVersion.versionId || ORIGINAL_VERSION_ID)) {
    return null;
  }
  return {
    approvedVersion,
    reviewVersion,
  };
}

function buildDiffSummary(
  proposal: Proposal,
  reviewVersion: Proposal,
  compareVersion: Proposal,
  comparisonKind: VersionDiffSummary['comparisonKind']
): VersionDiffSummary {
  const normalized = ensureProposalWorkflow(proposal);
  const currentRetail = toFiniteNumber(reviewVersion.pricing?.retailPrice || reviewVersion.totalCost);
  const compareRetail = toFiniteNumber(compareVersion.pricing?.retailPrice || compareVersion.totalCost);
  const currentCost = toFiniteNumber(reviewVersion.pricing?.totalCOGS);
  const compareCost = toFiniteNumber(compareVersion.pricing?.totalCOGS);
  const currentGrossProfit = toFiniteNumber(reviewVersion.pricing?.grossProfit);
  const compareGrossProfit = toFiniteNumber(compareVersion.pricing?.grossProfit);
  const currentGrossMargin = toFiniteNumber(reviewVersion.pricing?.grossProfitMargin);
  const compareGrossMargin = toFiniteNumber(compareVersion.pricing?.grossProfitMargin);
  const currentDiscount = getNonPapDiscountTotal(reviewVersion);
  const compareDiscount = getNonPapDiscountTotal(compareVersion);
  const categories = buildDetailedDiffCategories(reviewVersion, compareVersion);

  return {
    reviewVersionId: reviewVersion.versionId || ORIGINAL_VERSION_ID,
    compareVersionId: compareVersion.versionId || null,
    approvedVersionId: compareVersion.versionId || null,
    reviewVersionName: getVersionName(reviewVersion),
    compareVersionName: getVersionName(compareVersion),
    comparisonKind,
    changedSections: categories.map((category) => category.label),
    retailDelta: currentRetail - compareRetail,
    costDelta: currentCost - compareCost,
    grossProfitDelta: currentGrossProfit - compareGrossProfit,
    grossMarginDelta: currentGrossMargin - compareGrossMargin,
    discountDelta: currentDiscount - compareDiscount,
    contractOverrideDelta:
      Object.keys(reviewVersion.contractOverrides || {}).length -
      Object.keys(compareVersion.contractOverrides || {}).length,
    noteIndicator: Boolean(normalized.workflow?.manualReviewMessage),
    categories,
  };
}

export function buildVersionDiffSummary(proposal: Proposal): VersionDiffSummary | null {
  const normalized = ensureProposalWorkflow(proposal);
  if (getSubmittedReviewKind(normalized) !== 'proposal_addendum') {
    return null;
  }
  const comparison = getWorkflowComparisonVersions(normalized);
  if (!comparison) return null;

  return buildDiffSummary(
    normalized,
    comparison.reviewVersion,
    comparison.approvedVersion,
    'proposal_addendum'
  );
}

export function buildSignedAddendumDiffSummaries(proposal: Proposal): VersionDiffSummary[] {
  const normalized = ensureProposalWorkflow(proposal);
  const signedVersion = getSignedVersion(normalized);
  if (!signedVersion) return [];

  return getSignedAddendumVersions(normalized)
    .filter(
      (version) =>
        (version.versionId || ORIGINAL_VERSION_ID) !== (signedVersion.versionId || ORIGINAL_VERSION_ID)
    )
    .map((version) => buildDiffSummary(normalized, version, signedVersion, 'signed_addendum'));
}
