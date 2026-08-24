import type { Proposal } from '../types/proposal-new';

export const UNSAFE_PROPOSAL_OVERWRITE_CODE = 'UNSAFE_PROPOSAL_OVERWRITE';

export type LoadedProposalIdentity = {
  proposalNumber: string;
  createdDate?: string;
  customerName?: string;
};

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sameTimestamp(left: unknown, right: unknown) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (!normalizedLeft || !normalizedRight) return normalizedLeft === normalizedRight;
  if (normalizedLeft === normalizedRight) return true;

  const leftTimestamp = Date.parse(normalizedLeft);
  const rightTimestamp = Date.parse(normalizedRight);
  return Number.isFinite(leftTimestamp) && Number.isFinite(rightTimestamp) && leftTimestamp === rightTimestamp;
}

function readRetailTotal(proposal: Partial<Proposal>) {
  const candidates = [
    (proposal as any)?.pricing?.retailPrice,
    proposal.totalCost,
    (proposal as any)?.retailPrice,
    proposal.subtotal,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function serializedSize(proposal: Partial<Proposal>) {
  try {
    return JSON.stringify(proposal).length;
  } catch (_) {
    return 0;
  }
}

function listVersionSnapshots(proposal: Partial<Proposal>) {
  const nestedVersions = Array.isArray(proposal.versions) ? proposal.versions : [];
  return [proposal, ...nestedVersions];
}

function versionIdOf(proposal: Partial<Proposal>) {
  return normalizeText(proposal.versionId) || 'original';
}

function replacesExistingVersionCreationDate(
  candidate: Partial<Proposal>,
  existing: Partial<Proposal>
) {
  // A proposal container's top level is the active version snapshot. Compare
  // matching version IDs so selecting a newer version is not mistaken for
  // rewriting the previously active version's creation date.
  const existingVersionsById = new Map(
    listVersionSnapshots(existing).map((version) => [versionIdOf(version), version])
  );

  return listVersionSnapshots(candidate).some((candidateVersion) => {
    const existingVersion = existingVersionsById.get(versionIdOf(candidateVersion));
    const existingCreatedDate = normalizeText(existingVersion?.createdDate);
    return (
      Boolean(existingCreatedDate) &&
      !sameTimestamp(candidateVersion.createdDate, existingCreatedDate)
    );
  });
}

export function buildLoadedProposalIdentity(proposal: Partial<Proposal>): LoadedProposalIdentity {
  return {
    proposalNumber: normalizeText(proposal.proposalNumber),
    createdDate: normalizeText(proposal.createdDate) || undefined,
    customerName: normalizeText(proposal.customerInfo?.customerName) || undefined,
  };
}

export function getExistingProposalSaveBlockReason(options: {
  routeProposalNumber: string;
  hydratedProposalNumber?: string | null;
  proposal: Partial<Proposal>;
  baseline?: LoadedProposalIdentity | null;
}) {
  const routeProposalNumber = normalizeText(options.routeProposalNumber);
  const hydratedProposalNumber = normalizeText(options.hydratedProposalNumber);
  const proposalNumber = normalizeText(options.proposal.proposalNumber);

  if (!routeProposalNumber || hydratedProposalNumber !== routeProposalNumber) {
    return 'This proposal has not finished loading. Nothing was saved.';
  }
  if (proposalNumber !== routeProposalNumber) {
    return 'The loaded proposal identity does not match the proposal being edited. Nothing was saved.';
  }

  const baseline = options.baseline;
  if (!baseline || normalizeText(baseline.proposalNumber) !== routeProposalNumber) {
    return 'The original proposal identity is unavailable. Nothing was saved.';
  }
  if (baseline.createdDate && !sameTimestamp(options.proposal.createdDate, baseline.createdDate)) {
    return 'The proposal creation date changed while the proposal was open. Nothing was saved.';
  }
  if (baseline.customerName && !normalizeText(options.proposal.customerInfo?.customerName)) {
    return 'The customer name disappeared while the proposal was open. Nothing was saved.';
  }

  return null;
}

export function getUnsafeProposalOverwriteReason(
  candidate: Partial<Proposal>,
  existing?: Partial<Proposal> | null
) {
  if (!existing) return null;

  const candidateNumber = normalizeText(candidate.proposalNumber);
  const existingNumber = normalizeText(existing.proposalNumber);
  if (!candidateNumber || !existingNumber || candidateNumber !== existingNumber) {
    return 'The incoming proposal number does not match the stored proposal.';
  }

  const existingCustomerName = normalizeText(existing.customerInfo?.customerName);
  const candidateCustomerName = normalizeText(candidate.customerInfo?.customerName);
  const existingRetailTotal = readRetailTotal(existing);
  const candidateRetailTotal = readRetailTotal(candidate);
  const candidateRepairsCollapsedExistingProposal =
    !existingCustomerName &&
    Boolean(candidateCustomerName) &&
    existingRetailTotal <= 0 &&
    candidateRetailTotal > 0;

  if (
    replacesExistingVersionCreationDate(candidate, existing) &&
    !candidateRepairsCollapsedExistingProposal
  ) {
    return 'The incoming proposal would replace the original creation date.';
  }

  if (existingCustomerName && !candidateCustomerName) {
    return 'The incoming proposal would remove the stored customer name.';
  }

  const existingSize = serializedSize(existing);
  const candidateSize = serializedSize(candidate);
  const isSevereStructuralCollapse =
    existingSize >= 12_000 &&
    candidateSize > 0 &&
    candidateSize < existingSize * 0.45 &&
    existingRetailTotal > 0 &&
    candidateRetailTotal <= 0;
  if (isSevereStructuralCollapse) {
    return 'The incoming proposal is unexpectedly much smaller and would replace a priced proposal with zero-value defaults.';
  }

  return null;
}

export function createUnsafeProposalOverwriteError(reason: string) {
  const error = new Error(`Proposal safety check blocked this save. ${reason}`);
  (error as any).code = UNSAFE_PROPOSAL_OVERWRITE_CODE;
  return error;
}

export function isUnsafeProposalOverwriteError(error: unknown) {
  return (error as any)?.code === UNSAFE_PROPOSAL_OVERWRITE_CODE;
}
