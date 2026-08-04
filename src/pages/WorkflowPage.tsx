import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { TooltipAnchor } from '../components/AppTooltip';
import type { CloudConnectionIssue } from '../components/CloudConnectionNotice';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useFranchiseSignedWorkflowDisabled } from '../hooks/useFranchiseSignedWorkflowDisabled';
import type {
  CostLineItem,
  Proposal,
  ProposalWorkflowEvent,
  ProposalWorkflowReason,
} from '../types/proposal-new';
import { DISABLED_SIGNED_WORKFLOW_MESSAGE } from '../services/franchiseBranding';
import {
  addWorkflowNote,
  approveWorkflowProposal,
  buildProposalSelectionCategories,
  buildSignedAddendumDiffSummaries,
  buildVersionDiffSummary,
  completeWorkflowProposal,
  countUnreadWorkflowEvents,
  ensureProposalWorkflow,
  getApprovedVersion,
  getApprovedVersionId,
  getPendingReviewVersion,
  getSignedVersion,
  getWorkflowStatus,
  hasUnreadWorkflowEvents,
  markWorkflowRead,
  requestWorkflowChanges,
} from '../services/proposalWorkflow';
import { listFranchiseUsers, type FranchiseUser } from '../services/franchiseUsersAdapter';
import { getProposal, listProposals, saveProposal } from '../services/proposalsAdapter';
import { normalizeCostBreakdownForDisplay } from '../utils/costBreakdownDisplay';
import {
  CUSTOM_OPTIONS_SUBCATEGORY,
  getLineItemSubcategory,
  isCustomOptionItem,
} from '../utils/costBreakdownSubcategories';
import { isOffContractLineItem } from '../utils/offContractLineItems';
import { listAllVersions, ORIGINAL_VERSION_ID } from '../utils/proposalVersions';
import { isMasterActingAsOwnerSession, type UserSession } from '../services/session';
import './WorkflowPage.css';

type WorkflowPageProps = {
  session?: UserSession | null;
  cloudIssue?: CloudConnectionIssue;
};

type QueueFilter = 'needs_approval' | 'approved' | 'signed' | 'archive';
type WorkflowLocationState = {
  selectedFilter?: QueueFilter;
  selectedUserId?: string | null;
};

type WorkflowDetailTab =
  | 'summary'
  | 'cogs'
  | 'proposal_selections'
  | 'notes_activity'
  | 'versions'
  | 'issues';

type WorkflowSortOption = 'most_recent' | 'oldest' | 'price_high_low' | 'price_low_high';

type WorkflowCogsRow = {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  total: number;
  totalLabel: string;
  subcategory?: string | null;
};

type WorkflowCogsCategory = {
  key: string;
  label: string;
  itemCount: number;
  total: number;
  rows: WorkflowCogsRow[];
};

type WorkflowBreakdownSegment = {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
};

type WorkflowComparisonPreviewRow = {
  key: string;
  group: 'overview' | 'category';
  label: string;
  before: string;
  after: string;
  delta: number;
  deltaLabel: string;
  tone: 'danger' | 'success';
};

type WorkflowVersionEntry = {
  versionId: string;
  versionName: string;
  submittedAt: string;
  version: Proposal;
};

type WorkflowIconName =
  | 'summary'
  | 'cogs'
  | 'proposal'
  | 'notes'
  | 'versions'
  | 'issues'
  | 'compare'
  | 'search'
  | 'filter'
  | 'more'
  | 'back'
  | 'open';

const BREAKDOWN_COLORS = ['#7398d6', '#38b1d7', '#2f7ed8', '#1b57c5', '#0f2d69'];

const normalizeIdentity = (value?: string | null) => String(value || '').trim().toLowerCase();

const normalizeStatusLabel = (value?: string | null) =>
  (() => {
    const normalized = String(value || 'draft').trim().toLowerCase();
    if (normalized === 'changes_requested') return 'Returned';
    return normalized.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  })();

const matchesQueueFilter = (proposal: Proposal, filter: QueueFilter) => {
  const status = getWorkflowStatus(proposal);
  if (filter === 'needs_approval') return status === 'needs_approval';
  if (filter === 'signed') return status === 'signed';
  if (filter === 'archive') return status === 'completed';
  return status === 'approved' || status === 'submitted';
};

const getQueueFilterForProposal = (proposal: Proposal): QueueFilter => {
  if (matchesQueueFilter(proposal, 'needs_approval')) return 'needs_approval';
  if (matchesQueueFilter(proposal, 'signed')) return 'signed';
  if (matchesQueueFilter(proposal, 'archive')) return 'archive';
  return 'approved';
};

const proposalBelongsToUser = (proposal: Proposal, user?: FranchiseUser | null) => {
  if (!user) return true;
  const proposalDesigner = normalizeIdentity(proposal.designerName);
  if (!proposalDesigner) return false;
  const candidates = [normalizeIdentity(user.name), normalizeIdentity(user.email)].filter(Boolean);
  return candidates.some((candidate) => candidate === proposalDesigner);
};

const proposalDesignerMatchesUser = (designerName?: string | null, user?: FranchiseUser | null) => {
  if (!user) return false;
  const normalizedDesigner = normalizeIdentity(designerName);
  if (!normalizedDesigner) return false;
  return [normalizeIdentity(user.name), normalizeIdentity(user.email)].filter(Boolean).includes(normalizedDesigner);
};

const getUserFilterLabel = (user: FranchiseUser) => {
  const name = String(user.name || '').trim();
  return name ? `${name} (${user.email})` : user.email;
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

const formatSignedCurrency = (value: number) => {
  const absolute = formatCurrency(Math.abs(value));
  if (!Number.isFinite(value) || value === 0) return absolute;
  return value > 0 ? `+${absolute}` : `-${absolute}`;
};

const formatPercent = (value: number) => `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`;

const formatSignedPercent = (value: number) => {
  if (!Number.isFinite(value) || value === 0) return '0.00%';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const formatQuantity = (value: number) =>
  Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0';

const getWorkflowEventActorLabel = (entry?: ProposalWorkflowEvent | null) =>
  entry?.actor?.name || entry?.actor?.email || 'User';

const isSelectionValueSet = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'none';
};

const getSelectionDisplayValue = (value?: string | null) =>
  isSelectionValueSet(value) ? value : 'Not set';

const splitCustomOptionItems = (items: CostLineItem[] = []) => ({
  baseItems: items.filter((item) => !isCustomOptionItem(item)),
  customOptions: items.filter(isCustomOptionItem),
});

const toWorkflowCogsRow = (
  item: CostLineItem,
  index: number,
  explicitSubcategory?: string | null
): WorkflowCogsRow => {
  const numericQuantity = Number(item.quantity);
  const numericUnitPrice = Number(item.unitPrice);
  const numericTotal = Number(item.total);
  const isOffContract = isOffContractLineItem(item);
  return {
    id: `${explicitSubcategory || getLineItemSubcategory(item) || 'base'}-${index}-${item.description || item.category || 'line'}`,
    label: item.description || item.category || 'Line Item',
    quantity: Number.isFinite(numericQuantity) ? numericQuantity : 0,
    unitPrice: Number.isFinite(numericUnitPrice) ? numericUnitPrice : 0,
    total: isOffContract ? 0 : Number.isFinite(numericTotal) ? numericTotal : 0,
    totalLabel: isOffContract ? 'Off Contract' : formatCurrency(Number.isFinite(numericTotal) ? numericTotal : 0),
    subcategory: explicitSubcategory || getLineItemSubcategory(item),
  };
};

const buildWorkflowCogsRows = (items: CostLineItem[] = [], explicitSubcategory?: string | null) =>
  items.map((item, index) => toWorkflowCogsRow(item, index, explicitSubcategory));

const buildWorkflowCogsCategory = (
  key: string,
  label: string,
  rows: WorkflowCogsRow[]
): WorkflowCogsCategory | null => {
  if (rows.length === 0) return null;
  return {
    key,
    label,
    itemCount: rows.length,
    total: rows.reduce((sum, row) => sum + row.total, 0),
    rows,
  };
};

const buildWorkflowCogsCategories = (proposal?: Partial<Proposal> | null): WorkflowCogsCategory[] => {
  if (!proposal?.costBreakdown) return [];
  const costBreakdown = normalizeCostBreakdownForDisplay(proposal.costBreakdown, proposal);
  const tileLaborItems = costBreakdown.tileLabor || [];
  const tileMaterialItems = costBreakdown.tileMaterial || [];
  const { baseItems: tileLaborBase, customOptions: tileCustomFromLabor } = splitCustomOptionItems(tileLaborItems);
  const { baseItems: tileMaterialBase, customOptions: tileCustomFromMaterial } = splitCustomOptionItems(tileMaterialItems);
  const tileCustomOptions = [...tileCustomFromLabor, ...tileCustomFromMaterial];

  return [
    buildWorkflowCogsCategory(
      'plansAndEngineering',
      'Plans & Engineering',
      buildWorkflowCogsRows(costBreakdown.plansAndEngineering || [])
    ),
    buildWorkflowCogsCategory('layout', 'Layout', buildWorkflowCogsRows(costBreakdown.layout || [])),
    buildWorkflowCogsCategory('permit', 'Permit', buildWorkflowCogsRows(costBreakdown.permit || [])),
    buildWorkflowCogsCategory('excavation', 'Excavation', buildWorkflowCogsRows(costBreakdown.excavation || [])),
    buildWorkflowCogsCategory('plumbing', 'Plumbing', buildWorkflowCogsRows(costBreakdown.plumbing || [])),
    buildWorkflowCogsCategory('gas', 'Gas', buildWorkflowCogsRows(costBreakdown.gas || [])),
    buildWorkflowCogsCategory('steel', 'Steel', buildWorkflowCogsRows(costBreakdown.steel || [])),
    buildWorkflowCogsCategory('electrical', 'Electrical', buildWorkflowCogsRows(costBreakdown.electrical || [])),
    buildWorkflowCogsCategory('shotcrete', 'Shotcrete', [
      ...buildWorkflowCogsRows(costBreakdown.shotcreteLabor || [], 'Labor'),
      ...buildWorkflowCogsRows(costBreakdown.shotcreteMaterial || [], 'Material'),
    ]),
    buildWorkflowCogsCategory('tile', 'Tile', [
      ...buildWorkflowCogsRows(tileLaborBase, 'Labor'),
      ...buildWorkflowCogsRows(tileCustomOptions, CUSTOM_OPTIONS_SUBCATEGORY),
      ...buildWorkflowCogsRows(tileMaterialBase, 'Material'),
    ]),
    buildWorkflowCogsCategory('copingDecking', 'Coping / Decking', [
      ...buildWorkflowCogsRows(costBreakdown.copingDeckingLabor || [], 'Labor'),
      ...buildWorkflowCogsRows(costBreakdown.copingDeckingMaterial || [], 'Material'),
    ]),
    buildWorkflowCogsCategory('stoneRockwork', 'Stone / Rockwork', [
      ...buildWorkflowCogsRows(costBreakdown.stoneRockworkLabor || [], 'Labor'),
      ...buildWorkflowCogsRows(costBreakdown.stoneRockworkMaterial || [], 'Material'),
    ]),
    buildWorkflowCogsCategory('drainage', 'Drainage', buildWorkflowCogsRows(costBreakdown.drainage || [])),
    buildWorkflowCogsCategory(
      'waterFeatures',
      'Water Features',
      buildWorkflowCogsRows(costBreakdown.waterFeatures || [])
    ),
    buildWorkflowCogsCategory(
      'equipmentOrdered',
      'Equipment Ordered',
      buildWorkflowCogsRows(costBreakdown.equipmentOrdered || [])
    ),
    buildWorkflowCogsCategory(
      'equipmentSet',
      'Equipment Set',
      buildWorkflowCogsRows(costBreakdown.equipmentSet || [])
    ),
    buildWorkflowCogsCategory('cleanup', 'Cleanup', buildWorkflowCogsRows(costBreakdown.cleanup || [])),
    buildWorkflowCogsCategory(
      'interiorFinish',
      'Interior Finish',
      buildWorkflowCogsRows(costBreakdown.interiorFinish || [])
    ),
    buildWorkflowCogsCategory('waterTruck', 'Water Truck', buildWorkflowCogsRows(costBreakdown.waterTruck || [])),
    buildWorkflowCogsCategory(
      'fiberglassShell',
      'Fiberglass Shell',
      buildWorkflowCogsRows(costBreakdown.fiberglassShell || [])
    ),
    buildWorkflowCogsCategory(
      'fiberglassInstall',
      'Fiberglass Install',
      buildWorkflowCogsRows(costBreakdown.fiberglassInstall || [])
    ),
    buildWorkflowCogsCategory(
      'startupOrientation',
      'Startup / Orientation',
      buildWorkflowCogsRows(costBreakdown.startupOrientation || [])
    ),
    buildWorkflowCogsCategory(
      'customFeatures',
      'Custom Features',
      buildWorkflowCogsRows(costBreakdown.customFeatures || [])
    ),
  ].filter((category): category is WorkflowCogsCategory => Boolean(category));
};

const getNonPapDiscountTotal = (proposal?: Partial<Proposal> | null) => {
  const retailAdjustments = Array.isArray(proposal?.retailAdjustments) ? proposal.retailAdjustments : [];
  const retailDiscountTotal = retailAdjustments.reduce((sum, adjustment) => {
    const amount = Number(adjustment?.amount);
    return Number.isFinite(amount) && amount < 0 ? sum + Math.abs(amount) : sum;
  }, 0);
  const manualAdjustments = proposal?.manualAdjustments || ({} as Proposal['manualAdjustments']);
  const negative1 = Number((manualAdjustments as any).negative1);
  const negative2 = Number((manualAdjustments as any).negative2);
  const manualDiscountTotal =
    Math.abs(Math.min(0, Number.isFinite(negative1) ? negative1 : 0)) +
    Math.abs(Math.min(0, Number.isFinite(negative2) ? negative2 : 0));
  return retailDiscountTotal + manualDiscountTotal;
};

const getProposalIssues = (proposal?: Partial<Proposal> | null) =>
  (proposal?.workflow?.approvalReasons || []).filter((reason) => reason.code !== 'manual_review');

const getProposalIssueCount = (proposal?: Partial<Proposal> | null) => getProposalIssues(proposal).length;

const getProposalRetailValue = (proposal?: Partial<Proposal> | null) =>
  Number(proposal?.pricing?.retailPrice || proposal?.totalCost || 0);

const getSortLabel = (value: WorkflowSortOption) => {
  if (value === 'price_high_low') return 'Price (High -> Low)';
  if (value === 'price_low_high') return 'Price (Low -> High)';
  if (value === 'oldest') return 'Oldest';
  return 'Most Recent';
};

const getProposalSortTimestamp = (proposal: Proposal) =>
  new Date(proposal.workflow?.submittedAt || proposal.lastModified || proposal.createdDate || 0).getTime();

const proposalMatchesSearch = (proposal: Proposal, query: string) => {
  if (!query.trim()) return true;
  const normalizedQuery = normalizeIdentity(query);
  return normalizeIdentity(proposal.customerInfo?.customerName).includes(normalizedQuery);
};

const sortQueueEntries = (entries: Proposal[], sortOption: WorkflowSortOption) => {
  const nextEntries = [...entries];
  nextEntries.sort((a, b) => {
    if (sortOption === 'price_high_low') {
      return getProposalRetailValue(b) - getProposalRetailValue(a);
    }
    if (sortOption === 'price_low_high') {
      return getProposalRetailValue(a) - getProposalRetailValue(b);
    }
    if (sortOption === 'oldest') {
      return getProposalSortTimestamp(a) - getProposalSortTimestamp(b);
    }
    return getProposalSortTimestamp(b) - getProposalSortTimestamp(a);
  });
  return nextEntries;
};

const parseThresholdFromReason = (reason?: ProposalWorkflowReason | null) => {
  const detail = String(reason?.detail || '');
  const match = detail.match(/vs\s+([0-9.]+)%/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const getVersionDisplayName = (version?: Partial<Proposal> | null) => {
  const name = String(version?.versionName || '').trim();
  if (name) return name;
  return (version?.versionId || ORIGINAL_VERSION_ID) === ORIGINAL_VERSION_ID ? 'Original Version' : 'Version';
};

const getVersionSubmittedAt = (proposal?: Proposal | null, version?: Partial<Proposal> | null) => {
  if (version?.versionSubmittedAt) return version.versionSubmittedAt;
  if (!proposal) return null;
  const targetId = version?.versionId || ORIGINAL_VERSION_ID;
  const matchingSubmission = [...(proposal.workflow?.history || [])]
    .reverse()
    .find(
      (entry) => entry.type === 'submitted' && (entry.versionId || ORIGINAL_VERSION_ID) === targetId
    );
  if (matchingSubmission?.createdAt) return matchingSubmission.createdAt;
  if ((proposal.workflow?.submittedVersionId || ORIGINAL_VERSION_ID) === targetId) {
    return proposal.workflow?.submittedAt || null;
  }
  return null;
};

const getComparisonDeltaClass = (
  value: number,
  tone: 'danger' | 'success'
) => {
  if (!Number.isFinite(value) || value === 0) return '';
  if (tone === 'success') return value > 0 ? 'is-success' : 'is-danger';
  return value > 0 ? 'is-danger' : 'is-success';
};

function WorkflowIcon({ name, className }: { name: WorkflowIconName; className?: string }) {
  const strokeWidth = 1.8;
  switch (name) {
    case 'summary':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
          <path d="M8 9.5h8M8 12.5h8M8 15.5h5" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    case 'cogs':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M12 3.8l2.2 1 2.4-.5 1.1 2.2 2.2 1.1-.5 2.4 1 2.2-1 2.2.5 2.4-2.2 1.1-1.1 2.2-2.4-.5-2.2 1-2.2-1-2.4.5-1.1-2.2-2.2-1.1.5-2.4-1-2.2 1-2.2-.5-2.4 2.2-1.1 1.1-2.2 2.4.5z" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3.1" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
        </svg>
      );
    case 'proposal':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M7 5h7l4 4v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
          <path d="M14 5v4h4" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M8.5 13h7M8.5 16h5.5" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    case 'notes':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M8.5 8.5h7M8.5 11.5h5" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    case 'versions':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M7.5 6.5h9M7.5 12h9M7.5 17.5h9" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
          <circle cx="5.2" cy="6.5" r="1.2" fill="currentColor" />
          <circle cx="5.2" cy="12" r="1.2" fill="currentColor" />
          <circle cx="5.2" cy="17.5" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'issues':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M12 4.2l8 14H4z" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
          <path d="M12 9v4.8M12 17.2h.01" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    case 'compare':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M8 6H5v13h3M16 6h3v13h-3M9 8h6M9 12h6M9 16h6" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <circle cx="11" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth={strokeWidth} />
          <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </svg>
      );
    case 'filter':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M5 7h14l-5.8 6v4l-2.4 1v-5z" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round" />
        </svg>
      );
    case 'more':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <circle cx="6.5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="17.5" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'back':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M14.5 7.5L10 12l4.5 4.5M10 12h8" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'open':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
          <path d="M9 5h10v10M19 5l-9.5 9.5" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 13.5v4A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5v-11A1.5 1.5 0 0 1 6.5 5h4" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function WorkflowPage({ session, cloudIssue }: WorkflowPageProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { proposalNumber } = useParams();
  const isOffline = cloudIssue === 'no-internet' || cloudIssue === 'server-issue';
  const isMasterInspection = isMasterActingAsOwnerSession();
  const inspectionDisabledReason = isMasterInspection
    ? 'Master inspection mode is read-only.'
    : undefined;
  const offlineActionDisabledReason = isMasterInspection
    ? inspectionDisabledReason
    : isOffline
    ? 'Internet connection must be restored'
    : undefined;
  const { showToast } = useToast();
  const workflowLocationState = (location.state as WorkflowLocationState | null) ?? null;
  const filterMenuRef = useRef<HTMLDivElement | null>(null);

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [franchiseUsers, setFranchiseUsers] = useState<FranchiseUser[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<QueueFilter>(
    () => workflowLocationState?.selectedFilter || 'needs_approval'
  );
  const [selectedUserId, setSelectedUserId] = useState<string>(
    () => workflowLocationState?.selectedUserId || ''
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<WorkflowSortOption>('most_recent');
  const [activeDetailTab, setActiveDetailTab] = useState<WorkflowDetailTab>('summary');
  const [noteDraft, setNoteDraft] = useState('');
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [expandedCogsCategories, setExpandedCogsCategories] = useState<string[]>([]);
  const [expandedSelectionCategories, setExpandedSelectionCategories] = useState<string[]>([]);
  const [expandedComparisonCategories, setExpandedComparisonCategories] = useState<string[]>([]);
  const [showDesignerFilter, setShowDesignerFilter] = useState(false);
  const [showDiffOverlay, setShowDiffOverlay] = useState(false);
  const [showComparisonChangesOnly, setShowComparisonChangesOnly] = useState(true);
  const [activeComparisonId, setActiveComparisonId] = useState<string | null>(null);

  const effectiveRole = String(session?.role || '').trim().toLowerCase();
  const canAccess =
    effectiveRole === 'owner' ||
    effectiveRole === 'admin' ||
    effectiveRole === 'bookkeeper' ||
    effectiveRole === 'master';
  const { disableSignedWorkflow } = useFranchiseSignedWorkflowDisabled(
    selectedProposal?.franchiseId || session?.franchiseId || undefined
  );

  const loadWorkspace = async (preferredProposalNumber?: string | null) => {
    if (!canAccess) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const rows = (await listProposals(session?.franchiseId)).map((entry) => ensureProposalWorkflow(entry));
      setProposals(rows);

      const preferred = preferredProposalNumber || proposalNumber;
      if (preferred) {
        const selected = rows.find((entry) => entry.proposalNumber === preferred);
        if (selected) {
          await loadSelectedProposal(selected.proposalNumber, rows);
          return;
        }
      }

      setSelectedProposal(null);
    } catch (error) {
      console.error('Failed to load workflow workspace', error);
      showToast({ type: 'error', message: 'Unable to load the workflow workspace.' });
    } finally {
      setLoading(false);
    }
  };

  const loadSelectedProposal = async (targetProposalNumber: string, sourceRows?: Proposal[]) => {
    try {
      const loaded = await getProposal(targetProposalNumber);
      if (!loaded) {
        setSelectedProposal(null);
        return;
      }

      const normalized = ensureProposalWorkflow(loaded);
      const readUpdated = isMasterInspection ? normalized : markWorkflowRead(normalized, session?.userId);
      const didUpdateReadState =
        JSON.stringify(readUpdated.workflow?.history || []) !== JSON.stringify(normalized.workflow?.history || []);
      const persisted = !isMasterInspection && didUpdateReadState ? await saveProposal(readUpdated) : readUpdated;
      const finalProposal = ensureProposalWorkflow(persisted as Proposal);
      setSelectedProposal(finalProposal);

      setProposals((current) => {
        const base = sourceRows || current;
        return base.map((entry) =>
          entry.proposalNumber === finalProposal.proposalNumber ? finalProposal : entry
        );
      });
    } catch (error) {
      console.error('Failed to load selected workflow proposal', error);
      showToast({ type: 'error', message: 'Unable to load the selected proposal.' });
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, [canAccess, proposalNumber, session?.franchiseId]);

  useEffect(() => {
    if (!canAccess || !session?.franchiseId) {
      setFranchiseUsers([]);
      setUsersLoaded(true);
      return;
    }

    let cancelled = false;
    setUsersLoaded(false);

    const loadUsers = async () => {
      try {
        const rows = await listFranchiseUsers(session.franchiseId as string);
        if (!cancelled) {
          setFranchiseUsers(rows);
          setUsersLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load franchise users for workflow filter', error);
        if (!cancelled) {
          setFranchiseUsers([]);
          setUsersLoaded(true);
        }
      }
    };

    void loadUsers();
    return () => {
      cancelled = true;
    };
  }, [canAccess, session?.franchiseId]);

  useEffect(() => {
    const hasFilterOverride = workflowLocationState?.selectedFilter !== undefined;
    const hasUserOverride = workflowLocationState?.selectedUserId !== undefined;
    if (!hasFilterOverride && !hasUserOverride) return;
    if (hasFilterOverride) {
      setSelectedFilter(workflowLocationState?.selectedFilter || 'needs_approval');
    }
    if (hasUserOverride) {
      setSelectedUserId(workflowLocationState?.selectedUserId || '');
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, workflowLocationState?.selectedFilter, workflowLocationState?.selectedUserId]);

  useEffect(() => {
    const handleOnline = () => {
      void loadWorkspace(selectedProposal?.proposalNumber || proposalNumber);
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [proposalNumber, selectedProposal?.proposalNumber]);

  useEffect(() => {
    setActiveDetailTab('summary');
    setNoteDraft('');
    setShowCompleteConfirm(false);
    setShowDiffOverlay(false);
    setShowDesignerFilter(false);
  }, [selectedProposal?.proposalNumber]);

  useEffect(() => {
    setExpandedCogsCategories([]);
    setExpandedSelectionCategories([]);
    setExpandedComparisonCategories([]);
  }, [selectedProposal?.proposalNumber]);

  useEffect(() => {
    if (!showDesignerFilter) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setShowDesignerFilter(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDesignerFilter]);

  const selectedUser = useMemo(
    () => franchiseUsers.find((entry) => entry.id === selectedUserId) || null,
    [franchiseUsers, selectedUserId]
  );

  useEffect(() => {
    if (!usersLoaded || !selectedUserId) return;
    if (!selectedUser) {
      setSelectedUserId('');
    }
  }, [selectedUser, selectedUserId, usersLoaded]);

  const counts = useMemo(() => {
    const countForFilter = (filter: QueueFilter) =>
      proposals.filter((entry) => matchesQueueFilter(entry, filter) && proposalBelongsToUser(entry, selectedUser)).length;
    return {
      needsApproval: countForFilter('needs_approval'),
      approved: countForFilter('approved'),
      signed: countForFilter('signed'),
      archive: countForFilter('archive'),
    };
  }, [proposals, selectedUser]);

  const queueScopedProposals = useMemo(
    () =>
      proposals
        .filter((entry) => matchesQueueFilter(entry, selectedFilter))
        .filter((entry) => proposalBelongsToUser(entry, selectedUser)),
    [proposals, selectedFilter, selectedUser]
  );

  const filteredProposals = useMemo(
    () => sortQueueEntries(queueScopedProposals.filter((entry) => proposalMatchesSearch(entry, searchQuery)), sortOption),
    [queueScopedProposals, searchQuery, sortOption]
  );

  useEffect(() => {
    if (!selectedProposal) return;
    if (filteredProposals.some((entry) => entry.proposalNumber === selectedProposal.proposalNumber)) {
      return;
    }
    setSelectedProposal(null);
    if (proposalNumber) {
      navigate('/workflow', { replace: true });
    }
  }, [filteredProposals, navigate, proposalNumber, selectedProposal]);

  useEffect(() => {
    if (!selectedProposal || !proposalNumber || workflowLocationState?.selectedFilter) return;
    const inferredFilter = getQueueFilterForProposal(selectedProposal);
    if (inferredFilter !== selectedFilter) {
      setSelectedFilter(inferredFilter);
    }
  }, [proposalNumber, selectedFilter, selectedProposal, workflowLocationState?.selectedFilter]);

  const selectedDiff = useMemo(
    () => (selectedProposal ? buildVersionDiffSummary(selectedProposal) : null),
    [selectedProposal]
  );

  const selectedSignedDiffs = useMemo(
    () => (selectedProposal ? buildSignedAddendumDiffSummaries(selectedProposal) : []),
    [selectedProposal]
  );

  const selectedComparisonSummaries = useMemo(() => {
    if (selectedDiff) return [selectedDiff];
    return selectedSignedDiffs;
  }, [selectedDiff, selectedSignedDiffs]);

  useEffect(() => {
    if (selectedComparisonSummaries.length === 0) {
      setActiveComparisonId(null);
      return;
    }
    setActiveComparisonId((current) =>
      selectedComparisonSummaries.some((summary) => summary.reviewVersionId === current)
        ? current
        : selectedComparisonSummaries[selectedComparisonSummaries.length - 1].reviewVersionId
    );
  }, [selectedComparisonSummaries]);

  const activeComparisonSummary = useMemo(() => {
    if (selectedComparisonSummaries.length === 0) return null;
    return (
      selectedComparisonSummaries.find((summary) => summary.reviewVersionId === activeComparisonId) ||
      selectedComparisonSummaries[selectedComparisonSummaries.length - 1]
    );
  }, [activeComparisonId, selectedComparisonSummaries]);

  const selectedApprovedVersionId = selectedProposal ? getApprovedVersionId(selectedProposal) : null;
  const selectedReviewVersion = selectedProposal ? getPendingReviewVersion(selectedProposal) : null;
  const selectedApprovedVersion = selectedProposal ? getApprovedVersion(selectedProposal) : null;
  const selectedSignedVersion = selectedProposal ? getSignedVersion(selectedProposal) : null;
  const selectedDisplayVersion =
    selectedReviewVersion || selectedApprovedVersion || selectedSignedVersion || selectedProposal;

  const selectedWorkflowReasons = getProposalIssues(selectedProposal);
  const selectedBelowMarginThreshold = selectedWorkflowReasons.some(
    (reason) => reason.code === 'margin_below_threshold'
  );
  const selectedMarginReason = selectedWorkflowReasons.find(
    (reason) => reason.code === 'margin_below_threshold'
  );

  const selectedRetailTotal = getProposalRetailValue(selectedDisplayVersion);
  const selectedTotalCogs = Number(selectedDisplayVersion?.pricing?.totalCOGS || 0);
  const selectedGrossProfitAmount = Number(selectedDisplayVersion?.pricing?.grossProfit || 0);
  const selectedGrossProfitPercent = Number(selectedDisplayVersion?.pricing?.grossProfitMargin || 0);
  const selectedDiscountAmount = getNonPapDiscountTotal(selectedDisplayVersion);

  const selectedHistory = useMemo(
    () =>
      [...(selectedProposal?.workflow?.history || [])].sort(
        (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
      ),
    [selectedProposal]
  );

  const selectedActivityEntries = useMemo(
    () => selectedHistory.filter((entry) => ['submitted', 'approved', 'signed', 'completed'].includes(entry.type)),
    [selectedHistory]
  );

  const selectedRecentActivityEntries = useMemo(
    () => [...selectedActivityEntries].reverse().slice(0, 4),
    [selectedActivityEntries]
  );

  const selectedNoteEntries = useMemo(
    () =>
      [...selectedHistory]
        .filter((entry) => {
          if (entry.type === 'note') return true;
          return Boolean(entry.message);
        })
        .reverse(),
    [selectedHistory]
  );

  const selectedProposalSelectionCategories = useMemo(
    () => (selectedDisplayVersion ? buildProposalSelectionCategories(selectedDisplayVersion) : []),
    [selectedDisplayVersion]
  );

  const selectedCogsCategories = useMemo(
    () => buildWorkflowCogsCategories(selectedDisplayVersion),
    [selectedDisplayVersion]
  );

  const selectedCurrentStatus = selectedProposal ? getWorkflowStatus(selectedProposal) : 'draft';
  const selectedCanSendNotes =
    !isMasterInspection && Boolean(selectedProposal?.workflow?.submittedAt) && selectedCurrentStatus !== 'completed';
  const selectedCanRequestChanges =
    !isMasterInspection && selectedCurrentStatus !== 'completed' && selectedCurrentStatus !== 'signed';

  const selectedVersionMap = useMemo(() => {
    const map = new Map<string, Proposal>();
    if (!selectedProposal) return map;
    listAllVersions(selectedProposal).forEach((version) => {
      map.set(version.versionId || ORIGINAL_VERSION_ID, version);
    });
    return map;
  }, [selectedProposal]);

  const selectedSubmittedVersions = useMemo<WorkflowVersionEntry[]>(() => {
    if (!selectedProposal) return [];
    return listAllVersions(selectedProposal)
      .map((version) => {
        const submittedAt = getVersionSubmittedAt(selectedProposal, version);
        if (!submittedAt) return null;
        return {
          versionId: version.versionId || ORIGINAL_VERSION_ID,
          versionName: getVersionDisplayName(version),
          submittedAt,
          version,
        };
      })
      .filter((entry): entry is WorkflowVersionEntry => Boolean(entry))
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
  }, [selectedProposal]);

  const selectedDesigner = useMemo(
    () => franchiseUsers.find((user) => proposalDesignerMatchesUser(selectedProposal?.designerName, user)) || null,
    [franchiseUsers, selectedProposal?.designerName]
  );

  const selectedDesignerThreshold = useMemo(() => {
    const threshold = Number(selectedDesigner?.approvalMarginThresholdPercent);
    if (Number.isFinite(threshold)) return threshold;
    return parseThresholdFromReason(selectedMarginReason);
  }, [selectedDesigner, selectedMarginReason]);

  const selectedBreakdownTotal = useMemo(
    () => selectedCogsCategories.reduce((sum, category) => sum + category.total, 0),
    [selectedCogsCategories]
  );

  const selectedBreakdownSegments = useMemo<WorkflowBreakdownSegment[]>(() => {
    if (selectedBreakdownTotal <= 0) return [];
    const sorted = [...selectedCogsCategories].sort((a, b) => b.total - a.total);
    const topCategories = sorted.slice(0, 4).map((category) => ({
      key: category.key,
      label: category.label,
      value: category.total,
    }));
    const otherValue = sorted.slice(4).reduce((sum, category) => sum + category.total, 0);
    const segments = otherValue > 0
      ? [...topCategories, { key: 'other', label: 'Other Categories', value: otherValue }]
      : topCategories;

    return segments.map((segment, index) => ({
      ...segment,
      percent: selectedBreakdownTotal > 0 ? (segment.value / selectedBreakdownTotal) * 100 : 0,
      color: BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length],
    }));
  }, [selectedBreakdownTotal, selectedCogsCategories]);

  const selectedBreakdownGradient = useMemo(() => {
    if (!selectedBreakdownSegments.length) return 'transparent';
    let currentAngle = 0;
    const stops = selectedBreakdownSegments.map((segment) => {
      const nextAngle = currentAngle + (segment.percent / 100) * 360;
      const stop = `${segment.color} ${currentAngle}deg ${nextAngle}deg`;
      currentAngle = nextAngle;
      return stop;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [selectedBreakdownSegments]);

  const selectedCogsPreviewRows = useMemo(
    () => [...selectedCogsCategories].sort((a, b) => b.total - a.total).slice(0, 8),
    [selectedCogsCategories]
  );

  const activeComparisonVersions = useMemo(() => {
    if (!activeComparisonSummary) return null;
    const compareVersionId =
      activeComparisonSummary.compareVersionId || activeComparisonSummary.approvedVersionId || null;
    const reviewVersion = selectedVersionMap.get(activeComparisonSummary.reviewVersionId);
    const compareVersion = compareVersionId ? selectedVersionMap.get(compareVersionId) : null;
    if (!reviewVersion || !compareVersion || !selectedProposal) return null;
    return {
      reviewVersion,
      compareVersion,
      reviewSubmittedAt: getVersionSubmittedAt(selectedProposal, reviewVersion),
      compareSubmittedAt: getVersionSubmittedAt(selectedProposal, compareVersion),
    };
  }, [activeComparisonSummary, selectedProposal, selectedVersionMap]);

  const activeComparisonRows = useMemo<WorkflowComparisonPreviewRow[]>(() => {
    if (!activeComparisonSummary || !activeComparisonVersions) return [];

    const overviewRows: WorkflowComparisonPreviewRow[] = [
      {
        key: 'retail',
        group: 'overview',
        label: 'Total Retail',
        before: formatCurrency(getProposalRetailValue(activeComparisonVersions.compareVersion)),
        after: formatCurrency(getProposalRetailValue(activeComparisonVersions.reviewVersion)),
        delta: activeComparisonSummary.retailDelta,
        deltaLabel: formatSignedCurrency(activeComparisonSummary.retailDelta),
        tone: 'danger',
      },
      {
        key: 'cogs',
        group: 'overview',
        label: 'Total COGS',
        before: formatCurrency(Number(activeComparisonVersions.compareVersion.pricing?.totalCOGS || 0)),
        after: formatCurrency(Number(activeComparisonVersions.reviewVersion.pricing?.totalCOGS || 0)),
        delta: activeComparisonSummary.costDelta,
        deltaLabel: formatSignedCurrency(activeComparisonSummary.costDelta),
        tone: 'danger',
      },
      {
        key: 'gross-profit-percent',
        group: 'overview',
        label: 'Gross Profit %',
        before: formatPercent(Number(activeComparisonVersions.compareVersion.pricing?.grossProfitMargin || 0)),
        after: formatPercent(Number(activeComparisonVersions.reviewVersion.pricing?.grossProfitMargin || 0)),
        delta: activeComparisonSummary.grossMarginDelta,
        deltaLabel: formatSignedPercent(activeComparisonSummary.grossMarginDelta),
        tone: 'success',
      },
    ];

    const categoryRows = [...activeComparisonSummary.categories]
      .filter((category) => category.costChanges.length > 0)
      .sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta))
      .slice(0, 5)
      .map<WorkflowComparisonPreviewRow>((category) => {
        const beforeTotal = category.costChanges.reduce((sum, change) => sum + change.beforeTotal, 0);
        const afterTotal = category.costChanges.reduce((sum, change) => sum + change.afterTotal, 0);
        return {
          key: category.key,
          group: 'category',
          label: category.label,
          before: formatCurrency(beforeTotal),
          after: formatCurrency(afterTotal),
          delta: category.totalDelta,
          deltaLabel: formatSignedCurrency(category.totalDelta),
          tone: 'danger',
        };
      });

    const allRows = [...overviewRows, ...categoryRows];
    if (!showComparisonChangesOnly) return allRows;
    return allRows.filter((row) => row.delta !== 0);
  }, [activeComparisonSummary, activeComparisonVersions, showComparisonChangesOnly]);

  const selectedUserLabel = selectedUser ? getUserFilterLabel(selectedUser) : null;
  const emptyDetailMessage =
    queueScopedProposals.length === 0 && selectedUserLabel
      ? `No proposals for ${selectedUserLabel} in this view.`
      : searchQuery.trim() && filteredProposals.length === 0
      ? 'No proposals match this search.'
      : selectedFilter === 'needs_approval' && queueScopedProposals.length > 0
      ? 'Select a proposal that is awaiting approval on the left.'
      : selectedFilter === 'signed' && queueScopedProposals.length > 0
      ? 'Select a signed proposal to review its addendum history.'
      : 'Select a proposal to review its workflow.';

  const persistSelectedProposal = async (nextProposal: Proposal, successMessage: string) => {
    if (isMasterInspection) {
      showToast({ type: 'warning', message: inspectionDisabledReason || 'Master inspection mode is read-only.' });
      return;
    }
    setSavingAction(successMessage);
    try {
      const saved = ensureProposalWorkflow((await saveProposal(nextProposal, { requireOnline: true })) as Proposal);
      const nextRows = proposals.map((entry) =>
        entry.proposalNumber === saved.proposalNumber ? saved : entry
      );
      const nextSelected =
        filteredProposals.find((entry) => entry.proposalNumber === saved.proposalNumber) &&
        matchesQueueFilter(saved, selectedFilter) &&
        proposalBelongsToUser(saved, selectedUser) &&
        proposalMatchesSearch(saved, searchQuery)
          ? saved
          : sortQueueEntries(
              nextRows
                .filter((entry) => matchesQueueFilter(entry, selectedFilter))
                .filter((entry) => proposalBelongsToUser(entry, selectedUser))
                .filter((entry) => proposalMatchesSearch(entry, searchQuery)),
              sortOption
            )[0] || null;

      setSelectedProposal(nextSelected);
      setProposals(nextRows);
      setNoteDraft('');
      if (nextSelected) {
        navigate(`/workflow/${nextSelected.proposalNumber}`, { replace: true });
      } else {
        navigate('/workflow', { replace: true });
      }
      showToast({ type: 'success', message: successMessage });
    } catch (error) {
      console.error('Failed to save workflow action', error);
      showToast({
        type: 'error',
        message: (error as any)?.message || 'Unable to save the workflow action.',
      });
    } finally {
      setSavingAction(null);
    }
  };

  const handleFilterChange = (nextFilter: QueueFilter) => {
    setSelectedFilter(nextFilter);
  };

  const handleUserFilterChange = (nextUserId: string) => {
    setSelectedUserId(nextUserId);
    setShowDesignerFilter(false);
  };

  const handleApprove = async () => {
    if (!selectedProposal || isOffline) return;
    await persistSelectedProposal(
      approveWorkflowProposal(selectedProposal, undefined, session),
      getSignedVersion(selectedProposal) ? 'Proposal addendum approved.' : 'Proposal approved.'
    );
  };

  const handleRequestChanges = async () => {
    if (isOffline) return;
    if (!selectedProposal || !noteDraft.trim()) {
      setActiveDetailTab('notes_activity');
      return;
    }
    await persistSelectedProposal(
      requestWorkflowChanges(selectedProposal, noteDraft.trim(), session),
      'Proposal returned with requested changes.'
    );
  };

  const handleSendNote = async () => {
    if (isOffline) return;
    if (!selectedProposal || !noteDraft.trim()) {
      setActiveDetailTab('notes_activity');
      return;
    }
    await persistSelectedProposal(
      addWorkflowNote(selectedProposal, noteDraft.trim(), session),
      'Note sent.'
    );
  };

  const handleComplete = async () => {
    if (!selectedProposal || getWorkflowStatus(selectedProposal) !== 'signed' || isOffline) return;
    await persistSelectedProposal(
      completeWorkflowProposal(selectedProposal, undefined, session),
      'Proposal marked as completed.'
    );
  };

  const toggleCogsCategory = (categoryKey: string) => {
    setExpandedCogsCategories((current) =>
      current.includes(categoryKey)
        ? current.filter((entry) => entry !== categoryKey)
        : [...current, categoryKey]
    );
  };

  const toggleSelectionCategory = (categoryKey: string) => {
    setExpandedSelectionCategories((current) =>
      current.includes(categoryKey)
        ? current.filter((entry) => entry !== categoryKey)
        : [...current, categoryKey]
    );
  };

  const toggleComparisonCategory = (categoryKey: string) => {
    setExpandedComparisonCategories((current) =>
      current.includes(categoryKey)
        ? current.filter((entry) => entry !== categoryKey)
        : [...current, categoryKey]
    );
  };

  const openSelectedProposalVersion = (
    versionId?: string | null,
    options?: { openSignModal?: boolean }
  ) => {
    if (!selectedProposal) return;
    navigate(`/proposal/view/${selectedProposal.proposalNumber}`, {
      state: {
        versionId: versionId || undefined,
        openSignModal: options?.openSignModal === true,
        reviewerReturnTo: 'workflow',
        reviewerReturnPath: '/workflow',
        reviewerReturnFilter: selectedFilter,
        reviewerReturnUserId: selectedUserId || null,
      },
    });
  };

  const renderSummaryTab = () => (
    <div className="workflow-summary-tab">
      <div className="workflow-summary-grid">
        <section className="workflow-panel-card workflow-financial-overview-card">
          <div className="workflow-panel-header">
            <div>
              <h3>Financial Overview</h3>
            </div>
          </div>
          <dl className="workflow-definition-list">
            <div className="workflow-definition-row">
              <dt>Pricing Model</dt>
              <dd>{selectedProposal?.pricingModelName || 'Pricing Model'}</dd>
            </div>
            <div className="workflow-definition-row">
              <dt>Total Retail</dt>
              <dd>{formatCurrency(selectedRetailTotal)}</dd>
            </div>
            <div className="workflow-definition-row">
              <dt>Total COGS</dt>
              <dd>{formatCurrency(selectedTotalCogs)}</dd>
            </div>
            <div className="workflow-definition-row">
              <dt>Gross Profit $</dt>
              <dd>{formatCurrency(selectedGrossProfitAmount)}</dd>
            </div>
            <div className="workflow-definition-row">
              <dt>Gross Profit %</dt>
              <dd className={selectedBelowMarginThreshold ? 'is-danger' : ''}>
                {formatPercent(selectedGrossProfitPercent)}
              </dd>
            </div>
            <div className="workflow-definition-row">
              <dt>Discount Amount</dt>
              <dd>{formatCurrency(selectedDiscountAmount)}</dd>
            </div>
            <div className="workflow-definition-row">
              <dt>Designer Threshold</dt>
              <dd>{selectedDesignerThreshold !== null ? formatPercent(selectedDesignerThreshold) : 'N/A'}</dd>
            </div>
          </dl>
        </section>

        <section className="workflow-panel-card workflow-breakdown-card">
          <div className="workflow-panel-header">
            <div>
              <h3>Breakdown</h3>
            </div>
          </div>
          {selectedBreakdownSegments.length === 0 ? (
            <div className="workflow-empty workflow-inline-empty">No COGS data is available for this proposal.</div>
          ) : (
            <>
              <div className="workflow-breakdown-layout">
                <div className="workflow-breakdown-donut" style={{ background: selectedBreakdownGradient }}>
                  <div className="workflow-breakdown-donut-center">
                    <strong>{formatCurrency(selectedBreakdownTotal)}</strong>
                    <span>Total COGS</span>
                  </div>
                </div>
                <div className="workflow-breakdown-legend">
                  {selectedBreakdownSegments.map((segment) => (
                    <div key={segment.key} className="workflow-breakdown-legend-row">
                      <div className="workflow-breakdown-legend-copy">
                        <span
                          className="workflow-breakdown-dot"
                          style={{ backgroundColor: segment.color }}
                          aria-hidden="true"
                        />
                        <span>{segment.label}</span>
                      </div>
                      <div className="workflow-breakdown-legend-metrics">
                        <strong>{formatCurrency(segment.value)}</strong>
                        <span>{segment.percent.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="workflow-inline-link"
                onClick={() => setActiveDetailTab('cogs')}
              >
                View full COGS breakdown
              </button>
            </>
          )}
        </section>

        <div className="workflow-summary-side-column">
          <section className="workflow-panel-card workflow-quick-notes-card">
            <div className="workflow-panel-header">
              <div>
                <h3>Quick Notes</h3>
              </div>
            </div>
            <textarea
              className="workflow-note-input workflow-note-input-compact"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Add a note (shared notes only)..."
              disabled={!selectedCanSendNotes}
            />
            <div className="workflow-note-actions workflow-note-actions-compact">
              <TooltipAnchor tooltip={offlineActionDisabledReason}>
                <button
                  type="button"
                  className="workflow-secondary-btn"
                  disabled={!selectedCanSendNotes || !noteDraft.trim() || Boolean(savingAction) || isOffline}
                  onClick={() => {
                    void handleSendNote();
                  }}
                >
                  Add Note
                </button>
              </TooltipAnchor>
            </div>
          </section>

          <section className="workflow-panel-card workflow-recent-activity-card">
            <div className="workflow-panel-header">
              <div>
                <h3>Recent Activity</h3>
              </div>
            </div>
            {selectedRecentActivityEntries.length === 0 ? (
              <div className="workflow-empty workflow-inline-empty">No activity recorded yet.</div>
            ) : (
              <div className="workflow-activity-list">
                {selectedRecentActivityEntries.map((entry) => (
                  <div key={entry.id} className="workflow-activity-item">
                    <div className="workflow-activity-line" aria-hidden="true" />
                    <div className="workflow-activity-item-copy">
                      <strong>{normalizeStatusLabel(entry.type)}</strong>
                      <span>{getWorkflowEventActorLabel(entry)}</span>
                    </div>
                    <div className="workflow-activity-item-time">{formatDateTime(entry.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="workflow-summary-bottom-grid">
        <section className="workflow-panel-card workflow-cogs-preview-card">
          <div className="workflow-panel-header">
            <div>
              <h3>COGS Breakdown</h3>
              <p>Detailed breakdown of costs</p>
            </div>
          </div>
          {selectedCogsPreviewRows.length === 0 ? (
            <div className="workflow-empty workflow-inline-empty">No COGS categories are available.</div>
          ) : (
            <>
              <div className="workflow-table-shell">
                <table className="workflow-summary-table workflow-compact-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Line Items</th>
                      <th>Total</th>
                      <th>% of Retail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCogsPreviewRows.map((category) => (
                      <tr key={category.key}>
                        <td>{category.label}</td>
                        <td>{category.itemCount}</td>
                        <td>{formatCurrency(category.total)}</td>
                        <td>
                          {selectedRetailTotal > 0
                            ? `${((category.total / selectedRetailTotal) * 100).toFixed(1)}%`
                            : '0.0%'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="workflow-inline-link"
                onClick={() => setActiveDetailTab('cogs')}
              >
                View full COGS breakdown
              </button>
            </>
          )}
        </section>

        <section className="workflow-panel-card workflow-comparison-preview-card">
          <div className="workflow-panel-header">
            <div>
              <h3>Comparison View</h3>
              <p>
                {activeComparisonSummary
                  ? `${activeComparisonSummary.compareVersionName || 'Approved Proposal'} vs ${activeComparisonSummary.reviewVersionName}`
                  : 'No addendum comparison is available'}
              </p>
            </div>
            {activeComparisonSummary && (
              <label className="workflow-switch">
                <span>Show changes only</span>
                <button
                  type="button"
                  className={`workflow-switch-toggle${showComparisonChangesOnly ? ' is-on' : ''}`}
                  onClick={() => setShowComparisonChangesOnly((current) => !current)}
                  aria-pressed={showComparisonChangesOnly}
                >
                  <span className="workflow-switch-handle" />
                </button>
              </label>
            )}
          </div>

          {selectedComparisonSummaries.length > 1 && (
            <div className="workflow-comparison-switcher">
              {selectedComparisonSummaries.map((summary) => (
                <button
                  key={summary.reviewVersionId}
                  type="button"
                  className={`workflow-comparison-switcher-btn${
                    summary.reviewVersionId === activeComparisonSummary?.reviewVersionId ? ' is-active' : ''
                  }`}
                  onClick={() => setActiveComparisonId(summary.reviewVersionId)}
                >
                  {summary.reviewVersionName}
                </button>
              ))}
            </div>
          )}

          {!activeComparisonSummary || !activeComparisonVersions ? (
            <div className="workflow-empty workflow-inline-empty">No addendum changes are available to compare.</div>
          ) : (
            <>
              <div className="workflow-table-shell">
                <table className="workflow-summary-table workflow-comparison-table">
                  <thead>
                    <tr>
                      <th>Category / Item</th>
                      <th>
                        <div>{activeComparisonSummary.compareVersionName || 'Approved Proposal'}</div>
                        <span>{formatDateTime(activeComparisonVersions.compareSubmittedAt)}</span>
                      </th>
                      <th>
                        <div>{activeComparisonSummary.reviewVersionName}</div>
                        <span>{formatDateTime(activeComparisonVersions.reviewSubmittedAt)}</span>
                      </th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeComparisonRows.length > 0 &&
                      activeComparisonRows.some((row) => row.group === 'overview') && (
                        <tr className="workflow-comparison-section-row">
                          <td colSpan={4}>Overview</td>
                        </tr>
                      )}
                    {activeComparisonRows
                      .filter((row) => row.group === 'overview')
                      .map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.before}</td>
                          <td>{row.after}</td>
                          <td className={getComparisonDeltaClass(row.delta, row.tone)}>{row.deltaLabel}</td>
                        </tr>
                      ))}
                    {activeComparisonRows.length > 0 &&
                      activeComparisonRows.some((row) => row.group === 'category') && (
                        <tr className="workflow-comparison-section-row">
                          <td colSpan={4}>COGS Categories</td>
                        </tr>
                      )}
                    {activeComparisonRows
                      .filter((row) => row.group === 'category')
                      .map((row) => (
                        <tr key={row.key}>
                          <td>{row.label}</td>
                          <td>{row.before}</td>
                          <td>{row.after}</td>
                          <td className={getComparisonDeltaClass(row.delta, row.tone)}>{row.deltaLabel}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="workflow-inline-link"
                onClick={() => setShowDiffOverlay(true)}
              >
                View full change breakdown
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );

  const renderCogsTab = () => (
    <div className="workflow-panel-card">
      <div className="workflow-panel-header">
        <div>
          <h3>COGS Breakdown</h3>
          <p>Expand a category to inspect the line items inside it.</p>
        </div>
      </div>
      {selectedCogsCategories.length === 0 ? (
        <div className="workflow-empty workflow-inline-empty">No COGS data is available for this proposal.</div>
      ) : (
        <div className="workflow-table-shell">
          <table className="workflow-summary-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Line Items</th>
                <th>Total</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            {selectedCogsCategories.map((category) => {
              const expanded = expandedCogsCategories.includes(category.key);
              return (
                <tbody key={category.key}>
                  <tr className="workflow-summary-row">
                    <td>
                      <button
                        type="button"
                        className="workflow-table-toggle"
                        onClick={() => toggleCogsCategory(category.key)}
                        aria-expanded={expanded}
                      >
                        <span className="workflow-table-toggle-icon">{expanded ? '-' : '+'}</span>
                        <span>{category.label}</span>
                      </button>
                    </td>
                    <td>{category.itemCount}</td>
                    <td>{formatCurrency(category.total)}</td>
                    <td className="workflow-summary-row-action">{expanded ? 'Hide' : 'View'}</td>
                  </tr>
                  {expanded && (
                    <tr className="workflow-expand-row">
                      <td colSpan={4}>
                        <div className="workflow-expand-panel">
                          <table className="workflow-detail-table">
                            <thead>
                              <tr>
                                <th>Line Item</th>
                                <th>Type</th>
                                <th>Qty</th>
                                <th>Unit Cost</th>
                                <th>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {category.rows.map((row) => (
                                <tr key={row.id}>
                                  <td>{row.label}</td>
                                  <td>{row.subcategory || 'Base'}</td>
                                  <td>{formatQuantity(row.quantity)}</td>
                                  <td>{formatCurrency(row.unitPrice)}</td>
                                  <td>{row.totalLabel}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );

  const renderProposalSelectionsTab = () => (
    <div className="workflow-panel-card">
      <div className="workflow-panel-header">
        <div>
          <h3>Proposal Selections</h3>
          <p>Every builder section with the values selected for it.</p>
        </div>
      </div>
      {selectedProposalSelectionCategories.length === 0 ? (
        <div className="workflow-empty workflow-inline-empty">No proposal selections are available for this version.</div>
      ) : (
        <div className="workflow-table-shell">
          <table className="workflow-summary-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Filled</th>
                <th>Fields</th>
                <th aria-hidden="true" />
              </tr>
            </thead>
            {selectedProposalSelectionCategories.map((category) => {
              const expanded = expandedSelectionCategories.includes(category.key);
              const filledCount = category.fields.filter((field) => isSelectionValueSet(field.value)).length;
              return (
                <tbody key={category.key}>
                  <tr className="workflow-summary-row">
                    <td>
                      <button
                        type="button"
                        className="workflow-table-toggle"
                        onClick={() => toggleSelectionCategory(category.key)}
                        aria-expanded={expanded}
                      >
                        <span className="workflow-table-toggle-icon">{expanded ? '-' : '+'}</span>
                        <span>{category.label}</span>
                      </button>
                    </td>
                    <td>{filledCount}</td>
                    <td>{category.fields.length}</td>
                    <td className="workflow-summary-row-action">{expanded ? 'Hide' : 'View'}</td>
                  </tr>
                  {expanded && (
                    <tr className="workflow-expand-row">
                      <td colSpan={4}>
                        <div className="workflow-expand-panel">
                          <table className="workflow-detail-table">
                            <thead>
                              <tr>
                                <th>Setting</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {category.fields.map((field) => (
                                <tr key={`${category.key}-${field.key}`}>
                                  <td>{field.label}</td>
                                  <td className={!isSelectionValueSet(field.value) ? 'is-empty' : ''}>
                                    {getSelectionDisplayValue(field.value)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </div>
  );

  const renderNotesActivityTab = () => (
    <div className="workflow-notes-grid">
      <section className="workflow-panel-card">
        <div className="workflow-panel-header">
          <div>
            <h3>Notes</h3>
            <p>Shared notes between reviewers and designers.</p>
          </div>
        </div>

        {selectedCanSendNotes && (
          <>
            <textarea
              className="workflow-note-input"
              value={noteDraft}
              onChange={(event) => setNoteDraft(event.target.value)}
              placeholder="Add a shared note"
            />
            <div className="workflow-note-actions">
              <TooltipAnchor tooltip={offlineActionDisabledReason}>
                <button
                  type="button"
                  className="workflow-secondary-btn"
                  disabled={!noteDraft.trim() || Boolean(savingAction) || isOffline}
                  onClick={() => {
                    void handleSendNote();
                  }}
                >
                  Send Note
                </button>
              </TooltipAnchor>
              {selectedCanRequestChanges && (
                <TooltipAnchor tooltip={offlineActionDisabledReason}>
                  <button
                    type="button"
                    className="workflow-danger-btn"
                    disabled={!noteDraft.trim() || Boolean(savingAction) || isOffline}
                    onClick={() => {
                      void handleRequestChanges();
                    }}
                  >
                    Request Changes
                  </button>
                </TooltipAnchor>
              )}
              <button
                type="button"
                className="workflow-secondary-btn"
                disabled={Boolean(savingAction)}
                onClick={() => setNoteDraft('')}
              >
                Clear
              </button>
            </div>
          </>
        )}

        {selectedNoteEntries.length === 0 ? (
          <div className="workflow-empty workflow-inline-empty">No notes have been added for this proposal.</div>
        ) : (
          <div className="workflow-notes-list">
            {selectedNoteEntries.map((entry) => (
              <div key={entry.id} className="workflow-note-entry">
                <div className="workflow-note-entry-head">
                  <div className="workflow-note-entry-meta">
                    <span className={`workflow-status-pill is-${entry.type}`}>
                      {normalizeStatusLabel(entry.type)}
                    </span>
                    <span>{getWorkflowEventActorLabel(entry)}</span>
                  </div>
                  <span>{formatDateTime(entry.createdAt)}</span>
                </div>
                <div className="workflow-note-entry-message">{entry.message}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="workflow-panel-card">
        <div className="workflow-panel-header">
          <div>
            <h3>Activity</h3>
            <p>Status history for this proposal.</p>
          </div>
        </div>
        {selectedActivityEntries.length === 0 ? (
          <div className="workflow-empty workflow-inline-empty">No activity recorded yet.</div>
        ) : (
          <div className="workflow-activity-list workflow-activity-list-full">
            {[...selectedActivityEntries].reverse().map((entry) => (
              <div key={entry.id} className="workflow-activity-item workflow-activity-item-full">
                <div className="workflow-activity-line" aria-hidden="true" />
                <div className="workflow-activity-item-copy">
                  <strong>{normalizeStatusLabel(entry.type)}</strong>
                  <span>{getWorkflowEventActorLabel(entry)}</span>
                </div>
                <div className="workflow-activity-item-time">{formatDateTime(entry.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  const renderVersionsTab = () => (
    <div className="workflow-panel-card">
      <div className="workflow-panel-header">
        <div>
          <h3>Versions</h3>
          <p>Submitted proposal versions in this workflow.</p>
        </div>
      </div>
      {selectedSubmittedVersions.length === 0 ? (
        <div className="workflow-empty workflow-inline-empty">No submitted versions are available.</div>
      ) : (
        <div className="workflow-version-list">
          {selectedSubmittedVersions.map((entry) => (
            <div key={entry.versionId} className="workflow-version-row">
              <div className="workflow-version-copy">
                <strong>{entry.versionName}</strong>
                <span>{formatDateTime(entry.submittedAt)}</span>
              </div>
              <button
                type="button"
                className="workflow-inline-action"
                onClick={() => openSelectedProposalVersion(entry.versionId)}
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderIssuesTab = () => (
    <div className="workflow-panel-card">
      <div className="workflow-panel-header">
        <div>
          <h3>Issues</h3>
          <p>Workflow issues that require attention.</p>
        </div>
        {selectedWorkflowReasons.length > 0 && (
          <span className="workflow-alert-badge">{selectedWorkflowReasons.length}</span>
        )}
      </div>
      {selectedWorkflowReasons.length === 0 ? (
        <div className="workflow-empty workflow-inline-empty">No issues are currently flagged for this proposal.</div>
      ) : (
        <div className="workflow-issue-list">
          {selectedWorkflowReasons.map((reason) => (
            <div key={`${reason.code}-${reason.label}`} className="workflow-issue-card">
              <div className="workflow-issue-icon">
                <WorkflowIcon name="issues" className="workflow-inline-icon" />
              </div>
              <div className="workflow-issue-copy">
                <strong>{reason.label}</strong>
                {reason.detail && <span>{reason.detail}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderDetailTab = () => {
    if (activeDetailTab === 'cogs') return renderCogsTab();
    if (activeDetailTab === 'proposal_selections') return renderProposalSelectionsTab();
    if (activeDetailTab === 'notes_activity') return renderNotesActivityTab();
    if (activeDetailTab === 'versions') return renderVersionsTab();
    if (activeDetailTab === 'issues') return renderIssuesTab();
    return renderSummaryTab();
  };

  if (!canAccess) {
    return (
      <div className="workflow-page">
        <div className="workflow-locked-card">
          <h2>Workflow access required</h2>
          <p>Switch to an owner, admin, or book keeper account to review submitted proposals.</p>
          <button type="button" className="workflow-primary-btn" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const queueCountText = `Showing ${filteredProposals.length} of ${queueScopedProposals.length}`;
  const addendumCount = selectedComparisonSummaries.length;
  const notesCount = selectedNoteEntries.length;
  const versionsCount = selectedSubmittedVersions.length;
  const issuesCount = selectedWorkflowReasons.length;

  return (
    <div className="workflow-page">
      <div className="workflow-workspace">
        <aside className="workflow-queue">
          <div className="workflow-queue-header">
            <div className="workflow-queue-header-copy">
              <p className="workflow-queue-eyebrow">Proposal Queue</p>
            </div>
            <div className="workflow-queue-filter-pills">
              <button
                type="button"
                className={`workflow-filter-pill${selectedFilter === 'needs_approval' ? ' is-active' : ''}`}
                onClick={() => handleFilterChange('needs_approval')}
              >
                <span>Needs Approval</span>
                <span className="workflow-filter-count">{counts.needsApproval}</span>
              </button>
              <button
                type="button"
                className={`workflow-filter-pill${selectedFilter === 'approved' ? ' is-active' : ''}`}
                onClick={() => handleFilterChange('approved')}
              >
                <span>Approved</span>
                <span className="workflow-filter-count">{counts.approved}</span>
              </button>
              <button
                type="button"
                className={`workflow-filter-pill${selectedFilter === 'signed' ? ' is-active' : ''}`}
                onClick={() => handleFilterChange('signed')}
              >
                <span>Signed</span>
                <span className="workflow-filter-count">{counts.signed}</span>
              </button>
              <button
                type="button"
                className={`workflow-filter-pill${selectedFilter === 'archive' ? ' is-active' : ''}`}
                onClick={() => handleFilterChange('archive')}
              >
                <span>Archived</span>
                <span className="workflow-filter-count">{counts.archive}</span>
              </button>
            </div>
            <div className="workflow-queue-controls">
              <label className="workflow-search-field">
                <WorkflowIcon name="search" className="workflow-control-icon" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search proposals..."
                />
              </label>

              <label className="workflow-select-control">
                <span>Sort:</span>
                <select value={sortOption} onChange={(event) => setSortOption(event.target.value as WorkflowSortOption)}>
                  <option value="most_recent">{getSortLabel('most_recent')}</option>
                  <option value="oldest">{getSortLabel('oldest')}</option>
                  <option value="price_high_low">{getSortLabel('price_high_low')}</option>
                  <option value="price_low_high">{getSortLabel('price_low_high')}</option>
                </select>
              </label>

              <div className="workflow-filter-control" ref={filterMenuRef}>
                <button
                  type="button"
                  className={`workflow-filter-trigger${selectedUserId ? ' has-value' : ''}`}
                  onClick={() => setShowDesignerFilter((current) => !current)}
                >
                  <WorkflowIcon name="filter" className="workflow-control-icon" />
                  <span>Filter</span>
                </button>
                {showDesignerFilter && (
                  <div className="workflow-filter-popover">
                    <label className="workflow-filter-select-label" htmlFor="workflow-user-filter">
                      Designer
                    </label>
                    <select
                      id="workflow-user-filter"
                      value={selectedUserId}
                      onChange={(event) => handleUserFilterChange(event.target.value)}
                    >
                      <option value="">All Designers</option>
                      {franchiseUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {getUserFilterLabel(user)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="workflow-empty">Loading workflow queue...</div>
          ) : filteredProposals.length === 0 ? (
            <div className="workflow-empty">
              {searchQuery.trim()
                ? 'No proposals match this search.'
                : selectedUserLabel
                ? `No proposals for ${selectedUserLabel} in this view.`
                : 'No proposals match this view.'}
            </div>
          ) : (
            <div className="workflow-queue-list">
              {filteredProposals.map((entry) => {
                const unread = hasUnreadWorkflowEvents(entry, session?.userId);
                const issueCount = getProposalIssueCount(entry);
                return (
                  <button
                    key={entry.proposalNumber}
                    type="button"
                    className={`workflow-queue-item${
                      selectedProposal?.proposalNumber === entry.proposalNumber ? ' is-selected' : ''
                    }`}
                    onClick={() => {
                      navigate(`/workflow/${entry.proposalNumber}`);
                      void loadSelectedProposal(entry.proposalNumber);
                    }}
                  >
                    <div className="workflow-queue-item-accent" />
                    <div className="workflow-queue-item-main">
                      <div className="workflow-queue-item-top">
                        <div className="workflow-queue-item-copy">
                          <div className="workflow-queue-customer">{entry.customerInfo?.customerName || 'Proposal'}</div>
                          <div className="workflow-queue-designer">{entry.designerName || 'Designer'}</div>
                        </div>
                        <div className="workflow-queue-item-value">
                          <strong>{formatCurrency(getProposalRetailValue(entry))}</strong>
                        </div>
                      </div>
                      <div className="workflow-queue-item-meta">
                        <span>{formatDateTime(entry.workflow?.submittedAt || entry.lastModified)}</span>
                        {unread && (
                          <span className="workflow-unread-pill">
                            {countUnreadWorkflowEvents(entry, session?.userId)} New
                          </span>
                        )}
                      </div>
                      <div className="workflow-queue-item-footer">
                        {issueCount > 0 ? (
                          <span className="workflow-issue-pill">{issueCount} Issue{issueCount === 1 ? '' : 's'}</span>
                        ) : (
                          <span className="workflow-queue-item-clear">No Issues</span>
                        )}
                        <span className="workflow-queue-item-arrow">Open</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="workflow-queue-footer">
            <span>{queueCountText}</span>
          </div>

          <div className="workflow-insights-card">
            <div className="workflow-insights-header">
              <div>
                <h3>Insights</h3>
              </div>
              {issuesCount > 0 && <span className="workflow-alert-badge">{issuesCount}</span>}
            </div>
            {!selectedProposal ? (
              <div className="workflow-empty workflow-inline-empty">Select a proposal to review issues.</div>
            ) : issuesCount === 0 ? (
              <div className="workflow-empty workflow-inline-empty">No issues are currently flagged.</div>
            ) : (
              <>
                <div className="workflow-insight-list">
                  {selectedWorkflowReasons.slice(0, 3).map((reason) => (
                    <div key={`${reason.code}-${reason.label}`} className="workflow-insight-row">
                      <div className="workflow-insight-dot" aria-hidden="true" />
                      <div className="workflow-insight-copy">
                        <strong>{reason.label}</strong>
                        {reason.detail && <span>{reason.detail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="workflow-inline-link"
                  onClick={() => setActiveDetailTab('issues')}
                >
                  View all issues
                </button>
              </>
            )}
          </div>
        </aside>

        <section className="workflow-detail">
          {!selectedProposal ? (
            <div className="workflow-empty workflow-empty-detail">{emptyDetailMessage}</div>
          ) : (
            <div className="workflow-detail-shell">
              <div className="workflow-detail-header-row">
                <button
                  type="button"
                  className="workflow-back-button"
                  onClick={() => {
                    setSelectedProposal(null);
                    navigate('/workflow', { replace: true });
                  }}
                >
                  <WorkflowIcon name="back" className="workflow-inline-icon" />
                  <span>Back to Queue</span>
                </button>
              </div>

              <div className="workflow-detail-header">
                <div>
                  <div className="workflow-detail-title-row">
                    <h2>{selectedProposal.customerInfo?.customerName || selectedProposal.proposalNumber}</h2>
                    <div className={`workflow-status-pill is-${selectedCurrentStatus}`}>
                      {normalizeStatusLabel(selectedCurrentStatus)}
                    </div>
                  </div>
                  <div className="workflow-detail-subtitle">
                    <span>Designer: {selectedProposal.designerName || 'Designer'}</span>
                    <span>Submitted: {formatDateTime(selectedProposal.workflow?.submittedAt || selectedProposal.lastModified)}</span>
                  </div>
                </div>

                <div className="workflow-detail-header-actions">
                  {addendumCount > 0 && (
                    <button
                      type="button"
                      className="workflow-outline-btn"
                      onClick={() => setShowDiffOverlay(true)}
                    >
                      <WorkflowIcon name="compare" className="workflow-inline-icon" />
                      <span>
                        Compare with Addendum{addendumCount === 1 ? '' : 's'} ({addendumCount})
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="workflow-icon-btn"
                    onClick={() => openSelectedProposalVersion()}
                    aria-label="Open proposal summary"
                  >
                    <WorkflowIcon name="more" className="workflow-inline-icon" />
                  </button>
                </div>
              </div>

              <div className="workflow-metrics-grid">
                <div className="workflow-stat-card">
                  <div className="workflow-stat-label">Total Retail</div>
                  <div className="workflow-stat-value">{formatCurrency(selectedRetailTotal)}</div>
                </div>
                <div className="workflow-stat-card">
                  <div className="workflow-stat-label">Total COGS</div>
                  <div className="workflow-stat-value">{formatCurrency(selectedTotalCogs)}</div>
                </div>
                <div className="workflow-stat-card">
                  <div className="workflow-stat-label">Gross Profit %</div>
                  <div className={`workflow-stat-value${selectedBelowMarginThreshold ? ' is-danger' : ''}`}>
                    {formatPercent(selectedGrossProfitPercent)}
                  </div>
                  <div className={`workflow-stat-note${selectedBelowMarginThreshold ? ' is-danger' : ''}`}>
                    {selectedBelowMarginThreshold
                      ? selectedMarginReason?.detail || 'Below designer threshold'
                      : selectedDesignerThreshold !== null
                      ? `Within threshold (${formatPercent(selectedDesignerThreshold)})`
                      : 'Within threshold'}
                  </div>
                </div>
                <div className="workflow-stat-card">
                  <div className="workflow-stat-label">Discount Amount</div>
                  <div className="workflow-stat-value">{formatCurrency(selectedDiscountAmount)}</div>
                </div>
              </div>

              <div className="workflow-tab-card">
                <div className="workflow-tab-strip" role="tablist" aria-label="Proposal review tabs">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === 'summary'}
                    className={`workflow-tab-btn${activeDetailTab === 'summary' ? ' is-active' : ''}`}
                    onClick={() => setActiveDetailTab('summary')}
                  >
                    <WorkflowIcon name="summary" className="workflow-tab-icon" />
                    <span>Summary</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === 'cogs'}
                    className={`workflow-tab-btn${activeDetailTab === 'cogs' ? ' is-active' : ''}`}
                    onClick={() => setActiveDetailTab('cogs')}
                  >
                    <WorkflowIcon name="cogs" className="workflow-tab-icon" />
                    <span>COGS</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === 'proposal_selections'}
                    className={`workflow-tab-btn${activeDetailTab === 'proposal_selections' ? ' is-active' : ''}`}
                    onClick={() => setActiveDetailTab('proposal_selections')}
                  >
                    <WorkflowIcon name="proposal" className="workflow-tab-icon" />
                    <span>Proposal Selections</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === 'notes_activity'}
                    className={`workflow-tab-btn${activeDetailTab === 'notes_activity' ? ' is-active' : ''}`}
                    onClick={() => setActiveDetailTab('notes_activity')}
                  >
                    <WorkflowIcon name="notes" className="workflow-tab-icon" />
                    <span>Notes & Activity</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === 'versions'}
                    className={`workflow-tab-btn${activeDetailTab === 'versions' ? ' is-active' : ''}`}
                    onClick={() => setActiveDetailTab('versions')}
                  >
                    <WorkflowIcon name="versions" className="workflow-tab-icon" />
                    <span>Versions</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeDetailTab === 'issues'}
                    className={`workflow-tab-btn${activeDetailTab === 'issues' ? ' is-active' : ''}`}
                    onClick={() => setActiveDetailTab('issues')}
                  >
                    <WorkflowIcon name="issues" className="workflow-tab-icon" />
                    <span>Issues</span>
                    {issuesCount > 0 && <span className="workflow-tab-badge">{issuesCount}</span>}
                  </button>
                </div>
                <div className="workflow-tab-panel">{renderDetailTab()}</div>
              </div>
            </div>
          )}
        </section>

        <aside className="workflow-sidebar">
          {!selectedProposal ? (
            <div className="workflow-sidebar-card workflow-sidebar-empty">
              <h3>Take Action</h3>
              <p>Select a proposal to review actions and summary details.</p>
            </div>
          ) : (
            <>
              <div className="workflow-sidebar-card">
                <div className="workflow-sidebar-card-header">
                  <h3>Take Action</h3>
                </div>
                <div className="workflow-sidebar-actions">
                  {(selectedCurrentStatus === 'needs_approval' || selectedCurrentStatus === 'submitted') && (
                    <TooltipAnchor tooltip={offlineActionDisabledReason}>
                      <button
                        type="button"
                        className="workflow-success-btn workflow-sidebar-btn"
                        disabled={Boolean(savingAction) || isOffline || isMasterInspection}
                        onClick={() => {
                          void handleApprove();
                        }}
                      >
                        Approve Proposal
                      </button>
                    </TooltipAnchor>
                  )}

                  {selectedCurrentStatus === 'approved' && (
                    <TooltipAnchor
                      tooltip={
                        isMasterInspection
                          ? inspectionDisabledReason
                          : isOffline
                          ? offlineActionDisabledReason
                          : disableSignedWorkflow
                          ? DISABLED_SIGNED_WORKFLOW_MESSAGE
                          : undefined
                      }
                    >
                      <button
                        type="button"
                        className="workflow-success-btn workflow-sidebar-btn"
                        disabled={Boolean(savingAction) || disableSignedWorkflow || isOffline || isMasterInspection}
                        onClick={() =>
                          openSelectedProposalVersion(selectedApprovedVersionId, { openSignModal: true })
                        }
                      >
                        Sign Proposal
                      </button>
                    </TooltipAnchor>
                  )}

                  {selectedCurrentStatus === 'signed' && (
                    <TooltipAnchor tooltip={offlineActionDisabledReason}>
                      <button
                        type="button"
                        className="workflow-success-btn workflow-sidebar-btn"
                        disabled={Boolean(savingAction) || isOffline || isMasterInspection}
                        onClick={() => setShowCompleteConfirm(true)}
                      >
                        Mark Complete
                      </button>
                    </TooltipAnchor>
                  )}

                  {selectedCanRequestChanges && (
                    <TooltipAnchor tooltip={offlineActionDisabledReason}>
                      <button
                        type="button"
                        className="workflow-secondary-btn workflow-sidebar-btn"
                        disabled={Boolean(savingAction) || isOffline || isMasterInspection}
                        onClick={() => {
                          if (!noteDraft.trim()) {
                            setActiveDetailTab('notes_activity');
                            return;
                          }
                          void handleRequestChanges();
                        }}
                      >
                        Request Changes
                      </button>
                    </TooltipAnchor>
                  )}

                  <button
                    type="button"
                    className="workflow-secondary-btn workflow-sidebar-btn"
                    onClick={() => openSelectedProposalVersion()}
                  >
                    More Actions
                  </button>
                </div>
              </div>

              <div className="workflow-sidebar-card">
                <div className="workflow-sidebar-card-header">
                  <h3>At a Glance</h3>
                </div>
                <div className="workflow-glance-list">
                  <div className="workflow-glance-row">
                    <span>Issues</span>
                    {issuesCount > 0 ? (
                      <span className="workflow-alert-badge">{issuesCount}</span>
                    ) : (
                      <span className="workflow-glance-value">0</span>
                    )}
                  </div>
                  <div className="workflow-glance-row">
                    <span>Addendums</span>
                    {addendumCount > 0 ? (
                      <span className="workflow-alert-badge">{addendumCount}</span>
                    ) : (
                      <span className="workflow-glance-value">0</span>
                    )}
                  </div>
                  <div className="workflow-glance-row">
                    <span>Notes</span>
                    <span className="workflow-glance-value">{notesCount}</span>
                  </div>
                  <div className="workflow-glance-row">
                    <span>Versions Submitted</span>
                    <span className="workflow-glance-value">{versionsCount}</span>
                  </div>
                </div>
              </div>

              <div className="workflow-sidebar-card">
                <div className="workflow-sidebar-card-header">
                  <h3>Thresholds</h3>
                </div>
                <div className="workflow-threshold-list">
                  <div className="workflow-threshold-row">
                    <span>Designer Threshold</span>
                    <strong>{selectedDesignerThreshold !== null ? formatPercent(selectedDesignerThreshold) : 'N/A'}</strong>
                  </div>
                  <div className="workflow-threshold-row">
                    <span>Current Margin</span>
                    <strong className={selectedBelowMarginThreshold ? 'is-danger' : ''}>
                      {formatPercent(selectedGrossProfitPercent)}
                    </strong>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {showDiffOverlay && activeComparisonSummary && activeComparisonVersions && (
        <div className="workflow-modal-overlay" data-scroll-lock="true" onClick={() => setShowDiffOverlay(false)}>
          <div className="workflow-modal-card workflow-diff-modal" onClick={(event) => event.stopPropagation()}>
            <div className="workflow-modal-header">
              <div>
                <p className="workflow-kicker">Change Breakdown</p>
                <h3>
                  {activeComparisonSummary.compareVersionName || 'Approved Proposal'} vs{' '}
                  {activeComparisonSummary.reviewVersionName}
                </h3>
                <div className="workflow-detail-subtitle">
                  <span>{formatDateTime(activeComparisonVersions.compareSubmittedAt)}</span>
                  <span>{formatDateTime(activeComparisonVersions.reviewSubmittedAt)}</span>
                </div>
              </div>
              <button
                type="button"
                className="workflow-icon-btn"
                onClick={() => setShowDiffOverlay(false)}
                aria-label="Close comparison details"
              >
                <WorkflowIcon name="more" className="workflow-inline-icon" />
              </button>
            </div>

            {selectedComparisonSummaries.length > 1 && (
              <div className="workflow-comparison-switcher workflow-comparison-switcher-modal">
                {selectedComparisonSummaries.map((summary) => (
                  <button
                    key={summary.reviewVersionId}
                    type="button"
                    className={`workflow-comparison-switcher-btn${
                      summary.reviewVersionId === activeComparisonSummary.reviewVersionId ? ' is-active' : ''
                    }`}
                    onClick={() => setActiveComparisonId(summary.reviewVersionId)}
                  >
                    {summary.reviewVersionName}
                  </button>
                ))}
              </div>
            )}

            <div className="workflow-modal-metric-grid">
              <div className="workflow-metric">
                <span>Retail Delta</span>
                <strong className={getComparisonDeltaClass(activeComparisonSummary.retailDelta, 'danger')}>
                  {formatSignedCurrency(activeComparisonSummary.retailDelta)}
                </strong>
              </div>
              <div className="workflow-metric">
                <span>COGS Delta</span>
                <strong className={getComparisonDeltaClass(activeComparisonSummary.costDelta, 'danger')}>
                  {formatSignedCurrency(activeComparisonSummary.costDelta)}
                </strong>
              </div>
              <div className="workflow-metric">
                <span>Gross Profit Delta</span>
                <strong className={getComparisonDeltaClass(activeComparisonSummary.grossProfitDelta, 'success')}>
                  {formatSignedCurrency(activeComparisonSummary.grossProfitDelta)}
                </strong>
              </div>
              <div className="workflow-metric">
                <span>GP % Delta</span>
                <strong className={getComparisonDeltaClass(activeComparisonSummary.grossMarginDelta, 'success')}>
                  {formatSignedPercent(activeComparisonSummary.grossMarginDelta)}
                </strong>
              </div>
            </div>

            <div className="workflow-diff-categories">
              {activeComparisonSummary.categories.map((category) => (
                <div key={category.key} className="workflow-diff-category">
                  <div className="workflow-diff-category-header">
                    <div>
                      <div className="workflow-diff-category-title">{category.label}</div>
                      <div className="workflow-diff-category-meta">
                        {category.changeCount} change{category.changeCount === 1 ? '' : 's'} |{' '}
                        {formatSignedCurrency(category.totalDelta)}
                      </div>
                    </div>
                  </div>

                  {category.fieldChanges.length > 0 && (
                    <div className="workflow-diff-block">
                      <div className="workflow-diff-block-title">Proposal Changes</div>
                      {category.fieldChanges.map((change) => (
                        <div key={`${category.key}-${change.label}`} className="workflow-diff-row">
                          <span className="workflow-diff-label">{change.label}</span>
                          <span className="workflow-diff-before">{change.before || 'None'}</span>
                          <span className="workflow-diff-arrow">{'->'}</span>
                          <span className="workflow-diff-after">{change.after || 'None'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {category.costChanges.length > 0 && (
                    <div className="workflow-diff-block">
                      <div className="workflow-diff-block-header">
                        <div className="workflow-diff-block-title">Cost Breakdown Impact</div>
                        <button
                          type="button"
                          className="workflow-diff-toggle-btn"
                          onClick={() => toggleComparisonCategory(category.key)}
                          aria-expanded={expandedComparisonCategories.includes(category.key)}
                        >
                          {expandedComparisonCategories.includes(category.key) ? 'Hide Details' : 'Show Details'}
                        </button>
                      </div>
                      {expandedComparisonCategories.includes(category.key) && (
                        <div className="workflow-diff-block-content">
                          {category.costChanges.map((change) => (
                            <div key={`${category.key}-${change.category}-${change.label}`} className="workflow-cost-row">
                              <div className="workflow-cost-row-copy">
                                <div className="workflow-cost-row-title">{change.label}</div>
                                <div className="workflow-cost-row-meta">
                                  {change.beforeQuantity.toLocaleString('en-US', {
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  {'->'}{' '}
                                  {change.afterQuantity.toLocaleString('en-US', {
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  qty
                                </div>
                              </div>
                              <div className="workflow-cost-row-values">
                                <span>
                                  {formatCurrency(change.beforeTotal)} {'->'} {formatCurrency(change.afterTotal)}
                                </span>
                                <strong>{formatSignedCurrency(change.delta)}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showCompleteConfirm}
        title="Are you sure?"
        message="Are you sure you want to mark this proposal as complete? No further edits can be made, and it will be reconciled in the Archive."
        confirmLabel="Yes, I'm sure"
        cancelLabel="No, take me back"
        isLoading={Boolean(savingAction)}
        confirmDisabled={isOffline || isMasterInspection}
        confirmDisabledReason={offlineActionDisabledReason}
        onConfirm={() => {
          setShowCompleteConfirm(false);
          void handleComplete();
        }}
        onCancel={() => setShowCompleteConfirm(false)}
      />
    </div>
  );
}

export default WorkflowPage;
