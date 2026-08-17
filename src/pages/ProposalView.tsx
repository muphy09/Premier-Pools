import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { CostLineItem, Proposal, ProposalWorkflowActor, ProposalWorkflowEvent, RetailAdjustment } from '../types/proposal-new';
import CostBreakdownView from '../components/CostBreakdownView';
import SubmergeAdvantageWarranty from '../components/SubmergeAdvantageWarranty';
import type { ContractViewHandle } from '../components/ContractView';
import { OverflowTooltipText, TooltipAnchor } from '../components/AppTooltip';
import CloudConnectionNotice, { type CloudConnectionIssue } from '../components/CloudConnectionNotice';
import FranchiseLogo from '../components/FranchiseLogo';
import OffContractItemsView from '../components/OffContractItemsView';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import SubmitProposalModal from '../components/SubmitProposalModal';
import PricingRevisionPromptModal from '../components/PricingRevisionPromptModal';
import PricingRevisionComparisonModal from '../components/PricingRevisionComparisonModal';
import ContractRevisionPromptModal from '../components/ContractRevisionPromptModal';
import AddendumPricingChoiceModal from '../components/AddendumPricingChoiceModal';
import './ProposalView.css';
import { useFranchiseSignedWorkflowDisabled } from '../hooks/useFranchiseSignedWorkflowDisabled';
import { useFranchiseCapability } from '../hooks/useFranchiseCapability';
import { isPpasEastFranchiseCode } from '../utils/franchiseScope';
import customerBreakIconImg from '../../docs/img/custbreak.png';
import cogsBreakIconImg from '../../docs/img/cogsbreak.png';
import summaryIconImg from '../../docs/img/summary.png';
import MasterPricingEngine from '../services/masterPricingEngine';
import {
  DISABLED_SIGNED_WORKFLOW_MESSAGE,
  loadFranchiseSignedWorkflowDisabled,
} from '../services/franchiseBranding';
import { getProposal as getProposalRemote, saveProposal as saveProposalRemote } from '../services/proposalsAdapter';
import { listPricingModels as listPricingModelsRemote } from '../services/pricingModelsAdapter';
import {
  initPricingDataStore,
  loadPricingSnapshotForExistingProposal,
  loadPricingSnapshotForFranchise,
  subscribeToPricingData,
  withTemporaryPricingSnapshot,
} from '../services/pricingDataStore';
import {
  getSessionFranchiseId,
  getSessionRole,
  isMasterActingAsOwnerSession,
  readSession,
} from '../services/session';
import { recordRecentProposalOpen } from '../services/recentProposalActivity';
import {
  buildPricingRevisionComparison,
  markPricingRevisionDeclined,
  upgradeProposalPricingRevision,
  type PricingRevisionComparison,
} from '../services/pricingRevisionReview';
import { getContractTemplateIdForProposal } from '../services/contractTemplates';
import {
  adoptContractRevision,
  checkProposalContractRevision,
  declineContractRevision,
  type ContractRevisionCheck,
  type ContractRevisionDescriptor,
} from '../services/contractTemplateRegistry';
import {
  getDefaultProposal,
  getDefaultPoolSpecs,
  getDefaultExcavation,
  getDefaultPlumbing,
  getDefaultElectrical,
  getDefaultTileCopingDecking,
  getDefaultDrainage,
  getDefaultEquipment,
  getDefaultWaterFeatures,
  getDefaultInteriorFinish,
  getDefaultManualAdjustments,
  mergePlumbingRuns,
  mergeRetailAdjustments,
} from '../utils/proposalDefaults';
import { normalizeEquipmentLighting } from '../utils/lighting';
import { applyActiveVersion, createVersionFromProposal, listAllVersions } from '../utils/proposalVersions';
import { getEmptyRetiredEquipmentFlags, getRetiredEquipmentFlags, type RetiredEquipmentFlags } from '../utils/retiredEquipment';
import { validateProposal } from '../utils/validation';
import { normalizeCostBreakdownForDisplay } from '../utils/costBreakdownDisplay';
import { ContractOverrides } from '../services/contractGenerator';
import {
  buildLineItemSubcategories,
  CUSTOM_OPTIONS_SUBCATEGORY,
  hasLineItemSubcategory,
  isCustomOptionItem,
} from '../utils/costBreakdownSubcategories';
import { getOffContractItemGroups, getOffContractTotal } from '../utils/customOptions';
import {
  buildCustomOptionPricingCorrectionReview,
  type CustomOptionPricingCorrectionReview,
} from '../utils/customOptionPricingCorrection';
import { getEffectivePrimarySanitationSystemName, getSelectedEquipmentPackage } from '../utils/equipmentPackages';
import { normalizeCustomFeatures } from '../utils/customFeatures';
import { isOffContractLineItem } from '../utils/offContractLineItems';
import { normalizeWarrantySectionsSetting } from '../utils/warranty';
import { resolveProposalPapDiscounts } from '../utils/papDiscounts';
import {
  applyHistoricalPricingProtection,
  buildHistoricalPricingReview,
} from '../utils/pricingEngineCompatibility';
import { getPricingTierName, isBronzePricingTier, normalizePricingTierId } from '../services/pricingTiers';
import {
  FEENSTRA_MAY_2026_CALCULATION_PROFILE,
  FEENSTRA_PROPOSAL_NUMBER,
} from '../services/legacy/feenstraMay2026Profile';
import {
  addWorkflowNote,
  approveWorkflowProposal,
  collapseApprovedProposalVersions,
  completeWorkflowProposal,
  ensureProposalWorkflow,
  getApprovedVersionIds,
  getApprovedVersionId,
  getLatestSignedBaselineVersionId,
  getPendingReviewVersionId,
  getReviewVersionId,
  getReviewerPrimaryVersionId,
  getReviewerVisibleVersions,
  getSignedAddendumVersionIds,
  getSignedVersionId,
  hasVersionSubmissionHistory,
  getVersionRecordStatus,
  getWorkflowSubmissionPreview,
  getWorkflowStatus,
  isSubmittedVersionLocked,
  isVersionPermanentlyLocked,
  markProposalAsSigned,
  markWorkflowRead,
  reconcileWorkflowVersionStates,
  resetWorkflowAfterVersionEdit,
  requestWorkflowChanges,
  submitProposalForWorkflow,
} from '../services/proposalWorkflow';

type PricingModelStatus = 'active' | 'inactive' | 'removed';

type ProposalVersionSyncMeta = {
  priceModelStatus: PricingModelStatus;
  equipmentFlags: RetiredEquipmentFlags;
  pricingSnapshot?: Awaited<ReturnType<typeof loadPricingSnapshotForFranchise>>['pricing'];
};

type PricingModelDirectory = {
  loaded: boolean;
  rows: Awaited<ReturnType<typeof listPricingModelsRemote>>;
};

const splitCustomOptions = (items: CostLineItem[]) => ({
  baseItems: items.filter(item => !isCustomOptionItem(item)),
  customOptions: items.filter(isCustomOptionItem),
});

const normalizeSummaryName = (value?: string | null): string => (value ?? '').trim();
const normalizeComparisonText = (value?: string | null): string => normalizeSummaryName(value).toLowerCase();
const REMOVED_EQUIPMENT_SUMMARY_LABEL = 'Removed - Please Select Another';
const MARK_SIGNED_EQUIPMENT_CHANGE_REQUIRED_MESSAGE =
  'Equipment change required. Update the equipment selections before marking this proposal as signed.';
const ADDENDUM_EQUIPMENT_CHANGE_REQUIRED_MESSAGE =
  'Equipment change required. Update the equipment selections before submitting this proposal addendum.';

const getStoredPricingModelStatus = (proposal?: Partial<Proposal> | null): PricingModelStatus => {
  const name = normalizeComparisonText(proposal?.pricingModelName);
  if (name.includes('(removed)')) return 'removed';
  return proposal?.pricingModelIsDefault ? 'active' : 'inactive';
};

const getPricingModelStatusTooltip = (status: PricingModelStatus) => {
  switch (status) {
    case 'active':
      return 'Pricing Model is Current';
    case 'removed':
      return 'Pricing Model was removed; please select another';
    case 'inactive':
    default:
      return 'Pricing Model is no longer active for this franchise';
  }
};

const getPricingModelDisplayName = (name: string, status: PricingModelStatus) => {
  const baseName = normalizeSummaryName(name) || 'No Pricing Model';
  const normalizedName = normalizeComparisonText(baseName);

  if (baseName === 'No Pricing Model') {
    return baseName;
  }

  if (status === 'active') {
    return normalizedName.endsWith('(active)') ? baseName : `${baseName} (Active)`;
  }

  if (status === 'inactive') {
    return normalizedName.endsWith('(inactive)') ? baseName : `${baseName} (Inactive)`;
  }

  return normalizedName.endsWith('(removed)') ? baseName : `${baseName} (Removed)`;
};

const resolveCurrentPricingModelStatus = (
  proposal: Partial<Proposal>,
  pricingSnapshot: Awaited<ReturnType<typeof loadPricingSnapshotForFranchise>>,
  directory: PricingModelDirectory
): PricingModelStatus => {
  if (normalizeComparisonText(proposal.pricingModelName).includes('(removed)')) {
    return 'removed';
  }

  const pricingModelId = normalizeSummaryName(proposal.pricingModelId);
  if (directory.loaded) {
    const rows = directory.rows || [];
    if (pricingModelId) {
      const matchingRow = rows.find((row) => row.id === pricingModelId);
      if (!matchingRow) return 'removed';
      return matchingRow.isDefault ? 'active' : 'inactive';
    }

    const pricingModelName = normalizeComparisonText(proposal.pricingModelName);
    if (pricingModelName) {
      const matchingRows = rows.filter((row) => normalizeComparisonText(row.name) === pricingModelName);
      if (!matchingRows.length) return 'removed';
      return matchingRows.some((row) => row.isDefault) ? 'active' : 'inactive';
    }
  }

  if (pricingModelId) {
    const resolvedPricingModelId = normalizeSummaryName(pricingSnapshot.pricingModelId);
    if (resolvedPricingModelId && resolvedPricingModelId !== pricingModelId) {
      return 'removed';
    }
    return pricingSnapshot.isDefault ? 'active' : 'inactive';
  }

  return proposal.pricingModelIsDefault ? 'active' : 'inactive';
};

const getVersionIdKey = (proposal?: Partial<Proposal> | null) => proposal?.versionId || 'original';

const getFrozenVersionSyncMeta = (proposal?: Partial<Proposal> | null): ProposalVersionSyncMeta => ({
  priceModelStatus: getStoredPricingModelStatus(proposal),
  equipmentFlags: getEmptyRetiredEquipmentFlags(),
});

const isHistoricalVersionState = (proposal?: Partial<Proposal> | null) => isVersionPermanentlyLocked(proposal);

const hasEquipmentChangeRequired = (equipmentFlags?: RetiredEquipmentFlags | null) => Boolean(equipmentFlags?.any);

const hasNamedSelection = (value: string | undefined, placeholderToken: string): boolean => {
  const normalized = normalizeSummaryName(value).toLowerCase();
  return Boolean(normalized) && normalized !== 'none' && !normalized.includes(placeholderToken);
};

const summarizeNamedSelections = (names: string[]): string => {
  const normalizedNames = names.map((name) => normalizeSummaryName(name)).filter(Boolean);
  if (!normalizedNames.length) return 'None';
  if (normalizedNames.length === 1) return normalizedNames[0];

  const primary = normalizedNames[0];
  const allMatchPrimary = normalizedNames.every((name) => name.toLowerCase() === primary.toLowerCase());
  return allMatchPrimary ? `${primary} x${normalizedNames.length}` : `${primary} +${normalizedNames.length - 1}`;
};

const summarizeSelectionWithQuantity = (
  name: string | undefined,
  quantity: number | undefined,
  placeholderToken: string
): string => {
  const safeName = normalizeSummaryName(name);
  const safeQuantity = Number.isFinite(quantity) ? Math.max(quantity ?? 0, 0) : 0;
  if (!hasNamedSelection(name, placeholderToken) || safeQuantity <= 0) return 'None';
  return safeQuantity > 1 ? `${safeName} x${safeQuantity}` : safeName;
};

const summarizePumpSelection = (equipment: Proposal['equipment']): string => {
  return hasNamedSelection(equipment.pump?.name, 'no pump') ? normalizeSummaryName(equipment.pump.name) : 'None';
};

type ProposalViewLocationState = {
  versionId?: string;
  openSignModal?: boolean;
  reviewerReturnTo?: 'workflow' | 'admin-panel';
  reviewerReturnPath?: string;
  reviewerReturnFilter?: 'needs_approval' | 'approved' | 'signed' | 'archive';
  reviewerReturnUserId?: string | null;
};

type ContractViewComponent = typeof import('../components/ContractView').default;
type BreakdownExportPagesModule = typeof import('../components/BreakdownExportPages');
type BreakdownPrintPreviewWindow = Window;
type BreakdownPrintPreviewMeta = {
  eyebrow: string;
  title: string;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

type CustomerBreakdownEditorState = {
  versionId: string;
  baselineRetailAdjustments: RetailAdjustment[];
  draftRetailAdjustments: RetailAdjustment[];
  baselineWarrantySections: Proposal['warrantySections'];
  draftWarrantySections: Proposal['warrantySections'];
};

type CustomerBreakdownMode = 'combined' | 'cost' | 'warranty';

type WorkflowVersionOption = {
  id: string;
  label: string;
  detail?: string;
  disabled?: boolean;
};

type VersionNameModalMode = 'create' | 'rename';

type VersionContextMenuState = {
  x: number;
  y: number;
  versionId: string;
};

const SCRATCH_VERSION_SOURCE_ID = '__scratch__';

let contractViewModulePromise: Promise<typeof import('../components/ContractView')> | null = null;
const loadContractView = () => {
  if (!contractViewModulePromise) {
    contractViewModulePromise = import('../components/ContractView');
  }
  return contractViewModulePromise;
};

let breakdownExportPagesModulePromise: Promise<typeof import('../components/BreakdownExportPages')> | null = null;
const loadBreakdownExportPages = () => {
  if (!breakdownExportPagesModulePromise) {
    breakdownExportPagesModulePromise = import('../components/BreakdownExportPages');
  }
  return breakdownExportPagesModulePromise;
};

function escapeBreakdownPreviewHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const cloneRetailAdjustments = (input?: RetailAdjustment[] | null): RetailAdjustment[] =>
  mergeRetailAdjustments(input ?? undefined).map((adjustment) => ({ ...adjustment }));

const cloneWarrantySections = (
  input: Proposal['warrantySections']
): Proposal['warrantySections'] => {
  const normalized = normalizeWarrantySectionsSetting(input);
  if (!normalized) return null;
  return normalized.map((section) => ({
    ...section,
    featureItems: section.featureItems.map((item) => ({ ...item })),
    advantageItems: section.advantageItems.map((item) => ({ ...item })),
  }));
};

const areRetailAdjustmentsEqual = (
  a?: RetailAdjustment[] | null,
  b?: RetailAdjustment[] | null
) => JSON.stringify(cloneRetailAdjustments(a)) === JSON.stringify(cloneRetailAdjustments(b));

const areWarrantySectionsEqual = (
  a: Proposal['warrantySections'],
  b: Proposal['warrantySections']
) => JSON.stringify(cloneWarrantySections(a)) === JSON.stringify(cloneWarrantySections(b));

const createCustomerBreakdownEditorState = (input: Proposal): CustomerBreakdownEditorState => {
  const baselineRetailAdjustments = cloneRetailAdjustments(input.retailAdjustments);
  const baselineWarrantySections = cloneWarrantySections(input.warrantySections);
  return {
    versionId: input.versionId || 'original',
    baselineRetailAdjustments,
    draftRetailAdjustments: cloneRetailAdjustments(baselineRetailAdjustments),
    baselineWarrantySections,
    draftWarrantySections: cloneWarrantySections(baselineWarrantySections),
  };
};

function writeBreakdownPrintPreviewWindowShell(
  previewWindow: BreakdownPrintPreviewWindow,
  options: {
    title: string;
    fileName: string;
    previewMeta: BreakdownPrintPreviewMeta;
    showPrintButton?: boolean;
    content: string;
  }
) {
  previewWindow.document.open();
  previewWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeBreakdownPreviewHtml(options.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", Tahoma, sans-serif;
        --preview-bg: #d8dee8;
        --preview-panel: #eef2f8;
        --preview-border: rgba(57, 78, 115, 0.18);
        --preview-text: #163055;
        --preview-muted: #55709a;
        --preview-accent: #1d4f91;
      }

      * {
        box-sizing: border-box;
      }

      html, body {
        margin: 0;
        min-height: 100%;
        background: var(--preview-bg);
        color: var(--preview-text);
      }

      body {
        font-family: inherit;
      }

      .preview-toolbar {
        position: sticky;
        top: 0;
        z-index: 5;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 16px 20px;
        background: rgba(238, 242, 248, 0.96);
        border-bottom: 1px solid var(--preview-border);
        backdrop-filter: blur(12px);
      }

      .preview-title {
        min-width: 0;
      }

      .preview-title p {
        margin: 0 0 2px;
        color: var(--preview-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .preview-title h1 {
        margin: 0;
        font-size: 22px;
        line-height: 1.2;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .preview-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .preview-actions button {
        border: 1px solid rgba(55, 83, 128, 0.22);
        border-radius: 999px;
        padding: 0 16px;
        height: 40px;
        background: #ffffff;
        color: var(--preview-text);
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }

      .preview-actions button.primary {
        background: var(--preview-accent);
        border-color: var(--preview-accent);
        color: #ffffff;
      }

      .preview-status {
        width: min(560px, calc(100vw - 48px));
        margin: 72px auto 0;
        padding: 24px 28px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.96);
        border: 1px solid var(--preview-border);
        box-shadow: 0 20px 44px rgba(34, 55, 97, 0.12);
        text-align: center;
        font-size: 16px;
        font-weight: 600;
      }

      .preview-status.error {
        color: #8d1d1d;
      }

      .preview-pages {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 24px;
        padding: 24px 18px 40px;
      }

      .preview-sheet {
        width: min(8.5in, calc(100vw - 36px));
        min-height: calc(min(8.5in, calc(100vw - 36px)) * 11 / 8.5);
        background: #ffffff;
        border: 1px solid var(--preview-border);
        box-shadow: 0 28px 60px rgba(34, 55, 97, 0.18);
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 0;
      }

      .preview-sheet img {
        display: block;
        width: min(7.7in, calc(100vw - 52px));
        height: auto;
      }

      @media (max-width: 800px) {
        .preview-toolbar {
          flex-direction: column;
          align-items: stretch;
        }

        .preview-actions {
          justify-content: space-between;
        }
      }

      @media print {
        @page {
          size: letter;
          margin: 0;
        }

        html, body {
          background: #ffffff !important;
        }

        .preview-toolbar {
          display: none !important;
        }

        .preview-pages {
          padding: 0 !important;
          gap: 0 !important;
        }

        .preview-sheet {
          width: 8.5in !important;
          min-height: 11in !important;
          border: none !important;
          box-shadow: none !important;
          break-after: page;
          page-break-after: always;
        }

        .preview-sheet img {
          width: 7.7in !important;
          height: auto !important;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
      }
    </style>
  </head>
  <body>
    <div class="preview-toolbar">
      <div class="preview-title">
        <p>${escapeBreakdownPreviewHtml(options.previewMeta.eyebrow)}</p>
        <h1>${escapeBreakdownPreviewHtml(options.fileName)}</h1>
      </div>
      <div class="preview-actions">
        ${
          options.showPrintButton
            ? '<button type="button" class="primary" id="preview-print">Print</button>'
            : ''
        }
        <button type="button" id="preview-close">Close</button>
      </div>
    </div>
    ${options.content}
  </body>
</html>`);
  previewWindow.document.close();
}

function bindBreakdownPrintPreviewWindowControls(previewWindow: BreakdownPrintPreviewWindow) {
  const closeButton = previewWindow.document.getElementById('preview-close');
  closeButton?.addEventListener('click', () => {
    previewWindow.close();
  });

  const printButton = previewWindow.document.getElementById('preview-print') as HTMLButtonElement | null;
  if (printButton) {
    printButton.addEventListener('click', () => {
      printButton.disabled = true;
      previewWindow.focus();
      previewWindow.print();
    });
  }

  previewWindow.onafterprint = () => {
    const currentPrintButton = previewWindow.document.getElementById('preview-print') as HTMLButtonElement | null;
    if (currentPrintButton) {
      currentPrintButton.disabled = false;
    }
  };
}

function openBreakdownPrintPreviewWindow(
  fileName: string,
  previewMeta: BreakdownPrintPreviewMeta
): BreakdownPrintPreviewWindow | null {
  const previewWindow = window.open('', '_blank', 'width=1120,height=1400');
  if (!previewWindow) {
    return null;
  }

  writeBreakdownPrintPreviewWindowShell(previewWindow, {
    title: `${previewMeta.title} Print Preview`,
    fileName,
    previewMeta,
    content: '<div class="preview-status">Preparing breakdown print preview...</div>',
  });
  bindBreakdownPrintPreviewWindowControls(previewWindow);
  previewWindow.focus();
  return previewWindow;
}

function showBreakdownPrintPreviewError(
  previewWindow: BreakdownPrintPreviewWindow,
  fileName: string,
  previewMeta: BreakdownPrintPreviewMeta,
  message: string
) {
  writeBreakdownPrintPreviewWindowShell(previewWindow, {
    title: `${previewMeta.title} Print Preview`,
    fileName,
    previewMeta,
    content: `<div class="preview-status error">${escapeBreakdownPreviewHtml(message)}</div>`,
  });
  bindBreakdownPrintPreviewWindowControls(previewWindow);
}

function showBreakdownPrintPreviewPages(
  previewWindow: BreakdownPrintPreviewWindow,
  fileName: string,
  previewMeta: BreakdownPrintPreviewMeta,
  pageImages: string[]
) {
  writeBreakdownPrintPreviewWindowShell(previewWindow, {
    title: `${previewMeta.title} Print Preview`,
    fileName,
    previewMeta,
    showPrintButton: true,
    content: '<div class="preview-pages" id="preview-pages"></div>',
  });
  bindBreakdownPrintPreviewWindowControls(previewWindow);

  const pagesRoot = previewWindow.document.getElementById('preview-pages');
  if (!pagesRoot) {
    showBreakdownPrintPreviewError(previewWindow, fileName, previewMeta, 'Could not open the breakdown print preview.');
    return;
  }

  pageImages.forEach((src, index) => {
    const sheet = previewWindow.document.createElement('div');
    sheet.className = 'preview-sheet';
    const image = previewWindow.document.createElement('img');
    image.src = src;
    image.alt = `Breakdown page ${index + 1}`;
    image.loading = 'eager';
    sheet.appendChild(image);
    pagesRoot.appendChild(sheet);
  });
  previewWindow.focus();
}

const summarizePoolLightSelection = (lights: Array<{ name?: string }> | undefined): string => {
  const names = (lights ?? [])
    .map((light) => light?.name)
    .filter((name): name is string => {
      const normalized = normalizeSummaryName(name).toLowerCase();
      return Boolean(normalized) && normalized !== 'none';
    });
  return summarizeNamedSelections(names);
};

const getEquipmentPackageLabel = (equipment: Proposal['equipment']): string | null => {
  const selectedPackage = getSelectedEquipmentPackage(equipment as any);
  if (!selectedPackage) return null;

  const packageName = normalizeSummaryName(selectedPackage.name);
  if (!packageName) {
    return selectedPackage.mode === 'custom' ? 'Custom Equipment Package' : null;
  }

  if (selectedPackage.mode !== 'custom') {
    return packageName;
  }

  const normalizedPackageName = packageName.toLowerCase();
  if (normalizedPackageName === 'custom') {
    return 'Custom Equipment Package';
  }

  return normalizedPackageName.includes('package') ? packageName : `${packageName} Equipment Package`;
};

const buildEquipmentSummary = (
  equipment: Proposal['equipment'],
  equipmentFlags: RetiredEquipmentFlags = getEmptyRetiredEquipmentFlags()
) => {
  const selectedPackage = getSelectedEquipmentPackage(equipment as any);
  const packageSaltName = selectedPackage?.includedSaltSystemName;
  const effectiveSaltName = getEffectivePrimarySanitationSystemName(equipment as any);
  const packageIncludesSalt = hasNamedSelection(packageSaltName, 'no salt');
  const filterQuantity = equipment.filterQuantity ?? (hasNamedSelection(equipment.filter?.name, 'no filter') ? 1 : 0);
  const cleanerQuantity =
    equipment.cleanerQuantity ?? (hasNamedSelection(equipment.cleaner?.name, 'no cleaner') ? 1 : 0);
  const heaterQuantity = equipment.heaterQuantity ?? (hasNamedSelection(equipment.heater?.name, 'no heater') ? 1 : 0);
  const automationQuantity =
    equipment.automationQuantity ?? (hasNamedSelection(equipment.automation?.name, 'no automation') ? 1 : 0);
  const saltQuantity = Math.max(
    packageIncludesSalt
      ? Math.max(selectedPackage?.includedSaltSystemQuantity ?? 1, 1)
      : equipment.saltSystemQuantity ??
          (equipment.saltSystem?.name
            ? 1
            : hasNamedSelection(effectiveSaltName, 'no salt')
            ? 1
            : 0),
    0
  );
  const autoFillQuantity = Math.max(
    equipment.autoFillSystemQuantity ?? (hasNamedSelection(equipment.autoFillSystem?.name, 'no auto') ? 1 : 0),
    0
  );
  const pumpChangeRequired =
    equipmentFlags.pump ||
    equipmentFlags.additionalPumps.some(Boolean) ||
    equipmentFlags.auxiliaryPumps.some(Boolean);
  const poolLightChangeRequired = equipmentFlags.poolLights.some(Boolean);
  const sanitationChangeRequired = equipmentFlags.saltSystem || equipmentFlags.sanitationAccessory;

  return {
    equipmentPackageLabel: getEquipmentPackageLabel(equipment),
    pumpSummary: pumpChangeRequired ? REMOVED_EQUIPMENT_SUMMARY_LABEL : summarizePumpSelection(equipment),
    filterSummary: equipmentFlags.filter
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : summarizeSelectionWithQuantity(equipment.filter?.name, filterQuantity, 'no filter'),
    heaterSummary: equipmentFlags.heater
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : summarizeSelectionWithQuantity(equipment.heater?.name, heaterQuantity, 'no heater'),
    cleanerSummary: equipmentFlags.cleaner
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : summarizeSelectionWithQuantity(equipment.cleaner?.name, cleanerQuantity, 'no cleaner'),
    automationSummary: equipmentFlags.automation
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : summarizeSelectionWithQuantity(equipment.automation?.name, automationQuantity, 'no automation'),
    sanitationSummary: sanitationChangeRequired
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : (() => {
      const primarySummary = equipment.saltSystem?.includedSaltCellPlaceholder
        ? equipment.saltSystem.name
        : summarizeSelectionWithQuantity(effectiveSaltName, saltQuantity, 'no salt');
      const additionalSummary = hasNamedSelection(equipment.additionalSaltSystem?.name, 'no salt')
        ? normalizeSummaryName(equipment.additionalSaltSystem?.name)
        : '';
      if (!additionalSummary) return primarySummary;
      return primarySummary === 'None' ? additionalSummary : `${primarySummary} + ${additionalSummary}`;
    })(),
    autoFillSummary: equipmentFlags.autoFillSystem
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : summarizeSelectionWithQuantity(equipment.autoFillSystem?.name, autoFillQuantity, 'no auto'),
    poolLightSummary: poolLightChangeRequired
      ? REMOVED_EQUIPMENT_SUMMARY_LABEL
      : summarizePoolLightSelection(equipment.poolLights),
  };
};

type ProposalViewProps = {
  cloudIssue?: CloudConnectionIssue;
};

function ProposalView({ cloudIssue }: ProposalViewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { proposalNumber } = useParams();

  useEffect(() => {
    const session = readSession();
    if (!proposalNumber || !session?.userId) return;
    recordRecentProposalOpen(proposalNumber, {
      userId: session.userId,
      franchiseId: getSessionFranchiseId(),
    });
  }, [proposalNumber]);

  const isOffline = cloudIssue === 'no-internet' || cloudIssue === 'server-issue';
  const offlineActionDisabledReason = isOffline ? 'Internet connection must be restored' : undefined;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [versions, setVersions] = useState<Proposal[]>([]);
  const [activeVersionId, setActiveVersionId] = useState<string>('original');
  const [selectedVersionId, setSelectedVersionId] = useState<string>('original');
  const [loading, setLoading] = useState(true);
  const [, setPricingStoreVersion] = useState(0);
  const [customerBreakdownVersionId, setCustomerBreakdownVersionId] = useState<string | null>(null);
  const [customerBreakdownMode, setCustomerBreakdownMode] = useState<CustomerBreakdownMode>('combined');
  const [cogsBreakdownVersionId, setCogsBreakdownVersionId] = useState<string | null>(null);
  const [preCogsBreakdownVersionId, setPreCogsBreakdownVersionId] = useState<string | null>(null);
  const [showCogsBreakdown, setShowCogsBreakdown] = useState(false);
  const [offContractVersionId, setOffContractVersionId] = useState<string | null>(null);
  const [contractVersionId, setContractVersionId] = useState<string | null>(null);
  const [activeContractRevision, setActiveContractRevision] = useState<ContractRevisionDescriptor | null>(null);
  const [pendingContractRevision, setPendingContractRevision] = useState<{
    version: Proposal;
    check: ContractRevisionCheck;
  } | null>(null);
  const [contractRevisionPromptOpen, setContractRevisionPromptOpen] = useState(false);
  const [contractRevisionBusy, setContractRevisionBusy] = useState(false);
  const [contractRevisionError, setContractRevisionError] = useState<string | null>(null);
  const [customerBreakdownEditor, setCustomerBreakdownEditor] = useState<CustomerBreakdownEditorState | null>(null);
  const [pendingUnsavedCloseTarget, setPendingUnsavedCloseTarget] = useState<'contract' | 'customer' | null>(null);
  const [breakdownExportOpen, setBreakdownExportOpen] = useState(false);
  const [breakdownExporting, setBreakdownExporting] = useState(false);
  const [breakdownExportActive, setBreakdownExportActive] = useState(false);
  const [breakdownSaving, setBreakdownSaving] = useState(false);
  const [contractExportOpen, setContractExportOpen] = useState(false);
  const [contractDirty, setContractDirty] = useState(false);
  const [contractExporting, setContractExporting] = useState(false);
  const [contractSaving, setContractSaving] = useState(false);
  const [contractViewReady, setContractViewReady] = useState(false);
  const [loadedContractView, setLoadedContractView] = useState<ContractViewComponent | null>(null);
  const [loadedBreakdownExportPages, setLoadedBreakdownExportPages] = useState<BreakdownExportPagesModule | null>(null);
  const [showVersionNameModal, setShowVersionNameModal] = useState(false);
  const [versionNameModalMode, setVersionNameModalMode] = useState<VersionNameModalMode>('create');
  const [newVersionName, setNewVersionName] = useState('');
  const [newVersionSourceId, setNewVersionSourceId] = useState<string>(SCRATCH_VERSION_SOURCE_ID);
  const [renameTargetVersionId, setRenameTargetVersionId] = useState<string | null>(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitTargetVersionId, setSubmitTargetVersionId] = useState<string | null>(null);
  const [submitManualReviewRequested, setSubmitManualReviewRequested] = useState(false);
  const [showModifySignedConfirm, setShowModifySignedConfirm] = useState(false);
  const [addendumPricingComparison, setAddendumPricingComparison] = useState<PricingRevisionComparison | null>(null);
  const [addendumPricingBusy, setAddendumPricingBusy] = useState(false);
  const [showMarkSignedConfirm, setShowMarkSignedConfirm] = useState(false);
  const [signTargetVersionId, setSignTargetVersionId] = useState<string | null>(null);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [isWorkflowHistoryExpanded, setIsWorkflowHistoryExpanded] = useState(false);
  const [isArchiveVersionsExpanded, setIsArchiveVersionsExpanded] = useState(false);
  const [versionContextMenu, setVersionContextMenu] = useState<VersionContextMenuState | null>(null);
  const [showWorkflowMessageComposer, setShowWorkflowMessageComposer] = useState(false);
  const [workflowMessageDraft, setWorkflowMessageDraft] = useState('');
  const [workflowMessageSaving, setWorkflowMessageSaving] = useState(false);
  const [reviewerActionSaving, setReviewerActionSaving] = useState(false);
  const [pricingRevisionComparison, setPricingRevisionComparison] = useState<PricingRevisionComparison | null>(null);
  const [pricingRevisionPromptOpen, setPricingRevisionPromptOpen] = useState(false);
  const [pricingRevisionComparisonOpen, setPricingRevisionComparisonOpen] = useState(false);
  const [pricingRevisionBusy, setPricingRevisionBusy] = useState(false);
  const [pricingRevisionError, setPricingRevisionError] = useState<string | null>(null);
  const [customOptionPricingCorrection, setCustomOptionPricingCorrection] =
    useState<CustomOptionPricingCorrectionReview | null>(null);
  const [customOptionPricingCorrectionBusy, setCustomOptionPricingCorrectionBusy] = useState(false);
  const [customOptionPricingCorrectionError, setCustomOptionPricingCorrectionError] = useState<string | null>(null);
  const dismissedCustomOptionCorrectionVersionRef = useRef<string | null>(null);
  const [versionSyncMeta, setVersionSyncMeta] = useState<Record<string, ProposalVersionSyncMeta>>({});
  const proposalRef = useRef<HTMLDivElement>(null);
  const breakdownExportControlRef = useRef<HTMLDivElement>(null);
  const breakdownExportAreaRef = useRef<HTMLDivElement>(null);
  const contractExportControlRef = useRef<HTMLDivElement>(null);
  const contractViewRef = useRef<ContractViewHandle | null>(null);
  const loadRequestRef = useRef(0);
  const autoOpenedSignModalRef = useRef(false);
  const { showToast } = useToast();
  const handleContractViewRef = useCallback((instance: ContractViewHandle | null) => {
    contractViewRef.current = instance;
    setContractViewReady(Boolean(instance));
  }, []);
  const locationState = (location.state as ProposalViewLocationState | null) ?? null;
  const sessionRole = getSessionRole();
  const isProposalEditingRestricted = isMasterActingAsOwnerSession();
  const isReviewerRole = sessionRole === 'owner' || sessionRole === 'admin' || sessionRole === 'bookkeeper';
  const isReviewerWorkspaceView = Boolean(locationState?.reviewerReturnTo || locationState?.reviewerReturnPath);
  const isReadOnlyReviewerView = isReviewerRole && isReviewerWorkspaceView;
  const canViewCogsBreakdown = showCogsBreakdown;
  const activeEditableVersion =
    (versions.length
      ? versions.find((entry) => (entry.versionId || 'original') === activeVersionId)
      : proposal) || proposal;
  const proposalWorkflowStatus = getWorkflowStatus(proposal);
  const hasSignedBaseline = Boolean(getSignedVersionId(proposal as Proposal));
  const isProposalCompleted = proposalWorkflowStatus === 'completed';
  const canOpenReadOnlyBuilder = isProposalEditingRestricted;
  const canManageVersionDrafts =
    !isProposalEditingRestricted &&
    !isReadOnlyReviewerView &&
    !isProposalCompleted;
  const activeVersionRecordStatus = getVersionRecordStatus(activeEditableVersion);
  const canSendWorkflowMessages =
    !isProposalEditingRestricted && Boolean(proposal?.workflow?.submittedAt) && !isProposalCompleted;
  const editDisabledReason =
    isProposalEditingRestricted
      ? 'Master accounts acting as owner can view proposals but cannot edit them.'
      : isReadOnlyReviewerView
      ? 'Proposals opened from the reviewer workspace are read-only. Return to Dashboard to edit drafts.'
      : isProposalCompleted
      ? 'Completed proposals are locked.'
      : activeVersionRecordStatus === 'signed'
      ? 'Signed proposal versions are locked. Use Create Proposal Addendum to create an addendum draft.'
      : activeVersionRecordStatus === 'completed'
      ? 'Completed proposal versions are locked.'
      : undefined;
  const { disableSignedWorkflow } = useFranchiseSignedWorkflowDisabled(proposal?.franchiseId);
  const { enabled: splitCustomerCostWarranty } = useFranchiseCapability(
    'splitCustomerCostWarranty',
    proposal?.franchiseId
  );
  const franchiseLogoId = proposal?.franchiseId;
  const canSubmitProposal = Boolean(proposal?.customerInfo.customerName?.trim());
  const reviewerReturnTo = locationState?.reviewerReturnTo === 'admin-panel' ? 'admin-panel' : 'workflow';
  const reviewerBackLabel = reviewerReturnTo === 'admin-panel' ? 'Back to Admin Panel' : 'Back to Book Keeper';
  const handleReviewerBack = () =>
    navigate(locationState?.reviewerReturnPath || (reviewerReturnTo === 'admin-panel' ? '/admin' : '/workflow'), {
      state:
        reviewerReturnTo === 'workflow'
          ? {
              selectedFilter: locationState?.reviewerReturnFilter || 'needs_approval',
              selectedUserId: locationState?.reviewerReturnUserId || '',
            }
          : undefined,
    });
  const getCachedVersionSyncMeta = (version?: Partial<Proposal> | null) =>
    version ? versionSyncMeta[getVersionIdKey(version)] : undefined;
  const shouldUseLiveVersionSync = (container: Proposal, version?: Partial<Proposal> | null) => {
    if (!version) return false;
    if (getWorkflowStatus(container) === 'completed') return false;
    return !isHistoricalVersionState(version);
  };
  const mergeProposalWithDefaults = (input: Partial<Proposal>): Partial<Proposal> => {
    const base = getDefaultProposal();
    const pricingTierId = normalizePricingTierId(input.pricingTierId || input.pricingTierName);
    const poolSpecs = { ...getDefaultPoolSpecs(), ...(input.poolSpecs || {}) };
    const sourceEquipment = (input.equipment || {}) as Proposal['equipment'];
    const hasExplicitPackageTouchState = Object.prototype.hasOwnProperty.call(
      sourceEquipment,
      'packageSelectionTouched'
    );
    const mergedEquipment = normalizeEquipmentLighting(
      {
        ...getDefaultEquipment(),
        ...sourceEquipment,
        packageSelectionTouched: hasExplicitPackageTouchState
          ? sourceEquipment.packageSelectionTouched
          : sourceEquipment.packageSelectionId
            ? true
            : undefined,
      } as Proposal['equipment'],
      { poolSpecs, hasSpa: poolSpecs.spaType !== 'none' }
    );
    const defaultPlumbing = getDefaultPlumbing();
    const inputPlumbing = (input.plumbing || {}) as Partial<Proposal['plumbing']>;
    const defaultElectrical = getDefaultElectrical();
    const inputElectrical = (input.electrical || {}) as Partial<Proposal['electrical']>;

    const merged = {
      ...(base as Proposal),
      ...input,
      customerInfo: { ...(base.customerInfo || {}), ...(input.customerInfo || {}) } as Proposal['customerInfo'],
      poolSpecs,
      excavation: { ...getDefaultExcavation(), ...(input.excavation || {}) },
      plumbing: {
        ...defaultPlumbing,
        ...inputPlumbing,
        runs: mergePlumbingRuns(inputPlumbing.runs),
      },
      electrical: {
        ...defaultElectrical,
        ...inputElectrical,
        runs: { ...defaultElectrical.runs, ...(inputElectrical.runs || {}) },
      },
      tileCopingDecking: { ...getDefaultTileCopingDecking(), ...(input.tileCopingDecking || {}) },
      drainage: { ...getDefaultDrainage(), ...(input.drainage || {}) },
      equipment: mergedEquipment,
      waterFeatures: { ...getDefaultWaterFeatures(), ...(input.waterFeatures || {}) },
      customFeatures: normalizeCustomFeatures(input.customFeatures),
      interiorFinish: { ...getDefaultInteriorFinish(), ...(input.interiorFinish || {}) },
      manualAdjustments: { ...getDefaultManualAdjustments(), ...(input.manualAdjustments || {}) },
      retailAdjustments: mergeRetailAdjustments(input.retailAdjustments),
      papDiscounts: resolveProposalPapDiscounts(input, (base as any).papDiscounts),
      contractOverrides: (input as Proposal).contractOverrides || (base as Proposal).contractOverrides || {},
      warrantySections: normalizeWarrantySectionsSetting(input.warrantySections),
      pricingTierId,
      pricingTierName: getPricingTierName(pricingTierId),
    };
    if (isBronzePricingTier(pricingTierId)) {
      merged.excavation = {
        ...merged.excavation,
        hasGravelInstall: isPpasEastFranchiseCode(merged.designerCode),
      };
      merged.interiorFinish = { ...merged.interiorFinish, hasWaterproofing: false };
    }
    return merged;
  };

  const resolveVersionSyncMetaEntries = async (
    entries: Proposal[],
    container: Proposal
  ): Promise<Record<string, ProposalVersionSyncMeta>> => {
    const pricingSnapshotCache = new Map<string, Awaited<ReturnType<typeof loadPricingSnapshotForExistingProposal>>>();
    const pricingDirectoryCache = new Map<string, PricingModelDirectory>();

    const results = await Promise.all(
      entries.map(async (entry) => {
        const versionKey = getVersionIdKey(entry);

        const sourceFranchiseId = entry.pricingModelFranchiseId || entry.franchiseId || container.franchiseId || 'default';
        let pricingDirectory = pricingDirectoryCache.get(sourceFranchiseId);
        if (!pricingDirectory) {
          try {
            pricingDirectory = {
              loaded: true,
              rows: await listPricingModelsRemote(sourceFranchiseId),
            };
          } catch (error) {
            console.warn('Unable to load pricing models for proposal view', sourceFranchiseId, error);
            pricingDirectory = {
              loaded: false,
              rows: [],
            };
          }
          pricingDirectoryCache.set(sourceFranchiseId, pricingDirectory);
        }

        const useLiveVersionSync = shouldUseLiveVersionSync(container, entry);
        const resolvedFranchiseId = entry.franchiseId || container.franchiseId || 'default';
        const pricingModelId = entry.pricingModelId || undefined;
        const pricingModelFranchiseId = entry.pricingModelFranchiseId || undefined;
        const pricingModelRevisionId = entry.pricingModelRevisionId || undefined;
        const pricingTierId = normalizePricingTierId(entry.pricingTierId || entry.pricingTierName);
        const pricingCacheKey = `${resolvedFranchiseId}::${pricingModelFranchiseId || resolvedFranchiseId}::${pricingModelId || 'default'}::${pricingModelRevisionId || 'current'}::${pricingTierId}`;
        let pricingSnapshot = pricingSnapshotCache.get(pricingCacheKey);
        if (!pricingSnapshot) {
          pricingSnapshot = await loadPricingSnapshotForExistingProposal(
            resolvedFranchiseId,
            pricingModelId,
            pricingModelFranchiseId,
            pricingTierId,
            pricingModelRevisionId
          );
          pricingSnapshotCache.set(pricingCacheKey, pricingSnapshot);
        }

        const mergedVersion = withTemporaryPricingSnapshot(pricingSnapshot.pricing, () => mergeProposalWithDefaults(entry)) as Proposal;
        const priceModelStatus = resolveCurrentPricingModelStatus(entry, pricingSnapshot, pricingDirectory);
        const equipmentFlags =
          !useLiveVersionSync || priceModelStatus === 'removed'
            ? getEmptyRetiredEquipmentFlags()
            : withTemporaryPricingSnapshot(pricingSnapshot.pricing, () =>
                getRetiredEquipmentFlags(mergedVersion.equipment)
              );

        return [
          versionKey,
          {
            priceModelStatus,
            equipmentFlags,
            pricingSnapshot: priceModelStatus === 'removed' ? undefined : pricingSnapshot.pricing,
          },
        ] as const;
      })
    );

    return Object.fromEntries(results);
  };

  const resolveVersionSyncMetaForVersion = async (version?: Proposal | null, container?: Proposal | null) => {
    if (!version || !container) return null;
    const results = await resolveVersionSyncMetaEntries([version], container);
    return results[getVersionIdKey(version)] || null;
  };

  useEffect(() => {
    setShowCogsBreakdown(false);
    setCogsBreakdownVersionId(null);
    setPreCogsBreakdownVersionId(null);
  }, [proposalNumber]);

  useEffect(() => {
    const unsubscribe = subscribeToPricingData(() => {
      setPricingStoreVersion((current) => current + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!proposal) {
      setVersionSyncMeta({});
      return;
    }

    const container = ensureProposalWorkflow(proposal);
    const versionsToResolve = versions.length ? versions : listAllVersions(container);
    if (!versionsToResolve.length) {
      setVersionSyncMeta({});
      return;
    }

    let cancelled = false;
    const loadVersionSyncMeta = async () => {
      const entries = await resolveVersionSyncMetaEntries(versionsToResolve, container);
      if (cancelled) return;
      setVersionSyncMeta(entries);
    };

    void loadVersionSyncMeta();

    return () => {
      cancelled = true;
    };
  }, [proposal, versions]);

  useEffect(() => {
    if (canViewCogsBreakdown) return;
    if (cogsBreakdownVersionId) setCogsBreakdownVersionId(null);
    if (preCogsBreakdownVersionId) setPreCogsBreakdownVersionId(null);
  }, [canViewCogsBreakdown, cogsBreakdownVersionId, preCogsBreakdownVersionId]);

  const loadProposal = async (num: string) => {
    const requestId = ++loadRequestRef.current;
    try {
      const data = await getProposalRemote(num);
      if (requestId !== loadRequestRef.current) return;
      if (!data) {
        showToast({
          type: 'error',
          message: 'Proposal not found or access denied.',
        });
        navigate('/', { replace: true });
        return;
      }
      let sourceProposal = ensureProposalWorkflow(JSON.parse(JSON.stringify(data)) as Proposal);
      const versionStateCleanup = reconcileWorkflowVersionStates(sourceProposal);
      const needsVersionStateCleanup = JSON.stringify(versionStateCleanup) !== JSON.stringify(sourceProposal);
      sourceProposal = versionStateCleanup;
      const approvedVersionCleanup = collapseApprovedProposalVersions(sourceProposal);
      const needsApprovedCleanup = JSON.stringify(approvedVersionCleanup) !== JSON.stringify(sourceProposal);
      sourceProposal = approvedVersionCleanup;
      const currentUserId = readSession()?.userId;
      const readUpdated = isProposalEditingRestricted
        ? sourceProposal
        : markWorkflowRead(sourceProposal, currentUserId);
      if (
        !isProposalEditingRestricted &&
        JSON.stringify(readUpdated.workflow?.history || []) !== JSON.stringify(sourceProposal.workflow?.history || [])
      ) {
        try {
          sourceProposal = await saveProposalRemote(readUpdated);
        } catch (markReadError) {
          console.warn('Failed to persist workflow read state', markReadError);
          sourceProposal = readUpdated;
        }
      } else if (!isProposalEditingRestricted && (needsVersionStateCleanup || needsApprovedCleanup)) {
        try {
          sourceProposal = await saveProposalRemote(sourceProposal);
        } catch (cleanupError) {
          console.warn('Failed to persist workflow version cleanup', cleanupError);
        }
      }
      const pricingCache = new Map<string, Awaited<ReturnType<typeof loadPricingSnapshotForExistingProposal>>>();
      const mergeWithPricingSnapshot = async (input: Partial<Proposal>): Promise<Partial<Proposal>> => {
        const resolvedFranchiseId = input.franchiseId || sourceProposal.franchiseId || 'default';
        const pricingModelId = input.pricingModelId || undefined;
        const pricingModelFranchiseId = input.pricingModelFranchiseId || undefined;
        const pricingModelRevisionId = input.pricingModelRevisionId || undefined;
        const pricingTierId = normalizePricingTierId(input.pricingTierId || input.pricingTierName);
        const pricingCacheKey = `${resolvedFranchiseId}::${pricingModelFranchiseId || resolvedFranchiseId}::${pricingModelId || 'default'}::${pricingModelRevisionId || 'current'}::${pricingTierId}`;
        let pricingSnapshot = pricingCache.get(pricingCacheKey);
        if (!pricingSnapshot) {
          pricingSnapshot = await loadPricingSnapshotForExistingProposal(
            resolvedFranchiseId,
            pricingModelId,
            pricingModelFranchiseId,
            pricingTierId,
            pricingModelRevisionId
          );
          pricingCache.set(pricingCacheKey, pricingSnapshot);
        }
        const merged = withTemporaryPricingSnapshot(pricingSnapshot.pricing, () => mergeProposalWithDefaults(input));
        return {
          ...merged,
          pricingModelId: input.pricingModelId || pricingSnapshot.pricingModelId || undefined,
          pricingModelName: input.pricingModelName || pricingSnapshot.pricingModelName || undefined,
          pricingModelFranchiseId:
            input.pricingModelFranchiseId || pricingSnapshot.pricingModelFranchiseId || undefined,
          pricingModelRevisionId: input.pricingModelRevisionId || pricingSnapshot.pricingModelRevisionId || undefined,
          pricingModelRevisionNumber:
            input.pricingModelRevisionNumber || pricingSnapshot.pricingModelRevisionNumber || undefined,
        };
      };

      const activeApplied = ensureProposalWorkflow(applyActiveVersion(sourceProposal));
      const allVersions = (
        await Promise.all(
          listAllVersions(sourceProposal).map(async (v) => ({
            ...((await mergeWithPricingSnapshot(v)) as Proposal),
            versionId: v.versionId || 'original',
            versionName: v.versionName || (v.isOriginalVersion ? 'Original Version' : 'Version'),
            isOriginalVersion: v.isOriginalVersion,
            activeVersionId: v.activeVersionId,
            versions: [],
          }))
        )
      ) as Proposal[];
      const requestedVersionId = locationState?.versionId;
      const reviewerVisibleVersionIds = isReadOnlyReviewerView
        ? new Set(getReviewerVisibleVersions(sourceProposal).map((entry) => entry.versionId || 'original'))
        : null;
      const reviewerPrimaryVersionId = isReadOnlyReviewerView
        ? getReviewerPrimaryVersionId(sourceProposal)
        : null;
      const requestedVisibleVersionId =
        requestedVersionId &&
        (!reviewerVisibleVersionIds || reviewerVisibleVersionIds.has(requestedVersionId))
          ? requestedVersionId
          : undefined;
      const activeId =
        activeApplied.activeVersionId ||
        activeApplied.versionId ||
        'original';
      const initialSelectedVersionId =
        requestedVisibleVersionId ||
        reviewerPrimaryVersionId ||
        activeId;
      const activeVersion =
        allVersions.find((v) => v.versionId === activeId) ||
        ((await mergeWithPricingSnapshot(activeApplied)) as Proposal);
      if (requestId !== loadRequestRef.current) return;

      const initialVersionSyncMeta = await resolveVersionSyncMetaEntries(allVersions, sourceProposal);
      if (requestId !== loadRequestRef.current) return;

      await initPricingDataStore(
        activeVersion.franchiseId,
        activeVersion.pricingModelId || undefined,
        activeVersion.pricingModelFranchiseId || undefined,
        normalizePricingTierId(activeVersion.pricingTierId || activeVersion.pricingTierName),
        activeVersion.pricingModelRevisionId || undefined
      );
      if (requestId !== loadRequestRef.current) return;

      setVersions(allVersions);
      setActiveVersionId(activeId);
      setSelectedVersionId(initialSelectedVersionId);
      setVersionSyncMeta(initialVersionSyncMeta);
      setProposal(ensureProposalWorkflow({ ...(activeVersion as Proposal), workflow: sourceProposal.workflow, status: sourceProposal.status }));
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Failed to load proposal:', error);
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (proposalNumber) {
      setLoading(true);
      setProposal(null);
      setVersions([]);
      void loadProposal(proposalNumber);
    }
  }, [location.state, navigate, proposalNumber, showToast]);

  useEffect(() => {
    autoOpenedSignModalRef.current = false;
  }, [proposalNumber]);

  useEffect(() => {
    setIsWorkflowHistoryExpanded(false);
    setVersionContextMenu(null);
  }, [proposal?.proposalNumber]);

  useEffect(() => {
    if (loading || !proposal) return;

    const allVersionsForSelection = versions.length ? versions : listAllVersions(proposal as Proposal);
    if (!allVersionsForSelection.length) return;

    const displayContainer =
      buildContainerFromVersions(
        allVersionsForSelection.map((entry) => ({ ...(entry as Proposal), versions: [] })),
        (proposal as Proposal).activeVersionId || activeVersionId
      ) || proposal;
    const visibleVersions = isReadOnlyReviewerView
      ? getReviewerVisibleVersions(displayContainer as Proposal)
      : allVersionsForSelection;
    const hasSelectedVersion = visibleVersions.some(
      (entry) => (entry.versionId || 'original') === selectedVersionId
    );

    if (hasSelectedVersion) return;

    const fallbackSelectedVersionId =
      (locationState?.versionId &&
      visibleVersions.some((entry) => (entry.versionId || 'original') === locationState.versionId)
        ? locationState.versionId
        : undefined) ||
      (isReadOnlyReviewerView ? getReviewerPrimaryVersionId(displayContainer as Proposal) : undefined) ||
      activeVersionId ||
      (proposal as Proposal).activeVersionId ||
      visibleVersions[0]?.versionId ||
      'original';

    setSelectedVersionId(fallbackSelectedVersionId);
  }, [activeVersionId, isReadOnlyReviewerView, loading, locationState?.versionId, proposal, selectedVersionId, versions]);

  useEffect(() => {
    if (!breakdownExportOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (breakdownExportControlRef.current && !breakdownExportControlRef.current.contains(event.target as Node)) {
        setBreakdownExportOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [breakdownExportOpen]);

  useEffect(() => {
    if (!customerBreakdownVersionId && !cogsBreakdownVersionId) {
      setBreakdownExportOpen(false);
      setBreakdownExporting(false);
      setBreakdownExportActive(false);
    }
  }, [customerBreakdownVersionId, cogsBreakdownVersionId]);

  useEffect(() => {
    if (customerBreakdownVersionId) return;
    setCustomerBreakdownEditor(null);
    setBreakdownSaving(false);
    if (pendingUnsavedCloseTarget === 'customer') {
      setPendingUnsavedCloseTarget(null);
    }
  }, [customerBreakdownVersionId, pendingUnsavedCloseTarget]);

  useEffect(() => {
    if (!contractExportOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (contractExportControlRef.current && !contractExportControlRef.current.contains(event.target as Node)) {
        setContractExportOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [contractExportOpen]);

  useEffect(() => {
    if (!contractVersionId) {
      setContractExportOpen(false);
      setContractDirty(false);
      setContractExporting(false);
      setContractSaving(false);
      setContractViewReady(false);
    }
  }, [contractVersionId]);

  useEffect(() => {
    if (!contractVersionId || loadedContractView) return;

    let isMounted = true;
    setContractViewReady(false);

    void loadContractView()
      .then((module) => {
        if (isMounted) {
          setLoadedContractView(() => module.default);
        }
      })
      .catch((error) => {
        console.error('Failed to load contract view', error);
        if (isMounted) {
          setContractVersionId(null);
          showToast({ type: 'error', message: 'Could not load contract view.' });
        }
      });

    return () => {
      isMounted = false;
    };
  }, [contractVersionId, loadedContractView, showToast]);

  const buildContainerFromVersions = (
    nextVersions: Proposal[],
    desiredActiveId?: string,
    statusOverride?: Proposal['status']
  ): Proposal | null => {
    if (!proposal) return null;
    const resolvedActiveId =
      desiredActiveId || activeVersionId || proposal.activeVersionId || proposal.versionId || 'original';
    const active =
      nextVersions.find((entry) => (entry.versionId || 'original') === resolvedActiveId) ||
      nextVersions[0];
    if (!active) return null;
    const others = nextVersions.filter(
      (entry) => (entry.versionId || 'original') !== (active.versionId || 'original')
    );
    return ensureProposalWorkflow({
      ...(active as Proposal),
      status: statusOverride || getWorkflowStatus(proposal),
      activeVersionId: resolvedActiveId,
      versions: others.map((entry) => ({ ...entry, versions: [] })),
      workflow: proposal.workflow,
    });
  };

  const getPricingRevisionActor = (): ProposalWorkflowActor => {
    const session = readSession();
    return {
      userId: session?.userId,
      name: session?.userName || null,
      email: session?.userEmail || null,
      role: getSessionRole(),
    };
  };

  const refreshPricingRevisionComparison = async () => {
    if (!proposal) return null;
    const latestComparison = await buildPricingRevisionComparison(proposal);
    setPricingRevisionComparison(latestComparison);
    return latestComparison;
  };

  const calculateCurrentCategoryCustomOptionPricing = (input: Proposal) => {
    const syncMeta = getCachedVersionSyncMeta(input) ?? getFrozenVersionSyncMeta(input);
    const pricingSnapshot = syncMeta.pricingSnapshot;
    if (!pricingSnapshot || syncMeta.priceModelStatus === 'removed') return null;
    const merged = withTemporaryPricingSnapshot(pricingSnapshot, () => mergeProposalWithDefaults(input)) as Proposal;
    const calculation = withTemporaryPricingSnapshot(pricingSnapshot, () =>
      MasterPricingEngine.calculateCompleteProposal(merged, merged.papDiscounts)
    );
    return { merged, calculation };
  };

  const persistPricingRevisionVersion = async (updatedVersion: Proposal) => {
    if (isProposalEditingRestricted) return;
    if (!proposal) return;
    const targetVersionId = updatedVersion.versionId || activeVersionId || 'original';
    const all = versions.length ? versions : listAllVersions(proposal);
    const updatedVersions = all.map((entry) =>
      (entry.versionId || 'original') === targetVersionId
        ? { ...updatedVersion, versions: [] }
        : { ...entry, versions: [] }
    );
    const builtContainer = buildContainerFromVersions(
      updatedVersions,
      activeVersionId || targetVersionId,
      updatedVersion.status
    );
    if (!builtContainer) return;
    const container = ensureProposalWorkflow({
      ...builtContainer,
      status: updatedVersion.status,
      workflow: updatedVersion.workflow || builtContainer.workflow,
    });
    const saved = await saveProposalRemote(container);
    const savedVersions = listAllVersions(saved as Proposal).map((entry) => ({
      ...(mergeProposalWithDefaults(entry) as Proposal),
      versionId: entry.versionId || 'original',
      versionName: entry.versionName || (entry.isOriginalVersion ? 'Original Version' : 'Version'),
      isOriginalVersion: entry.isOriginalVersion,
      activeVersionId: entry.activeVersionId,
      versions: [],
    }));
    const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));
    setVersions(savedVersions);
    setProposal(activeApplied as Proposal);
    setVersionSyncMeta(await resolveVersionSyncMetaEntries(savedVersions, saved as Proposal));
  };

  const handleApplyCustomOptionPricingCorrection = async () => {
    if (!proposal || isProposalEditingRestricted || customOptionPricingCorrectionBusy) return;
    setCustomOptionPricingCorrectionBusy(true);
    setCustomOptionPricingCorrectionError(null);
    try {
      const current = calculateCurrentCategoryCustomOptionPricing(proposal);
      const review = current
        ? buildCustomOptionPricingCorrectionReview(proposal, current.calculation)
        : null;
      if (!current || !review) {
        setCustomOptionPricingCorrection(null);
        return;
      }

      const currentStatus = getWorkflowStatus(proposal);
      const needsReapproval = currentStatus === 'approved';
      const correctedStatus = needsReapproval ? 'needs_approval' : currentStatus;
      const correctedVersion: Proposal = {
        ...current.merged,
        status: correctedStatus,
        workflow: proposal.workflow
          ? {
              ...proposal.workflow,
              status: correctedStatus,
              needsApproval: needsReapproval ? true : proposal.workflow.needsApproval,
              approved: needsReapproval ? false : proposal.workflow.approved,
              approvedAt: needsReapproval ? null : proposal.workflow.approvedAt,
              approvedBy: needsReapproval ? null : proposal.workflow.approvedBy,
            }
          : proposal.workflow,
        costBreakdown: current.calculation.costBreakdown,
        pricing: current.calculation.pricing,
        subtotal: current.calculation.subtotal,
        taxRate: current.calculation.taxRate,
        taxAmount: current.calculation.taxAmount,
        totalCost: current.calculation.totalCost,
        lastModified: new Date().toISOString(),
        versions: [],
      };
      await persistPricingRevisionVersion(correctedVersion);
      setCustomOptionPricingCorrection(null);
      showToast({
        type: 'success',
        message: needsReapproval
          ? 'Corrected custom-option pricing applied. This proposal requires approval again.'
          : 'Corrected custom-option pricing applied and saved.',
      });
    } catch (error: any) {
      setCustomOptionPricingCorrectionError(error?.message || 'Unable to apply the pricing correction.');
    } finally {
      setCustomOptionPricingCorrectionBusy(false);
    }
  };

  const handleDeclinePricingRevision = async () => {
    if (isProposalEditingRestricted) return;
    if (!proposal || !pricingRevisionComparison) return;
    setPricingRevisionBusy(true);
    setPricingRevisionError(null);
    try {
      const currentComparison = await refreshPricingRevisionComparison();
      if (!currentComparison) {
        setPricingRevisionPromptOpen(false);
        setPricingRevisionComparisonOpen(false);
        return;
      }
      const declined = markPricingRevisionDeclined(
        proposal,
        currentComparison,
        getPricingRevisionActor()
      );
      await persistPricingRevisionVersion(declined);
      setPricingRevisionPromptOpen(false);
      setPricingRevisionComparisonOpen(false);
      showToast({ type: 'success', message: 'Original pricing retained. You can upgrade later in the Proposal Builder.' });
    } catch (error: any) {
      setPricingRevisionError(error?.message || 'Unable to save the pricing review decision.');
    } finally {
      setPricingRevisionBusy(false);
    }
  };

  const handleUpgradePricingRevision = async () => {
    if (isProposalEditingRestricted) return;
    if (!proposal || !pricingRevisionComparison) return;
    setPricingRevisionBusy(true);
    setPricingRevisionError(null);
    try {
      const currentComparison = await refreshPricingRevisionComparison();
      if (!currentComparison) {
        setPricingRevisionPromptOpen(false);
        setPricingRevisionComparisonOpen(false);
        return;
      }
      const upgraded = await upgradeProposalPricingRevision(
        proposal,
        currentComparison,
        getPricingRevisionActor()
      );
      await persistPricingRevisionVersion(upgraded);
      await initPricingDataStore(
        upgraded.franchiseId,
        upgraded.pricingModelId,
        upgraded.pricingModelFranchiseId,
        normalizePricingTierId(upgraded.pricingTierId || upgraded.pricingTierName),
        upgraded.pricingModelRevisionId
      );
      setPricingRevisionPromptOpen(false);
      setPricingRevisionComparisonOpen(false);
      setPricingRevisionComparison(null);
      showToast({
        type: 'success',
        message:
          getWorkflowStatus(upgraded) === 'needs_approval'
            ? 'Pricing upgraded. This proposal requires approval again.'
            : 'Pricing upgraded to the newest revision.',
      });
    } catch (error: any) {
      setPricingRevisionError(error?.message || 'Unable to upgrade the pricing model.');
    } finally {
      setPricingRevisionBusy(false);
    }
  };

  const openContractWithRevision = (version: Proposal, revision: ContractRevisionDescriptor) => {
    setActiveContractRevision(revision);
    setContractVersionId(version.versionId || 'original');
  };

  const handleOpenContract = async (version: Proposal) => {
    if (contractRevisionBusy) return;
    setContractRevisionBusy(true);
    setContractRevisionError(null);
    try {
      const check = await checkProposalContractRevision(version);
      if (!check) {
        showToast({
          type: 'warning',
          message: 'A contract template has not been published for this franchise and proposal type yet.',
        });
        return;
      }
      const locked = isVersionPermanentlyLocked(version);
      if (locked) {
        openContractWithRevision(version, check.pinned);
        return;
      }
      if (isProposalEditingRestricted) {
        if (check.requiresReview) {
          setPendingContractRevision({ version, check });
          setContractRevisionPromptOpen(true);
          return;
        }
        openContractWithRevision(version, check.pinned);
        return;
      }
      if (check.canAdoptInitialRevisionSilently) {
        const pinned = adoptContractRevision(version, check.latest, getPricingRevisionActor());
        await persistPricingRevisionVersion(pinned);
        openContractWithRevision(pinned, check.latest);
        return;
      }
      if (check.requiresReview) {
        setPendingContractRevision({ version, check });
        setContractRevisionPromptOpen(true);
        return;
      }
      if (!version.contractTemplateRevisionId) {
        const pinned = adoptContractRevision(version, check.pinned, getPricingRevisionActor());
        await persistPricingRevisionVersion(pinned);
        openContractWithRevision(pinned, check.pinned);
        return;
      }
      openContractWithRevision(version, check.pinned);
    } catch (error: any) {
      showToast({ type: 'error', message: error?.message || 'Could not load this contract template.' });
    } finally {
      setContractRevisionBusy(false);
    }
  };

  const handleKeepCurrentContract = async () => {
    if (!pendingContractRevision) return;
    if (isProposalEditingRestricted) {
      const { version, check } = pendingContractRevision;
      setContractRevisionPromptOpen(false);
      setPendingContractRevision(null);
      setContractRevisionError(null);
      openContractWithRevision(version, check.pinned);
      return;
    }
    setContractRevisionBusy(true);
    setContractRevisionError(null);
    try {
      const { version, check } = pendingContractRevision;
      const declined = declineContractRevision(version, check.pinned, check.latest, getPricingRevisionActor());
      await persistPricingRevisionVersion(declined);
      setContractRevisionPromptOpen(false);
      setPendingContractRevision(null);
      openContractWithRevision(declined, check.pinned);
    } catch (error: any) {
      setContractRevisionError(error?.message || 'Unable to keep the current contract revision.');
    } finally {
      setContractRevisionBusy(false);
    }
  };

  const handleUpgradeContract = async () => {
    if (!pendingContractRevision) return;
    if (isProposalEditingRestricted) {
      const { version, check } = pendingContractRevision;
      setContractRevisionPromptOpen(false);
      setPendingContractRevision(null);
      setContractRevisionError(null);
      openContractWithRevision(version, check.latest);
      showToast({
        type: 'info',
        message: 'Previewing the latest contract template. The proposal was not changed.',
      });
      return;
    }
    setContractRevisionBusy(true);
    setContractRevisionError(null);
    try {
      const { version, check } = pendingContractRevision;
      const upgraded = adoptContractRevision(version, check.latest, getPricingRevisionActor());
      await persistPricingRevisionVersion(upgraded);
      setContractRevisionPromptOpen(false);
      setPendingContractRevision(null);
      openContractWithRevision(upgraded, check.latest);
    } catch (error: any) {
      setContractRevisionError(error?.message || 'Unable to upgrade the contract revision.');
    } finally {
      setContractRevisionBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const detectPricingRevision = async () => {
      if (isProposalEditingRestricted) {
        setPricingRevisionComparison(null);
        setPricingRevisionPromptOpen(false);
        setPricingRevisionComparisonOpen(false);
        return;
      }
      if (!proposal?.pricingModelId || !proposal.pricingModelRevisionId) {
        setPricingRevisionComparison(null);
        setPricingRevisionPromptOpen(false);
        return;
      }
      if (isVersionPermanentlyLocked(proposal)) {
        setPricingRevisionComparison(null);
        setPricingRevisionPromptOpen(false);
        return;
      }
      try {
        const comparison = await buildPricingRevisionComparison(proposal);
        if (cancelled) return;
        setPricingRevisionComparison(comparison);
        if (!comparison) {
          setPricingRevisionPromptOpen(false);
          return;
        }
        const alreadyDeclined =
          proposal.pricingRevisionReview?.decision === 'declined' &&
          proposal.pricingRevisionReview.latestRevisionId === comparison.latestRevisionId;
        const alreadyUpgraded =
          proposal.pricingRevisionReview?.decision === 'upgraded' &&
          proposal.pricingRevisionReview.latestRevisionId === comparison.latestRevisionId;
        setPricingRevisionPromptOpen(!alreadyDeclined && !alreadyUpgraded);
      } catch (error) {
        if (!cancelled) console.warn('Unable to compare pricing model revisions:', error);
      }
    };
    void detectPricingRevision();
    return () => {
      cancelled = true;
    };
  }, [isProposalEditingRestricted, proposal?.pricingModelId, proposal?.pricingModelRevisionId, proposal?.lastModified]);

  useEffect(() => {
    if (!proposal || isProposalEditingRestricted || isVersionPermanentlyLocked(proposal)) {
      setCustomOptionPricingCorrection(null);
      return;
    }
    const versionKey = proposal.versionId || activeVersionId || 'original';
    if (dismissedCustomOptionCorrectionVersionRef.current === versionKey) return;
    try {
      const current = calculateCurrentCategoryCustomOptionPricing(proposal);
      const review = current
        ? buildCustomOptionPricingCorrectionReview(proposal, current.calculation)
        : null;
      setCustomOptionPricingCorrection(review);
      if (!review) setCustomOptionPricingCorrectionError(null);
    } catch (error) {
      console.warn('Unable to check custom-option pricing correction:', error);
      setCustomOptionPricingCorrection(null);
    }
  }, [
    activeVersionId,
    isProposalEditingRestricted,
    proposal?.lastModified,
    proposal?.versionId,
    versionSyncMeta,
  ]);

  const handleEdit = (version?: Proposal, options?: { readOnly?: boolean }) => {
    if (!canManageVersionDrafts && !canOpenReadOnlyBuilder && !options?.readOnly) return;
    if (!version) return;
    if (!canOpenReadOnlyBuilder && !options?.readOnly && (isVersionPermanentlyLocked(version) || isProposalCompleted)) return;
    const targetVersionId = version?.versionId || proposal?.versionId || 'original';
    navigate(`/proposal/edit/${proposalNumber}`, {
      state: {
        versionId: targetVersionId,
        versionName: version?.versionName,
        versionSnapshot: { ...version, versions: [] },
        readOnlyVersion: options?.readOnly === true,
      },
    });
  };

  const handleDeleteVersion = async (versionId: string) => {
    if (!canManageVersionDrafts) return;
    if (!proposal) return;
    const all = versions.length ? versions : listAllVersions(proposal as Proposal);
    if (all.length <= 1) {
      showToast({ type: 'warning', message: 'Cannot delete the only version.' });
      return;
    }
    const target = all.find((v) => (v.versionId || 'original') === versionId);
    if (!target || (target.isOriginalVersion ?? versionId === 'original')) {
      showToast({ type: 'warning', message: 'The original version cannot be deleted.' });
      return;
    }
    if (isSubmittedVersionLocked(target)) {
      showToast({ type: 'warning', message: 'Submitted versions cannot be deleted.' });
      return;
    }

    const remaining = all.filter((v) => (v.versionId || 'original') !== versionId);
    const nextActive = remaining.find((v) => (v.versionId || 'original') === activeVersionId) || remaining[0];
    const nextSelected =
      (selectedVersionId && selectedVersionId !== versionId
        ? remaining.find((v) => (v.versionId || 'original') === selectedVersionId)
        : null) || nextActive || remaining[0];

    try {
      const container = buildContainerFromVersions(
        remaining.map((entry) => ({ ...entry, versions: [] })),
        nextActive.versionId || 'original'
      );
      if (!container) return;
      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(container);
      const isPending = (saved as any).syncStatus === 'pending';
      const updatedVersions = listAllVersions(saved as Proposal).map((v) => ({
        ...(mergeProposalWithDefaults(v) as Proposal),
        versionId: v.versionId || 'original',
        versionName: v.versionName || (v.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: v.isOriginalVersion,
        activeVersionId: v.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));
      setActiveVersionId(activeApplied.activeVersionId || nextActive.versionId || 'original');
      setSelectedVersionId(nextSelected?.versionId || 'original');
      setVersions(updatedVersions);
      setProposal(activeApplied as Proposal);
      showToast({
        type: isPending ? 'warning' : 'success',
        message: isPending ? 'Version deleted locally. Will sync when back online.' : 'Version deleted.',
      });
    } catch (error) {
      console.error('Failed to delete version', error);
      showToast({ type: 'error', message: 'Could not delete version.' });
    }
  };

  const handleBuildAnotherVersion = async () => {
    if (!canManageVersionDrafts) {
      showToast({ type: 'warning', message: editDisabledReason || 'This proposal is view only.' });
      return;
    }
    if (!proposal) return;
    if (isProposalCompleted) {
      showToast({ type: 'warning', message: 'Completed proposals cannot create new versions.' });
      return;
    }
    if (hasSignedBaseline) {
      if (proposalWorkflowStatus !== 'signed') {
        showToast({
          type: 'warning',
          message: 'Mark the current addendum as signed before creating another proposal addendum.',
        });
        return;
      }
      if (existingEditableAddendumVersion) {
        showToast({
          type: 'warning',
          message: 'A proposal addendum is already in progress. Continue working in that version before creating another addendum.',
        });
        return;
      }
      setShowModifySignedConfirm(true);
      return;
    }
    const count = (versions.length ? versions.length : listAllVersions(proposal as Proposal).length) + 1;
    const defaultPrefix = 'Version';
    setVersionNameModalMode('create');
    setRenameTargetVersionId(null);
    setNewVersionName(`${defaultPrefix} ${count}`);
    setNewVersionSourceId(resolvedSelectedVersionId || selectedVersionId || activeVersionId || 'original');
    setShowVersionNameModal(true);
  };

  const closeVersionNameModal = () => {
    setShowVersionNameModal(false);
    setVersionNameModalMode('create');
    setRenameTargetVersionId(null);
    setNewVersionName('');
  };

  const handleVersionContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    versionId: string
  ) => {
    if (!canManageVersionDrafts) return;
    event.preventDefault();
    setVersionContextMenu({
      versionId,
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 80),
    });
  };

  const handleOpenRenameVersion = (versionId: string) => {
    const all = versions.length ? versions : listAllVersions(proposal as Proposal);
    const target = all.find((entry) => (entry.versionId || 'original') === versionId);
    if (!target) return;
    setVersionContextMenu(null);
    setVersionNameModalMode('rename');
    setRenameTargetVersionId(versionId);
    setNewVersionName(getDisplayVersionLabel(target));
    setShowVersionNameModal(true);
  };

  const getNextAddendumName = (container: Proposal) => {
    const existingSignedAddendums = Array.isArray(container.workflow?.signedAddendumVersionIds)
      ? container.workflow?.signedAddendumVersionIds.length
      : 0;
    return `Proposal Addendum ${existingSignedAddendums + 1}`;
  };

  const createEditableVersion = async (
    explicitName?: string,
    sourceId?: string,
    useLatestAddendumPricing?: PricingRevisionComparison | null
  ) => {
    if (!canManageVersionDrafts) return;
    if (!proposal) return;
    try {
      const container = {
        ...ensureProposalWorkflow(proposal as Proposal),
        versions,
        activeVersionId,
      } as Proposal;
      const containerWorkflowStatus = getWorkflowStatus(container);
      const sourceVersionId =
        containerWorkflowStatus === 'signed'
          ? getLatestSignedBaselineVersionId(container) ||
            getApprovedVersionId(container) ||
            getPendingReviewVersionId(container) ||
            container.activeVersionId ||
            proposal.versionId ||
            activeVersionId
          : resolvedSelectedVersionId ||
            selectedVersionId ||
            container.activeVersionId ||
            proposal.versionId ||
            activeVersionId;
      const creationSource =
        containerWorkflowStatus === 'signed'
          ? { mode: 'copy', sourceVersionId } as const
          : sourceId === SCRATCH_VERSION_SOURCE_ID
          ? ({ mode: 'scratch' } as const)
          : ({ mode: 'copy', sourceVersionId: sourceId || sourceVersionId } as const);
      const isAddendumDraft = Boolean(getSignedVersionId(container));
      const resolvedVersionName =
        explicitName && explicitName.trim()
          ? explicitName.trim()
          : isAddendumDraft
          ? getNextAddendumName(container)
          : undefined;
      const preservedActiveVersionId =
        container.activeVersionId || container.versionId || activeVersionId || 'original';
      const { container: createdContainer, newVersion } = createVersionFromProposal(
        container,
        creationSource,
        resolvedVersionName
      );
      let nextContainer = createdContainer;
      if (isAddendumDraft && useLatestAddendumPricing) {
        const upgradedAddendum = await upgradeProposalPricingRevision(
          newVersion,
          useLatestAddendumPricing,
          getPricingRevisionActor()
        );
        const createdVersions = listAllVersions(createdContainer).map((entry) =>
          (entry.versionId || 'original') === (newVersion.versionId || 'original')
            ? { ...upgradedAddendum, status: 'draft' as const, versions: [] }
            : { ...entry, versions: [] }
        );
        nextContainer =
          buildContainerFromVersions(createdVersions, createdContainer.activeVersionId || activeVersionId, 'signed') ||
          createdContainer;
      }
      await initPricingDataStore(
        nextContainer.franchiseId,
        nextContainer.pricingModelId || undefined,
        nextContainer.pricingModelFranchiseId || undefined,
        normalizePricingTierId(nextContainer.pricingTierId || nextContainer.pricingTierName),
        nextContainer.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(nextContainer);
      const isPending = (saved as any).syncStatus === 'pending';
      const updatedVersions = listAllVersions(saved as Proposal).map((v) => ({
        ...(mergeProposalWithDefaults(v) as Proposal),
        versionId: v.versionId || 'original',
        versionName: v.versionName || (v.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: v.isOriginalVersion,
        activeVersionId: v.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));
      setVersions(updatedVersions);
      setProposal(activeApplied as Proposal);
      setActiveVersionId(newVersion.versionId || activeApplied.activeVersionId || preservedActiveVersionId);
      setSelectedVersionId(newVersion.versionId || activeApplied.activeVersionId || preservedActiveVersionId);
      showToast({
        type: isPending ? 'warning' : 'success',
        message: isPending
          ? isAddendumDraft
            ? 'Proposal addendum draft created locally. Will sync when back online.'
            : 'New version created locally. Will sync when back online.'
          : isAddendumDraft
          ? 'Proposal addendum draft created.'
          : 'New version created.',
      });
    } catch (error) {
      console.error('Failed to build version', error);
      showToast({
        type: 'error',
        message: proposalWorkflowStatus === 'signed'
          ? 'Could not create the proposal addendum draft.'
          : 'Could not create a new version.',
      });
    }
  };

  const handleConfirmModifySignedProposal = async () => {
    setShowModifySignedConfirm(false);
    if (!proposal) return;
    setAddendumPricingBusy(true);
    try {
      const container = { ...proposal, versions, activeVersionId } as Proposal;
      const signedId = getLatestSignedBaselineVersionId(container) || getSignedVersionId(container);
      const signedVersion = listAllVersions(container).find(
        (entry) => (entry.versionId || 'original') === (signedId || 'original')
      );
      const comparison = signedVersion ? await buildPricingRevisionComparison(signedVersion) : null;
      if (comparison) {
        setAddendumPricingComparison(comparison);
        return;
      }
      await createEditableVersion();
    } catch (error) {
      console.warn('Unable to check addendum pricing revision:', error);
      showToast({ type: 'error', message: 'Could not check the signed proposal pricing model.' });
    } finally {
      setAddendumPricingBusy(false);
    }
  };

  const renameVersion = async (versionId: string, nextName: string) => {
    if (!canManageVersionDrafts) return false;
    if (!proposal) return false;
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      showToast({ type: 'warning', message: 'Version name is required.' });
      return false;
    }

    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const target = all.find((entry) => (entry.versionId || 'original') === versionId);
      if (!target) return false;

      const updated = all.map((entry) => {
        const entryId = entry.versionId || 'original';
        if (entryId !== versionId) return entry;
        return {
          ...(entry as Proposal),
          versionName: trimmedName,
          lastModified: new Date().toISOString(),
        };
      });

      const desiredActiveId =
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const container = buildContainerFromVersions(
        updated.map((entry) => ({ ...(entry as Proposal), versions: [] })),
        desiredActiveId
      );
      if (!container) return false;

      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(container);
      const isPending = (saved as any).syncStatus === 'pending';
      const updatedVersions = listAllVersions(saved as Proposal).map((entry) => ({
        ...(mergeProposalWithDefaults(entry) as Proposal),
        versionId: entry.versionId || 'original',
        versionName: entry.versionName || (entry.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: entry.isOriginalVersion,
        activeVersionId: entry.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));
      setVersions(updatedVersions);
      setProposal(activeApplied as Proposal);
      setActiveVersionId(activeApplied.activeVersionId || desiredActiveId);
      showToast({
        type: isPending ? 'warning' : 'success',
        message: isPending ? 'Version name saved locally. Will sync when back online.' : 'Version renamed.',
      });
      return true;
    } catch (error) {
      console.error('Failed to rename version', error);
      showToast({ type: 'error', message: 'Could not rename version.' });
      return false;
    }
  };

  const handleConfirmVersionName = async () => {
    if (versionNameModalMode === 'rename') {
      if (!renameTargetVersionId) {
        closeVersionNameModal();
        return;
      }
      const didRename = await renameVersion(renameTargetVersionId, newVersionName);
      if (didRename) {
        closeVersionNameModal();
      }
      return;
    }

    const nextVersionName = newVersionName;
    const sourceVersionId = newVersionSourceId;
    closeVersionNameModal();
    await createEditableVersion(nextVersionName, sourceVersionId);
  };

  const handleSaveContractOverrides = async (versionId: string, overrides: ContractOverrides) => {
    if (isProposalEditingRestricted) return;
    if (!proposal) return;
    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const targetVersion = all.find((entry) => (entry.versionId || 'original') === versionId);
      if (!targetVersion || isVersionPermanentlyLocked(targetVersion) || isProposalCompleted) {
        return;
      }
      const updated = all.map((v) => {
        const id = v.versionId || 'original';
        if (id !== versionId) return v;
        return {
          ...(v as Proposal),
          contractOverrides: overrides,
          lastModified: new Date().toISOString(),
        };
      });

      const desiredActiveId =
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const container = buildContainerFromVersions(updated, desiredActiveId);
      if (!container) return;

      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(container);
      const isPending = (saved as any).syncStatus === 'pending';
      const updatedVersions = listAllVersions(saved as Proposal).map((v) => ({
        ...(mergeProposalWithDefaults(v) as Proposal),
        versionId: v.versionId || 'original',
        versionName: v.versionName || (v.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: v.isOriginalVersion,
        activeVersionId: v.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));
      setVersions(updatedVersions);
      setProposal(activeApplied as Proposal);
      setActiveVersionId(activeApplied.activeVersionId || desiredActiveId);
      showToast({
        type: isPending ? 'warning' : 'success',
        message: isPending
          ? 'Contract overrides saved locally. Will sync when back online.'
          : 'Contract overrides saved.',
      });
    } catch (error) {
      console.error('Failed to save contract overrides', error);
      showToast({ type: 'error', message: 'Could not save contract overrides.' });
    }
  };

  const handleCustomerRetailAdjustmentsDraftChange = (nextAdjustments: RetailAdjustment[]) => {
    setCustomerBreakdownEditor((prev) =>
      prev
        ? {
            ...prev,
            draftRetailAdjustments: cloneRetailAdjustments(nextAdjustments),
          }
        : prev
    );
  };

  const handleCustomerWarrantySectionsDraftChange = (
    nextSections: Proposal['warrantySections']
  ) => {
    setCustomerBreakdownEditor((prev) =>
      prev
        ? {
            ...prev,
            draftWarrantySections: cloneWarrantySections(nextSections),
          }
        : prev
    );
  };

  const handleSaveCustomerBreakdownChanges = async (): Promise<boolean> => {
    if (!customerBreakdownEditor) return true;
    if (breakdownSaving) return false;
    const versionId = customerBreakdownEditor.versionId;
    const normalizedAdjustments = cloneRetailAdjustments(customerBreakdownEditor.draftRetailAdjustments);
    const normalizedWarrantySections = cloneWarrantySections(customerBreakdownEditor.draftWarrantySections);
    const retailChanged = !areRetailAdjustmentsEqual(
        customerBreakdownEditor.draftRetailAdjustments,
        customerBreakdownEditor.baselineRetailAdjustments
      );
    const warrantyChanged = !areWarrantySectionsEqual(
        customerBreakdownEditor.draftWarrantySections,
        customerBreakdownEditor.baselineWarrantySections
      );
    const hasUnsavedChanges =
      customerBreakdownMode === 'cost'
        ? retailChanged
        : customerBreakdownMode === 'warranty'
        ? warrantyChanged
        : retailChanged || warrantyChanged;
    if (!hasUnsavedChanges) return true;
    if (isProposalEditingRestricted || !proposal) return false;

    setBreakdownSaving(true);
    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const targetVersion = all.find((entry) => (entry.versionId || 'original') === versionId);
      if (!targetVersion || isVersionPermanentlyLocked(targetVersion) || isProposalCompleted) {
        return false;
      }

      const savedRetailAdjustments =
        customerBreakdownMode === 'warranty'
          ? cloneRetailAdjustments(targetVersion.retailAdjustments)
          : normalizedAdjustments;
      const savedWarrantySections =
        customerBreakdownMode === 'cost'
          ? cloneWarrantySections(targetVersion.warrantySections)
          : normalizedWarrantySections;

      const updatedTimestamp = new Date().toISOString();
      const updatedVersions = all.map((entry) => {
        const entryId = entry.versionId || 'original';
        if (entryId !== versionId) return entry;
        return {
          ...(entry as Proposal),
          retailAdjustments: savedRetailAdjustments,
          warrantySections: savedWarrantySections,
          lastModified: updatedTimestamp,
        };
      });

      const desiredActiveId =
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const container = buildContainerFromVersions(updatedVersions, desiredActiveId);
      if (!container) return false;
      const targetVersionStatus = getVersionRecordStatus(targetVersion);
      const versionRequiresResubmission =
        targetVersionStatus === 'submitted' ||
        targetVersionStatus === 'needs_approval' ||
        targetVersionStatus === 'approved' ||
        hasVersionSubmissionHistory(proposal as Proposal, versionId);
      const containerToSave = versionRequiresResubmission
        ? resetWorkflowAfterVersionEdit(container as Proposal, versionId)
        : ensureProposalWorkflow(container as Proposal);

      await initPricingDataStore(
        containerToSave.franchiseId,
        containerToSave.pricingModelId || undefined,
        containerToSave.pricingModelFranchiseId || undefined,
        normalizePricingTierId(containerToSave.pricingTierId || containerToSave.pricingTierName),
        containerToSave.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(containerToSave);
      const isPending = (saved as any).syncStatus === 'pending';
      const savedWorkflowStatus = getWorkflowStatus(saved as Proposal);
      const updated = listAllVersions(saved as Proposal).map((entry) => ({
        ...(mergeProposalWithDefaults(entry) as Proposal),
        versionId: entry.versionId || 'original',
        versionName: entry.versionName || (entry.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: entry.isOriginalVersion,
        activeVersionId: entry.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));

      setVersions(updated);
      setActiveVersionId(activeApplied.activeVersionId || desiredActiveId);
      setProposal(activeApplied as Proposal);
      setCustomerBreakdownEditor({
        versionId,
        baselineRetailAdjustments: cloneRetailAdjustments(savedRetailAdjustments),
        draftRetailAdjustments: cloneRetailAdjustments(savedRetailAdjustments),
        baselineWarrantySections: cloneWarrantySections(savedWarrantySections),
        draftWarrantySections: cloneWarrantySections(savedWarrantySections),
      });
      const changeLabel =
        customerBreakdownMode === 'cost'
          ? 'Customer cost changes'
          : customerBreakdownMode === 'warranty'
          ? 'Warranty changes'
          : 'Customer cost and warranty changes';
      showToast({
        type: isPending ? 'warning' : 'success',
        message: isPending
          ? `${changeLabel} saved locally. Will sync when back online.`
          : savedWorkflowStatus === 'draft'
          ? `${changeLabel} saved. Resubmit when ready.`
          : `${changeLabel} saved.`,
      });
      return true;
    } catch (error) {
      console.error('Failed to save customer breakdown changes', error);
      const failureLabel =
        customerBreakdownMode === 'cost'
          ? 'customer cost changes'
          : customerBreakdownMode === 'warranty'
          ? 'warranty changes'
          : 'customer cost and warranty changes';
      showToast({ type: 'error', message: `Could not save ${failureLabel}.` });
      return false;
    } finally {
      setBreakdownSaving(false);
    }
  };

  const handleBreakdownExportToggle = () => {
    setBreakdownExportOpen((prev) => !prev);
  };

  const getBreakdownExportFilename = () => {
    const customerName =
      cogsModalView?.proposal?.customerInfo?.customerName ||
      customerModalView?.proposal?.customerInfo?.customerName ||
      proposal?.customerInfo?.customerName ||
      'Proposal';
    const today = new Date();
    const formattedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`;
    if (cogsModalView) {
      return `${customerName}-cogs-cost-breakdown-${formattedDate}.pdf`;
    }
    if (customerBreakdownMode === 'cost') {
      return `${customerName}-customer-cost-breakdown-${formattedDate}.pdf`;
    }
    if (customerBreakdownMode === 'warranty') {
      return `${customerName}-warranty-breakdown-${formattedDate}.pdf`;
    }
    return `${customerName}-job-cost-summary-warranty-${formattedDate}.pdf`;
  };

  const getBreakdownPrintPreviewMeta = (): BreakdownPrintPreviewMeta => {
    if (cogsModalView) {
      return {
        eyebrow: 'COGS Breakdown',
        title: 'COGS Cost Breakdown',
      };
    }

    if (customerBreakdownMode === 'cost') {
      return {
        eyebrow: 'Customer Cost Breakdown',
        title: 'Job Cost Summary',
      };
    }

    if (customerBreakdownMode === 'warranty') {
      return {
        eyebrow: 'Warranty Breakdown',
        title: 'Warranty & Inclusions',
      };
    }

    return {
      eyebrow: 'Customer Cost & Warranty Breakdown',
      title: 'Job Cost Summary & Warranty',
    };
  };

  const waitForBreakdownImages = async (root: HTMLElement | null) => {
    if (!root) return;
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img'));
    if (!images.length) return;

    await Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            if (image.complete) {
              resolve();
              return;
            }

            const finish = () => {
              image.removeEventListener('load', finish);
              image.removeEventListener('error', finish);
              resolve();
            };

            image.addEventListener('load', finish);
            image.addEventListener('error', finish);
          })
      )
    );
  };

  const prepareBreakdownExport = async () => {
    if (!loadedBreakdownExportPages) {
      const module = await loadBreakdownExportPages();
      setLoadedBreakdownExportPages(module);
    }
    setBreakdownExportActive(true);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (breakdownExportAreaRef.current?.querySelector('.export-breakdown-page')) {
        break;
      }
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    await document.fonts?.ready;
    await waitForBreakdownImages(breakdownExportAreaRef.current);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  };

  const renderBreakdownPrintPreviewPages = async (): Promise<string[]> => {
    const { default: html2canvas } = await import('html2canvas');
    const exportArea = breakdownExportAreaRef.current;
    const pages = exportArea
      ? Array.from(exportArea.querySelectorAll<HTMLElement>('.export-breakdown-page'))
      : [];
    if (!pages.length) {
      throw new Error('No breakdown pages available for print preview.');
    }

    const pageImages: string[] = [];
    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i], {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      pageImages.push(canvas.toDataURL('image/png'));
    }

    return pageImages;
  };

  const handleBreakdownPrint = async () => {
    if (breakdownExporting || breakdownSaving) return;
    setBreakdownExportOpen(false);
    if (customerBreakdownVersionId) {
      const saveSucceeded = await handleSaveCustomerBreakdownChanges();
      if (!saveSucceeded) return;
    }
    const filename = getBreakdownExportFilename();
    const previewMeta = getBreakdownPrintPreviewMeta();
    const previewWindow = openBreakdownPrintPreviewWindow(filename, previewMeta);
    let deferCleanupToAfterPrint = false;
    setBreakdownExporting(true);
    try {
      await prepareBreakdownExport();

      if (!previewWindow) {
        deferCleanupToAfterPrint = true;
        let didCleanup = false;
        const cleanup = () => {
          if (didCleanup) return;
          didCleanup = true;
          document.body.classList.remove('breakdown-print-mode');
          setBreakdownExportActive(false);
          setBreakdownExporting(false);
          window.removeEventListener('afterprint', cleanup);
        };

        document.body.classList.add('breakdown-print-mode');
        window.addEventListener('afterprint', cleanup);
        window.print();
        setTimeout(cleanup, 1200);
        return;
      }

      if (previewWindow.closed) {
        return;
      }

      const pageImages = await renderBreakdownPrintPreviewPages();
      if (previewWindow.closed) {
        return;
      }
      showBreakdownPrintPreviewPages(previewWindow, filename, previewMeta, pageImages);
    } catch (error) {
      console.error('Failed to prepare breakdown export', error);
      if (previewWindow && !previewWindow.closed) {
        showBreakdownPrintPreviewError(
          previewWindow,
          filename,
          previewMeta,
          'Could not open the breakdown print preview.'
        );
      }
      showToast({ type: 'error', message: 'Could not prepare breakdown export.' });
    } finally {
      if (deferCleanupToAfterPrint) {
        return;
      }
      setBreakdownExportActive(false);
      setBreakdownExporting(false);
    }
  };

  const exportBreakdownPdfFallback = async (filename: string) => {
    const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
    const exportArea = breakdownExportAreaRef.current;
    const pages = exportArea
      ? Array.from(exportArea.querySelectorAll('.export-breakdown-page'))
      : [];
    if (!pages.length) {
      throw new Error('No breakdown pages available for export.');
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < pages.length; i += 1) {
      const canvas = await html2canvas(pages[i] as HTMLElement, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      if (i > 0) {
        pdf.addPage();
      }
      pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
    }

    pdf.save(filename);
  };

  const exportBreakdownPdf = async () => {
    if (breakdownSaving) return;
    if (customerBreakdownVersionId) {
      const saveSucceeded = await handleSaveCustomerBreakdownChanges();
      if (!saveSucceeded) return;
    }
    const filename = getBreakdownExportFilename();
    setBreakdownExporting(true);
    try {
      await prepareBreakdownExport();
      document.body.classList.add('breakdown-print-mode');
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

      if (window.electron?.exportBreakdownPdf) {
        const result = await window.electron.exportBreakdownPdf({ filename });
        if (result?.canceled) return;
        if (!result?.filePath) throw new Error('No breakdown PDF file was saved.');
      } else {
        await exportBreakdownPdfFallback(filename);
      }

      showToast({ type: 'success', message: 'Breakdown PDF generated.' });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error('Failed to export breakdown PDF', error);
        showToast({ type: 'error', message: 'Could not export breakdown PDF.' });
      }
    } finally {
      document.body.classList.remove('breakdown-print-mode');
      setBreakdownExporting(false);
      setBreakdownExportActive(false);
    }
  };

  const handleBreakdownPdf = () => {
    if (breakdownExporting || breakdownSaving) return;
    setBreakdownExportOpen(false);
    void exportBreakdownPdf();
  };

  const handleContractSaveClick = () => {
    if (contractSaving || !contractViewReady) return;
    void contractViewRef.current?.saveOverrides();
  };

  const handleCustomerBreakdownSaveClick = () => {
    if (breakdownSaving || breakdownExporting || !canEditCustomerBreakdownVersion) return;
    void handleSaveCustomerBreakdownChanges();
  };

  const handleContractExportToggle = () => {
    if (contractExporting || contractSaving || !contractViewReady) return;
    setContractExportOpen((prev) => !prev);
  };

  const handleContractPrint = () => {
    setContractExportOpen(false);
    if (!contractViewRef.current) return;
    void contractViewRef.current.printContract();
  };

  const handleContractPdf = () => {
    setContractExportOpen(false);
    if (!contractViewRef.current) return;
    void contractViewRef.current.exportPdf();
  };

  const handleConfirmPendingUnsavedClose = async () => {
    if (pendingUnsavedCloseTarget === 'contract') {
      const saveSucceeded = await contractViewRef.current?.saveOverrides();
      if (saveSucceeded) {
        closeContractModal();
      }
      return;
    }

    if (pendingUnsavedCloseTarget === 'customer') {
      const saveSucceeded = await handleSaveCustomerBreakdownChanges();
      if (saveSucceeded) {
        closeCustomerBreakdownModal();
      }
    }
  };

  const handleDiscardPendingUnsavedClose = () => {
    if (pendingUnsavedCloseTarget === 'contract') {
      closeContractModal();
      return;
    }

    if (pendingUnsavedCloseTarget === 'customer') {
      closeCustomerBreakdownModal();
    }
  };

  const ensureVersionCanSubmitAddendum = async (version?: Proposal | null, container?: Proposal | null) => {
    if (!version || !container || !isEditableAddendumVersion(version)) {
      return true;
    }

    const baselineVersion = getSignedBaselineVersion(container);
    if (!versionsHaveMeaningfulDifferences(version, baselineVersion)) {
      showToast({ type: 'error', message: 'Proposal addendums must include changes before they can be submitted.' });
      return false;
    }

    const syncMeta = await resolveVersionSyncMetaForVersion(version, container);
    if (hasEquipmentChangeRequired(syncMeta?.equipmentFlags)) {
      showToast({ type: 'error', message: ADDENDUM_EQUIPMENT_CHANGE_REQUIRED_MESSAGE });
      return false;
    }

    return true;
  };

  const ensureVersionCanBeMarkedAsSigned = async (container?: Proposal | null, versionId?: string | null) => {
    if (!container) return false;
    const targetFranchiseId = container.franchiseId || proposal?.franchiseId || null;

    try {
      const isSignedWorkflowDisabled = targetFranchiseId
        ? await loadFranchiseSignedWorkflowDisabled(targetFranchiseId, { force: true })
        : disableSignedWorkflow;
      if (isSignedWorkflowDisabled) {
        showToast({ type: 'error', message: DISABLED_SIGNED_WORKFLOW_MESSAGE });
        return false;
      }
    } catch (error) {
      console.warn('Unable to verify signed workflow setting before marking proposal as signed:', error);
      if (disableSignedWorkflow) {
        showToast({ type: 'error', message: DISABLED_SIGNED_WORKFLOW_MESSAGE });
        return false;
      }
    }

    const targetVersionId = versionId || getApprovedVersionId(container) || getReviewVersionId(container);
    const targetVersion =
      listAllVersions(container).find((entry) => getVersionIdKey(entry) === (targetVersionId || 'original')) || null;

    if (!targetVersion) return false;

    const syncMeta = await resolveVersionSyncMetaForVersion(targetVersion, container);
    if (hasEquipmentChangeRequired(syncMeta?.equipmentFlags)) {
      showToast({ type: 'error', message: MARK_SIGNED_EQUIPMENT_CHANGE_REQUIRED_MESSAGE });
      return false;
    }

    return true;
  };

  const persistStatusChange = async (
    nextStatus: 'draft' | 'submitted',
    submissionRequest?: { manualReviewRequested: boolean; note: string },
    targetVersionId?: string
  ) => {
    if (!proposal) return;
    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const desiredActiveId =
        targetVersionId ||
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const normalizedVersions = all.map((v) => ({
        ...(mergeProposalWithDefaults(v) as Proposal),
        versions: [],
      }));
      const active =
        normalizedVersions.find((v) => (v.versionId || 'original') === desiredActiveId) ||
        normalizedVersions[0];
      if (!active) return;

      const draftContainer = buildContainerFromVersions(
        normalizedVersions,
        active.versionId || 'original',
        nextStatus === 'draft' ? 'draft' : getWorkflowStatus(proposal)
      );
      if (!draftContainer) return;

      if (nextStatus === 'submitted') {
        if (!active.customerInfo?.customerName?.trim()) {
          showToast({ type: 'error', message: 'Customer name is required to submit.' });
          return;
        }
        const validationErrors = validateProposal(active);
        if (validationErrors.length > 0) {
          showToast({
            type: 'error',
            message: `Validation errors: ${validationErrors.map((entry) => entry.message).join(', ')}`,
          });
          return;
        }
        const canSubmitAddendum = await ensureVersionCanSubmitAddendum(active, draftContainer);
        if (!canSubmitAddendum) {
          return;
        }
      }

      const container = draftContainer;
      const isSignedAddendumSubmission = getWorkflowStatus(container) === 'signed';
      const payload =
        nextStatus === 'submitted'
          ? submitProposalForWorkflow(container, active.versionId || 'original', {
              manualReviewRequested: submissionRequest?.manualReviewRequested,
              message: submissionRequest?.note,
            })
          : container;

      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(
        payload,
        nextStatus === 'submitted' ? { requireOnline: true } : undefined
      );
      const persistedActiveVersionId =
        nextStatus === 'submitted'
          ? isSignedAddendumSubmission
            ? (saved as Proposal).activeVersionId ||
              container.activeVersionId ||
              activeVersionId ||
              active.versionId ||
              'original'
            : active.versionId || 'original'
          : (saved as Proposal).activeVersionId || active.versionId || 'original';
      const savedWithPreferredActive =
        nextStatus === 'submitted'
          ? ({ ...(saved as Proposal), activeVersionId: persistedActiveVersionId } as Proposal)
          : (saved as Proposal);
      const updatedVersions = listAllVersions(savedWithPreferredActive as Proposal).map((v) => ({
        ...(mergeProposalWithDefaults(v) as Proposal),
        versionId: v.versionId || 'original',
        versionName: v.versionName || (v.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: v.isOriginalVersion,
        activeVersionId: persistedActiveVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(savedWithPreferredActive as Proposal));
      const isPending = (saved as any).syncStatus === 'pending';
      setVersions(updatedVersions);
      setActiveVersionId(persistedActiveVersionId);
      setProposal(activeApplied as Proposal);
      const savedWorkflowStatus = getWorkflowStatus(saved as Proposal);
      showToast({
        type: isPending ? 'warning' : 'success',
        message:
          nextStatus === 'submitted'
            ? isPending
              ? 'Saved locally. Will submit when back online.'
              : savedWorkflowStatus === 'needs_approval'
              ? isSignedAddendumSubmission
                ? 'Proposal addendum submitted for approval.'
                : 'Proposal submitted for approval.'
              : savedWorkflowStatus === 'approved'
              ? isSignedAddendumSubmission
                ? 'Proposal addendum submitted. Mark it as signed when ready.'
                : 'Proposal submitted. Mark it as signed when ready.'
              : 'Proposal submitted successfully.'
            : isPending
            ? 'Saved locally. Will sync when back online.'
            : 'Proposal saved as draft.',
      });
    } catch (error) {
      console.error('Failed to update proposal status', error);
      showToast({ type: 'error', message: 'Could not update proposal status.' });
    }
  };

  const handleOpenSubmitModal = (versionId?: string) => {
    if (!proposal) return;
    const preferredVersionId =
      versionId ||
      selectedVersionId ||
      activeVersionId ||
      (proposal as Proposal).activeVersionId ||
      (proposal as Proposal).versionId ||
      'original';
    const preferredOption = submitVersionOptions.find((option) => option.id === preferredVersionId);
    const fallbackOption = submitVersionOptions.find((option) => !option.disabled);
    setSubmitTargetVersionId(
      preferredOption && !preferredOption.disabled
        ? preferredOption.id
        : fallbackOption?.id || preferredVersionId
    );
    setSubmitManualReviewRequested(false);
    setSubmitNote('');
    setShowSubmitModal(true);
  };

  const handleOpenSignModal = (versionId?: string) => {
    if (isProposalEditingRestricted) return;
    const preferredVersionId =
      versionId ||
      selectedVersionId ||
      activeVersionId ||
      approvedVersionId ||
      approvedVersionIds[approvedVersionIds.length - 1] ||
      'original';
    const preferredOption = signVersionOptions.find((option) => option.id === preferredVersionId);
    const fallbackOption = signVersionOptions.find((option) => !option.disabled);
    setSignTargetVersionId(
      preferredOption && !preferredOption.disabled
        ? preferredOption.id
        : fallbackOption?.id || preferredVersionId
    );
    setShowMarkSignedConfirm(true);
  };

  useEffect(() => {
    if (!locationState?.openSignModal) {
      autoOpenedSignModalRef.current = false;
      return;
    }
    if (autoOpenedSignModalRef.current || loading || !proposal || isProposalEditingRestricted) return;
    autoOpenedSignModalRef.current = true;
    handleOpenSignModal(locationState.versionId);
  }, [isProposalEditingRestricted, loading, locationState?.openSignModal, locationState?.versionId, proposal]);

  const handleSubmitProposal = async (versionId?: string) => {
    if (!proposal || isOffline || isProposalEditingRestricted) return;
    const targetId =
      versionId ||
      selectedVersionId ||
      activeVersionId ||
      (proposal as Proposal).activeVersionId ||
      (proposal as Proposal).versionId ||
      'original';
    const all = versions.length ? versions : listAllVersions(proposal as Proposal);
    const targetVersion =
      all.find((entry) => (entry.versionId || 'original') === targetId) || proposal;
    const disabledReason = getSubmitVersionDisabledReason(targetVersion as Proposal);
    if (disabledReason) {
      showToast({ type: 'warning', message: disabledReason });
      return;
    }
    if (!targetVersion?.customerInfo?.customerName?.trim()) {
      showToast({ type: 'error', message: 'Customer name is required to submit.' });
      return;
    }
    const errors = validateProposal(targetVersion);
    if (errors.length > 0) {
      showToast({
        type: 'error',
        message: `Validation errors: ${errors.map((e) => e.message).join(', ')}`,
      });
      return;
    }

    const draftContainer = ensureProposalWorkflow(
      buildContainerFromVersions(
        all.map((entry) => ({ ...(entry as Proposal), versions: [] })),
        targetId,
        getWorkflowStatus(proposal)
      ) || (proposal as Proposal)
    );
    const canSubmitAddendum = await ensureVersionCanSubmitAddendum(targetVersion as Proposal, draftContainer);
    if (!canSubmitAddendum) {
      return;
    }

    handleOpenSubmitModal(targetId);
  };

  const handleConfirmSubmit = async () => {
    if (isOffline) return;
    setShowSubmitModal(false);
    await persistStatusChange('submitted', {
      manualReviewRequested: submitManualReviewRequested,
      note: submitManualReviewRequested ? submitNote : '',
    }, submitTargetVersionId || undefined);
    setSubmitTargetVersionId(null);
    setSubmitManualReviewRequested(false);
    setSubmitNote('');
  };

  const handleSendWorkflowMessage = async () => {
    const trimmedMessage = workflowMessageDraft.trim();
    if (!proposal || !canSendWorkflowMessages || !trimmedMessage || workflowMessageSaving || isOffline) return;

    setWorkflowMessageSaving(true);
    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const normalizedVersions = all.map((version) => ({
        ...(mergeProposalWithDefaults(version) as Proposal),
        versions: [],
      }));
      const desiredActiveId =
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const container = buildContainerFromVersions(normalizedVersions, desiredActiveId);
      if (!container) return;

      const payload = addWorkflowNote(container, trimmedMessage);
      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(payload, { requireOnline: true });
      const updatedVersions = listAllVersions(saved as Proposal).map((version) => ({
        ...(mergeProposalWithDefaults(version) as Proposal),
        versionId: version.versionId || 'original',
        versionName: version.versionName || (version.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: version.isOriginalVersion,
        activeVersionId: version.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));
      setVersions(updatedVersions);
      setActiveVersionId(activeApplied.activeVersionId || desiredActiveId);
      setProposal(activeApplied as Proposal);
      setWorkflowMessageDraft('');
      setShowWorkflowMessageComposer(false);
      showToast({
        type: 'success',
        message: 'Message sent.',
      });
    } catch (error) {
      console.error('Failed to send workflow message', error);
      showToast({ type: 'error', message: (error as any)?.message || 'Could not send message.' });
    } finally {
      setWorkflowMessageSaving(false);
    }
  };

  const persistReviewerWorkflowAction = async (
    buildPayload: (container: Proposal, note: string) => Proposal,
    successMessage: string,
    options?: { requiresNote?: boolean }
  ) => {
    if (isProposalEditingRestricted) {
      showToast({ type: 'warning', message: editDisabledReason || 'Master inspection mode is read-only.' });
      return false;
    }
    const trimmedMessage = workflowMessageDraft.trim();
    if (!proposal || reviewerActionSaving) return;
    if (options?.requiresNote && !trimmedMessage) {
      setShowWorkflowMessageComposer(true);
      return false;
    }

    setReviewerActionSaving(true);
    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const normalizedVersions = all.map((version) => ({
        ...(mergeProposalWithDefaults(version) as Proposal),
        versions: [],
      }));
      const desiredActiveId =
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const container = buildContainerFromVersions(normalizedVersions, desiredActiveId);
      if (!container) return;

      const payload = buildPayload(container, trimmedMessage);
      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(payload, { requireOnline: true });
      const updatedVersions = listAllVersions(saved as Proposal).map((version) => ({
        ...(mergeProposalWithDefaults(version) as Proposal),
        versionId: version.versionId || 'original',
        versionName: version.versionName || (version.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: version.isOriginalVersion,
        activeVersionId: version.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));

      setVersions(updatedVersions);
      setActiveVersionId(activeApplied.activeVersionId || desiredActiveId);
      setProposal(activeApplied as Proposal);
      setWorkflowMessageDraft('');
      setShowWorkflowMessageComposer(false);
      showToast({ type: 'success', message: successMessage });
      return true;
    } catch (error) {
      console.error('Failed to save reviewer workflow action', error);
      showToast({ type: 'error', message: (error as any)?.message || 'Could not save the workflow action.' });
      return false;
    } finally {
      setReviewerActionSaving(false);
    }
  };

  const handleReviewerApprove = async () => {
    if (isOffline) return;
    const didApprove = await persistReviewerWorkflowAction(
      (container) => approveWorkflowProposal(container, undefined),
      getSignedVersionId(proposal as Proposal) ? 'Proposal addendum approved.' : 'Proposal approved.'
    );
    if (didApprove) {
      handleReviewerBack();
    }
  };

  const handleReviewerRequestChanges = async () => {
    if (isOffline) return;
    await persistReviewerWorkflowAction(
      (container, note) => requestWorkflowChanges(container, note),
      'Proposal returned with requested changes.',
      { requiresNote: true }
    );
  };

  const handleReviewerComplete = async () => {
    if (proposalWorkflowStatus !== 'signed' || isOffline) return;
    await persistReviewerWorkflowAction(
      (container, note) => completeWorkflowProposal(container, note || undefined),
      'Proposal marked as completed.'
    );
  };

  const handleConfirmMarkProposalAsSigned = async () => {
    if (!proposal || isOffline || isProposalEditingRestricted) return;
    setReviewerActionSaving(true);
    try {
      const all = versions.length ? versions : listAllVersions(proposal as Proposal);
      const normalizedVersions = all.map((version) => ({
        ...(mergeProposalWithDefaults(version) as Proposal),
        versions: [],
      }));
      const desiredActiveId =
        activeVersionId ||
        (proposal as Proposal).activeVersionId ||
        (proposal as Proposal).versionId ||
        'original';
      const container = buildContainerFromVersions(normalizedVersions, desiredActiveId);
      if (!container) return;

      const targetVersion =
        listAllVersions(container).find((entry) => getVersionIdKey(entry) === (signTargetVersionId || '')) || null;
      const signDisabledReason = targetVersion ? getSignVersionDisabledReason(targetVersion) : 'Choose an approved version to sign.';
      if (signDisabledReason) {
        showToast({ type: 'warning', message: signDisabledReason });
        setShowMarkSignedConfirm(false);
        return;
      }

      const canMarkAsSigned = await ensureVersionCanBeMarkedAsSigned(container, signTargetVersionId || undefined);
      if (!canMarkAsSigned) {
        setShowMarkSignedConfirm(false);
        return;
      }

      await initPricingDataStore(
        container.franchiseId,
        container.pricingModelId || undefined,
        container.pricingModelFranchiseId || undefined,
        normalizePricingTierId(container.pricingTierId || container.pricingTierName),
        container.pricingModelRevisionId || undefined
      );
      const saved = await saveProposalRemote(
        markProposalAsSigned(container, undefined, signTargetVersionId || undefined),
        { requireOnline: true }
      );
      const updatedVersions = listAllVersions(saved as Proposal).map((version) => ({
        ...(mergeProposalWithDefaults(version) as Proposal),
        versionId: version.versionId || 'original',
        versionName: version.versionName || (version.isOriginalVersion ? 'Original Version' : 'Version'),
        isOriginalVersion: version.isOriginalVersion,
        activeVersionId: version.activeVersionId,
        versions: [],
      }));
      const activeApplied = ensureProposalWorkflow(applyActiveVersion(saved as Proposal));

      setVersions(updatedVersions);
      setActiveVersionId(activeApplied.activeVersionId || desiredActiveId);
      setProposal(activeApplied as Proposal);
      setShowMarkSignedConfirm(false);
      setSignTargetVersionId(null);
      showToast({ type: 'success', message: 'Proposal marked as signed.' });
    } catch (error) {
      console.error('Failed to mark proposal as signed', error);
      showToast({ type: 'error', message: (error as any)?.message || 'Could not mark the proposal as signed.' });
    } finally {
      setReviewerActionSaving(false);
    }
  };

  const formatCurrency = (value: number): string =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);

  const formatGrossMarginIndicator = (value?: number): string => {
    const safeValue = Number.isFinite(value) ? (value as number) : 0;
    const sign = safeValue < 0 ? '-' : '';
    const fixed = Math.abs(safeValue).toFixed(2);
    const [whole, decimal] = fixed.split('.');
    const paddedWhole = (whole || '0').padStart(2, '0');
    return `${sign}${paddedWhole}.${decimal}`;
  };

  const buildProposalIndicator = (value?: number): string =>
    `Proposal #26${formatGrossMarginIndicator(value)}`;

  const formatNumber = (value: number | undefined, suffix?: string): string => {
    if (!Number.isFinite(value)) return 'N/A';
    const num = value ?? 0;
    const formatted = num.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return suffix ? `${formatted} ${suffix}` : formatted;
  };

  const formatWorkflowStatusLabel = (value?: string | null) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'Draft';
    if (normalized === 'changes_requested') return 'Returned';
    return normalized.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
  };

  const formatSubmittedVersionLabel = (submissionCount: number) =>
    submissionCount > 1 ? 'Resubmitted' : 'Submitted';

  const getLatestWorkflowEventForVersion = (
    history: ProposalWorkflowEvent[],
    versionId: string,
    type: ProposalWorkflowEvent['type']
  ) =>
    [...history]
      .reverse()
      .find((entry) => entry.type === type && (entry.versionId || 'original') === versionId) || null;

  const formatWorkflowActorSummary = (
    actor?: ProposalWorkflowActor | null,
    at?: string | null,
    fallback = 'Not available'
  ) => {
    const actorLabel = actor?.name || actor?.email || '';
    if (!actorLabel && !at) return fallback;
    if (actorLabel && at) return `${actorLabel} - ${new Date(at).toLocaleString()}`;
    if (actorLabel) return actorLabel;
    return at ? new Date(at).toLocaleString() : fallback;
  };

  const getDisplayVersionLabel = (input: Proposal): string => {
    const name = input.versionName?.trim() || '';
    const versionId = input.versionId || 'original';
    const isOriginal = input.isOriginalVersion ?? versionId === 'original';

    if (isOriginal) {
      const lower = name.toLowerCase();
      if (!name || lower === 'version' || lower === 'original version') {
        return 'Original';
      }
      return name;
    }

    return name || 'Version';
  };

  const getContractTypeLabel = (input: Proposal): string => {
    const templateId = getContractTemplateIdForProposal(input);
    const [state, poolType] = templateId.split('-');
    const typeLabel = poolType === 'fiberglass' ? 'Fiberglass' : 'Shotcrete';
    return `${state.toUpperCase()} ${typeLabel}`;
  };

  const buildViewModel = (input: Proposal) => {
    const syncMeta = getCachedVersionSyncMeta(input) ?? getFrozenVersionSyncMeta(input);
    const livePricingSnapshot = syncMeta.pricingSnapshot;
    const canUsePricingSnapshot =
      Boolean(proposal) &&
      Boolean(livePricingSnapshot) &&
      syncMeta.priceModelStatus !== 'removed';
    let mergedProposal = canUsePricingSnapshot
      ? (withTemporaryPricingSnapshot(livePricingSnapshot!, () => mergeProposalWithDefaults(input)) as Proposal)
      : (input as Proposal);
    let calculated: ReturnType<typeof MasterPricingEngine.calculateCompleteProposal> | null = null;
    if (canUsePricingSnapshot) {
      try {
        calculated = withTemporaryPricingSnapshot(livePricingSnapshot!, () =>
          MasterPricingEngine.calculateCompleteProposal(mergedProposal, mergedProposal.papDiscounts)
        );
        const historicalReview = buildHistoricalPricingReview(mergedProposal, calculated);
        if (historicalReview) {
          mergedProposal = applyHistoricalPricingProtection(mergedProposal, historicalReview) as Proposal;
          calculated = withTemporaryPricingSnapshot(livePricingSnapshot!, () =>
            MasterPricingEngine.calculateCompleteProposal(mergedProposal, mergedProposal.papDiscounts)
          );
        }
      } catch (error) {
        console.error('Failed to recalculate proposal for view:', error);
      }
    }

    const costBreakdownForDisplay = normalizeCostBreakdownForDisplay(
      calculated?.costBreakdown || mergedProposal.costBreakdown,
      mergedProposal
    );
    const subtotal = calculated?.subtotal ?? mergedProposal.subtotal ?? 0;
    const totalCost = calculated?.totalCost ?? mergedProposal.totalCost ?? 0;
    const pricing = calculated?.pricing ?? mergedProposal.pricing;
    const offContractDeckingLineItems = costBreakdownForDisplay
      ? [
          ...(costBreakdownForDisplay.copingDeckingLabor || []),
          ...(costBreakdownForDisplay.copingDeckingMaterial || []),
        ]
      : [];
    const retailPrice = pricing?.retailPrice ?? totalCost ?? subtotal ?? 0;
    const offContractTotal =
      pricing?.offContractTotal ?? getOffContractTotal(mergedProposal, offContractDeckingLineItems);
    const retailPriceForMargin = Math.max(0, retailPrice - offContractTotal);
    const digCommission = pricing?.digCommission ?? 0;
    const adminFee = pricing?.adminFee ?? 0;
    const closeoutCommission = pricing?.closeoutCommission ?? 0;
    const totalCOGS =
      pricing?.totalCOGS ??
      costBreakdownForDisplay?.totals?.grandTotal ??
      totalCost ??
      subtotal ??
      0;
    const grossMargin =
      pricing?.grossProfitMargin ??
      (retailPriceForMargin > 0 ? ((retailPriceForMargin - totalCOGS) / retailPriceForMargin) * 100 : 0);
    const papDiscountTotal = costBreakdownForDisplay
      ? Object.entries(costBreakdownForDisplay).reduce((sum, [key, value]) => {
          if (key === 'totals') return sum;
          if (Array.isArray(value)) {
            const papSum = value.reduce((innerSum, item) => {
              const description = (item.description || '').toString().toLowerCase();
              return description.includes('pap discount') ? innerSum + (item.total ?? 0) : innerSum;
            }, 0);
            return sum + papSum;
          }
          return sum;
        }, 0)
      : 0;

    const overheadMultiplier = pricing?.overheadMultiplier ?? 1.01;
    const totalCOGSBeforeOverhead =
      pricing?.totalCostsBeforeOverhead ??
      (overheadMultiplier > 0 ? totalCOGS / overheadMultiplier : totalCOGS);
    const totalCOGSWithoutOverhead = Math.max(totalCOGSBeforeOverhead, 0);
    const overheadReductionFactor =
      totalCOGS > 0 ? Math.min(Math.max(totalCOGSWithoutOverhead / totalCOGS, 0), 1) : 1;
    const preOverheadGrossProfit =
      retailPriceForMargin - totalCOGSWithoutOverhead - digCommission - adminFee - closeoutCommission;
    const overheadDifferential = totalCOGS - totalCOGSWithoutOverhead;
    const preOverheadGrossMarginPercent =
      retailPriceForMargin > 0 ? (preOverheadGrossProfit / retailPriceForMargin) * 100 : 0;
    const targetMargin = pricing?.targetMargin ?? 0.7;
    const costsBeforePapDiscounts = (pricing?.totalCostsBeforeOverhead ?? subtotal ?? 0) - papDiscountTotal;
    const baseRetailPriceBeforePap =
      Math.ceil(((costsBeforePapDiscounts * overheadMultiplier) / targetMargin) / 10) * 10;
    const g3UpgradeCost = pricing?.g3UpgradeCost ?? 0;
    const retailPriceBeforeDiscounts = baseRetailPriceBeforePap + g3UpgradeCost + offContractTotal;
    const retailSalePrice = retailPrice;
    const totalSavings = retailPriceBeforeDiscounts - retailSalePrice;
    const totalSavingsPercent = retailPriceBeforeDiscounts > 0 ? (totalSavings / retailPriceBeforeDiscounts) * 100 : 0;

    const displayNumber = mergedProposal.proposalNumber.replace('PROP-', '');
    const submissionDate = new Date(
      mergedProposal.createdDate || mergedProposal.lastModified || Date.now()
    ).toLocaleDateString();

    const customerLocation = mergedProposal.customerInfo.city
      ? `${mergedProposal.customerInfo.customerName} (${mergedProposal.customerInfo.city})`
      : mergedProposal.customerInfo.customerName;

    const proposalStatus = mergedProposal.status ? mergedProposal.status.charAt(0).toUpperCase() + mergedProposal.status.slice(1) : 'Draft';
    const dateModified = new Date(mergedProposal.lastModified || Date.now()).toLocaleDateString();

    // Designer name - using a placeholder for now, update with actual field when available
    const designerName = 'Design Team';

    // Get the pricing model used for this proposal
    const priceModel = mergedProposal.pricingModelName || 'No Pricing Model';
    const priceModelStatus = syncMeta.priceModelStatus;
    const isPriceModelActive = priceModelStatus === 'active';
    const isPriceModelRemoved = priceModelStatus === 'removed';
    const equipmentFlags = syncMeta.equipmentFlags;
    const hasEquipmentChangeRequiredForVersion = hasEquipmentChangeRequired(equipmentFlags);

    const poolTypeLabel =
      mergedProposal.poolSpecs.poolType === 'gunite'
        ? 'Shotcrete (Custom)'
        : mergedProposal.poolSpecs.fiberglassModelName
        ? `Fiberglass - ${mergedProposal.poolSpecs.fiberglassModelName}`
        : 'Fiberglass';

    const approximateGallons = Number.isFinite(mergedProposal.poolSpecs.approximateGallons)
      ? mergedProposal.poolSpecs.approximateGallons.toLocaleString('en-US')
      : 'N/A';

    const hasSpaSelected = mergedProposal.poolSpecs.spaType !== 'none';
    const hasIntegratedFiberglassSpa =
      mergedProposal.poolSpecs.poolType === 'fiberglass' &&
      mergedProposal.poolSpecs.spaType === 'none' &&
      (mergedProposal.plumbing?.runs?.spaRun ?? 0) > 0;
    const showFiberglassSpaSummary =
      mergedProposal.poolSpecs.spaType === 'fiberglass' || hasIntegratedFiberglassSpa;
    const maxWidth = formatNumber(mergedProposal.poolSpecs.maxWidth, 'ft');
    const maxLength = formatNumber(mergedProposal.poolSpecs.maxLength, 'ft');
    const shallowDepth = formatNumber(mergedProposal.poolSpecs.shallowDepth, 'ft');
    const endDepth = formatNumber(mergedProposal.poolSpecs.endDepth, 'ft');
    const spaLengthLabel = showFiberglassSpaSummary ? 'Spa' : 'Spa Length';
    const spaLength = showFiberglassSpaSummary
      ? 'Fiberglass Spa'
      : hasSpaSelected
      ? formatNumber(mergedProposal.poolSpecs.spaLength, 'ft')
      : 'No Spa';
    const spaWidthLabel = 'Spa Width';
    const spaWidth = hasSpaSelected && !showFiberglassSpaSummary
      ? formatNumber(mergedProposal.poolSpecs.spaWidth, 'ft')
      : 'No Spa';
    const equipmentSummary = buildEquipmentSummary(mergedProposal.equipment, equipmentFlags);

    const tileLaborItems = costBreakdownForDisplay?.tileLabor || [];
    const tileMaterialItems = costBreakdownForDisplay?.tileMaterial || [];
    const { baseItems: tileLaborBase, customOptions: tileCustomFromLabor } = splitCustomOptions(tileLaborItems);
    const { baseItems: tileMaterialBase, customOptions: tileCustomFromMaterial } = splitCustomOptions(tileMaterialItems);
    const tileCustomOptions = [...tileCustomFromLabor, ...tileCustomFromMaterial];
    const offContractItemGroups = getOffContractItemGroups(mergedProposal, offContractDeckingLineItems);
    const offContractItemCount = offContractItemGroups.reduce((sum, group) => sum + group.items.length, 0);

    const costLineItems: {
      name: string;
      items: CostLineItem[];
      subcategories?: { name: string; items: CostLineItem[] }[];
      hideBaseItems?: boolean;
    }[] = costBreakdownForDisplay
      ? [
          { name: 'Plans & Engineering', items: costBreakdownForDisplay.plansAndEngineering },
          { name: 'Layout', items: costBreakdownForDisplay.layout },
          { name: 'Permit', items: costBreakdownForDisplay.permit },
          {
            name: 'Excavation',
            items: costBreakdownForDisplay.excavation,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.excavation),
          },
          {
            name: 'Plumbing',
            items: costBreakdownForDisplay.plumbing,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.plumbing),
          },
          { name: 'Gas', items: costBreakdownForDisplay.gas },
          { name: 'Steel', items: costBreakdownForDisplay.steel },
          {
            name: 'Electrical',
            items: costBreakdownForDisplay.electrical,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.electrical),
          },
          {
            name: 'Shotcrete',
            items: [...costBreakdownForDisplay.shotcreteLabor, ...costBreakdownForDisplay.shotcreteMaterial],
            subcategories: [
              { name: 'Labor', items: costBreakdownForDisplay.shotcreteLabor },
              { name: 'Material', items: costBreakdownForDisplay.shotcreteMaterial },
            ].filter((sub) => sub.items.length > 0),
            hideBaseItems: true,
          },
          {
            name: 'Tile',
            items: [...tileLaborItems, ...tileMaterialItems],
            subcategories: [
              { name: 'Labor', items: tileLaborBase },
              { name: CUSTOM_OPTIONS_SUBCATEGORY, items: tileCustomOptions },
              { name: 'Material', items: tileMaterialBase },
            ].filter((sub) => sub.items.length > 0),
            hideBaseItems: true,
          },
          {
            name: 'Coping/Decking',
            items: [
              ...costBreakdownForDisplay.copingDeckingLabor,
              ...costBreakdownForDisplay.copingDeckingMaterial,
            ],
            subcategories: [
              { name: 'Labor', items: costBreakdownForDisplay.copingDeckingLabor },
              { name: 'Material', items: costBreakdownForDisplay.copingDeckingMaterial },
            ].filter((sub) => sub.items.length > 0),
            hideBaseItems: true,
          },
          {
            name: 'Stone/Rockwork',
            items: [
              ...costBreakdownForDisplay.stoneRockworkLabor,
              ...costBreakdownForDisplay.stoneRockworkMaterial,
            ],
            subcategories: [
              { name: 'Labor', items: costBreakdownForDisplay.stoneRockworkLabor },
              { name: 'Material', items: costBreakdownForDisplay.stoneRockworkMaterial },
            ].filter((sub) => sub.items.length > 0),
            hideBaseItems: true,
          },
          {
            name: 'Drainage',
            items: costBreakdownForDisplay.drainage,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.drainage),
          },
          {
            name: 'Water Features',
            items: costBreakdownForDisplay.waterFeatures,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.waterFeatures),
          },
          { name: 'Equipment Ordered', items: costBreakdownForDisplay.equipmentOrdered },
          {
            name: 'Equipment Set',
            items: costBreakdownForDisplay.equipmentSet,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.equipmentSet),
          },
          { name: 'Cleanup', items: costBreakdownForDisplay.cleanup },
          {
            name: 'Interior Finish',
            items: costBreakdownForDisplay.interiorFinish,
            subcategories: buildLineItemSubcategories(costBreakdownForDisplay.interiorFinish),
          },
          { name: 'Water Truck', items: costBreakdownForDisplay.waterTruck },
          { name: 'Fiberglass Shell', items: costBreakdownForDisplay.fiberglassShell },
          { name: 'Fiberglass Install', items: costBreakdownForDisplay.fiberglassInstall },
          { name: 'Startup/Orientation', items: costBreakdownForDisplay.startupOrientation },
          { name: 'Custom Features', items: costBreakdownForDisplay.customFeatures },
        ].filter((category) => (category.items || []).length > 0)
      : [];

    const adjustItemForNoOverhead = (item: CostLineItem): CostLineItem => ({
      ...item,
      unitPrice: (item.unitPrice ?? 0) * overheadReductionFactor,
      total: (item.total ?? 0) * overheadReductionFactor,
    });

    const preOverheadCostLineItems = costLineItems.map((category) => ({
      ...category,
      items: category.items.map(adjustItemForNoOverhead),
      subcategories: category.subcategories?.map((sub) => ({
        ...sub,
        items: sub.items.map(adjustItemForNoOverhead),
      })),
      hideBaseItems: category.hideBaseItems,
    }));

    return {
      proposal: mergedProposal,
      calculated,
      costBreakdownForDisplay,
      subtotal,
      totalCost,
      pricing,
      retailPrice,
      digCommission,
      adminFee,
      closeoutCommission,
      totalCOGS,
      grossMargin,
      papDiscountTotal,
      overheadMultiplier,
      totalCOGSBeforeOverhead,
      totalCOGSWithoutOverhead,
      overheadReductionFactor,
      preOverheadGrossProfit,
      overheadDifferential,
      preOverheadGrossMarginPercent,
      targetMargin,
      costsBeforePapDiscounts,
      baseRetailPriceBeforePap,
      g3UpgradeCost,
      retailPriceBeforeDiscounts,
      retailSalePrice,
      totalSavings,
      totalSavingsPercent,
      displayNumber,
      submissionDate,
      customerLocation,
      proposalStatus,
      dateModified,
      designerName,
      priceModel,
      isPriceModelActive,
      isPriceModelRemoved,
      priceModelStatus,
      hasEquipmentChangeRequired: hasEquipmentChangeRequiredForVersion,
      poolTypeLabel,
      approximateGallons,
      maxWidth,
      maxLength,
      shallowDepth,
      endDepth,
      spaLengthLabel,
      spaLength,
      spaWidthLabel,
      spaWidth,
      showFiberglassSpaSummary,
      ...equipmentSummary,
      offContractTotal,
      offContractItemGroups,
      offContractItemCount,
      costLineItems,
      preOverheadCostLineItems,
    };
  };

  if (loading) {
    return (
      <div className="proposal-view">
        <div className="loading-container">Loading proposal...</div>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="proposal-view">
        <div className="error-container">
          <h2>Proposal not found</h2>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const allVersionsForRender = versions.length
    ? versions
    : proposal
    ? listAllVersions(proposal as Proposal)
    : [];

  const displayVersionContainer =
    proposal && allVersionsForRender.length
      ? buildContainerFromVersions(
          allVersionsForRender.map((entry) => ({ ...(entry as Proposal), versions: [] })),
          (proposal as Proposal).activeVersionId || activeVersionId
        ) || (proposal as Proposal)
      : proposal;

  const versionsForRender = isReadOnlyReviewerView && displayVersionContainer
    ? getReviewerVisibleVersions(displayVersionContainer as Proposal)
    : allVersionsForRender;
  const approvedVersionIds = proposal ? getApprovedVersionIds(proposal as Proposal) : [];
  const approvedVersionId = proposal ? getApprovedVersionId(proposal as Proposal) : null;
  const signedVersionId = proposal ? getSignedVersionId(proposal as Proposal) : null;
  const signedAddendumVersionIds = proposal ? getSignedAddendumVersionIds(proposal as Proposal) : [];
  const latestSignedBaselineVersionId = proposal ? getLatestSignedBaselineVersionId(proposal as Proposal) : null;
  const signedChainVersionIds = new Set<string>(
    [signedVersionId, ...signedAddendumVersionIds].filter((entry): entry is string => Boolean(entry))
  );
  const livePublishedVersionId =
    proposalWorkflowStatus === 'signed'
      ? latestSignedBaselineVersionId || approvedVersionId
      : getPendingReviewVersionId(proposal as Proposal) || approvedVersionId;
  const isArchivedVersion = (version?: Partial<Proposal> | null) => {
    if (!version || !hasSignedBaseline) return false;
    const versionId = getVersionIdKey(version);
    if (signedChainVersionIds.has(versionId)) return false;

    const versionName = String(version.versionName || '').trim().toLowerCase();
    if (versionName.includes('addendum')) return false;

    const signedTimestamp = Date.parse(String(proposal?.workflow?.signedAt || ''));
    const versionTimestamp = Date.parse(String(version.createdDate || version.lastModified || ''));
    if (Number.isFinite(signedTimestamp) && Number.isFinite(versionTimestamp) && versionTimestamp > signedTimestamp) {
      return false;
    }

    return true;
  };
  const existingEditableAddendumVersion =
    proposalWorkflowStatus === 'signed' && livePublishedVersionId && !isReadOnlyReviewerView
      ? allVersionsForRender.find(
          (entry) =>
            (entry.versionId || 'original') !== livePublishedVersionId &&
            !isVersionPermanentlyLocked(entry)
        ) || null
      : null;
  const renderPrimaryVersionId =
    (isReadOnlyReviewerView ? getReviewerPrimaryVersionId(displayVersionContainer as Proposal) : activeVersionId) ||
    activeVersionId ||
    (proposal as Proposal).activeVersionId ||
    (proposal as Proposal).versionId ||
    'original';
  const sortVersionsByCreatedDateDesc = (left: Proposal, right: Proposal) => {
    const leftCreated = new Date(left.createdDate || left.lastModified || 0).getTime();
    const rightCreated = new Date(right.createdDate || right.lastModified || 0).getTime();
    if (leftCreated !== rightCreated) return rightCreated - leftCreated;

    const leftUpdated = new Date(left.lastModified || left.createdDate || 0).getTime();
    const rightUpdated = new Date(right.lastModified || right.createdDate || 0).getTime();
    return rightUpdated - leftUpdated;
  };

  const navigationVersions = [...versionsForRender].sort(sortVersionsByCreatedDateDesc);
  const viewModels = navigationVersions.map((v) => buildViewModel(v));
  const activeNavigationViewModels = viewModels.filter((vm) => !isArchivedVersion(vm.proposal));
  const archivedNavigationViewModels = viewModels.filter((vm) => isArchivedVersion(vm.proposal));
  const versionMap = new Map<string, ReturnType<typeof buildViewModel>>();
  viewModels.forEach((vm) => {
    versionMap.set(vm.proposal.versionId || 'original', vm);
  });
  const displayPrimaryVersionId = renderPrimaryVersionId;
  const resolvedSelectedVersionId =
    selectedVersionId && versionMap.has(selectedVersionId)
      ? selectedVersionId
      : versionMap.has(displayPrimaryVersionId)
      ? displayPrimaryVersionId
      : viewModels[0]?.proposal.versionId || 'original';
  const selectedView = versionMap.get(resolvedSelectedVersionId) || viewModels[0];
  const workflowHistory = [...(proposal?.workflow?.history || [])].sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );
  const submissionCount = workflowHistory.filter((entry) => entry.type === 'submitted').length;
  const submittedVersionId =
    livePublishedVersionId ||
    proposal?.workflow?.submittedVersionId ||
    getPendingReviewVersionId(proposal as Proposal) ||
    null;
  const submittedVersionLabel =
    proposalWorkflowStatus === 'signed'
      ? 'Signed'
      : proposalWorkflowStatus === 'approved'
      ? 'Approved'
      : formatSubmittedVersionLabel(submissionCount);
  const activeVersionCanComplete = !isProposalEditingRestricted && proposalWorkflowStatus === 'signed';
  const completeActionDisabledReason = isProposalEditingRestricted
    ? editDisabledReason
    : isOffline
    ? offlineActionDisabledReason
    : activeVersionCanComplete
    ? undefined
    : 'A proposal version must be signed before the proposal can be completed.';
  const versionActionLabel =
    proposalWorkflowStatus === 'signed' ? 'Create Proposal Addendum' : 'Build Another Version';
  const buildVersionDisabledReason =
    !canManageVersionDrafts
      ? editDisabledReason
      : proposalWorkflowStatus === 'signed' && existingEditableAddendumVersion
      ? 'A proposal addendum is already in progress. Continue working in that version before creating another addendum.'
      : undefined;
  const isEditableAddendumVersion = (version?: Partial<Proposal> | null) => {
    if (!hasSignedBaseline || !version) return false;
    return (
      !isVersionPermanentlyLocked(version) &&
      getVersionIdKey(version) !== (livePublishedVersionId || '')
    );
  };
  const primaryView = versionMap.get(displayPrimaryVersionId) || viewModels[0];
  const selectedViewModel = selectedView || primaryView;
  const selectedVersionIdKey = selectedViewModel?.proposal.versionId || 'original';
  const signableApprovedVersionIds = approvedVersionIds.filter(
    (versionId) => !hasEquipmentChangeRequired(versionSyncMeta[versionId]?.equipmentFlags)
  );
  const isFeenstraMay11Contract =
    proposal?.proposalNumber === FEENSTRA_PROPOSAL_NUMBER &&
    proposal?.calculationProfile === FEENSTRA_MAY_2026_CALCULATION_PROFILE;
  const versionCreationSourceOptions: WorkflowVersionOption[] =
    proposalWorkflowStatus === 'signed'
      ? []
      : [
          ...(isFeenstraMay11Contract
            ? []
            : [
                {
                  id: SCRATCH_VERSION_SOURCE_ID,
                  label: 'Start from Scratch',
                },
              ]),
          ...activeNavigationViewModels.map((vm) => ({
            id: vm.proposal.versionId || 'original',
            label: `Start from Copy of ${getDisplayVersionLabel(vm.proposal)}`,
          })),
        ];
  const selectedVersionRecordStatus = getVersionRecordStatus(selectedViewModel?.proposal);
  const selectedVersionSubmittedEvent = getLatestWorkflowEventForVersion(
    workflowHistory,
    selectedVersionIdKey,
    'submitted'
  );
  const selectedVersionApprovedEvent = getLatestWorkflowEventForVersion(
    workflowHistory,
    selectedVersionIdKey,
    'approved'
  );
  const selectedVersionSignedEvent = getLatestWorkflowEventForVersion(
    workflowHistory,
    selectedVersionIdKey,
    'signed'
  );
  const selectedVersionCompletedEvent = getLatestWorkflowEventForVersion(
    workflowHistory,
    selectedVersionIdKey,
    'completed'
  );
  const selectedVersionStatusLabel =
    selectedViewModel &&
    hasSignedBaseline &&
    isEditableAddendumVersion(selectedViewModel.proposal) &&
    selectedVersionRecordStatus === 'draft'
      ? 'Addendum Draft'
      : formatWorkflowStatusLabel(selectedVersionRecordStatus);
  const selectedVersionStatusTone =
    selectedViewModel &&
    hasSignedBaseline &&
    isEditableAddendumVersion(selectedViewModel.proposal) &&
    selectedVersionRecordStatus === 'draft'
      ? 'draft'
      : selectedVersionRecordStatus;
  const selectedWorkflowStatusTooltip =
    selectedViewModel &&
    hasSignedBaseline &&
    isEditableAddendumVersion(selectedViewModel.proposal) &&
    selectedVersionRecordStatus === 'draft'
      ? 'This proposal addendum is still a draft. Submit it, then mark it as signed when ready to make it the next signed baseline.'
      : selectedVersionRecordStatus === 'needs_approval'
      ? 'This proposal version is submitted and awaiting approval.'
      : !hasSignedBaseline &&
        selectedVersionRecordStatus === 'draft' &&
        hasVersionSubmissionHistory(proposal as Proposal, selectedVersionIdKey)
      ? 'This proposal version was edited after submission and must be resubmitted before it can be signed.'
      : selectedVersionRecordStatus === 'changes_requested'
      ? 'Changes were requested for this version. Continue editing and resubmit when ready.'
      : selectedVersionRecordStatus === 'signed'
      ? 'This proposal version is signed. Future changes must be added as proposal addendums.'
      : selectedVersionRecordStatus === 'approved'
      ? 'This proposal version was approved and can still be marked as signed.'
      : selectedVersionRecordStatus === 'completed'
      ? 'This proposal version is complete.'
      : undefined;
  const selectedWorkflowReasons = (
    (selectedVersionSubmittedEvent?.metadata?.reasons as Array<{ code?: string; label?: string; detail?: string }> | undefined) || []
  ).filter((reason) => reason.code !== 'manual_review' && reason.label);
  const selectedVersionSubmittedAt =
    selectedVersionSubmittedEvent?.createdAt || selectedViewModel?.proposal.versionSubmittedAt || null;
  const selectedVersionSubmittedBy =
    selectedVersionSubmittedEvent?.actor || selectedViewModel?.proposal.versionSubmittedBy || null;
  const selectedVersionApprovalAt = selectedVersionApprovedEvent?.createdAt || null;
  const selectedVersionApprovalBy = selectedVersionApprovedEvent?.actor || null;
  const selectedVersionSignedAt = selectedVersionSignedEvent?.createdAt || null;
  const selectedVersionSignedBy = selectedVersionSignedEvent?.actor || null;
  const selectedVersionCompletedAt = selectedVersionCompletedEvent?.createdAt || null;
  const selectedVersionCompletedBy = selectedVersionCompletedEvent?.actor || null;
  const customerModalView = customerBreakdownVersionId
    ? versionMap.get(customerBreakdownVersionId) || primaryView
    : null;
  const cogsModalView = cogsBreakdownVersionId
    ? versionMap.get(cogsBreakdownVersionId) || primaryView
    : null;
  const preCogsModalView = preCogsBreakdownVersionId
    ? versionMap.get(preCogsBreakdownVersionId) || primaryView
    : null;
  const offContractModalView = offContractVersionId
    ? versionMap.get(offContractVersionId) || primaryView
    : null;
  const contractModalView = contractVersionId ? versionMap.get(contractVersionId) || primaryView : null;
  const contractVersionRecordStatus = getVersionRecordStatus(contractModalView?.proposal);
  const contractHasUnsavedChanges =
    contractDirty || Boolean(contractViewRef.current?.hasUnsavedChanges);
  const canEditContractVersion =
    canManageVersionDrafts &&
    Boolean(contractModalView?.proposal) &&
    !isVersionPermanentlyLocked(contractModalView?.proposal);
  const contractEditDisabledReason =
    !canManageVersionDrafts
      ? editDisabledReason
      : contractVersionRecordStatus === 'signed'
      ? 'Signed proposal versions are locked. Use Create Proposal Addendum to create an addendum draft.'
      : contractVersionRecordStatus === 'completed'
      ? 'Completed proposal versions are locked.'
      : undefined;
  const customerVersionRecordStatus = getVersionRecordStatus(customerModalView?.proposal);
  const canEditCustomerBreakdownVersion =
    canManageVersionDrafts &&
    Boolean(customerModalView?.proposal) &&
    !isVersionPermanentlyLocked(customerModalView?.proposal);
  const customerBreakdownEditDisabledReason =
    !canManageVersionDrafts
      ? editDisabledReason
      : customerVersionRecordStatus === 'signed'
      ? 'Signed proposal versions are locked. Use Create Proposal Addendum to create an addendum draft.'
      : customerVersionRecordStatus === 'completed'
      ? 'Completed proposal versions are locked.'
      : undefined;
  const customerRetailBreakdownDirty = Boolean(customerBreakdownEditor) &&
    !areRetailAdjustmentsEqual(
      customerBreakdownEditor?.draftRetailAdjustments,
      customerBreakdownEditor?.baselineRetailAdjustments
    );
  const customerWarrantyBreakdownDirty = Boolean(customerBreakdownEditor) &&
    !areWarrantySectionsEqual(
      customerBreakdownEditor?.draftWarrantySections ?? null,
      customerBreakdownEditor?.baselineWarrantySections ?? null
    );
  const customerBreakdownDirty =
    customerBreakdownMode === 'cost'
      ? customerRetailBreakdownDirty
      : customerBreakdownMode === 'warranty'
      ? customerWarrantyBreakdownDirty
      : customerRetailBreakdownDirty || customerWarrantyBreakdownDirty;
  const customerBreakdownPreviewProposal =
    customerModalView && customerBreakdownEditor &&
    customerBreakdownEditor.versionId === (customerModalView.proposal.versionId || 'original')
      ? {
          ...customerModalView.proposal,
          retailAdjustments: customerBreakdownEditor.draftRetailAdjustments,
          warrantySections: customerBreakdownEditor.draftWarrantySections,
        }
      : customerModalView?.proposal;
  const customerBreakdownPreviewView = customerBreakdownPreviewProposal
    ? buildViewModel(customerBreakdownPreviewProposal as Proposal)
    : customerModalView;
  const closeContractModal = () => {
    setPendingUnsavedCloseTarget(null);
    setContractExportOpen(false);
    setContractVersionId(null);
    setActiveContractRevision(null);
  };
  const closeCustomerBreakdownModal = () => {
    setPendingUnsavedCloseTarget(null);
    setBreakdownExportOpen(false);
    setCustomerBreakdownEditor(null);
    setCustomerBreakdownVersionId(null);
    setCustomerBreakdownMode('combined');
  };
  const requestContractModalClose = () => {
    if (contractSaving) return;
    if (contractHasUnsavedChanges) {
      setPendingUnsavedCloseTarget('contract');
      return;
    }
    closeContractModal();
  };
  const requestCustomerBreakdownModalClose = () => {
    if (breakdownSaving) return;
    if (customerBreakdownDirty) {
      setPendingUnsavedCloseTarget('customer');
      return;
    }
    closeCustomerBreakdownModal();
  };
  const handleOpenCustomerBreakdown = (
    input: Proposal,
    mode: CustomerBreakdownMode = 'combined'
  ) => {
    setPendingUnsavedCloseTarget(null);
    setBreakdownSaving(false);
    setCustomerBreakdownEditor(createCustomerBreakdownEditorState(input));
    setCustomerBreakdownMode(mode);
    setCustomerBreakdownVersionId(input.versionId || 'original');
  };
  const submitTargetVersion =
    (submitTargetVersionId
      ? allVersionsForRender.find((entry) => (entry.versionId || 'original') === submitTargetVersionId)
      : activeEditableVersion) || proposal;
  const signTargetVersion =
    (signTargetVersionId
      ? allVersionsForRender.find((entry) => (entry.versionId || 'original') === signTargetVersionId)
      : null) || null;
  const renameTargetVersion =
    (renameTargetVersionId
      ? allVersionsForRender.find((entry) => (entry.versionId || 'original') === renameTargetVersionId)
      : null) || null;
  const isRenamingVersion = versionNameModalMode === 'rename';
  const submitPreview = submitTargetVersion
    ? getWorkflowSubmissionPreview(submitTargetVersion as Proposal, {
        manualReviewRequested: submitManualReviewRequested,
        message: submitManualReviewRequested ? submitNote : '',
      })
    : null;
  const isSubmittingSignedAddendum =
    isEditableAddendumVersion(submitTargetVersion);
  const shouldRenderBreakdownExport = breakdownExportActive || breakdownExporting;
  const ContractViewComponent = loadedContractView;
  const BreakdownCostExportPageComponent = loadedBreakdownExportPages?.BreakdownCostExportPage;
  const BreakdownCogsExportPagesComponent = loadedBreakdownExportPages?.BreakdownCogsExportPages;
  const BreakdownWarrantyExportPagesComponent = loadedBreakdownExportPages?.BreakdownWarrantyExportPages;

  const categoryTotal = (items: CostLineItem[] = []): number =>
    items.reduce((sum, item) => sum + (isOffContractLineItem(item) ? 0 : (item.total ?? 0)), 0);

  const isTaxLineItem = (item: CostLineItem): boolean =>
    (item.description || '').toLowerCase().includes('tax');

  const renderQuantity = (item: CostLineItem): string => {
    if (isTaxLineItem(item)) return '';
    return (item.quantity ?? 0).toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });
  };

  const renderUnitPrice = (item: CostLineItem): string => {
    if (isTaxLineItem(item)) return '';
    return formatCurrency(item.unitPrice);
  };

  const renderTotal = (item: CostLineItem): string =>
    isOffContractLineItem(item) ? 'OFF CONTRACT' : formatCurrency(item.total);

  const formatVersionDateTime = (value?: string | null): string => {
    if (!value) return 'Unknown';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Unknown';
    return parsed.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const getSignedBaselineVersion = (container?: Proposal | null) => {
    if (!container) return null;
    const baselineVersionId = getLatestSignedBaselineVersionId(container);
    if (!baselineVersionId) return null;
    return (
      listAllVersions(container).find((entry) => (entry.versionId || 'original') === baselineVersionId) || null
    );
  };

  const buildComparableVersionSnapshot = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => buildComparableVersionSnapshot(entry));
    }
    if (value && typeof value === 'object') {
      const ignoredKeys = new Set([
        'activeVersionId',
        'createdDate',
        'isOriginalVersion',
        'lastModified',
        'proposalNumber',
        'status',
        'syncMessage',
        'syncStatus',
        'versionId',
        'versionLocked',
        'versionLockedAt',
        'versionName',
        'versionSubmittedAt',
        'versionSubmittedBy',
        'versions',
        'workflow',
      ]);
      return Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !ignoredKeys.has(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .reduce<Record<string, unknown>>((accumulator, [key, entryValue]) => {
          accumulator[key] = buildComparableVersionSnapshot(entryValue);
          return accumulator;
        }, {});
    }
    return value ?? null;
  };

  const versionsHaveMeaningfulDifferences = (
    candidateVersion?: Proposal | null,
    baselineVersion?: Proposal | null
  ) => {
    if (!candidateVersion || !baselineVersion) return true;
    return (
      JSON.stringify(buildComparableVersionSnapshot(candidateVersion)) !==
      JSON.stringify(buildComparableVersionSnapshot(baselineVersion))
    );
  };

  const getVersionStatusTone = (version: Proposal): string => {
    const versionId = version.versionId || 'original';
    const versionStatus = getVersionRecordStatus(version);

    if (isArchivedVersion(version)) return 'neutral';
    if (versionId === submittedVersionId) {
      if (proposalWorkflowStatus === 'signed') return 'signed';
      if (proposalWorkflowStatus === 'approved') return 'approved';
      return 'submitted';
    }
    if (versionStatus === 'approved') return 'approved';
    if (versionStatus === 'signed') return 'signed';
    if (versionStatus === 'completed') return 'completed';
    if (versionStatus === 'submitted') return 'submitted';
    return 'draft';
  };

  const getVersionStatusLabel = (version: Proposal): string => {
    const versionId = version.versionId || 'original';
    const versionStatus = getVersionRecordStatus(version);

    if (isArchivedVersion(version)) {
      return 'Archived';
    }
    if (versionId === submittedVersionId) {
      return submittedVersionLabel;
    }
    if (hasSignedBaseline && isEditableAddendumVersion(version)) {
      return 'Addendum Draft';
    }
    return formatWorkflowStatusLabel(versionStatus);
  };

  const getVersionNavBadges = (version: Proposal) => {
    return [{ label: getVersionStatusLabel(version), tone: getVersionStatusTone(version) }];
  };

  const getSubmitVersionDisabledReason = (version: Proposal) => {
    const versionId = version.versionId || 'original';
    const versionStatus = getVersionRecordStatus(version);
    const signedBaselineVersion = hasSignedBaseline ? getSignedBaselineVersion(proposal as Proposal) : null;

    if (isArchivedVersion(version)) {
      return 'Archived versions are read-only.';
    }
    if (!canManageVersionDrafts) {
      return editDisabledReason || 'This proposal is view only.';
    }
    if (proposalWorkflowStatus === 'needs_approval' && submittedVersionId && submittedVersionId !== versionId) {
      return 'Another proposal version is already awaiting approval.';
    }
    if (hasSignedBaseline && !isEditableAddendumVersion(version)) {
      return 'Only editable addendum drafts can be submitted after a proposal is signed.';
    }
    if (versionStatus === 'submitted' || versionStatus === 'needs_approval') {
      return 'This version is already awaiting approval.';
    }
    if (versionStatus === 'approved') {
      return 'This version is already approved and can be signed instead.';
    }
    if (versionStatus === 'signed') {
      return 'Signed versions are locked.';
    }
    if (versionStatus === 'completed') {
      return 'Completed versions are locked.';
    }
    if (!version.customerInfo?.customerName?.trim()) {
      return 'Customer name is required before submission.';
    }
    if (hasSignedBaseline && !versionsHaveMeaningfulDifferences(version, signedBaselineVersion)) {
      return 'Proposal addendums must include changes before they can be submitted.';
    }
    if (hasSignedBaseline && hasEquipmentChangeRequired(versionSyncMeta[versionId]?.equipmentFlags)) {
      return ADDENDUM_EQUIPMENT_CHANGE_REQUIRED_MESSAGE;
    }
    return undefined;
  };

  const getSignVersionDisabledReason = (version: Proposal) => {
    const versionId = version.versionId || 'original';
    const versionStatus = getVersionRecordStatus(version);

    if (isArchivedVersion(version)) {
      return 'Archived versions cannot be signed.';
    }
    if (versionStatus === 'signed') {
      return 'This version is already signed.';
    }
    if (versionStatus === 'completed') {
      return 'Completed versions cannot be signed again.';
    }
    if (!approvedVersionIds.includes(versionId)) {
      if (versionStatus === 'needs_approval' || versionStatus === 'submitted') {
        return 'This version is still awaiting approval.';
      }
      if (versionStatus === 'draft' || versionStatus === 'changes_requested') {
        return 'This version must be approved before it can be signed.';
      }
      return 'Only approved versions can be signed.';
    }
    if (hasEquipmentChangeRequired(versionSyncMeta[versionId]?.equipmentFlags)) {
      return MARK_SIGNED_EQUIPMENT_CHANGE_REQUIRED_MESSAGE;
    }
    return undefined;
  };

  const submitVersionOptions: WorkflowVersionOption[] = allVersionsForRender.map((version) => ({
    id: version.versionId || 'original',
    label: getDisplayVersionLabel(version),
    detail: getSubmitVersionDisabledReason(version) || getVersionStatusLabel(version),
    disabled: Boolean(getSubmitVersionDisabledReason(version)),
  }));

  const signVersionOptions: WorkflowVersionOption[] = allVersionsForRender.map((version) => ({
    id: version.versionId || 'original',
    label: getDisplayVersionLabel(version),
    detail: getSignVersionDisabledReason(version) || getVersionStatusLabel(version),
    disabled: Boolean(getSignVersionDisabledReason(version)),
  }));

  const getCategoryClassName = (categoryName: string): string => {
    const classMap: { [key: string]: string } = {
      'Plans & Engineering': 'pool-specs',
      'Excavation': 'excavation',
      'Plumbing': 'plumbing',
      'Electrical': 'electrical',
      'Tile': 'tile',
      'Coping/Decking': 'tile',
      'Drainage': 'drainage',
      'Water Features': 'water-features',
      'Equipment Ordered': 'equipment',
      'Equipment Set': 'equipment',
      'Interior Finish': 'interior',
      'Fiberglass Shell': 'pool-specs',
      'Fiberglass Install': 'pool-specs',
      'Custom Features': 'custom',
    };
    return classMap[categoryName] || '';
  };

  const getCategoryIcon = (categoryName: string) => {
    const iconMap: { [key: string]: JSX.Element } = {
      'Plans & Engineering': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 3h12c.6 0 1 .4 1 1v12c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      Layout: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      Permit: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 3h10c.6 0 1 .4 1 1v13c0 .6-.4 1-1 1H5c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 7h6M7 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="10" cy="14" r="1.5" fill="currentColor"/>
        </svg>
      ),
      Excavation: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 15h14M5 15L7 8l3 3 3-3 2 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      Plumbing: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 10h4m4 0h4M10 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      Gas: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3v6m-3 3l3-3 3 3M6 13h8v3H6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      Steel: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      Electrical: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 3L6 11h5l-1 6 5-8h-5l1-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      ),
      Shotcrete: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      Tile: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="11" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="3" y="11" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="11" y="11" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      'Coping/Decking': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 12h14M3 8h14M3 12v3h14v-3M3 8V5h14v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      'Stone/Rockwork': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 15l3-6 4 2 5-7M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      Drainage: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3v14m-3-3l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M6 7h8v6H6z" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      'Equipment Ordered': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="5" width="14" height="10" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      'Equipment Set': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M10 7v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      'Water Features': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3c-2 2-3 4-3 6 0 1.7 1.3 3 3 3s3-1.3 3-3c0-2-1-4-3-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M4 15h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      Cleanup: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M7 6V4h6v2M4 6h12M6 6v9c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M8 9v4M12 9v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
      'Interior Finish': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 10c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M6 10h8v6H6z" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      'Water Truck': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="6" width="11" height="7" rx="1" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="6" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <circle cx="12" cy="15" r="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M14 9h2l1 2v2h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
      'Fiberglass Shell': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="10" cy="10" rx="7" ry="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M3 10h14" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      'Fiberglass Install': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3v6m0 0L7 6m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="4" y="11" width="12" height="5" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
      'Startup/Orientation': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 8l5 2-5 2V8z" fill="currentColor"/>
        </svg>
      ),
      'Custom Features': (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 3l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6l2-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        </svg>
      ),
    };

    return iconMap[categoryName] || (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    );
  };

  const renderTiles = (vm: ReturnType<typeof buildViewModel>) => {
    const versionId = vm.proposal.versionId || 'original';
    const contractTypeLabel = getContractTypeLabel(vm.proposal);
    return (
      <div
        className={`tiles-grid${
          splitCustomerCostWarranty && canViewCogsBreakdown
            ? ' tiles-grid--two-column'
            : ''
        }`}
      >
        <button
          className="summary-tile customer-tile"
          type="button"
          onClick={() =>
            handleOpenCustomerBreakdown(
              vm.proposal,
              splitCustomerCostWarranty ? 'cost' : 'combined'
            )
          }
        >
          <div className="tile-header">
            <div className="tile-icon customer-icon">
              <img src={customerBreakIconImg} alt="Customer breakdown icon" className="customer-break-icon" />
            </div>
            <div className="tile-header-text">
              <p className="tile-title">
                {splitCustomerCostWarranty ? (
                  <>Customer Cost<br/>Breakdown</>
                ) : (
                  <>Customer Cost &amp;<br/>Warranty Breakdown</>
                )}
              </p>
            </div>
          </div>
          <div className="tile-content-box">
            <div className="tile-metrics">
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Retail Price:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.retailPriceBeforeDiscounts)}</OverflowTooltipText>
              </div>
              <div className="metric-divider"></div>
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Retail Sale Price:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.retailSalePrice)}</OverflowTooltipText>
              </div>
              <div className="metric-divider"></div>
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Total Savings:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.totalSavings)}</OverflowTooltipText>
              </div>
              <div className="metric-divider"></div>
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Total Savings %:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">
                  {Number.isFinite(vm.totalSavingsPercent) ? `${vm.totalSavingsPercent.toFixed(1)}%` : 'N/A'}
                </OverflowTooltipText>
              </div>
            </div>
          </div>
          <span className="tile-link">
            View Detailed Breakdown
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </button>

        {splitCustomerCostWarranty && (
          <button
            className="summary-tile warranty-tile"
            type="button"
            onClick={() => handleOpenCustomerBreakdown(vm.proposal, 'warranty')}
          >
            <div className="tile-header">
              <div className="tile-icon warranty-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 3L19 6V11C19 15.5 16.1 19.2 12 21C7.9 19.2 5 15.5 5 11V6L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                  <path d="M9 12L11 14L15.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div className="tile-header-text">
                <p className="tile-title">Warranty<br/>Breakdown</p>
              </div>
            </div>
            <div className="tile-content-box">
              <div className="tile-metrics">
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Prepared For:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">
                    {vm.proposal.customerInfo.customerName || 'Customer'}
                  </OverflowTooltipText>
                </div>
              </div>
            </div>
            <span className="tile-link">
              View Warranty Breakdown
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </button>
        )}

        {canViewCogsBreakdown && (
          <button className="summary-tile cogs-tile" type="button" onClick={() => setCogsBreakdownVersionId(versionId)}>
            <div className="tile-header">
              <div className="tile-icon cogs-icon">
                <img src={cogsBreakIconImg} alt="COGS breakdown icon" className="cogs-break-icon" />
              </div>
              <div className="tile-header-text">
                <p className="tile-title">COGS Cost<br/>Breakdown</p>
              </div>
            </div>
            <div className="tile-content-box">
              <div className="tile-metrics">
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Dig Commission:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.pricing?.digCommission ?? 0)}</OverflowTooltipText>
                </div>
                <div className="metric-divider"></div>
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Admin Fee:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.pricing?.adminFee ?? 0)}</OverflowTooltipText>
                </div>
                <div className="metric-divider"></div>
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Closeout Commission:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.pricing?.closeoutCommission ?? 0)}</OverflowTooltipText>
                </div>
                <div className="metric-divider"></div>
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Gross Profit:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">
                    {formatCurrency(vm.pricing?.grossProfit ?? 0)} ({Number.isFinite(vm.grossMargin) ? `${vm.grossMargin.toFixed(1)}%` : 'N/A'})
                  </OverflowTooltipText>
                </div>
              </div>
            </div>
            <span className="tile-link">
              View Detailed Breakdown
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </button>
        )}

        {vm.offContractItemCount > 0 && (
          <button
            className="summary-tile off-contract-tile"
            type="button"
            onClick={() => setOffContractVersionId(versionId)}
          >
            <div className="tile-header">
              <div className="tile-icon off-contract-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M9 12h6M9 16h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div className="tile-header-text">
                <p className="tile-title">Off Contract<br/>Items</p>
              </div>
            </div>
            <div className="tile-content-box">
              <div className="tile-metrics">
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Categories:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">{vm.offContractItemGroups.length}</OverflowTooltipText>
                </div>
                <div className="metric-divider"></div>
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Items:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">{vm.offContractItemCount}</OverflowTooltipText>
                </div>
                <div className="metric-divider"></div>
                <div className="metric-row">
                  <OverflowTooltipText as="p" className="metric-label">Off Contract Total:</OverflowTooltipText>
                  <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.offContractTotal)}</OverflowTooltipText>
                </div>
              </div>
            </div>
            <span className="tile-link">
              View Breakdown
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </button>
        )}

        <button
          className="summary-tile contract-tile"
          type="button"
          onClick={() => void handleOpenContract(vm.proposal)}
          disabled={contractRevisionBusy}
        >
          <div className="tile-header">
            <div className="tile-icon contract-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M7 3h8l4 4v14H7V3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 3v4h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9 12h6M9 16h6M9 8h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="tile-header-text">
              <p className="tile-title">Contract</p>
            </div>
          </div>
          <div className="tile-content-box">
            <div className="tile-metrics">
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Retail Price:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">{formatCurrency(vm.pricing?.retailPrice ?? vm.retailPriceBeforeDiscounts)}</OverflowTooltipText>
              </div>
              <div className="metric-divider"></div>
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Pool Type:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">{vm.poolTypeLabel}</OverflowTooltipText>
              </div>
              <div className="metric-divider"></div>
              <div className="metric-row">
                <OverflowTooltipText as="p" className="metric-label">Contract Type:</OverflowTooltipText>
                <OverflowTooltipText as="p" className="metric-value">{contractTypeLabel}</OverflowTooltipText>
              </div>
            </div>
          </div>
          <span className="tile-link">
            View Contract
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 11L11 3M11 3H5M11 3V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </button>
      </div>
    );
  };

  const renderCogsToggle = () => (
    <div className="proposal-summary-tools">
      <div className="proposal-summary-toggle-card">
        <div className="proposal-summary-toggle-copy">
          <span className="proposal-summary-toggle-label">Show COGS</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={showCogsBreakdown}
          className={`proposal-summary-toggle-switch ${showCogsBreakdown ? 'is-on' : ''}`}
          onClick={() => {
            const toggle = () => setShowCogsBreakdown((current) => !current);
            const viewTransitionDocument = document as ViewTransitionDocument;
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (!viewTransitionDocument.startViewTransition || prefersReducedMotion) {
              toggle();
              return;
            }
            viewTransitionDocument.startViewTransition(() => flushSync(toggle));
          }}
        >
          <span className="proposal-summary-toggle-switch-track" aria-hidden="true">
            <span className="proposal-summary-toggle-switch-thumb" />
          </span>
          <span className="proposal-summary-toggle-switch-state">{showCogsBreakdown ? 'On' : 'Off'}</span>
        </button>
      </div>
    </div>
  );

  const renderSelectedVersionSection = (vm: ReturnType<typeof buildViewModel>) => {
    const versionId = vm.proposal.versionId || 'original';
    const contractTypeLabel = getContractTypeLabel(vm.proposal);
    const isLivePublishedVersion = Boolean(livePublishedVersionId) && versionId === livePublishedVersionId;
    const proposalIndicator = buildProposalIndicator(vm.grossMargin);
    const versionStatusLabel = getVersionStatusLabel(vm.proposal);
    const shouldShowVersionStatus = versionStatusLabel !== 'Draft';

    return (
      <div className="version-section">
        <div
          className={`hero-card${isLivePublishedVersion ? ' is-live-published-version' : ''}${
            proposalWorkflowStatus === 'signed' && isLivePublishedVersion ? ' is-signed-version' : ''
          }`}
        >
          <div className="hero-header">
            <div className="hero-icon">
              <img src={summaryIconImg} alt="Proposal summary icon" className="summary-icon" />
            </div>
            <div className="hero-header-text">
              <h2 className="hero-title">
                <span className="hero-title-text">{vm.customerLocation}</span>
                <span className="hero-title-separator">-</span>
                <span className="version-pill">{contractTypeLabel}</span>
                {shouldShowVersionStatus && <span className="version-status-pill">{versionStatusLabel}</span>}
              </h2>
            </div>
          </div>

          <div className="hero-grid">
            <section className="hero-summary-section" aria-labelledby="pool-specifications-heading">
              <p id="pool-specifications-heading" className="hero-section-title hero-section-title-specs">
                <span>Pool Specifications</span>
                <TooltipAnchor tooltip={getPricingModelStatusTooltip(vm.priceModelStatus)}>
                  <span className={`hero-price-model ${vm.priceModelStatus}`} aria-label={getPricingModelStatusTooltip(vm.priceModelStatus)}>
                    {getPricingModelDisplayName(vm.priceModel, vm.priceModelStatus)}
                  </span>
                </TooltipAnchor>
              </p>
              <div className="hero-section-columns">
                <div className="hero-column">
                  <div className="hero-line"><span className="hero-label">Pool Type:</span><OverflowTooltipText>{vm.poolTypeLabel}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Max Width:</span><OverflowTooltipText>{vm.maxWidth}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Shallow Depth:</span><OverflowTooltipText>{vm.shallowDepth}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">{vm.spaLengthLabel}:</span><OverflowTooltipText>{vm.spaLength}</OverflowTooltipText></div>
                </div>
                <div className="hero-column">
                  <div className="hero-line"><span className="hero-label">Approx. Gallons:</span><OverflowTooltipText>{vm.approximateGallons}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Max Length:</span><OverflowTooltipText>{vm.maxLength}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">End Depth:</span><OverflowTooltipText>{vm.endDepth}</OverflowTooltipText></div>
                  {!vm.showFiberglassSpaSummary && (
                    <div className="hero-line"><span className="hero-label">{vm.spaWidthLabel}:</span><OverflowTooltipText>{vm.spaWidth}</OverflowTooltipText></div>
                  )}
                </div>
              </div>
            </section>
            <section className="hero-summary-section" aria-labelledby="pool-equipment-heading">
              <p id="pool-equipment-heading" className="hero-section-title hero-section-title-equipment">
                <span>Pool Equipment</span>
                {vm.equipmentPackageLabel && <span className="hero-equipment-package-pill">{vm.equipmentPackageLabel}</span>}
              </p>
              <div className="hero-section-columns">
                <div className="hero-column">
                  <div className="hero-line"><span className="hero-label">Pump:</span><OverflowTooltipText>{vm.pumpSummary}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Filter:</span><OverflowTooltipText>{vm.filterSummary}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Heater:</span><OverflowTooltipText>{vm.heaterSummary}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Cleaner:</span><OverflowTooltipText>{vm.cleanerSummary}</OverflowTooltipText></div>
                </div>
                <div className="hero-column">
                  <div className="hero-line"><span className="hero-label">Automation:</span><OverflowTooltipText>{vm.automationSummary}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Sanitation:</span><OverflowTooltipText>{vm.sanitationSummary}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Autofill:</span><OverflowTooltipText>{vm.autoFillSummary}</OverflowTooltipText></div>
                  <div className="hero-line"><span className="hero-label">Pool Light:</span><OverflowTooltipText>{vm.poolLightSummary}</OverflowTooltipText></div>
                </div>
              </div>
            </section>
          </div>

          <div className="hero-total">
            <span className="proposal-gp-indicator">{proposalIndicator}</span>
            <span className="hero-total-amount">
              <strong>Total Retail Cost:</strong> {formatCurrency(vm.retailPrice || vm.subtotal || vm.totalCost)}
            </span>
          </div>
        </div>

        {renderTiles(vm)}
      </div>
    );
  };

  const renderVersionActionsCard = (vm: ReturnType<typeof buildViewModel>) => {
    const versionId = vm.proposal.versionId || 'original';
    const isOriginal = vm.proposal.isOriginalVersion ?? versionId === 'original';
    const isArchived = isArchivedVersion(vm.proposal);
    const isLivePublishedVersion = Boolean(livePublishedVersionId) && versionId === livePublishedVersionId;
    const versionRecordStatus = getVersionRecordStatus(vm.proposal);
    const isEditableAddendum = hasSignedBaseline && isEditableAddendumVersion(vm.proposal);
    const baselineVersion = hasSignedBaseline ? getSignedBaselineVersion(proposal as Proposal) : null;
    const hasAddendumDifferences = isEditableAddendum
      ? versionsHaveMeaningfulDifferences(vm.proposal, baselineVersion)
      : true;
    const versionHasSubmissionHistory =
      !hasSignedBaseline && hasVersionSubmissionHistory(proposal as Proposal, versionId);
    const canOpenVersionInBuilder =
      canOpenReadOnlyBuilder ||
      isArchived ||
      (canManageVersionDrafts &&
        !isVersionPermanentlyLocked(vm.proposal) &&
        !isProposalCompleted);
    const showSignProposalButton =
      !isProposalEditingRestricted &&
      !isReadOnlyReviewerView &&
      proposalWorkflowStatus === 'approved' &&
      approvedVersionIds.length > 0;
    const signProposalDisabledReason = isOffline
      ? offlineActionDisabledReason
      : disableSignedWorkflow
      ? DISABLED_SIGNED_WORKFLOW_MESSAGE
      : signableApprovedVersionIds.length === 0
      ? MARK_SIGNED_EQUIPMENT_CHANGE_REQUIRED_MESSAGE
      : undefined;
    const editVersionDisabledReason =
      isProposalCompleted
        ? 'Completed proposals are locked.'
        : isArchived
        ? 'Open this archived version in the builder with read-only access.'
        : versionRecordStatus === 'signed'
        ? 'Signed proposal versions are locked. Create a proposal addendum to make changes.'
        : versionRecordStatus === 'completed'
        ? 'Completed proposal versions are locked.'
        : !canManageVersionDrafts && !canOpenReadOnlyBuilder
        ? editDisabledReason
        : canOpenReadOnlyBuilder
        ? 'Open proposal in the builder with read-only access.'
        : undefined;
    const deleteVersionDisabledReason =
      !canManageVersionDrafts
        ? editDisabledReason
        : isProposalCompleted
        ? 'Completed proposals are locked.'
        : isOriginal
        ? 'The original version cannot be deleted.'
        : isArchived
        ? 'Archived versions cannot be deleted.'
        : isSubmittedVersionLocked(vm.proposal)
        ? 'Submitted versions cannot be deleted.'
        : undefined;
    const canDeleteVersion = !deleteVersionDisabledReason;
    const shouldRenderSubmitAction =
      !isReadOnlyReviewerView &&
      !isArchived &&
      !(
        proposalWorkflowStatus === 'signed' &&
        versionRecordStatus === 'signed' &&
        !isEditableAddendum
      ) &&
      (isEditableAddendum || versionRecordStatus === 'draft' || versionRecordStatus === 'changes_requested');
    const submitActionDisabledReason =
      isOffline
        ? offlineActionDisabledReason
        : !canManageVersionDrafts
        ? editDisabledReason
        : isEditableAddendum && !hasAddendumDifferences
        ? 'Proposal addendums must differ from the current signed baseline before they can be submitted.'
        : isEditableAddendum && vm.hasEquipmentChangeRequired
        ? ADDENDUM_EQUIPMENT_CHANGE_REQUIRED_MESSAGE
        : !canSubmitProposal
        ? 'Must include Customer Name'
        : undefined;
    const submitActionLabel = isEditableAddendum
      ? 'Submit Addendum'
      : versionHasSubmissionHistory || versionRecordStatus === 'changes_requested'
      ? 'Resubmit Proposal'
      : 'Submit Proposal';
    const archivedEditLabel = isArchived ? 'Open Read-Only Builder' : 'Edit Proposal';
    const canUseSubmitAction = shouldRenderSubmitAction && !submitActionDisabledReason;
    const signActionTooltip = showSignProposalButton ? signProposalDisabledReason : undefined;
    const shouldRenderArchivedNote =
      isArchived &&
      !isReadOnlyReviewerView &&
      proposalWorkflowStatus === 'signed' &&
      isLivePublishedVersion === false;
    const archivedNote =
      shouldRenderArchivedNote
        ? 'Archived proposal versions stay available for comparison, but cannot be edited, submitted, signed, or deleted.'
        : null;

    return (
      <div className="proposal-side-card">
        <div className="proposal-side-card-header">
          <div>
            <p className="proposal-side-card-kicker">Selected Version Actions</p>
            <h2>{getDisplayVersionLabel(vm.proposal)}</h2>
          </div>
        </div>
        <div className="proposal-side-card-body">
          <div className="side-action-stack">
            {showSignProposalButton && (
              <TooltipAnchor tooltip={signActionTooltip}>
                <button
                  className="action-button primary side-action-button"
                  onClick={() => {
                    handleOpenSignModal(versionId);
                  }}
                  disabled={Boolean(signProposalDisabledReason) || reviewerActionSaving}
                >
                  Sign Proposal
                </button>
              </TooltipAnchor>
            )}
            {shouldRenderSubmitAction && (
              <TooltipAnchor tooltip={submitActionDisabledReason}>
                <button
                  className="action-button primary side-action-button"
                  onClick={() => {
                    void handleSubmitProposal(versionId);
                  }}
                  disabled={!canUseSubmitAction}
                >
                  {submitActionLabel}
                </button>
              </TooltipAnchor>
            )}
            <TooltipAnchor tooltip={editVersionDisabledReason}>
              <button
                className="action-button side-action-button"
                onClick={() => handleEdit(vm.proposal, { readOnly: isArchived })}
                disabled={!canOpenVersionInBuilder}
              >
                {archivedEditLabel}
              </button>
            </TooltipAnchor>
            <TooltipAnchor tooltip={deleteVersionDisabledReason}>
              <button
                className="action-button danger side-action-button"
                onClick={() => handleDeleteVersion(versionId)}
                disabled={!canDeleteVersion}
              >
                Delete Version
              </button>
            </TooltipAnchor>
          </div>
          {archivedNote && <p className="proposal-side-empty">{archivedNote}</p>}
        </div>
      </div>
    );
  };

  const renderProposalActionsCard = () => {
    const hasReviewerActions =
      isReadOnlyReviewerView &&
      (proposalWorkflowStatus === 'needs_approval' ||
        proposalWorkflowStatus === 'approved' ||
        (proposalWorkflowStatus !== 'completed' && proposalWorkflowStatus !== 'signed') ||
        proposalWorkflowStatus === 'signed');

    if (!hasReviewerActions) return null;

    return (
      <div className="proposal-side-card no-print">
        <div className="proposal-side-card-header">
          <div>
            <p className="proposal-side-card-kicker">Proposal Actions</p>
          </div>
        </div>
        <div className="proposal-side-card-body">
          <div className="side-action-stack">
            {isReadOnlyReviewerView && proposalWorkflowStatus === 'needs_approval' && (
              <TooltipAnchor tooltip={isProposalEditingRestricted ? editDisabledReason : offlineActionDisabledReason}>
                <button
                  className="action-button primary side-action-button"
                  onClick={() => {
                    void handleReviewerApprove();
                  }}
                  disabled={reviewerActionSaving || isOffline || isProposalEditingRestricted}
                >
                  Approve
                </button>
              </TooltipAnchor>
            )}
            {isReadOnlyReviewerView && proposalWorkflowStatus !== 'signed' && (
              <TooltipAnchor tooltip={isProposalEditingRestricted ? editDisabledReason : offlineActionDisabledReason}>
                <button
                  className="action-button danger side-action-button"
                  onClick={() => {
                    void handleReviewerRequestChanges();
                  }}
                  disabled={reviewerActionSaving || isOffline || isProposalEditingRestricted}
                >
                  Request Changes
                </button>
              </TooltipAnchor>
            )}
            {isReadOnlyReviewerView && proposalWorkflowStatus === 'approved' && (
              <TooltipAnchor
                tooltip={isOffline ? offlineActionDisabledReason : disableSignedWorkflow ? DISABLED_SIGNED_WORKFLOW_MESSAGE : undefined}
              >
                <button
                  className="action-button primary side-action-button"
                  onClick={() => {
                    handleOpenSignModal(selectedVersionIdKey);
                  }}
                  disabled={reviewerActionSaving || disableSignedWorkflow || isOffline}
                >
                  Sign Proposal
                </button>
              </TooltipAnchor>
            )}
            {isReadOnlyReviewerView && proposalWorkflowStatus === 'signed' && (
              <TooltipAnchor tooltip={offlineActionDisabledReason}>
                <button
                  className="action-button primary side-action-button"
                  onClick={() => setShowCompleteConfirm(true)}
                  disabled={reviewerActionSaving || isOffline}
                >
                  Mark Complete
                </button>
              </TooltipAnchor>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderWorkflowSummaryCard = () => (
    <div className="proposal-side-card no-print">
      <div className="proposal-side-card-header">
        <div className="workflow-summary-heading">
          <p className="proposal-side-card-kicker">Submission Workflow</p>
        </div>
        <TooltipAnchor as="div" tooltip={selectedWorkflowStatusTooltip}>
          <div className={`workflow-summary-pill is-${selectedVersionStatusTone}`}>
            {selectedVersionStatusLabel}
          </div>
        </TooltipAnchor>
      </div>

      <div className="proposal-side-card-body">
        <div className="workflow-summary-grid">
          <div className="workflow-summary-block">
            <div className="workflow-summary-label">Selected Version</div>
            <div className="workflow-summary-value">{getDisplayVersionLabel(selectedViewModel.proposal)}</div>
          </div>
          <div className="workflow-summary-block">
            <div className="workflow-summary-label">Submitted</div>
            <div className="workflow-summary-value">
              {formatWorkflowActorSummary(
                selectedVersionSubmittedBy,
                selectedVersionSubmittedAt,
                'Not submitted'
              )}
            </div>
          </div>
          <div className="workflow-summary-block">
            <div className="workflow-summary-label">Approved By</div>
            <div className="workflow-summary-value">
              {formatWorkflowActorSummary(
                selectedVersionApprovalBy,
                selectedVersionApprovalAt,
                'Not approved'
              )}
            </div>
          </div>
          <div className="workflow-summary-block">
            <div className="workflow-summary-label">
              {selectedVersionRecordStatus === 'completed' ? 'Completed By' : 'Signed By'}
            </div>
            <div className="workflow-summary-value">
              {selectedVersionRecordStatus === 'completed'
                ? formatWorkflowActorSummary(
                    selectedVersionCompletedBy,
                    selectedVersionCompletedAt,
                    'Not completed'
                  )
                : formatWorkflowActorSummary(
                    selectedVersionSignedBy,
                    selectedVersionSignedAt,
                    'Not signed'
                  )}
            </div>
          </div>
        </div>

        {selectedWorkflowReasons.length > 0 && (
          <div className="workflow-summary-reasons">
            {selectedWorkflowReasons.map((reason) => (
              <div key={`${reason.code}-${reason.label}`} className="workflow-summary-reason">
                <strong>{reason.label}</strong>
                {reason.detail ? ` - ${reason.detail}` : ''}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderWorkflowActivityCard = () => {
    if (!(workflowHistory.length > 0 || canSendWorkflowMessages)) return null;

    return (
      <div className="proposal-side-card no-print">
        <div className="proposal-side-card-header">
          <div>
            <p className="proposal-side-card-kicker">Workflow Activity</p>
            <h2>Messages & History</h2>
          </div>
          <button
            type="button"
            className="workflow-summary-history-toggle"
            onClick={() =>
              setIsWorkflowHistoryExpanded((current) => {
                const nextExpanded = !current;
                if (!nextExpanded) {
                  setShowWorkflowMessageComposer(false);
                }
                return nextExpanded;
              })
            }
          >
            {isWorkflowHistoryExpanded ? 'Compress' : 'Expand'}
          </button>
        </div>

        <div className="proposal-side-card-body">
          {isWorkflowHistoryExpanded && (
            <div className="workflow-summary-history-list">
              {workflowHistory.map((entry) => (
                <div key={entry.id} className="workflow-summary-history-item">
                  <div className="workflow-summary-history-meta">
                    <span>{formatWorkflowStatusLabel(entry.type)}</span>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    <span>{entry.actor?.name || entry.actor?.email || 'User'}</span>
                  </div>
                  {entry.message && <div className="workflow-summary-history-message">{entry.message}</div>}
                </div>
              ))}
            </div>
          )}

          {isWorkflowHistoryExpanded && canSendWorkflowMessages && !showWorkflowMessageComposer && (
            <div className="workflow-summary-message-actions">
              <TooltipAnchor tooltip={offlineActionDisabledReason}>
                <button
                  type="button"
                  className="action-button workflow-summary-message-trigger"
                  onClick={() => setShowWorkflowMessageComposer(true)}
                  disabled={workflowMessageSaving || loading || isOffline}
                >
                  {isReadOnlyReviewerView ? 'Add Note' : 'Send Another Note'}
                </button>
              </TooltipAnchor>
            </div>
          )}

          {isWorkflowHistoryExpanded && canSendWorkflowMessages && showWorkflowMessageComposer && (
            <div className="workflow-summary-message-composer">
              <textarea
                className="workflow-summary-message-input"
                value={workflowMessageDraft}
                onChange={(event) => setWorkflowMessageDraft(event.target.value)}
                placeholder="Add a message here"
                disabled={workflowMessageSaving || loading}
                rows={4}
              />
              <div className="workflow-summary-message-actions">
                <button
                  type="button"
                  className="action-button"
                  onClick={() => {
                    setWorkflowMessageDraft('');
                    setShowWorkflowMessageComposer(false);
                  }}
                  disabled={workflowMessageSaving}
                >
                  Cancel
                </button>
                <TooltipAnchor tooltip={offlineActionDisabledReason}>
                  <button
                    type="button"
                    className="action-button primary workflow-summary-message-button"
                    onClick={() => {
                      void handleSendWorkflowMessage();
                    }}
                    disabled={!workflowMessageDraft.trim() || workflowMessageSaving || loading || isOffline}
                  >
                    {workflowMessageSaving ? 'Sending...' : 'Send Message'}
                  </button>
                </TooltipAnchor>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!selectedViewModel) {
    return (
      <div className="proposal-view">
        <div className="error-container">
          <h2>Proposal versions are unavailable</h2>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="proposal-view">
      <div className="view-actions no-print">
        <div className="action-bar">
          <div className="action-bar-left">
            <button className="action-button" onClick={isReadOnlyReviewerView ? handleReviewerBack : () => navigate('/')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 13L5 8L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {isReadOnlyReviewerView ? reviewerBackLabel : 'Back to Home'}
            </button>
          </div>
          <div className="action-bar-center">
            {isOffline && <CloudConnectionNotice reason={cloudIssue} placement="inline" />}
          </div>
          <div className="action-bar-right">
            {!isReadOnlyReviewerView && (
              <TooltipAnchor tooltip={completeActionDisabledReason}>
                <button
                  className="action-button primary workflow-summary-submit-button"
                  onClick={() => {
                    setShowCompleteConfirm(true);
                  }}
                  disabled={!activeVersionCanComplete || reviewerActionSaving || loading || isOffline}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Complete Proposal
                </button>
              </TooltipAnchor>
            )}
          </div>
        </div>
      </div>

      <div className="proposal-view-shell">
        <aside className="proposal-column proposal-column--nav no-print">
          <div className="proposal-side-card proposal-nav-card">
            <div className="proposal-side-card-header proposal-nav-card-header">
              <div>
                <p className="proposal-side-card-kicker">Versions & Addendums</p>
                <h2>{viewModels.length} Available</h2>
              </div>
              {!isReadOnlyReviewerView && (
                <TooltipAnchor tooltip={buildVersionDisabledReason} className="proposal-nav-build-action">
                  <button
                    type="button"
                    className="action-button action-button-version proposal-nav-build-button"
                    onClick={handleBuildAnotherVersion}
                    disabled={Boolean(buildVersionDisabledReason)}
                  >
                    {versionActionLabel}
                  </button>
                </TooltipAnchor>
              )}
            </div>
            <div className="proposal-side-card-body proposal-nav-list">
              {activeNavigationViewModels.map((vm) => {
                const versionId = vm.proposal.versionId || 'original';
                const isSelected = versionId === resolvedSelectedVersionId;
                return (
                  <button
                    key={versionId}
                    type="button"
                    className={`proposal-nav-item${isSelected ? ' is-selected' : ''}`}
                    onContextMenu={(event) => handleVersionContextMenu(event, versionId)}
                    onClick={() => {
                      setSelectedVersionId(versionId);
                      setActiveVersionId(versionId);
                    }}
                  >
                    <div className="proposal-nav-item-header">
                      <div className="proposal-nav-item-top-row">
                        <div className="proposal-nav-item-location">{vm.customerLocation}</div>
                      </div>
                      <div className="proposal-nav-item-title-row">
                        <span className="proposal-nav-item-title">{getDisplayVersionLabel(vm.proposal)}</span>
                        <span className="proposal-nav-item-total">{formatCurrency(vm.retailPrice || vm.subtotal || vm.totalCost)}</span>
                      </div>
                    </div>
                    <div className="proposal-nav-badges">
                      {getVersionNavBadges(vm.proposal).map((badge) => (
                        <span key={`${versionId}-${badge.label}`} className={`proposal-nav-badge tone-${badge.tone}`}>
                          {badge.label}
                        </span>
                      ))}
                    </div>
                    <div className="proposal-nav-item-dates">
                      <span>Created {formatVersionDateTime(vm.proposal.createdDate || vm.proposal.lastModified)}</span>
                      <span>Updated {formatVersionDateTime(vm.proposal.lastModified || vm.proposal.createdDate)}</span>
                    </div>
                  </button>
                );
              })}
              {!isReadOnlyReviewerView && archivedNavigationViewModels.length > 0 && (
                <div className={`proposal-archive-group${isArchiveVersionsExpanded ? ' is-expanded' : ''}`}>
                  <button
                    type="button"
                    className="proposal-archive-toggle"
                    onClick={() => setIsArchiveVersionsExpanded((current) => !current)}
                  >
                    <span>Archive Versions</span>
                    <span>{archivedNavigationViewModels.length}</span>
                  </button>
                  {isArchiveVersionsExpanded && (
                    <div className="proposal-archive-list">
                      {archivedNavigationViewModels.map((vm) => {
                        const versionId = vm.proposal.versionId || 'original';
                        const isSelected = versionId === resolvedSelectedVersionId;
                        return (
                          <button
                            key={`archived-${versionId}`}
                            type="button"
                            className={`proposal-nav-item proposal-nav-item--archived${isSelected ? ' is-selected' : ''}`}
                            onContextMenu={(event) => handleVersionContextMenu(event, versionId)}
                            onClick={() => {
                              setSelectedVersionId(versionId);
                              setActiveVersionId(versionId);
                            }}
                          >
                            <div className="proposal-nav-item-header">
                              <div className="proposal-nav-item-top-row">
                                <div className="proposal-nav-item-location">{vm.customerLocation}</div>
                              </div>
                              <div className="proposal-nav-item-title-row">
                                <span className="proposal-nav-item-title">{getDisplayVersionLabel(vm.proposal)}</span>
                                <span className="proposal-nav-item-total">{formatCurrency(vm.retailPrice || vm.subtotal || vm.totalCost)}</span>
                              </div>
                            </div>
                            <div className="proposal-nav-badges">
                              {getVersionNavBadges(vm.proposal).map((badge) => (
                                <span key={`${versionId}-${badge.label}`} className={`proposal-nav-badge tone-${badge.tone}`}>
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                            <div className="proposal-nav-item-dates">
                              <span>Created {formatVersionDateTime(vm.proposal.createdDate || vm.proposal.lastModified)}</span>
                              <span>Updated {formatVersionDateTime(vm.proposal.lastModified || vm.proposal.createdDate)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div ref={proposalRef} className="proposal-summary-page">
          <div className="proposal-summary-header">
            <div className="proposal-summary-heading">
              <p className="proposal-side-card-kicker">Proposal Summary</p>
              <h1 className="page-title">{getDisplayVersionLabel(selectedViewModel.proposal)}</h1>
            </div>
            {renderCogsToggle()}
          </div>
          {renderSelectedVersionSection(selectedViewModel)}
        </div>

        <aside className="proposal-column proposal-column--side no-print">
          {renderVersionActionsCard(selectedViewModel)}
          {renderProposalActionsCard()}
          {proposal?.workflow && renderWorkflowSummaryCard()}
          {proposal?.workflow && renderWorkflowActivityCard()}
        </aside>
      </div>
      {versionContextMenu && (
        <>
          <div className="proposal-context-menu-backdrop" onClick={() => setVersionContextMenu(null)} />
          <div
            className="proposal-context-menu"
            style={{ top: versionContextMenu.y, left: versionContextMenu.x }}
          >
            <button
              type="button"
              className="proposal-context-menu-item"
              onClick={() => handleOpenRenameVersion(versionContextMenu.versionId)}
            >
              Rename Version
            </button>
          </div>
        </>
      )}
      {showVersionNameModal && (
        <div className="modal-overlay" data-scroll-lock="true" onClick={closeVersionNameModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="modal-eyebrow">{isRenamingVersion ? 'Rename Version' : 'New Version'}</p>
                <h2>
                  {isRenamingVersion
                    ? renameTargetVersion
                      ? `Rename '${getDisplayVersionLabel(renameTargetVersion as Proposal)}'`
                      : 'Rename Version'
                    : `Name the alternate version for '${proposal?.customerInfo.customerName || 'Proposal'}'`}
                </h2>
              </div>
              <button className="modal-close" onClick={closeVersionNameModal} aria-label="Close version naming dialog">
                x
              </button>
            </div>
            <div className="modal-body-scroll">
              {!isRenamingVersion && (
                <div className="version-source-list">
                  {versionCreationSourceOptions.map((option) => (
                    <label
                      key={option.id}
                      className={`version-source-option${newVersionSourceId === option.id ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="new-version-source"
                        value={option.id}
                        checked={newVersionSourceId === option.id}
                        onChange={(event) => setNewVersionSourceId(event.target.value)}
                      />
                      <span className="version-source-copy">
                        <span className="version-source-label">{option.label}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <label className="version-name-label">
                Version Name
                <input
                  type="text"
                  value={newVersionName}
                  onChange={(e) => setNewVersionName(e.target.value)}
                  className="version-name-input"
                  autoFocus
                />
              </label>
              <div className="version-name-actions">
                <button className="action-button" onClick={closeVersionNameModal}>Cancel</button>
                <button className="action-button primary" onClick={handleConfirmVersionName}>
                  {isRenamingVersion ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <SubmitProposalModal
        isOpen={showSubmitModal}
        kicker="Submission Review"
        versionName={submitTargetVersion ? getDisplayVersionLabel(submitTargetVersion as Proposal) : 'Current Version'}
        versionOptions={submitVersionOptions}
        selectedVersionId={submitTargetVersionId}
        versionFieldLabel="Version to Submit"
        isAddendum={isSubmittingSignedAddendum}
        willAutoApprove={submitPreview?.willAutoApprove === true}
        manualReviewRequested={submitManualReviewRequested}
        note={submitNote}
        isSubmitting={loading}
        confirmDisabled={isOffline || isProposalEditingRestricted}
        confirmDisabledReason={isProposalEditingRestricted ? editDisabledReason : offlineActionDisabledReason}
        onVersionChange={setSubmitTargetVersionId}
        onNoteChange={setSubmitNote}
        onManualReviewToggle={() => setSubmitManualReviewRequested((current) => !current)}
        onCancel={() => {
          setShowSubmitModal(false);
          setSubmitTargetVersionId(null);
          setSubmitManualReviewRequested(false);
          setSubmitNote('');
        }}
        onConfirm={() => {
          void handleConfirmSubmit();
        }}
      />
      <SubmitProposalModal
        isOpen={showMarkSignedConfirm}
        kicker="Signing Review"
        title={signTargetVersion ? `Sign ${getDisplayVersionLabel(signTargetVersion as Proposal)}?` : 'Sign Proposal?'}
        versionName={signTargetVersion ? getDisplayVersionLabel(signTargetVersion as Proposal) : 'Selected Version'}
        versionOptions={signVersionOptions}
        selectedVersionId={signTargetVersionId}
        versionFieldLabel="Version to Sign"
        messages={
          hasSignedBaseline
            ? [
                'Choose which approved proposal addendum should become the next signed baseline.',
                'Signing locks that addendum in place and makes it the version that remains in effect.',
                'Previously signed proposal history stays read-only, and future changes must continue through addendums.',
              ]
            : [
                'Choose which approved proposal version should become the signed proposal.',
                'Signing locks that version in place and moves the remaining proposal versions into Archive Versions.',
                'Once a proposal version is signed, there is no going back. Future changes must be made through proposal addendums.',
              ]
        }
        confirmLabel="Sign Proposal"
        submittingLabel="Signing..."
        allowManualReview={false}
        manualReviewRequested={false}
        note=""
        isSubmitting={reviewerActionSaving}
        confirmDisabled={isOffline || disableSignedWorkflow}
        confirmDisabledReason={
          isOffline ? offlineActionDisabledReason : disableSignedWorkflow ? DISABLED_SIGNED_WORKFLOW_MESSAGE : undefined
        }
        onVersionChange={setSignTargetVersionId}
        onNoteChange={() => {}}
        onManualReviewToggle={() => {}}
        onCancel={() => {
          setShowMarkSignedConfirm(false);
          setSignTargetVersionId(null);
        }}
        onConfirm={() => {
          void handleConfirmMarkProposalAsSigned();
        }}
      />
      <ConfirmDialog
        open={showModifySignedConfirm}
        title="Start proposal addendum?"
        message="Making changes to this signed proposal will create a new editable version. The book keeper and admins will continue to see the current signed proposal until the new addendum is submitted, approved if needed, and marked as signed. Do you want to continue?"
        confirmLabel="Continue"
        cancelLabel="Cancel"
        onConfirm={() => {
          void handleConfirmModifySignedProposal();
        }}
        onCancel={() => setShowModifySignedConfirm(false)}
      />
      <ConfirmDialog
        open={showCompleteConfirm}
        title="Are you sure?"
        message="Are you sure you want to mark this proposal as complete? No further edits can be made, and it will be reconciled in the Archive."
        confirmLabel="Yes, I'm sure"
        cancelLabel="No, take me back"
        isLoading={reviewerActionSaving}
        confirmDisabled={isOffline}
        confirmDisabledReason={offlineActionDisabledReason}
        onConfirm={() => {
          setShowCompleteConfirm(false);
          void handleReviewerComplete();
        }}
        onCancel={() => setShowCompleteConfirm(false)}
      />
      <ConfirmDialog
        open={pendingUnsavedCloseTarget !== null}
        title="Would you like to save your changes?"
        message=""
        confirmLabel="Save Changes"
        cancelLabel="No, discard"
        isLoading={
          pendingUnsavedCloseTarget === 'contract'
            ? contractSaving
            : pendingUnsavedCloseTarget === 'customer'
            ? breakdownSaving
            : false
        }
        onConfirm={() => {
          void handleConfirmPendingUnsavedClose();
        }}
        onCancel={handleDiscardPendingUnsavedClose}
      />
      {contractVersionId && contractModalView && (
        <div className="modal-overlay contract-printable" data-scroll-lock="true" onClick={requestContractModalClose}>
          <div className="modal-content contract-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header contract-modal-header">
              <div>
                <p className="modal-eyebrow">Contract</p>
                <h2>
                  Contract Preview - {contractModalView.proposal.customerInfo.customerName || 'Customer'}
                </h2>
              </div>
              <div className="contract-header-actions">
                <div className="export-control" ref={contractExportControlRef}>
                  <button
                    className={`action-button export-button ${contractExportOpen ? 'open' : ''}`}
                    type="button"
                    onClick={handleContractExportToggle}
                    disabled={contractExporting || contractSaving || !contractViewReady}
                    aria-expanded={contractExportOpen}
                    aria-haspopup="listbox"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                      <path d="M5 7h6M5 9h6M5 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Export
                  </button>
                  {contractExportOpen && (
                    <div className="export-dropdown" role="listbox">
                      <button
                        type="button"
                        className="export-option"
                        role="option"
                        onClick={handleContractPrint}
                        disabled={contractExporting || contractSaving || !contractViewReady}
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        className="export-option"
                        role="option"
                        onClick={handleContractPdf}
                        disabled={contractExporting || contractSaving || !contractViewReady}
                      >
                        PDF
                      </button>
                    </div>
                  )}
                </div>
                <TooltipAnchor tooltip={!canEditContractVersion ? contractEditDisabledReason : undefined}>
                  <button
                    className="action-button primary"
                    type="button"
                    onClick={handleContractSaveClick}
                    disabled={
                      !canEditContractVersion ||
                      !contractHasUnsavedChanges ||
                      contractSaving ||
                      !contractViewReady
                    }
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 2h8l2 2v10H3V2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                      <path d="M5 2v4h6V2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                      <path d="M6 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    {contractSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </TooltipAnchor>
                <button className="modal-close" onClick={requestContractModalClose} aria-label="Close contract">
                  x
                </button>
              </div>
            </div>
            <div className="modal-body-scroll">
              {ContractViewComponent ? (
                <ContractViewComponent
                  ref={handleContractViewRef}
                  proposal={contractModalView.proposal}
                  overrides={contractModalView.proposal.contractOverrides || {}}
                  onSave={(next: ContractOverrides) =>
                    handleSaveContractOverrides(contractModalView.proposal.versionId || 'original', next)
                  }
                  readOnly={!canEditContractVersion}
                  contractTemplate={activeContractRevision?.contractTemplate}
                  onDirtyChange={setContractDirty}
                  onExportingChange={setContractExporting}
                  onSavingChange={setContractSaving}
                />
              ) : (
                <div className="modal-loading-state">Loading contract preview...</div>
              )}
            </div>
          </div>
        </div>
      )}
      {offContractVersionId && offContractModalView && (
        <div className="modal-overlay" data-scroll-lock="true" onClick={() => setOffContractVersionId(null)}>
          <div className="modal-content wide off-contract-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="modal-eyebrow">Off Contract Items</p>
                <h2>Retail-Only Off Contract Breakdown</h2>
              </div>
              <button className="modal-close" onClick={() => setOffContractVersionId(null)} aria-label="Close off contract items">
                x
              </button>
            </div>
            <div className="modal-body-scroll">
              <OffContractItemsView
                customerName={offContractModalView.proposal.customerInfo.customerName}
                franchiseId={offContractModalView.proposal.franchiseId}
                groups={offContractModalView.offContractItemGroups}
              />
            </div>
          </div>
        </div>
      )}
      {customerBreakdownVersionId && customerModalView && (
        <>
          <div className="modal-overlay" data-scroll-lock="true" onClick={requestCustomerBreakdownModalClose}>
            <div className="modal-content wide" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <p className="modal-eyebrow">
                    {customerBreakdownMode === 'cost'
                      ? 'Customer Cost Breakdown'
                      : customerBreakdownMode === 'warranty'
                      ? 'Warranty Breakdown'
                      : 'Customer Cost and Warranty Breakdown'}
                  </p>
                  <h2>
                    {customerBreakdownMode === 'cost'
                      ? 'Job Cost Summary'
                      : customerBreakdownMode === 'warranty'
                      ? 'Warranty & Inclusions'
                      : 'Job Cost Summary & Warranty'}
                  </h2>
                </div>
                <div className="breakdown-header-actions">
                  <div className="export-control" ref={breakdownExportControlRef}>
                    <button
                      className={`action-button export-button ${breakdownExportOpen ? 'open' : ''}`}
                      type="button"
                      onClick={handleBreakdownExportToggle}
                      disabled={breakdownExporting || breakdownSaving}
                      aria-expanded={breakdownExportOpen}
                      aria-haspopup="listbox"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                        <path d="M5 7h6M5 9h6M5 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      Export
                    </button>
                    {breakdownExportOpen && (
                      <div className="export-dropdown" role="listbox">
                        <button
                          type="button"
                          className="export-option"
                          role="option"
                          onClick={handleBreakdownPrint}
                          disabled={breakdownExporting || breakdownSaving}
                        >
                          Print
                        </button>
                        <button
                          type="button"
                          className="export-option"
                          role="option"
                          onClick={handleBreakdownPdf}
                          disabled={breakdownExporting || breakdownSaving}
                        >
                          PDF
                        </button>
                      </div>
                    )}
                  </div>
                  <TooltipAnchor tooltip={!canEditCustomerBreakdownVersion ? customerBreakdownEditDisabledReason : undefined}>
                    <button
                      className="action-button primary"
                      type="button"
                      onClick={handleCustomerBreakdownSaveClick}
                      disabled={
                        !canEditCustomerBreakdownVersion ||
                        !customerBreakdownDirty ||
                        breakdownSaving ||
                        breakdownExporting
                      }
                    >
                      {breakdownSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </TooltipAnchor>
                  <button
                    className="modal-close"
                    onClick={requestCustomerBreakdownModalClose}
                    aria-label={
                      customerBreakdownMode === 'cost'
                        ? 'Close customer cost breakdown'
                        : customerBreakdownMode === 'warranty'
                        ? 'Close warranty breakdown'
                        : 'Close customer cost and warranty breakdown'
                    }
                  >
                    x
                  </button>
                </div>
              </div>
              <div className="modal-body-scroll">
                {customerBreakdownMode === 'warranty' ? (
                  <div className="customer-warranty-modal-body">
                    <SubmergeAdvantageWarranty
                      proposal={customerBreakdownPreviewProposal}
                      editable={canEditCustomerBreakdownVersion}
                      onWarrantySectionsChange={
                        canEditCustomerBreakdownVersion
                          ? handleCustomerWarrantySectionsDraftChange
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <CostBreakdownView
                    costBreakdown={customerBreakdownPreviewView!.costBreakdownForDisplay}
                    customerName={customerBreakdownPreviewView!.proposal.customerInfo.customerName}
                    proposal={customerBreakdownPreviewProposal}
                    pricing={customerBreakdownPreviewView!.pricing}
                    allowRetailAdjustments={canEditCustomerBreakdownVersion}
                    editableWarranty={
                      customerBreakdownMode === 'combined' && canEditCustomerBreakdownVersion
                    }
                    onRetailAdjustmentsChange={
                      canEditCustomerBreakdownVersion
                        ? handleCustomerRetailAdjustmentsDraftChange
                        : undefined
                    }
                    onWarrantySectionsChange={
                      customerBreakdownMode === 'combined' && canEditCustomerBreakdownVersion
                        ? handleCustomerWarrantySectionsDraftChange
                        : undefined
                    }
                    showWarranty={customerBreakdownMode === 'combined'}
                    showZoomControl={false}
                  />
                )}
              </div>
            </div>
          </div>
          {shouldRenderBreakdownExport && BreakdownCostExportPageComponent && BreakdownWarrantyExportPagesComponent && (
            <div
              className={`export-print-area ${breakdownExportActive ? 'print-mode' : ''}`}
              ref={breakdownExportAreaRef}
              aria-hidden="true"
            >
              {customerBreakdownMode !== 'warranty' && (
                <div className="export-breakdown-page export-breakdown-page--cost">
                  <BreakdownCostExportPageComponent
                    costBreakdown={customerBreakdownPreviewView!.costBreakdownForDisplay}
                    customerName={customerBreakdownPreviewView!.proposal.customerInfo.customerName}
                    proposal={customerBreakdownPreviewProposal}
                    pricing={customerBreakdownPreviewView!.pricing}
                  />
                </div>
              )}
              {customerBreakdownMode !== 'cost' && (
                <BreakdownWarrantyExportPagesComponent proposal={customerBreakdownPreviewProposal} />
              )}
            </div>
          )}
        </>
      )}
      {canViewCogsBreakdown && cogsBreakdownVersionId && cogsModalView && (
        <div className="modal-overlay" data-scroll-lock="true" onClick={() => setCogsBreakdownVersionId(null)}>
          <div className="modal-content cogs-breakdown-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-button" onClick={() => setCogsBreakdownVersionId(null)} aria-label="Close COGS breakdown">
              ×
            </button>

            <div className="cogs-header-info">
              <div className="cogs-header-bar">
                <div className="export-control" ref={breakdownExportControlRef}>
                  <button
                    className={`action-button export-button ${breakdownExportOpen ? 'open' : ''}`}
                    type="button"
                    onClick={handleBreakdownExportToggle}
                    disabled={breakdownExporting}
                    aria-expanded={breakdownExportOpen}
                    aria-haspopup="listbox"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                      <path d="M5 7h6M5 9h6M5 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                    Export
                  </button>
                  {breakdownExportOpen && (
                    <div className="export-dropdown" role="listbox">
                      <button
                        type="button"
                        className="export-option"
                        role="option"
                        onClick={handleBreakdownPrint}
                        disabled={breakdownExporting}
                      >
                        Print
                      </button>
                      <button
                        type="button"
                        className="export-option"
                        role="option"
                        onClick={handleBreakdownPdf}
                        disabled={breakdownExporting}
                      >
                        PDF
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="cogs-header-content">
                <div>
                  <p className="cogs-header-eyebrow">COGS Cost Breakdown</p>
                  <h2 className="cogs-header-title">Estimated Cost of Goods Sold</h2>
                  <div className="cogs-header-details">
                    <div className="cogs-header-detail-item">
                      <span className="cogs-header-detail-label">Customer:</span>
                      <span className="cogs-header-detail-value">{cogsModalView.proposal.customerInfo.customerName}</span>
                    </div>
                    <div className="cogs-header-detail-item">
                      <span className="cogs-header-detail-label">Date:</span>
                      <span className="cogs-header-detail-value">{new Date(cogsModalView.proposal.lastModified || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
                <div className="cogs-header-logo">
                  <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseLogoId} />
                </div>
              </div>
            </div>

            <div className="modal-body-scroll">
              {cogsModalView.costLineItems.length === 0 ? (
                <div className="empty-state">No cost breakdown available for this proposal.</div>
              ) : (
                <div className="cogs-categories-grid">
                  {cogsModalView.costLineItems.map((category) => (
                    <div className={`cogs-category-card ${getCategoryClassName(category.name)}`} key={category.name}>
                      <div className="cogs-category-card-header">
                        <div className="cogs-category-icon">
                          {getCategoryIcon(category.name)}
                        </div>
                        <div className="cogs-category-title-wrapper">
                          <h3 className="cogs-category-title">{category.name}</h3>
                          <div className="cogs-category-total">{formatCurrency(categoryTotal(category.items))}</div>
                        </div>
                      </div>

                      {category.subcategories && category.subcategories.length > 0 ? (
                        <div className="cogs-subcategories">
                          {(() => {
                            const baseItems = category.subcategories?.length
                              ? category.items.filter(item => !hasLineItemSubcategory(item))
                              : category.items;
                            if (category.hideBaseItems || baseItems.length === 0) return null;
                            return (
                              <table className="cogs-category-table">
                                <colgroup>
                                  <col style={{ width: '40%' }} />
                                  <col style={{ width: '10%' }} />
                                  <col style={{ width: '25%' }} />
                                  <col style={{ width: '25%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>Description</th>
                                    <th>Qty</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {baseItems.map((item, idx) => (
                                    <tr key={`${category.name}-base-${idx}`}>
                                      <td>{item.description}</td>
                                      <td>{renderQuantity(item)}</td>
                                      <td>{renderUnitPrice(item)}</td>
                                      <td>{renderTotal(item)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                          {category.subcategories.map((subcategory) => (
                            <div key={subcategory.name} className="cogs-subcategory">
                              <div className="cogs-subcategory-header">
                                <span className="cogs-subcategory-name">{subcategory.name}</span>
                                <span className="cogs-subcategory-total">
                                  {formatCurrency(categoryTotal(subcategory.items))}
                                </span>
                              </div>
                              <table className="cogs-category-table">
                                <colgroup>
                                  <col style={{ width: '40%' }} />
                                  <col style={{ width: '10%' }} />
                                  <col style={{ width: '25%' }} />
                                  <col style={{ width: '25%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>Description</th>
                                    <th>Qty</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {subcategory.items.map((item, idx) => (
                                    <tr key={`${category.name}-${subcategory.name}-${idx}`}>
                                      <td>{item.description}</td>
                                      <td>{renderQuantity(item)}</td>
                                      <td>{renderUnitPrice(item)}</td>
                                      <td>{renderTotal(item)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <table className="cogs-category-table">
                          <colgroup>
                            <col style={{ width: '40%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '25%' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>Description</th>
                              <th>Qty</th>
                              <th>Unit Price</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {category.items.map((item, idx) => (
                              <tr key={`${category.name}-${idx}`}>
                                <td>{item.description}</td>
                                <td>{renderQuantity(item)}</td>
                                <td>{renderUnitPrice(item)}</td>
                                <td>{renderTotal(item)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {cogsModalView.costLineItems.length > 0 && (
                <div className="cogs-footer">
                  <div className="cogs-footer-text">Total COGS: {formatCurrency(cogsModalView.totalCOGS)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {canViewCogsBreakdown && cogsBreakdownVersionId && cogsModalView && shouldRenderBreakdownExport && BreakdownCogsExportPagesComponent && (
        <div
          className={`export-print-area ${breakdownExportActive ? 'print-mode' : ''}`}
          ref={breakdownExportAreaRef}
          aria-hidden="true"
        >
          <BreakdownCogsExportPagesComponent
            categories={cogsModalView.costLineItems}
            proposal={cogsModalView.proposal}
            totalValue={cogsModalView.totalCOGS}
            totalLabel="Total COGS"
          />
        </div>
      )}

      {canViewCogsBreakdown && preCogsBreakdownVersionId && preCogsModalView && (
        <div className="modal-overlay" data-scroll-lock="true" onClick={() => setPreCogsBreakdownVersionId(null)}>
          <div className="modal-content cogs-breakdown-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-button" onClick={() => setPreCogsBreakdownVersionId(null)} aria-label="Close pre-COGS breakdown">
              A-
            </button>

            <div className="cogs-header-info">
              <div className="cogs-header-content">
                <div>
                  <p className="cogs-header-eyebrow">PRE OVERHEAD COGS COST BREAKDOWN</p>
                  <h2 className="cogs-header-title">Estimated Cost of Goods Sold (No 1% Overhead)</h2>
                  <div className="cogs-header-details">
                    <div className="cogs-header-detail-item">
                      <span className="cogs-header-detail-label">Customer:</span>
                      <span className="cogs-header-detail-value">{preCogsModalView.proposal.customerInfo.customerName}</span>
                    </div>
                    <div className="cogs-header-detail-item">
                      <span className="cogs-header-detail-label">Date:</span>
                      <span className="cogs-header-detail-value">{new Date(preCogsModalView.proposal.lastModified || Date.now()).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                  </div>
                </div>
                <div className="cogs-header-logo">
                  <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseLogoId} />
                </div>
              </div>
            </div>

            <div className="modal-body-scroll">
              {preCogsModalView.preOverheadCostLineItems.length === 0 ? (
                <div className="empty-state">No cost breakdown available for this proposal.</div>
              ) : (
                <div className="cogs-categories-grid">
                  {preCogsModalView.preOverheadCostLineItems.map((category) => (
                    <div className={`cogs-category-card ${getCategoryClassName(category.name)}`} key={category.name}>
                      <div className="cogs-category-card-header">
                        <div className="cogs-category-icon">
                          {getCategoryIcon(category.name)}
                        </div>
                        <div className="cogs-category-title-wrapper">
                          <h3 className="cogs-category-title">{category.name}</h3>
                          <div className="cogs-category-total">{formatCurrency(categoryTotal(category.items))}</div>
                        </div>
                      </div>

                      {category.subcategories && category.subcategories.length > 0 ? (
                        <div className="cogs-subcategories">
                          {(() => {
                            const baseItems = category.subcategories?.length
                              ? category.items.filter(item => !hasLineItemSubcategory(item))
                              : category.items;
                            if (category.hideBaseItems || baseItems.length === 0) return null;
                            return (
                              <table className="cogs-category-table">
                                <colgroup>
                                  <col style={{ width: '40%' }} />
                                  <col style={{ width: '10%' }} />
                                  <col style={{ width: '25%' }} />
                                  <col style={{ width: '25%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>Description</th>
                                    <th>Qty</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {baseItems.map((item, idx) => (
                                    <tr key={`${category.name}-base-${idx}`}>
                                      <td>{item.description}</td>
                                      <td>{renderQuantity(item)}</td>
                                      <td>{renderUnitPrice(item)}</td>
                                      <td>{renderTotal(item)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                          {category.subcategories.map((subcategory) => (
                            <div key={subcategory.name} className="cogs-subcategory">
                              <div className="cogs-subcategory-header">
                                <span className="cogs-subcategory-name">{subcategory.name}</span>
                                <span className="cogs-subcategory-total">
                                  {formatCurrency(categoryTotal(subcategory.items))}
                                </span>
                              </div>
                              <table className="cogs-category-table">
                                <colgroup>
                                  <col style={{ width: '40%' }} />
                                  <col style={{ width: '10%' }} />
                                  <col style={{ width: '25%' }} />
                                  <col style={{ width: '25%' }} />
                                </colgroup>
                                <thead>
                                  <tr>
                                    <th>Description</th>
                                    <th>Qty</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {subcategory.items.map((item, idx) => (
                                    <tr key={`${category.name}-${subcategory.name}-${idx}`}>
                                      <td>{item.description}</td>
                                      <td>{renderQuantity(item)}</td>
                                      <td>{renderUnitPrice(item)}</td>
                                  <td>{renderTotal(item)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <table className="cogs-category-table">
                          <colgroup>
                            <col style={{ width: '40%' }} />
                            <col style={{ width: '10%' }} />
                            <col style={{ width: '25%' }} />
                            <col style={{ width: '25%' }} />
                          </colgroup>
                          <thead>
                            <tr>
                              <th>Description</th>
                              <th>Qty</th>
                              <th>Unit Price</th>
                              <th>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {category.items.map((item, idx) => (
                              <tr key={`${category.name}-${idx}`}>
                                <td>{item.description}</td>
                                <td>{renderQuantity(item)}</td>
                                <td>{renderUnitPrice(item)}</td>
                                <td>{renderTotal(item)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {preCogsModalView.preOverheadCostLineItems.length > 0 && (
                <div className="cogs-footer">
                  <div className="cogs-footer-text">TOTAL COGS (No 1% Overhead): {formatCurrency(preCogsModalView.totalCOGSWithoutOverhead)}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <PricingRevisionPromptModal
        isOpen={
          pricingRevisionPromptOpen &&
          Boolean(pricingRevisionComparison) &&
          !customOptionPricingCorrection
        }
        pricingModelName={pricingRevisionComparison?.pricingModelName}
        busy={pricingRevisionBusy}
        onUpgrade={() => void handleUpgradePricingRevision()}
        onDecline={() => void handleDeclinePricingRevision()}
        onCompare={() => {
          setPricingRevisionBusy(true);
          setPricingRevisionError(null);
          void refreshPricingRevisionComparison()
            .then((currentComparison) => {
              if (!currentComparison) return;
              setPricingRevisionPromptOpen(false);
              setPricingRevisionComparisonOpen(true);
            })
            .catch((error: any) => {
              setPricingRevisionError(error?.message || 'Unable to load the newest pricing comparison.');
            })
            .finally(() => setPricingRevisionBusy(false));
        }}
      />

      <ConfirmDialog
        open={Boolean(customOptionPricingCorrection)}
        title="Custom-option pricing correction available"
        message={
          customOptionPricingCorrection
            ? `This proposal contains a category custom option that was reduced by an old PAP calculation. Review and apply the corrected price from ${formatCurrency(customOptionPricingCorrection.storedRetailPrice)} to ${formatCurrency(customOptionPricingCorrection.correctedRetailPrice)}?`
            : ''
        }
        confirmLabel="Apply corrected pricing"
        cancelLabel="Not now"
        isLoading={customOptionPricingCorrectionBusy}
        errorMessage={customOptionPricingCorrectionError}
        onConfirm={() => void handleApplyCustomOptionPricingCorrection()}
        onCancel={() => {
          dismissedCustomOptionCorrectionVersionRef.current =
            proposal?.versionId || activeVersionId || 'original';
          setCustomOptionPricingCorrection(null);
          setCustomOptionPricingCorrectionError(null);
        }}
      />

      <PricingRevisionComparisonModal
        isOpen={pricingRevisionComparisonOpen}
        comparison={pricingRevisionComparison}
        loading={pricingRevisionBusy}
        error={pricingRevisionError}
        onConfirm={() => void handleUpgradePricingRevision()}
        onDecline={() => void handleDeclinePricingRevision()}
        onClose={() => {
          setPricingRevisionComparisonOpen(false);
          if (
            pricingRevisionComparison &&
            proposal?.pricingRevisionReview?.latestRevisionId !== pricingRevisionComparison.latestRevisionId
          ) {
            setPricingRevisionPromptOpen(true);
          }
        }}
      />
      <ContractRevisionPromptModal
        isOpen={contractRevisionPromptOpen && Boolean(pendingContractRevision)}
        currentRevision={pendingContractRevision?.check.pinned.revisionNumber}
        latestRevision={pendingContractRevision?.check.latest.revisionNumber}
        busy={contractRevisionBusy}
        error={contractRevisionError}
        previewOnly={isProposalEditingRestricted}
        onUpgrade={() => void handleUpgradeContract()}
        onKeepCurrent={() => void handleKeepCurrentContract()}
        onClose={() => {
          if (contractRevisionBusy) return;
          setContractRevisionPromptOpen(false);
          setPendingContractRevision(null);
          setContractRevisionError(null);
        }}
      />
      <AddendumPricingChoiceModal
        isOpen={Boolean(addendumPricingComparison)}
        comparison={addendumPricingComparison}
        busy={addendumPricingBusy}
        onUseUpdated={() => {
          const comparison = addendumPricingComparison;
          setAddendumPricingComparison(null);
          void createEditableVersion(undefined, undefined, comparison);
        }}
        onUseOriginal={() => {
          setAddendumPricingComparison(null);
          void createEditableVersion();
        }}
        onCancel={() => setAddendumPricingComparison(null)}
      />

    </div>
  );
}

export default ProposalView;
