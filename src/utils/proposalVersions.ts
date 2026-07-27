import { Proposal } from '../types/proposal-new';
import { getDefaultProposal } from './proposalDefaults';
import { getPricingTierName, normalizePricingTierId } from '../services/pricingTiers';

export const ORIGINAL_VERSION_ID = 'original';

const randomId = () => `version-${Math.random().toString(36).slice(2, 9)}`;

const cloneProposalVersionData = (proposal: Proposal): Proposal =>
  JSON.parse(JSON.stringify(proposal)) as Proposal;

const cloneFieldValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export type ProposalVersionCreationSource =
  | { mode: 'scratch' }
  | { mode: 'copy'; sourceVersionId?: string };

const stripNestedVersions = (proposal: Proposal): Proposal => {
  const clone: Proposal = { ...proposal };
  clone.versions = [];
  return clone;
};

const ensureVersionDefaults = (proposal: Proposal, defaultName?: string): Proposal => {
  const versionId = proposal.versionId || ORIGINAL_VERSION_ID;
  const versionName =
    proposal.versionName ||
    defaultName ||
    (proposal.isOriginalVersion ? 'Original Version' : 'Version');
  const activeVersionId = proposal.activeVersionId || versionId;
  return {
    ...proposal,
    versionId,
    versionName,
    activeVersionId,
  };
};

const inheritSharedVersionMetadata = (container: Proposal, version: Proposal): Proposal => {
  const resolvedFranchiseId = version.franchiseId || container.franchiseId;
  const canInheritContainerPricingModel = version.versionCreationMode !== 'scratch';
  const resolvedPricingModelId =
    version.pricingModelId ||
    (canInheritContainerPricingModel ? container.pricingModelId : undefined);
  const resolvedPricingTierId = normalizePricingTierId(
    version.pricingTierId ||
      version.pricingTierName ||
      container.pricingTierId ||
      container.pricingTierName
  );
  const canReuseContainerPricingMeta =
    canInheritContainerPricingModel &&
    (!version.pricingModelId || version.pricingModelId === container.pricingModelId);
  const canReuseContainerPricingRevision =
    canReuseContainerPricingMeta && !version.pricingModelId;

  return {
    ...version,
    proposalNumber: version.proposalNumber || container.proposalNumber,
    franchiseId: resolvedFranchiseId,
    designerName: version.designerName || container.designerName,
    designerRole: version.designerRole || container.designerRole,
    designerCode: version.designerCode || container.designerCode,
    pricingModelId: resolvedPricingModelId,
    pricingModelName:
      version.pricingModelName ||
      (canReuseContainerPricingMeta ? container.pricingModelName : undefined),
    pricingModelFranchiseId:
      version.pricingModelFranchiseId ||
      (canReuseContainerPricingMeta ? container.pricingModelFranchiseId : undefined) ||
      (resolvedPricingModelId ? resolvedFranchiseId : undefined),
    pricingModelIsDefault:
      version.pricingModelIsDefault ??
      (canReuseContainerPricingMeta ? container.pricingModelIsDefault : undefined),
    pricingModelRevisionId:
      version.pricingModelRevisionId ||
      (canReuseContainerPricingRevision ? container.pricingModelRevisionId : undefined),
    pricingModelRevisionNumber:
      version.pricingModelRevisionNumber ??
      (canReuseContainerPricingRevision ? container.pricingModelRevisionNumber : undefined),
    pricingRevisionReview:
      version.pricingRevisionReview ??
      (canReuseContainerPricingRevision ? container.pricingRevisionReview : undefined),
    pricingTierId: resolvedPricingTierId,
    pricingTierName: getPricingTierName(resolvedPricingTierId),
  };
};

export const listAllVersions = (proposal: Proposal): Proposal[] => {
  const normalized = ensureVersionDefaults(proposal);
  const baseVersion: Proposal = stripNestedVersions({
    ...normalized,
    isOriginalVersion: normalized.isOriginalVersion ?? true,
  });

  const extraVersions = (normalized.versions || []).map((entry) => {
    const normalizedEntry = inheritSharedVersionMetadata(
      normalized,
      ensureVersionDefaults(entry)
    );
    return stripNestedVersions({
      ...normalizedEntry,
      workflow: normalizedEntry.workflow || normalized.workflow,
      isOriginalVersion: normalizedEntry.isOriginalVersion ?? false,
    });
  });

  const seen = new Set<string>();
  const all = [baseVersion, ...extraVersions].filter((version) => {
    const id = version.versionId || ORIGINAL_VERSION_ID;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return all;
};

export const applyActiveVersion = (proposal: Proposal): Proposal => {
  const normalized = ensureVersionDefaults(proposal);
  const allVersions = listAllVersions(normalized);
  const targetId =
    normalized.activeVersionId || normalized.versionId || ORIGINAL_VERSION_ID;
  const active =
    allVersions.find((v) => (v.versionId || ORIGINAL_VERSION_ID) === targetId) ||
    allVersions[0] ||
    stripNestedVersions({
      ...normalized,
      versionId: targetId || ORIGINAL_VERSION_ID,
    });
  const otherVersions = allVersions.filter(
    (v) => (v.versionId || ORIGINAL_VERSION_ID) !== (active.versionId || ORIGINAL_VERSION_ID)
  );

  const mergedActive: Proposal = {
    ...active,
    status: proposal.status || active.status || 'draft',
    versionId: active.versionId || targetId || ORIGINAL_VERSION_ID,
    versionName:
      active.versionName ||
      (active.isOriginalVersion ? 'Original Version' : 'Version'),
    activeVersionId: targetId || active.versionId || ORIGINAL_VERSION_ID,
    versions: otherVersions,
    workflow: proposal.workflow || active.workflow,
  };

  // Preserve sync status/message from the container if the active version lacks it
  const syncStatus = (active as any).syncStatus || (proposal as any).syncStatus;
  const syncMessage = (active as any).syncMessage || (proposal as any).syncMessage;
  if (syncStatus) {
    (mergedActive as any).syncStatus = syncStatus;
  }
  if (syncMessage) {
    (mergedActive as any).syncMessage = syncMessage;
  }

  return mergedActive;
};

const nextVersionName = (proposal: Proposal): string => {
  const all = listAllVersions(proposal);
  const suffix = all.length;
  return `Version ${suffix}`;
};

const COPYABLE_VERSION_FIELDS: Array<keyof Proposal> = [
  // A copied version is a financial snapshot of its source. Keep every input,
  // pricing pin, and calculated value that determines what the customer sees.
  // Workflow/identity/lock fields are intentionally excluded and are reset
  // when newVersion is assembled below.
  'customerInfo',
  'poolSpecs',
  'excavation',
  'plumbing',
  'electrical',
  'tileCopingDecking',
  'drainage',
  'equipment',
  'waterFeatures',
  'customFeatures',
  'masonry',
  'interiorFinish',
  'pricingModelId',
  'pricingModelName',
  'pricingModelFranchiseId',
  'pricingModelIsDefault',
  'pricingModelRevisionId',
  'pricingModelRevisionNumber',
  'pricingRevisionReview',
  'pricingTierId',
  'pricingTierName',
  'costBreakdown',
  'papDiscounts',
  'manualAdjustments',
  'retailAdjustments',
  'pricing',
  'subtotal',
  'taxRate',
  'taxAmount',
  'totalCost',
  'notes',
  'contractOverrides',
  'contractTemplateId',
  'contractTemplateRevisionId',
  'contractTemplateRevisionNumber',
  'contractRevisionReview',
  'contractTemplateRevision',
  'warrantySections',
];

const buildVersionDraftSeed = (
  container: Proposal,
  source: Proposal,
  creationSource: ProposalVersionCreationSource
): Proposal => {
  const defaults = cloneProposalVersionData(getDefaultProposal() as Proposal);
  const sourceSnapshot = cloneProposalVersionData(source);
  const sharedMetadata = {
    proposalNumber: sourceSnapshot.proposalNumber || container.proposalNumber || defaults.proposalNumber,
    franchiseId: sourceSnapshot.franchiseId || container.franchiseId || defaults.franchiseId,
    designerName: sourceSnapshot.designerName || container.designerName || defaults.designerName,
    designerRole: sourceSnapshot.designerRole || container.designerRole || defaults.designerRole,
    designerCode: sourceSnapshot.designerCode || container.designerCode || defaults.designerCode,
  };

  if (creationSource.mode === 'scratch') {
    return stripNestedVersions({
      ...defaults,
      ...sharedMetadata,
      customerInfo: {
        ...(defaults.customerInfo || {}),
        customerName: sourceSnapshot.customerInfo?.customerName || '',
        city: sourceSnapshot.customerInfo?.city || '',
        state: sourceSnapshot.customerInfo?.state || defaults.customerInfo?.state || 'NC',
      } as Proposal['customerInfo'],
    } as Proposal);
  }

  const copiedFields = COPYABLE_VERSION_FIELDS.reduce<Partial<Proposal>>((accumulator, field) => {
    const value = sourceSnapshot[field];
    if (value !== undefined) {
      (accumulator as Record<string, unknown>)[field] = cloneFieldValue(value);
    }
    return accumulator;
  }, {});

  return stripNestedVersions({
    ...defaults,
    ...sharedMetadata,
    ...copiedFields,
  } as Proposal);
};

export const createVersionFromProposal = (
  proposal: Proposal,
  sourceVersion?: ProposalVersionCreationSource | string,
  explicitName?: string
): { container: Proposal; newVersion: Proposal } => {
  const normalized = ensureVersionDefaults(proposal);
  const allVersions = listAllVersions(normalized);
  const now = new Date().toISOString();
  const creationSource: ProposalVersionCreationSource =
    typeof sourceVersion === 'string' || !sourceVersion
      ? { mode: 'copy', sourceVersionId: typeof sourceVersion === 'string' ? sourceVersion : undefined }
      : sourceVersion;
  const sourceVersionId =
    creationSource.mode === 'copy' ? creationSource.sourceVersionId : undefined;
  const source =
    allVersions.find((v) => v.versionId === sourceVersionId) ||
    allVersions.find((v) => v.versionId === normalized.activeVersionId) ||
    allVersions[0];
  const sourceSnapshot = cloneProposalVersionData(source || normalized);
  const draftSeed = buildVersionDraftSeed(normalized, sourceSnapshot, creationSource);

  const newVersion: Proposal = stripNestedVersions({
    ...draftSeed,
    versionId: randomId(),
    versionName: explicitName || nextVersionName(normalized),
    versionCreationMode: creationSource.mode,
    isOriginalVersion: false,
    status: 'draft',
    versionLocked: false,
    versionLockedAt: null,
    versionSubmittedAt: null,
    versionSubmittedBy: null,
    createdDate: now,
    lastModified: now,
  });

  const currentActiveVersionId = normalized.activeVersionId || normalized.versionId || ORIGINAL_VERSION_ID;
  const active =
    allVersions.find((v) => (v.versionId || ORIGINAL_VERSION_ID) === currentActiveVersionId) ||
    stripNestedVersions({ ...normalized, versionId: currentActiveVersionId });
  const remaining = allVersions.filter(
    (v) => (v.versionId || ORIGINAL_VERSION_ID) !== (active.versionId || ORIGINAL_VERSION_ID)
  );
  const nextActiveVersionId = active.versionId || currentActiveVersionId || ORIGINAL_VERSION_ID;

  const container: Proposal = {
    ...normalized,
    ...active,
    status: normalized.status,
    workflow: normalized.workflow,
    lastModified: now,
    activeVersionId: nextActiveVersionId,
    versions: [...remaining, newVersion],
  };

  return { container, newVersion };
};

export const upsertVersionInContainer = (
  container: Proposal,
  version: Proposal,
  activeVersionId?: string
): Proposal => {
  const normalizedContainer = ensureVersionDefaults(container);
  const targetId = version.versionId || normalizedContainer.versionId || ORIGINAL_VERSION_ID;
  const sanitizedVersion = stripNestedVersions(
    ensureVersionDefaults(version, version.versionName)
  );

  const allVersions = listAllVersions(normalizedContainer);
  const nextVersions = allVersions.map((v) =>
    (v.versionId || ORIGINAL_VERSION_ID) === (sanitizedVersion.versionId || targetId)
      ? { ...sanitizedVersion }
      : v
  );
  if (!nextVersions.some((v) => v.versionId === sanitizedVersion.versionId)) {
    nextVersions.push(sanitizedVersion);
  }

  const desiredActiveId =
    activeVersionId || normalizedContainer.activeVersionId || targetId || ORIGINAL_VERSION_ID;
  const active =
    nextVersions.find((v) => v.versionId === desiredActiveId) || sanitizedVersion;
  const others = nextVersions.filter((v) => v.versionId !== active.versionId);

  return {
    ...normalizedContainer,
    ...active,
    status: normalizedContainer.status,
    workflow: normalizedContainer.workflow,
    activeVersionId: desiredActiveId,
    versions: others,
  };
};
