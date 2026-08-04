import type { Proposal } from '../types/proposal-new';

type RecentProposalOpen = {
  proposalNumber: string;
  openedAt: string;
};

type RecentProposalScope = {
  userId?: string | null;
  franchiseId?: string | null;
};

const STORAGE_PREFIX = 'submerge.recent-proposal-opens.v1';
const MAX_STORED_OPENS = 30;

function getStorageKey({ userId, franchiseId }: RecentProposalScope) {
  const normalizedUserId = String(userId || 'anonymous').trim() || 'anonymous';
  const normalizedFranchiseId = String(franchiseId || 'default').trim() || 'default';
  return `${STORAGE_PREFIX}:${encodeURIComponent(normalizedUserId)}:${encodeURIComponent(normalizedFranchiseId)}`;
}

function readRecentProposalOpens(scope: RecentProposalScope): RecentProposalOpen[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const raw = localStorage.getItem(getStorageKey(scope));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (entry): entry is RecentProposalOpen =>
          typeof entry?.proposalNumber === 'string' &&
          entry.proposalNumber.trim().length > 0 &&
          typeof entry?.openedAt === 'string' &&
          Number.isFinite(Date.parse(entry.openedAt))
      )
      .slice(0, MAX_STORED_OPENS);
  } catch (error) {
    console.warn('Unable to read recent proposal activity:', error);
    return [];
  }
}

export function recordRecentProposalOpen(
  proposalNumber: string,
  scope: RecentProposalScope
) {
  if (typeof localStorage === 'undefined') return;
  const normalizedProposalNumber = String(proposalNumber || '').trim();
  if (!normalizedProposalNumber) return;

  const nextEntries = [
    { proposalNumber: normalizedProposalNumber, openedAt: new Date().toISOString() },
    ...readRecentProposalOpens(scope).filter(
      (entry) => entry.proposalNumber !== normalizedProposalNumber
    ),
  ].slice(0, MAX_STORED_OPENS);

  try {
    localStorage.setItem(getStorageKey(scope), JSON.stringify(nextEntries));
  } catch (error) {
    console.warn('Unable to save recent proposal activity:', error);
  }
}

function getProposalModifiedTime(proposal: Proposal) {
  const timestamp = Date.parse(String(proposal.lastModified || proposal.createdDate || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getRecentActivityProposals(
  proposals: Proposal[],
  scope: RecentProposalScope,
  limit = 4
) {
  const proposalByNumber = new Map(
    proposals.map((proposal) => [proposal.proposalNumber, proposal] as const)
  );
  const selectedProposalNumbers = new Set<string>();
  const openedProposals: Proposal[] = [];

  for (const entry of readRecentProposalOpens(scope)) {
    const proposal = proposalByNumber.get(entry.proposalNumber);
    if (!proposal || selectedProposalNumbers.has(proposal.proposalNumber)) continue;
    openedProposals.push(proposal);
    selectedProposalNumbers.add(proposal.proposalNumber);
    if (openedProposals.length >= limit) return openedProposals;
  }

  const modifiedFillers = [...proposals]
    .filter((proposal) => !selectedProposalNumbers.has(proposal.proposalNumber))
    .sort((left, right) => getProposalModifiedTime(right) - getProposalModifiedTime(left));

  return [...openedProposals, ...modifiedFillers].slice(0, limit);
}
