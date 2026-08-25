import { Proposal } from '../types/proposal-new';
import { getSupabaseClient, hasSupabaseConnection, isSupabaseEnabled } from './supabaseClient';
import {
  DEFAULT_FRANCHISE_ID,
  UserSession,
  getSessionFranchiseCode,
  getSessionFranchiseId,
  getSessionRole,
  getSessionUserName,
  isMasterActingAsOwnerSession,
  isMasterSession,
  isTestSession,
  readSession,
} from './session';
import { isEnvFlagTrue } from './env';
import { applyActiveVersion } from '../utils/proposalVersions';
import { sanitizeEditableProposalVersions } from '../utils/proposalSelectionSanitizer';
import { removeHardcodedPapDiscountsFromProposal } from '../utils/papDiscounts';
import { isCloudOnlyRenderRecoveryEnabled } from './renderRecovery';
import { logLedgerEventSafe } from './ledger';
import { upgradeProposalContractTemplateRevision } from './contractTemplateUpgrade';
import { countUnreadWorkflowEvents, ensureProposalWorkflow, getWorkflowStatus } from './proposalWorkflow';
import {
  createUnsafeProposalOverwriteError,
  getUnsafeProposalOverwriteReason,
  isUnsafeProposalOverwriteError,
} from '../utils/proposalPersistenceSafety';

const SUPABASE_REQUIRED = isEnvFlagTrue('VITE_SUPABASE_ONLY');
const STAGING_DIAGNOSTICS =
  String(import.meta.env.VITE_SUBMERGE_ENVIRONMENT || '').trim().toLowerCase() === 'staging';
const OFFLINE_ERROR_MESSAGE = 'No internet connection. Please reconnect to continue.';
export const MASTER_INSPECTION_READ_ONLY_MESSAGE =
  'Master accounts have read-only access to franchise proposals. Sign in as an authorized franchise user to make changes.';
export const MASTER_PROPOSAL_OWNERSHIP_MESSAGE =
  'Master accounts can only change proposals they created in the master area.';

type SaveResult = Proposal & { lastModified: string };
type SyncStatus = 'synced' | 'pending' | 'error';
type SaveProposalOptions = {
  ledgerAction?: 'proposal_submitted';
  requireOnline?: boolean;
  localOnly?: boolean;
};
type Tombstone = { proposalNumber: string; removedAt: string };
type StoredProposalRow = {
  proposal_json?: Proposal;
  franchise_id?: string | null;
  designer_auth_user_id?: string | null;
  designer_name?: string | null;
  designer_role?: UserSession['role'] | null;
  designer_code?: string | null;
  status?: string | null;
};
type WorkflowUnreadProjectionRow = {
  proposal_number?: string | null;
  status?: string | null;
  workflow?: Proposal['workflow'] | null;
  version_id?: string | null;
  proposal_status?: string | null;
};

export type LocalProposalLoadIssue = {
  proposalNumber?: string;
  customerName?: string;
  fileName?: string;
  reason: 'unreadable_file' | 'invalid_data' | 'local_only' | 'newer_local_changes';
  detail?: string;
};

type LocalProposalFileEntry = {
  proposal: Proposal;
  fileName?: string;
};

const PENDING_MESSAGE = 'Awaiting cloud sync';
const ONLINE_SYNC_MESSAGE = 'Synced with cloud';
const PENDING_DELETE_STORAGE_KEY = 'submerge.pendingProposalDeletes';
const DELETED_TOMBSTONES_STORAGE_KEY = 'submerge.deletedProposalTombstones';
const LOCAL_PROPOSAL_OWNERS_STORAGE_KEY = 'submerge.localProposalOwners.v1';
const RECOVERY_SNAPSHOTS_STORAGE_KEY = 'submerge.proposalRecoverySnapshots.v1';
const MAX_RECOVERY_SNAPSHOTS = 12;
export const PROPOSAL_CLOUD_SYNC_EVENT = 'submerge:proposal-cloud-sync';
const PRODUCTION_PROPOSALS_TABLE = 'franchise_proposals';
const TEST_PROPOSALS_TABLE = 'franchise_test_proposals';

function getProposalTableName() {
  return isTestSession() ? TEST_PROPOSALS_TABLE : PRODUCTION_PROPOSALS_TABLE;
}

let localProposalLoadIssues: LocalProposalLoadIssue[] = [];
let bypassedLocalProposals: Proposal[] = [];

function dedupeLocalProposalLoadIssues(issues: LocalProposalLoadIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = [issue.reason, issue.proposalNumber, issue.fileName].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readSafeText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function getLocalProposalLoadIssues(): LocalProposalLoadIssue[] {
  return localProposalLoadIssues.map((issue) => ({ ...issue }));
}

function isTestProposalNumber(proposalNumber?: string | null) {
  return String(proposalNumber || '').trim().toUpperCase().startsWith('TEST-');
}

function isProposalNumberForCurrentMode(proposalNumber?: string | null) {
  return isTestSession() === isTestProposalNumber(proposalNumber);
}

function getTestProposalNumber(proposalNumber?: string | null) {
  const current = String(proposalNumber || '').trim();
  if (!isTestSession() || current.startsWith('TEST-')) return current;
  const code = String(getSessionFranchiseCode() || 'FRANCHISE').replace(/[^a-z0-9-]/gi, '').toUpperCase();
  const suffix = current.replace(/^PROP-/i, '') || String(Date.now());
  return `TEST-${code}-${suffix}`;
}

function proposalOwnershipColumnUnavailable(error: any) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (message.includes('designer_auth_user_id') &&
      (message.includes('column') || message.includes('schema cache')))
  );
}

export type ProposalRecoverySnapshot = {
  id: string;
  proposalNumber: string;
  losingLastModified?: string | null;
  winnerLastModified?: string | null;
  reason: 'cloud_newer' | 'local_newer';
  archivedAt: string;
  proposal: Proposal;
};

type PendingDelete = { proposalNumber: string; franchiseId?: string | null };
type LocalProposalOwner = {
  proposalNumber: string;
  userId?: string | null;
  userEmail?: string | null;
  franchiseId?: string | null;
  updatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

function coerceTimestamp(value?: string | null): number {
  const ts = value ? Date.parse(value) : NaN;
  return Number.isFinite(ts) ? ts : 0;
}

export function listProposalRecoverySnapshots(): ProposalRecoverySnapshot[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECOVERY_SNAPSHOTS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function archiveLosingProposalSnapshot(
  proposal: Proposal,
  reason: ProposalRecoverySnapshot['reason'],
  winner?: Proposal | null
) {
  if (typeof localStorage === 'undefined' || !proposal?.proposalNumber) return;
  try {
    const losingLastModified = proposal.lastModified || proposal.createdDate || null;
    const id = `${proposal.proposalNumber}:${losingLastModified || 'unknown'}:${reason}`;
    const existing = listProposalRecoverySnapshots().filter((entry) => entry.id !== id);
    const snapshot: ProposalRecoverySnapshot = {
      id,
      proposalNumber: proposal.proposalNumber,
      losingLastModified,
      winnerLastModified: winner?.lastModified || winner?.createdDate || null,
      reason,
      archivedAt: nowIso(),
      proposal: { ...proposal },
    };
    localStorage.setItem(
      RECOVERY_SNAPSHOTS_STORAGE_KEY,
      JSON.stringify([snapshot, ...existing].slice(0, MAX_RECOVERY_SNAPSHOTS))
    );
  } catch (error) {
    console.warn('Unable to preserve proposal recovery snapshot:', error);
  }
}

function normalizeIdentity(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function isMasterOwnedProposal(proposal: Proposal, session?: UserSession | null) {
  const currentSession = session ?? readSession();
  const currentUserId = normalizeIdentity(currentSession?.userId);
  const proposalOwnerId = normalizeIdentity(proposal.designerAuthUserId);
  const proposalFranchiseId = proposal.franchiseId || DEFAULT_FRANCHISE_ID;
  return Boolean(
    currentUserId &&
    proposalOwnerId &&
    currentUserId === proposalOwnerId &&
    proposalFranchiseId === DEFAULT_FRANCHISE_ID
  );
}

function assertMasterProposalMutationAllowed(proposal: Proposal, session?: UserSession | null) {
  if (!isMasterSession()) return;
  if (isMasterActingAsOwnerSession()) {
    throw new Error(MASTER_INSPECTION_READ_ONLY_MESSAGE);
  }
  if (!isMasterOwnedProposal(proposal, session)) {
    throw new Error(MASTER_PROPOSAL_OWNERSHIP_MESSAGE);
  }
}

function normalizeUserKey(session?: UserSession | null) {
  return normalizeIdentity(session?.userId || session?.userEmail);
}

function getCurrentUserIdentity(session?: UserSession | null) {
  const currentSession = session ?? readSession();
  return normalizeIdentity(currentSession?.userName || currentSession?.userEmail);
}

function getEffectiveRole(session?: UserSession | null) {
  const role = getSessionRole((session?.role || 'designer') as any);
  return String(role || session?.role || 'designer').trim().toLowerCase();
}

function isOwnProposal(proposal: Proposal, session?: UserSession | null) {
  const proposalDesigner = normalizeIdentity((proposal as any).designerName);
  const currentUserName = getCurrentUserIdentity(session);
  return Boolean(proposalDesigner && currentUserName && proposalDesigner === currentUserName);
}

function isSubmittedStatus(status?: string | null) {
  const normalized = normalizeIdentity(status);
  return (
    normalized === 'submitted' ||
    normalized === 'approved' ||
    normalized === 'signed' ||
    normalized === 'needs_approval' ||
    normalized === 'changes_requested'
  );
}

function canAttemptProposalWrite(proposal: Proposal, session?: UserSession | null, franchiseId?: string) {
  if (isMasterActingAsOwnerSession()) return false;
  if (!isProposalNumberForCurrentMode(proposal.proposalNumber)) return false;
  if (isMasterSession()) return isMasterOwnedProposal(proposal, session);
  const role = getEffectiveRole(session);
  const targetFranchiseId = proposal.franchiseId || franchiseId || session?.franchiseId || DEFAULT_FRANCHISE_ID;
  const activeFranchiseId = getSessionFranchiseId();

  if (role !== 'master' && targetFranchiseId !== activeFranchiseId) {
    return false;
  }

  if (role === 'master' || role === 'owner' || role === 'admin') {
    return true;
  }

  if (!normalizeIdentity((proposal as any).designerName)) {
    return true;
  }

  const currentUserName = getCurrentUserIdentity(session) || normalizeIdentity(getSessionUserName());
  return !currentUserName || isOwnProposal(proposal, session);
}

function canReadProposal(proposal: Proposal, session?: UserSession | null) {
  const role = getEffectiveRole(session);
  if (role === 'master') return true;
  if (isOwnProposal(proposal, session)) return true;
  if (role === 'owner' || role === 'admin') {
    return isSubmittedStatus(getWorkflowStatus(proposal)) || getWorkflowStatus(proposal) === 'completed';
  }
  if (role === 'bookkeeper') {
    const status = getWorkflowStatus(proposal);
    return (
      status === 'submitted' ||
      status === 'approved' ||
      status === 'signed' ||
      status === 'needs_approval' ||
      status === 'changes_requested' ||
      status === 'completed'
    );
  }
  return false;
}

let localProposalOwnerCache: Record<string, LocalProposalOwner> | null = null;

function loadLocalProposalOwners(): Record<string, LocalProposalOwner> {
  if (localProposalOwnerCache) return localProposalOwnerCache;
  if (typeof localStorage === 'undefined') {
    localProposalOwnerCache = {};
    return localProposalOwnerCache;
  }
  try {
    const raw = localStorage.getItem(LOCAL_PROPOSAL_OWNERS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, LocalProposalOwner>) : {};
    localProposalOwnerCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('Unable to read local proposal owners from localStorage:', error);
    localProposalOwnerCache = {};
  }
  return localProposalOwnerCache;
}

function persistLocalProposalOwners(records: Record<string, LocalProposalOwner>) {
  localProposalOwnerCache = records;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_PROPOSAL_OWNERS_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('Unable to persist local proposal owners to localStorage:', error);
  }
}

function getLocalProposalOwner(proposalNumber?: string | null) {
  if (!proposalNumber) return null;
  return loadLocalProposalOwners()[proposalNumber] || null;
}

function setLocalProposalOwner(proposalNumber: string, session?: UserSession | null, franchiseId?: string | null) {
  if (!proposalNumber) return;
  const currentSession = session ?? readSession();
  const userId = normalizeIdentity(currentSession?.userId);
  const userEmail = normalizeIdentity(currentSession?.userEmail);
  if (!userId && !userEmail) return;

  const records = { ...loadLocalProposalOwners() };
  records[proposalNumber] = {
    proposalNumber,
    userId: userId || undefined,
    userEmail: userEmail || undefined,
    franchiseId: franchiseId || currentSession?.franchiseId || undefined,
    updatedAt: nowIso(),
  };
  persistLocalProposalOwners(records);
}

function clearLocalProposalOwner(proposalNumber: string) {
  const records = loadLocalProposalOwners();
  if (!records[proposalNumber]) return;
  const next = { ...records };
  delete next[proposalNumber];
  persistLocalProposalOwners(next);
}

function isLocalProposalVisibleToSession(proposal: Proposal, session?: UserSession | null) {
  const currentSession = session ?? readSession();
  if (!currentSession) return false;

  const owner = getLocalProposalOwner(proposal.proposalNumber);
  const sessionUserKey = normalizeUserKey(currentSession);
  const ownerUserKey = normalizeIdentity(owner?.userId || owner?.userEmail);
  if (sessionUserKey && ownerUserKey) {
    return sessionUserKey === ownerUserKey;
  }

  // Backward compatibility for proposals cached before owner tracking existed.
  return isOwnProposal(proposal, currentSession);
}

let pendingDeleteCache: PendingDelete[] | null = null;

function loadPendingDeletes(): PendingDelete[] {
  if (pendingDeleteCache) return pendingDeleteCache;
  if (typeof localStorage === 'undefined') {
    pendingDeleteCache = [];
    return pendingDeleteCache;
  }
  try {
    const raw = localStorage.getItem(PENDING_DELETE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PendingDelete[]) : [];
    pendingDeleteCache = Array.isArray(parsed) ? parsed.filter((r) => !!r?.proposalNumber) : [];
  } catch (error) {
    console.warn('Unable to read pending deletes from localStorage:', error);
    pendingDeleteCache = [];
  }
  return pendingDeleteCache;
}

function persistPendingDeletes(records: PendingDelete[]) {
  pendingDeleteCache = records;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PENDING_DELETE_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('Unable to persist pending deletes to localStorage:', error);
  }
}

function clearPendingDelete(proposalNumber: string) {
  const current = loadPendingDeletes();
  const filtered = current.filter((r) => r.proposalNumber !== proposalNumber);
  if (filtered.length !== current.length) {
    persistPendingDeletes(filtered);
  }
}

function isPendingDelete(proposalNumber: string) {
  return isProposalNumberForCurrentMode(proposalNumber) &&
    loadPendingDeletes().some((r) => r.proposalNumber === proposalNumber);
}

function getPendingDeleteSet(): Set<string> {
  return new Set(
    loadPendingDeletes()
      .filter((record) => isProposalNumberForCurrentMode(record.proposalNumber))
      .map((record) => record.proposalNumber)
  );
}

let tombstoneCache: Tombstone[] | null = null;

function loadDeletedTombstones(): Tombstone[] {
  if (tombstoneCache) return tombstoneCache;
  if (typeof localStorage === 'undefined') {
    tombstoneCache = [];
    return tombstoneCache;
  }
  try {
    const raw = localStorage.getItem(DELETED_TOMBSTONES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Tombstone[]) : [];
    tombstoneCache = Array.isArray(parsed) ? parsed.filter((r) => !!r?.proposalNumber) : [];
  } catch (error) {
    console.warn('Unable to read delete tombstones from localStorage:', error);
    tombstoneCache = [];
  }
  return tombstoneCache;
}

function persistDeletedTombstones(records: Tombstone[]) {
  tombstoneCache = records;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DELETED_TOMBSTONES_STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    console.warn('Unable to persist delete tombstones to localStorage:', error);
  }
}

function addDeletedTombstone(proposalNumber: string) {
  const now = nowIso();
  const current = loadDeletedTombstones().filter((r) => !!r?.proposalNumber);
  const filtered = current.filter((r) => r.proposalNumber !== proposalNumber);
  filtered.push({ proposalNumber, removedAt: now });
  persistDeletedTombstones(filtered);
}

function clearDeletedTombstone(proposalNumber: string) {
  const current = loadDeletedTombstones();
  const filtered = current.filter((r) => r.proposalNumber !== proposalNumber);
  if (filtered.length !== current.length) {
    persistDeletedTombstones(filtered);
  }
}

function getDeletedTombstoneSet(): Set<string> {
  return new Set(
    loadDeletedTombstones()
      .filter((record) => isProposalNumberForCurrentMode(record.proposalNumber))
      .map((record) => record.proposalNumber)
  );
}

function isDeletedTombstone(proposalNumber: string) {
  return getDeletedTombstoneSet().has(proposalNumber);
}

function ensureProposalReadMetadata(
  proposal: Proposal,
  session?: UserSession | null,
  stored?: StoredProposalRow
): Proposal {
  const currentSession = session ?? readSession();
  const franchiseId = proposal.franchiseId || stored?.franchise_id || currentSession?.franchiseId || DEFAULT_FRANCHISE_ID;
  const status = getWorkflowStatus(proposal) || (stored?.status as any) || 'draft';
  const designerAuthUserId = proposal.designerAuthUserId || stored?.designer_auth_user_id || undefined;
  const designerName = (proposal as any).designerName || stored?.designer_name || undefined;
  const designerRole = (proposal as any).designerRole || stored?.designer_role || undefined;
  const designerCode = (proposal as any).designerCode || stored?.designer_code || undefined;

  return {
    ...proposal,
    franchiseId,
    status,
    ...(designerAuthUserId ? { designerAuthUserId } : {}),
    ...(designerName ? { designerName } : {}),
    ...(designerRole ? { designerRole } : {}),
    ...(designerCode ? { designerCode } : {}),
  };
}

function ensureProposalWriteMetadata(proposal: Proposal, session?: UserSession | null): Proposal {
  const currentSession = session ?? readSession();
  const franchiseId = proposal.franchiseId || currentSession?.franchiseId || DEFAULT_FRANCHISE_ID;
  const designerName = (proposal as any).designerName || currentSession?.userName || currentSession?.userEmail || 'Designer';
  const proposalDesignerIdentity = normalizeIdentity(designerName);
  const currentUserOwnsDesignerIdentity = [currentSession?.userName, currentSession?.userEmail]
    .map(normalizeIdentity)
    .filter(Boolean)
    .includes(proposalDesignerIdentity);
  const designerAuthUserId =
    proposal.designerAuthUserId ||
    (currentUserOwnsDesignerIdentity ? currentSession?.userId : undefined);
  const designerRole = (proposal as any).designerRole || currentSession?.role || 'designer';
  const designerCode = (proposal as any).designerCode || currentSession?.franchiseCode;

  return {
    ...proposal,
    franchiseId,
    ...(designerAuthUserId ? { designerAuthUserId } : {}),
    designerName,
    designerRole,
    designerCode,
  };
}

function normalizeForConsumption(proposal: Proposal, session?: UserSession | null, stored?: StoredProposalRow): Proposal {
  const withMeta = removeHardcodedPapDiscountsFromProposal(
    upgradeProposalContractTemplateRevision(ensureProposalReadMetadata(proposal, session, stored))
  );
  const active = ensureProposalWorkflow(applyActiveVersion(withMeta));
  const normalizedActive = ensureProposalWorkflow(
    upgradeProposalContractTemplateRevision(ensureProposalReadMetadata(active, session, stored))
  );
  const normalizedVersions = (normalizedActive.versions || []).map((v) =>
    ensureProposalWorkflow(upgradeProposalContractTemplateRevision(ensureProposalReadMetadata(v, session, stored)))
  );
  return {
    ...normalizedActive,
    versions: normalizedVersions,
  };
}

function withSyncStatus(proposal: Proposal, status: SyncStatus, message?: string): Proposal {
  return {
    ...proposal,
    syncStatus: status,
    syncMessage: message,
  };
}

async function persistLocalProposal(proposal: Proposal) {
  if (!window.electron?.saveProposal) return;
  try {
    const upgradedProposal = removeHardcodedPapDiscountsFromProposal(
      upgradeProposalContractTemplateRevision(proposal)
    );
    setLocalProposalOwner(upgradedProposal.proposalNumber, readSession(), upgradedProposal.franchiseId);
    await window.electron.saveProposal(upgradedProposal);
  } catch (error) {
    console.warn('Failed to persist proposal locally:', error);
  }
}

async function loadLocalProposals(
  franchiseId?: string,
  session?: UserSession | null,
  includeAllFranchises = false
): Promise<Proposal[]> {
  try {
    if (!window.electron?.getAllProposals) return [] as Proposal[];
    const diskReport = window.electron.getAllProposalsWithReport
      ? await window.electron.getAllProposalsWithReport()
      : {
          entries: (await window.electron.getAllProposals()).map((proposal: Proposal) => ({ proposal })),
          issues: [],
        };
    const detectedIssues: LocalProposalLoadIssue[] = (diskReport.issues || []).map((issue) => ({
      fileName: readSafeText(issue.fileName),
      reason: 'unreadable_file',
      detail: readSafeText(issue.message),
    }));
    const normalizedRows = (diskReport.entries || []).flatMap((entry: LocalProposalFileEntry) => {
      const proposal = entry?.proposal;
      try {
        return [normalizeForConsumption(proposal, session)];
      } catch (error) {
        const proposalNumber = readSafeText(proposal?.proposalNumber);
        console.error('Skipping an unreadable local proposal while preserving its stored file.', {
          proposalNumber: proposalNumber || 'unknown',
          error,
        });
        detectedIssues.push({
          proposalNumber,
          customerName: readSafeText(proposal?.customerInfo?.customerName),
          fileName: readSafeText(entry?.fileName),
          reason: 'invalid_data',
          detail: readSafeText((error as Error)?.message),
        });
        return [];
      }
    });
    const visibleRows = normalizedRows
      .filter((proposal: Proposal) => isProposalNumberForCurrentMode(proposal.proposalNumber))
      .filter((proposal: Proposal) => isLocalProposalVisibleToSession(proposal, session))
      .filter((proposal: Proposal) =>
        includeAllFranchises
          ? true
          : (proposal.franchiseId || DEFAULT_FRANCHISE_ID) === (franchiseId || DEFAULT_FRANCHISE_ID)
      );
    localProposalLoadIssues = dedupeLocalProposalLoadIssues(detectedIssues);
    bypassedLocalProposals = isCloudOnlyRenderRecoveryEnabled() ? visibleRows : [];
    return isCloudOnlyRenderRecoveryEnabled() ? [] : visibleRows;
  } catch (error) {
    console.warn('Failed to list proposals from local store.', error);
    bypassedLocalProposals = [];
    localProposalLoadIssues = [{
      fileName: 'Local proposals folder',
      reason: 'unreadable_file',
      detail: readSafeText((error as Error)?.message),
    }];
    return [] as Proposal[];
  }
}

async function loadLocalProposal(proposalNumber: string, session?: UserSession | null): Promise<Proposal | null> {
  try {
    if (isCloudOnlyRenderRecoveryEnabled()) return null;
    if (!window.electron?.getProposal) return null;
    const proposal = await window.electron.getProposal(proposalNumber);
    if (!proposal) return null;
    const normalized = normalizeForConsumption(proposal as Proposal, session);
    if (!isProposalNumberForCurrentMode(normalized.proposalNumber)) return null;
    return isLocalProposalVisibleToSession(normalized, session) ? normalized : null;
  } catch (error) {
    console.warn('Failed to load proposal from local store.', error);
    return null;
  }
}

async function fetchSupabaseProposals(franchiseId: string, session: UserSession | null): Promise<Proposal[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const initialResult = await supabase
    .from(getProposalTableName())
    .select('proposal_json, franchise_id, designer_auth_user_id, designer_name, designer_role, designer_code, status')
    .eq('franchise_id', franchiseId || DEFAULT_FRANCHISE_ID)
    .order('updated_at', { ascending: false });
  let data = initialResult.data as StoredProposalRow[] | null;
  let error = initialResult.error;
  if (error && proposalOwnershipColumnUnavailable(error)) {
    const legacyResult = await supabase
      .from(getProposalTableName())
      .select('proposal_json, franchise_id, designer_name, designer_role, designer_code, status')
      .eq('franchise_id', franchiseId || DEFAULT_FRANCHISE_ID)
      .order('updated_at', { ascending: false });
    data = legacyResult.data as StoredProposalRow[] | null;
    error = legacyResult.error;
  }
  if (error) throw error;
  return (data || []).map((row: StoredProposalRow) => withSyncStatus(
    normalizeForConsumption((row?.proposal_json || {}) as Proposal, session, row),
    'synced',
    ONLINE_SYNC_MESSAGE
  ));
}

async function fetchSupabaseProposal(proposalNumber: string, session: UserSession | null): Promise<Proposal | null> {
  if (!isProposalNumberForCurrentMode(proposalNumber)) return null;
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const initialResult = await supabase
    .from(getProposalTableName())
    .select('proposal_json, franchise_id, designer_auth_user_id, designer_name, designer_role, designer_code, status')
    .eq('proposal_number', proposalNumber)
    .maybeSingle();
  let data = initialResult.data as StoredProposalRow | null;
  let error = initialResult.error;
  if (error && proposalOwnershipColumnUnavailable(error)) {
    const legacyResult = await supabase
      .from(getProposalTableName())
      .select('proposal_json, franchise_id, designer_name, designer_role, designer_code, status')
      .eq('proposal_number', proposalNumber)
      .maybeSingle();
    data = legacyResult.data as StoredProposalRow | null;
    error = legacyResult.error;
  }
  if (error) throw error;
  if (!(data as StoredProposalRow | null)?.proposal_json) return null;
  return withSyncStatus(
    normalizeForConsumption((data as StoredProposalRow).proposal_json as Proposal, session, data as StoredProposalRow),
    'synced',
    ONLINE_SYNC_MESSAGE
  );
}

function pickNewest(a?: Proposal | null, b?: Proposal | null): Proposal | null {
  if (a && !b) return a;
  if (b && !a) return b;
  if (!a || !b) return null;
  const aTs = coerceTimestamp(a.lastModified || a.createdDate);
  const bTs = coerceTimestamp(b.lastModified || b.createdDate);
  return bTs > aTs ? b : a;
}

function shouldSyncLocal(local: Proposal, remote?: Proposal | null) {
  if (!remote) return true;
  const remoteTs = coerceTimestamp(remote.lastModified || remote.createdDate);
  const localTs = coerceTimestamp(local.lastModified || local.createdDate);
  return localTs > remoteTs || (local.syncStatus === 'pending' && localTs >= remoteTs);
}

async function upsertToSupabase(
  proposal: Proposal,
  knownExistingProposal?: Proposal | null
): Promise<Proposal> {
  if (!isProposalNumberForCurrentMode(proposal.proposalNumber)) {
    throw new Error('This proposal belongs to a different storage mode and cannot be synced.');
  }
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase not configured');

  const normalized = removeHardcodedPapDiscountsFromProposal(
    ensureProposalWorkflow(
      upgradeProposalContractTemplateRevision(ensureProposalWriteMetadata(applyActiveVersion(proposal)))
    )
  );
  // Always make the safety decision against a fresh cloud read immediately
  // before the upsert. The caller's snapshot may already be stale if another
  // computer recovered or edited the proposal during synchronization.
  const freshlyStoredProposal = await fetchSupabaseProposal(normalized.proposalNumber, readSession());
  const existingProposal = freshlyStoredProposal || knownExistingProposal || null;
  const unsafeOverwriteReason = getUnsafeProposalOverwriteReason(normalized, existingProposal);
  if (unsafeOverwriteReason) {
    throw createUnsafeProposalOverwriteError(unsafeOverwriteReason);
  }
  const now = nowIso();

  const proposalRow = {
    proposal_number: normalized.proposalNumber,
    franchise_id: normalized.franchiseId || DEFAULT_FRANCHISE_ID,
    designer_auth_user_id: normalized.designerAuthUserId || null,
    designer_name: normalized.designerName,
    designer_role: normalized.designerRole,
    designer_code: normalized.designerCode,
    status: getWorkflowStatus(normalized),
    pricing_model_id: normalized.pricingModelId || null,
    pricing_model_name: normalized.pricingModelName || null,
    last_modified: normalized.lastModified || now,
    created_date: normalized.createdDate || now,
    updated_at: normalized.lastModified || now,
    proposal_json: {
      ...normalized,
      syncStatus: 'synced',
      syncMessage: ONLINE_SYNC_MESSAGE,
    },
  };
  let { error } = await supabase
    .from(getProposalTableName())
    .upsert(
      proposalRow,
      { onConflict: 'proposal_number', ignoreDuplicates: false }
    );
  if (error && proposalOwnershipColumnUnavailable(error)) {
    const { designer_auth_user_id: _designerAuthUserId, ...legacyProposalRow } = proposalRow;
    const legacyResult = await supabase
      .from(getProposalTableName())
      .upsert(legacyProposalRow, { onConflict: 'proposal_number', ignoreDuplicates: false });
    error = legacyResult.error;
  }

  if (error) {
    console.error('Supabase proposal upsert failed', {
      message: error.message,
      details: (error as any).details,
      hint: (error as any).hint,
      code: (error as any).code,
    });
    const wrapped = new Error(error.message || 'Supabase upsert failed');
    (wrapped as any).code = (error as any).code;
    (wrapped as any).details = (error as any).details;
    (wrapped as any).hint = (error as any).hint;
    throw wrapped;
  }

  return withSyncStatus(
    { ...normalized, lastModified: normalized.lastModified || now },
    'synced',
    ONLINE_SYNC_MESSAGE
  );
}

async function syncLocalCollectionToSupabase(
  locals: Proposal[],
  supabaseMap: Map<string, Proposal>,
  franchiseId?: string,
  session?: UserSession | null
): Promise<Set<string>> {
  const blockedLocalProposalNumbers = new Set<string>();
  for (const local of locals) {
    if (!canAttemptProposalWrite(local, session, franchiseId)) continue;
    const existing = supabaseMap.get(local.proposalNumber);
    if (!shouldSyncLocal(local, existing)) continue;
    const unsafeOverwriteReason = getUnsafeProposalOverwriteReason(local, existing);
    if (existing && unsafeOverwriteReason) {
      console.warn('Blocked unsafe local proposal overwrite', local.proposalNumber, unsafeOverwriteReason);
      archiveLosingProposalSnapshot(local, 'cloud_newer', existing);
      await persistLocalProposal(withSyncStatus(existing, 'synced', ONLINE_SYNC_MESSAGE));
      blockedLocalProposalNumbers.add(local.proposalNumber);
      continue;
    }
    try {
      const synced = await upsertToSupabase({
        ...local,
        franchiseId: local.franchiseId || franchiseId || DEFAULT_FRANCHISE_ID,
      }, existing || null);
      supabaseMap.set(local.proposalNumber, synced);
      await persistLocalProposal(synced);
    } catch (error) {
      if (existing && isUnsafeProposalOverwriteError(error)) {
        console.warn('Blocked unsafe local proposal overwrite', local.proposalNumber, error);
        archiveLosingProposalSnapshot(local, 'cloud_newer', existing);
        await persistLocalProposal(withSyncStatus(existing, 'synced', ONLINE_SYNC_MESSAGE));
        blockedLocalProposalNumbers.add(local.proposalNumber);
        continue;
      }
      console.warn('Failed to sync local proposal to Supabase', local.proposalNumber, error);
      const pending = withSyncStatus(
        { ...local, franchiseId: local.franchiseId || franchiseId || DEFAULT_FRANCHISE_ID },
        'pending',
        PENDING_MESSAGE
      );
      await persistLocalProposal(pending);
    }
  }
  return blockedLocalProposalNumbers;
}

let syncingPending = false;

export async function syncPendingProposals() {
  if (isMasterActingAsOwnerSession()) return;
  if (isCloudOnlyRenderRecoveryEnabled()) return;
  if (syncingPending) return;
  syncingPending = true;
  try {
    const supabaseOnline = await hasSupabaseConnection(true);
    if (!supabaseOnline) return;
    const session = readSession();
    const locals = await loadLocalProposals(undefined, session, true);
    const pending = (locals || []).filter((p) => p.syncStatus === 'pending');
    if (!pending.length) return;
    for (const proposal of pending) {
      if (!isProposalNumberForCurrentMode(proposal.proposalNumber)) continue;
      if (!canAttemptProposalWrite(proposal, session)) continue;
      try {
        const remote = await fetchSupabaseProposal(proposal.proposalNumber, session);
        const remoteTs = coerceTimestamp(remote?.lastModified || remote?.createdDate);
        const localTs = coerceTimestamp(proposal.lastModified || proposal.createdDate);
        if (remote && remoteTs >= localTs) {
          archiveLosingProposalSnapshot(proposal, 'cloud_newer', remote);
          await persistLocalProposal(withSyncStatus(remote, 'synced', ONLINE_SYNC_MESSAGE));
          continue;
        }
        const unsafeOverwriteReason = getUnsafeProposalOverwriteReason(proposal, remote);
        if (remote && unsafeOverwriteReason) {
          console.warn('Blocked unsafe pending proposal overwrite', proposal.proposalNumber, unsafeOverwriteReason);
          archiveLosingProposalSnapshot(proposal, 'cloud_newer', remote);
          await persistLocalProposal(withSyncStatus(remote, 'synced', ONLINE_SYNC_MESSAGE));
          continue;
        }
        if (remote) archiveLosingProposalSnapshot(remote, 'local_newer', proposal);
        const synced = await upsertToSupabase(proposal, remote);
        await persistLocalProposal(synced);
      } catch (error) {
        console.warn('Still unable to sync pending proposal', proposal.proposalNumber, error);
      }
    }
  } finally {
    syncingPending = false;
  }
}

let syncingPendingDeletes = false;

export async function syncPendingDeletes() {
  if (isMasterActingAsOwnerSession()) return;
  if (syncingPendingDeletes) return;
  if (!isSupabaseEnabled()) return;

  const supabaseOnline = await hasSupabaseConnection(true);
  if (!supabaseOnline) return;

  const pendingDeletes = loadPendingDeletes();
  if (!pendingDeletes.length) return;

  const supabase = getSupabaseClient();
  if (!supabase) return;

  const session = readSession();
  syncingPendingDeletes = true;
  try {
    for (const record of pendingDeletes) {
      if (!isProposalNumberForCurrentMode(record.proposalNumber)) continue;
      try {
        addDeletedTombstone(record.proposalNumber);
        const franchiseId = record.franchiseId || session?.franchiseId || DEFAULT_FRANCHISE_ID;
        if (isMasterSession() && franchiseId !== DEFAULT_FRANCHISE_ID) continue;
        if (isMasterSession() && !session?.userId) continue;
        let deleteQuery = supabase
          .from(getProposalTableName())
          .delete()
          .eq('proposal_number', record.proposalNumber)
          .eq('franchise_id', franchiseId || DEFAULT_FRANCHISE_ID);
        if (isMasterSession()) {
          deleteQuery = deleteQuery.eq('designer_auth_user_id', session!.userId!);
        }
        const { error, data } = await deleteQuery.select('proposal_number');
        if (error) throw error;

        const deletedCount = (data || []).length;
        if (deletedCount) {
          clearPendingDelete(record.proposalNumber);
        }
      } catch (error) {
        console.warn('Failed to sync pending proposal delete', record.proposalNumber, error);
      }
    }
  } finally {
    syncingPendingDeletes = false;
  }
}

function registerOnlineSyncListener() {
  if (typeof window === 'undefined') return;
  const anyWindow = window as any;
  if (anyWindow.__submergeSyncListenerRegistered) return;
  anyWindow.__submergeSyncListenerRegistered = true;
  window.addEventListener('online', () => {
    void syncPendingProposals();
    void syncPendingDeletes();
  });
}

registerOnlineSyncListener();

export async function listProposals(franchiseId?: string): Promise<Proposal[]> {
  if (SUPABASE_REQUIRED && !isSupabaseEnabled()) {
    throw new Error('Supabase is required but not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  const session = readSession();
  const cloudOnlyRecovery = isCloudOnlyRenderRecoveryEnabled();
  const isMasterInspection = isMasterActingAsOwnerSession();
  const targetFranchiseId = franchiseId || getSessionFranchiseId();
  const supabaseOnline = await hasSupabaseConnection(true);
  if (supabaseOnline) {
    await syncPendingDeletes();
  }
  const pendingDeletes = isMasterInspection ? new Set<string>() : getPendingDeleteSet();
  const deletedTombstones = isMasterInspection ? new Set<string>() : getDeletedTombstoneSet();
  const hiddenProposals = new Set<string>([...pendingDeletes, ...deletedTombstones]);

  const supabasePromise = (async () => {
    if (!supabaseOnline) return [] as Proposal[];
    try {
      const rows = await fetchSupabaseProposals(targetFranchiseId || DEFAULT_FRANCHISE_ID, session);
      return rows.filter((p) => !hiddenProposals.has(p.proposalNumber));
    } catch (error) {
      console.warn('Failed to list proposals from Supabase; using local copies.', error);
      return [] as Proposal[];
    }
  })();

  const localPromise = (async () => {
    const rows = await loadLocalProposals(targetFranchiseId, session);
    return rows.filter((p) => !hiddenProposals.has(p.proposalNumber));
  })();

  const [supabaseRows, localRows] = await Promise.all([supabasePromise, localPromise]);
  const supabaseMap = new Map<string, Proposal>();
  supabaseRows.forEach((p) => {
    if (p?.proposalNumber) supabaseMap.set(p.proposalNumber, p);
  });

  if (cloudOnlyRecovery) {
    const bypassIssues = bypassedLocalProposals.flatMap((local): LocalProposalLoadIssue[] => {
      const cloud = supabaseMap.get(local.proposalNumber);
      if (cloud && !shouldSyncLocal(local, cloud)) return [];
      return [{
        proposalNumber: readSafeText(local.proposalNumber),
        customerName: readSafeText(local.customerInfo?.customerName),
        reason: cloud ? 'newer_local_changes' : 'local_only',
      }];
    });
    localProposalLoadIssues = dedupeLocalProposalLoadIssues([
      ...localProposalLoadIssues,
      ...bypassIssues,
    ]);
  }

  let blockedLocalProposalNumbers = new Set<string>();
  if (!isMasterInspection && supabaseOnline && localRows.length) {
    await syncPendingProposals();
    blockedLocalProposalNumbers = await syncLocalCollectionToSupabase(
      localRows,
      supabaseMap,
      targetFranchiseId,
      session
    );
  }

  const merged = new Map<string, Proposal>();
  const upsert = (proposal: Proposal) => {
    if (!proposal?.proposalNumber) return;
    const existing = merged.get(proposal.proposalNumber);
    if (!existing) {
      merged.set(proposal.proposalNumber, proposal);
      return;
    }
    const chosen = pickNewest(existing, proposal) || existing;
    merged.set(proposal.proposalNumber, chosen);
  };

  supabaseMap.forEach((p) => upsert(withSyncStatus(p, 'synced', ONLINE_SYNC_MESSAGE)));
  const visibleLocalRows = isMasterInspection && supabaseOnline ? [] : localRows;
  visibleLocalRows.forEach((local) => {
    const cloud = supabaseMap.get(local.proposalNumber);
    if (cloud && blockedLocalProposalNumbers.has(local.proposalNumber)) {
      upsert(withSyncStatus(cloud, 'synced', ONLINE_SYNC_MESSAGE));
      return;
    }
    if (supabaseOnline && shouldSyncLocal(local, cloud || null)) {
      upsert(withSyncStatus(local, 'pending', PENDING_MESSAGE));
    } else if (!supabaseOnline) {
      const status = (local as any).syncStatus || 'pending';
      const message = (local as any).syncMessage || (status === 'synced' ? ONLINE_SYNC_MESSAGE : PENDING_MESSAGE);
      upsert(withSyncStatus(local, status, message));
    } else {
      upsert(local);
    }
  });

  const result = Array.from(merged.values()).sort(
    (a, b) => coerceTimestamp(b.lastModified || b.createdDate) - coerceTimestamp(a.lastModified || a.createdDate)
  );
  if (STAGING_DIAGNOSTICS) {
    console.info('[STAGING] Proposal sources', {
      franchiseId: targetFranchiseId,
      supabaseRows: supabaseRows.length,
      localRows: localRows.length,
      mergedRows: result.length,
      hiddenByLocalTombstone: hiddenProposals.size,
    });
  }
  return result;
}

export async function listDashboardProposals(franchiseId?: string): Promise<Proposal[]> {
  const session = readSession();
  if (!session) return [];
  const proposals = await listProposals(franchiseId);
  const visible = proposals.filter((proposal) => isOwnProposal(proposal, session));
  if (STAGING_DIAGNOSTICS) {
    console.info('[STAGING] Dashboard proposal visibility', {
      franchiseId: franchiseId || getSessionFranchiseId(),
      loadedRows: proposals.length,
      visibleRows: visible.length,
      hiddenByDesignerMatch: proposals.length - visible.length,
      sessionHasUserName: Boolean(normalizeIdentity(session.userName)),
    });
  }
  return visible;
}

export async function getWorkflowUnreadCount(franchiseId: string, userId?: string | null): Promise<number> {
  const normalizedUserId = normalizeIdentity(userId);
  if (!normalizedUserId) return 0;

  const supabaseOnline = await hasSupabaseConnection();
  if (!supabaseOnline) return 0;

  const supabase = getSupabaseClient();
  if (!supabase) return 0;

  const { data, error } = await supabase
    .from(getProposalTableName())
    .select(
      'proposal_number,status,workflow:proposal_json->workflow,version_id:proposal_json->versionId,proposal_status:proposal_json->status'
    )
    .eq('franchise_id', franchiseId || DEFAULT_FRANCHISE_ID)
    // Drafts and change-requested proposals cannot contribute to the unread badge.
    // Keep null-status legacy rows so their JSON status can still be evaluated below.
    .or('status.is.null,status.not.in.(draft,changes_requested)');
  if (error) throw error;

  return (data || []).reduce((sum, row) => {
    const entry = row as WorkflowUnreadProjectionRow;
    const proposal = {
      proposalNumber: entry.proposal_number || '',
      status: entry.proposal_status || entry.status || 'draft',
      versionId: entry.version_id || 'original',
      workflow: entry.workflow || undefined,
    } as Proposal;
    if (!canReadProposal(proposal)) return sum;
    return sum + countUnreadWorkflowEvents(proposal, normalizedUserId);
  }, 0);
}

export async function getProposal(proposalNumber: string): Promise<Proposal | null> {
  if (SUPABASE_REQUIRED && !isSupabaseEnabled()) {
    throw new Error('Supabase is required but not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  const isMasterInspection = isMasterActingAsOwnerSession();
  if (!isMasterInspection && (isPendingDelete(proposalNumber) || isDeletedTombstone(proposalNumber))) return null;

  const session = readSession();
  const supabaseOnline = await hasSupabaseConnection(true);
  if (supabaseOnline) {
    await syncPendingDeletes();
    if (!isMasterInspection && (isPendingDelete(proposalNumber) || isDeletedTombstone(proposalNumber))) return null;
  }

  const supabasePromise = (async () => {
    if (!supabaseOnline) return null;
    try {
      return await fetchSupabaseProposal(proposalNumber, session);
    } catch (error) {
      console.warn('Failed to load proposal from Supabase, will try local.', error);
      return null;
    }
  })();

  const localPromise = loadLocalProposal(proposalNumber, session);

  const [cloud, local] = await Promise.all([supabasePromise, localPromise]);

  if (isMasterInspection) {
    const inspectionCopy = cloud || local;
    if (!inspectionCopy || !canReadProposal(inspectionCopy, session)) return null;
    const status = cloud ? 'synced' : ((inspectionCopy as any).syncStatus || 'pending');
    const message = cloud
      ? ONLINE_SYNC_MESSAGE
      : (inspectionCopy as any).syncMessage || PENDING_MESSAGE;
    return withSyncStatus(inspectionCopy, status as SyncStatus, message);
  }

  const best = pickNewest(cloud, local);
  if (!best) return null;
  if (!canReadProposal(best, session)) return null;

  if (supabaseOnline && local && canAttemptProposalWrite(local, session) && shouldSyncLocal(local, cloud)) {
    const unsafeOverwriteReason = getUnsafeProposalOverwriteReason(local, cloud);
    if (cloud && unsafeOverwriteReason) {
      console.warn('Blocked unsafe newer local proposal overwrite', proposalNumber, unsafeOverwriteReason);
      archiveLosingProposalSnapshot(local, 'cloud_newer', cloud);
      await persistLocalProposal(withSyncStatus(cloud, 'synced', ONLINE_SYNC_MESSAGE));
      return withSyncStatus(cloud, 'synced', ONLINE_SYNC_MESSAGE);
    }
    try {
      if (cloud) archiveLosingProposalSnapshot(cloud, 'local_newer', local);
      const synced = await upsertToSupabase(local, cloud);
      await persistLocalProposal(synced);
      return synced;
    } catch (error) {
      console.warn('Unable to sync newer local proposal to Supabase', proposalNumber, error);
    }
  }

  if (supabaseOnline && cloud && local && !shouldSyncLocal(local, cloud)) {
    if (coerceTimestamp(local.lastModified || local.createdDate) !== coerceTimestamp(cloud.lastModified || cloud.createdDate)) {
      archiveLosingProposalSnapshot(local, 'cloud_newer', cloud);
    }
    await persistLocalProposal(cloud);
  }

  if (!supabaseOnline) {
    const status = (best as any).syncStatus || 'pending';
    const message = (best as any).syncMessage || (status === 'synced' ? ONLINE_SYNC_MESSAGE : PENDING_MESSAGE);
    return withSyncStatus(best, status as SyncStatus, message);
  }

  return withSyncStatus(best, 'synced', ONLINE_SYNC_MESSAGE);
}

export async function saveProposal(proposal: Proposal, options: SaveProposalOptions = {}): Promise<SaveResult> {
  if (isMasterActingAsOwnerSession()) {
    throw new Error(MASTER_INSPECTION_READ_ONLY_MESSAGE);
  }
  const now = nowIso();
  const session = readSession();
  const proposalNumber = getTestProposalNumber(proposal.proposalNumber) || proposal.proposalNumber;
  if (!isProposalNumberForCurrentMode(proposalNumber)) {
    throw new Error('This proposal belongs to a different storage mode and cannot be saved.');
  }
  const normalized = ensureProposalWriteMetadata(
    ensureProposalWorkflow(applyActiveVersion({
      ...proposal,
      proposalNumber,
      franchiseId: proposal.franchiseId || getSessionFranchiseId(),
      designerName: (proposal as any).designerName || getSessionUserName(),
      designerRole: (proposal as any).designerRole || getSessionRole(),
      designerCode: (proposal as any).designerCode || getSessionFranchiseCode(),
      lastModified: now,
    } as Proposal)),
    session
  );
  const normalizedWithVersions: Proposal = {
    ...normalized,
    versions: (normalized.versions || []).map((v) => ensureProposalWriteMetadata(v, session)),
  };
  const persistenceReady = removeHardcodedPapDiscountsFromProposal(
    upgradeProposalContractTemplateRevision(
      sanitizeEditableProposalVersions(normalizedWithVersions)
    )
  );
  assertMasterProposalMutationAllowed(persistenceReady, session);
  clearDeletedTombstone(proposalNumber);
  const franchiseId = persistenceReady.franchiseId || DEFAULT_FRANCHISE_ID;

  if (SUPABASE_REQUIRED && !isSupabaseEnabled()) {
    throw new Error('Supabase is required but not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  if (options.localOnly) {
    const pending = withSyncStatus(
      { ...persistenceReady, franchiseId, lastModified: persistenceReady.lastModified || now },
      'pending',
      PENDING_MESSAGE
    );
    await persistLocalProposal(pending);
    return { ...pending, lastModified: pending.lastModified || now };
  }

  const supabaseOnline = await hasSupabaseConnection(true);
  if (!supabaseOnline) {
    if (options.requireOnline) {
      throw new Error(OFFLINE_ERROR_MESSAGE);
    }
    const pending = withSyncStatus(
      { ...persistenceReady, franchiseId, lastModified: persistenceReady.lastModified || now },
      'pending',
      PENDING_MESSAGE
    );
    await persistLocalProposal(pending);
    return { ...pending, lastModified: pending.lastModified || now };
  }

  try {
    const synced = await upsertToSupabase(persistenceReady);
    await persistLocalProposal({ ...synced, franchiseId });
    if (options.ledgerAction === 'proposal_submitted' && !isTestSession()) {
      await logLedgerEventSafe({
        franchiseId,
        action: 'Proposal submitted',
        targetType: 'proposal',
        targetId: synced.proposalNumber,
        details: {
          proposalNumber: synced.proposalNumber,
          customerName: synced.customerInfo?.customerName || null,
          designerName: synced.designerName || null,
          status: synced.status || 'submitted',
        },
      });
    }
    return { ...synced, lastModified: synced.lastModified || now };
  } catch (error) {
    if (options.requireOnline || isUnsafeProposalOverwriteError(error)) {
      throw error;
    }
    const pending = withSyncStatus(
      { ...persistenceReady, franchiseId, lastModified: persistenceReady.lastModified || now },
      'pending',
      PENDING_MESSAGE
    );
    await persistLocalProposal(pending);
    return { ...pending, lastModified: pending.lastModified || now };
  }
}

export async function deleteProposal(proposalNumber: string, franchiseId?: string) {
  if (isMasterActingAsOwnerSession()) {
    throw new Error(MASTER_INSPECTION_READ_ONLY_MESSAGE);
  }
  if (!isProposalNumberForCurrentMode(proposalNumber)) {
    throw new Error('This proposal belongs to a different storage mode and cannot be deleted.');
  }
  const session = readSession();
  const requestedFranchiseId = franchiseId || getSessionFranchiseId();
  if (isMasterSession() && requestedFranchiseId !== DEFAULT_FRANCHISE_ID) {
    throw new Error(MASTER_PROPOSAL_OWNERSHIP_MESSAGE);
  }
  const targetFranchiseId = isMasterSession() ? DEFAULT_FRANCHISE_ID : requestedFranchiseId;
  if (SUPABASE_REQUIRED && !isSupabaseEnabled()) {
    throw new Error('Supabase is required but not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const supabaseOnline = await hasSupabaseConnection(true);
  if (!supabaseOnline) {
    throw new Error(OFFLINE_ERROR_MESSAGE);
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const existing = await supabase
    .from(getProposalTableName())
    .select('proposal_number,franchise_id,designer_auth_user_id,designer_name,status,proposal_json')
    .eq('proposal_number', proposalNumber)
    .eq('franchise_id', targetFranchiseId || DEFAULT_FRANCHISE_ID)
    .maybeSingle();
  if (existing.error && (existing.error as any).code !== 'PGRST116') {
    throw existing.error;
  }
  if (isMasterSession()) {
    const stored = existing.data as any;
    if (
      !stored ||
      normalizeIdentity(stored.designer_auth_user_id) !== normalizeIdentity(session?.userId) ||
      stored.franchise_id !== DEFAULT_FRANCHISE_ID
    ) {
      throw new Error(MASTER_PROPOSAL_OWNERSHIP_MESSAGE);
    }
  }

  const { error, data } = await supabase
    .from(getProposalTableName())
    .delete()
    .eq('proposal_number', proposalNumber)
    .eq('franchise_id', targetFranchiseId || DEFAULT_FRANCHISE_ID)
    .select('proposal_number');
  if (error) throw error;

  const deletedCount = (data || []).length;
  if (isMasterSession() && !deletedCount) {
    throw new Error(MASTER_PROPOSAL_OWNERSHIP_MESSAGE);
  }

  clearPendingDelete(proposalNumber);
  addDeletedTombstone(proposalNumber);
  clearLocalProposalOwner(proposalNumber);

  if (window.electron?.deleteProposal) {
    try {
      await window.electron.deleteProposal(proposalNumber);
    } catch (error) {
      throw new Error('Failed to delete proposal from local database after Supabase delete.');
    }
  }

  const existingProposal = (existing.data as any)?.proposal_json as Proposal | undefined;
  if (!isTestSession()) {
    await logLedgerEventSafe({
      franchiseId: (existing.data as any)?.franchise_id || targetFranchiseId || DEFAULT_FRANCHISE_ID,
      action: 'Proposal deleted',
      targetType: 'proposal',
      targetId: proposalNumber,
      details: {
        proposalNumber,
        customerName: existingProposal?.customerInfo?.customerName || null,
        designerName: (existing.data as any)?.designer_name || existingProposal?.designerName || null,
        status: (existing.data as any)?.status || existingProposal?.status || null,
      },
    });
  }
}
