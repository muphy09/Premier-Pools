import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import MasterFranchiseEditorModal from '../components/MasterFranchiseEditorModal';
import TempPasswordModal from '../components/TempPasswordModal';
import TestAccountsPanel from '../components/TestAccountsPanel';
import { useGlobalFeedbackEnabled } from '../hooks/useGlobalFeedbackEnabled';
import {
  archiveFeedback,
  deleteFeedback,
  getMasterFeedbackSummary,
  isFeedbackFeatureUnavailableError,
  listMasterFeedback,
  resolveFeedback,
  setGlobalFeedbackEnabled,
  type FeedbackEntry,
  type FeedbackStatus,
  type FeedbackSummary,
} from '../services/feedback';
import { getLedgerRoleLabel, listLedgerEvents, type LedgerEvent } from '../services/ledger';
import { formatReportedAppVersion } from '../services/appVersionReporter';
import {
  createFranchiseWithOwner,
  listAllPricingModels,
  listAllFranchiseUsers,
  listAllFranchises,
  softDeleteFranchise,
  type MasterFranchise,
  type MasterPricingModel,
  type MasterUser,
} from '../services/masterAdminAdapter';
import { loadPricingModel, savePricingModel } from '../services/pricingModelsAdapter';
import type { UserSession } from '../services/session';
import './MasterPage.css';

type MasterPageProps = {
  session?: UserSession | null;
  onActAsFranchise?: (franchise: MasterFranchise) => void;
  actingFranchiseId?: string | null;
  onFranchiseUpdated?: (franchise: MasterFranchise) => void;
};

const LEDGER_PAGE_SIZE = 10;

const formatDateTime = (value?: string) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
};

const renderDateTimeCell = (value?: string) => {
  if (!value) {
    return (
      <div className="master-date-time">
        <div className="master-date-line">N/A</div>
      </div>
    );
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return (
      <div className="master-date-time">
        <div className="master-date-line">N/A</div>
      </div>
    );
  }

  return (
    <div className="master-date-time">
      <div className="master-date-line">{date.toLocaleDateString()}</div>
      <div className="master-time-line">{date.toLocaleTimeString()}</div>
    </div>
  );
};

const formatDetailLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

const formatDetailValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return 'N/A';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

const getUserNameLabel = (user: Pick<MasterUser, 'name'>) => {
  const trimmedName = String(user.name || '').trim();
  return trimmedName || 'Unnamed';
};

const formatRoleLabel = (value?: string | null) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'Unknown';
  if (normalized === 'bookkeeper') return 'Book Keeper';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatFeedbackStatusLabel = (status: FeedbackStatus) => {
  if (status === 'resolved') return 'Resolved';
  if (status === 'archived') return 'Archived';
  return 'New';
};

type FeedbackActionIconButtonProps = {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

function FeedbackActionIconButton({
  label,
  danger = false,
  disabled = false,
  onClick,
  children,
}: FeedbackActionIconButtonProps) {
  return (
    <button
      type="button"
      className={`master-feedback-icon-btn${danger ? ' is-danger' : ''}`}
      data-tooltip={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function MasterPage({ session, onActAsFranchise, actingFranchiseId, onFranchiseUpdated }: MasterPageProps) {
  const navigate = useNavigate();
  const [franchises, setFranchises] = useState<MasterFranchise[]>([]);
  const [users, setUsers] = useState<MasterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [hideInactive, setHideInactive] = useState(true);
  const [pricingModels, setPricingModels] = useState<MasterPricingModel[]>([]);
  const [pricingLoading, setPricingLoading] = useState(true);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [copyTargets, setCopyTargets] = useState<Record<string, string>>({});
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [editingFranchise, setEditingFranchise] = useState<MasterFranchise | null>(null);
  const [ledgerEvents, setLedgerEvents] = useState<LedgerEvent[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerFranchiseFilter, setLedgerFranchiseFilter] = useState('all');
  const [hideInactiveLedgerFranchises, setHideInactiveLedgerFranchises] = useState(true);
  const [visibleLedgerCount, setVisibleLedgerCount] = useState(LEDGER_PAGE_SIZE);
  const [selectedLedgerEvent, setSelectedLedgerEvent] = useState<LedgerEvent | null>(null);
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSummary, setFeedbackSummary] = useState<FeedbackSummary>({
    newCount: 0,
    resolvedCount: 0,
    archivedCount: 0,
  });
  const [feedbackSectionOpen, setFeedbackSectionOpen] = useState(false);
  const [feedbackFranchiseFilter, setFeedbackFranchiseFilter] = useState('all');
  const [feedbackStatusView, setFeedbackStatusView] = useState<Exclude<FeedbackStatus, 'archived'>>('new');
  const [showArchivedFeedback, setShowArchivedFeedback] = useState(false);
  const [feedbackStatusMessage, setFeedbackStatusMessage] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [feedbackActionId, setFeedbackActionId] = useState<string | null>(null);
  const [feedbackResolveTarget, setFeedbackResolveTarget] = useState<FeedbackEntry | null>(null);
  const [feedbackResolutionMessage, setFeedbackResolutionMessage] = useState('');
  const [resolvingFeedback, setResolvingFeedback] = useState(false);
  const [updatingGlobalFeedbackEnabled, setUpdatingGlobalFeedbackEnabled] = useState(false);
  const [showCreateFranchiseModal, setShowCreateFranchiseModal] = useState(false);

  const [franchiseName, setFranchiseName] = useState('');
  const [franchiseCode, setFranchiseCode] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');

  const isMaster = (session?.role || '').toLowerCase() === 'master';
  const { feedbackEnabled: globalFeedbackEnabled, isLoading: globalFeedbackEnabledLoading } =
    useGlobalFeedbackEnabled();

  const loadData = async () => {
    setLoading(true);
    try {
      const [franchiseRows, userRows] = await Promise.all([
        listAllFranchises(),
        listAllFranchiseUsers(),
      ]);
      setFranchises(franchiseRows || []);
      setUsers(userRows || []);
    } catch (error) {
      console.error('Failed to load master data:', error);
      setFranchises([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const loadPricingModels = async () => {
    setPricingLoading(true);
    setPricingError(null);
    try {
      const rows = await listAllPricingModels();
      setPricingModels(rows || []);
    } catch (error: any) {
      console.error('Failed to load pricing models:', error);
      setPricingModels([]);
      setPricingError(error?.message || 'Unable to load pricing models.');
    } finally {
      setPricingLoading(false);
    }
  };

  const loadLedger = async () => {
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      const events = await listLedgerEvents(200);
      setLedgerEvents(events || []);
    } catch (error: any) {
      console.error('Failed to load ledger events:', error);
      setLedgerEvents([]);
      setLedgerError(error?.message || 'Unable to load ledger events.');
    } finally {
      setLedgerLoading(false);
    }
  };

  const loadFeedbackSummary = async (franchiseId?: string | null) => {
    try {
      const summary = await getMasterFeedbackSummary(franchiseId || null);
      setFeedbackSummary(summary);
    } catch (error: any) {
      console.error('Failed to load feedback summary:', error);
      setFeedbackSummary({
        newCount: 0,
        resolvedCount: 0,
        archivedCount: 0,
      });
    }
  };

  const loadFeedback = async (options?: {
    status?: FeedbackStatus;
    franchiseId?: string | null;
    silent?: boolean;
  }) => {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setFeedbackLoading(true);
      setFeedbackError(null);
    }
    try {
      const rows = await listMasterFeedback({
        status: options?.status || (showArchivedFeedback ? 'archived' : feedbackStatusView),
        franchiseId: options?.franchiseId || null,
        limit: 250,
      });
      setFeedbackEntries(rows);
    } catch (error: any) {
      console.error('Failed to load feedback:', error);
      if (!silent) {
        setFeedbackEntries([]);
        setFeedbackError(error?.message || 'Unable to load feedback.');
      }
    } finally {
      if (!silent) {
        setFeedbackLoading(false);
      }
    }
  };

  const refreshMasterData = async () => {
    await Promise.all([loadData(), loadLedger()]);
  };

  useEffect(() => {
    if (isMaster) {
      void loadData();
      void loadPricingModels();
      void loadLedger();
      void loadFeedbackSummary();
    }
  }, [isMaster]);

  useEffect(() => {
    if (!isMaster) return;
    const intervalId = window.setInterval(() => {
      void loadFeedbackSummary();
      if (feedbackSectionOpen) {
        void loadFeedback({
          status: showArchivedFeedback ? 'archived' : feedbackStatusView,
          franchiseId: feedbackFranchiseFilter === 'all' ? null : feedbackFranchiseFilter,
          silent: true,
        });
      }
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, [feedbackFranchiseFilter, feedbackSectionOpen, feedbackStatusView, isMaster, showArchivedFeedback]);

  const franchiseLookup = useMemo(() => {
    const map = new Map<string, MasterFranchise>();
    franchises.forEach((franchise) => {
      map.set(franchise.id, franchise);
    });
    return map;
  }, [franchises]);

  const franchiseOptions = useMemo(() => {
    return [...franchises].sort((a, b) => {
      const nameA = (a.name || a.franchiseCode || a.id).toLowerCase();
      const nameB = (b.name || b.franchiseCode || b.id).toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [franchises]);

  const copyTargetOptions = useMemo(() => {
    if (!hideInactive) return franchiseOptions;
    return franchiseOptions.filter((franchise) => !franchise.deletedAt && franchise.isActive !== false);
  }, [franchiseOptions, hideInactive]);

  const copyTargetOptionIds = useMemo(
    () => new Set(copyTargetOptions.map((franchise) => franchise.id)),
    [copyTargetOptions]
  );

  const ledgerFranchiseOptions = useMemo(() => {
    if (!hideInactiveLedgerFranchises) return franchiseOptions;
    return franchiseOptions.filter((franchise) => !franchise.deletedAt && franchise.isActive !== false);
  }, [franchiseOptions, hideInactiveLedgerFranchises]);

  const ledgerFranchiseOptionIds = useMemo(
    () => new Set(ledgerFranchiseOptions.map((franchise) => franchise.id)),
    [ledgerFranchiseOptions]
  );

  const feedbackFranchiseOptionIds = useMemo(
    () => new Set(franchiseOptions.map((franchise) => franchise.id)),
    [franchiseOptions]
  );

  const visibleFranchises = useMemo(() => {
    if (!hideInactive) return franchiseOptions;
    return franchiseOptions.filter((franchise) => !franchise.deletedAt && franchise.isActive !== false);
  }, [franchiseOptions, hideInactive]);

  const usersByFranchise = useMemo(() => {
    const map = new Map<string, MasterUser[]>();
    users.forEach((user) => {
      const key = user.franchiseId || 'unknown';
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(user);
    });
    return map;
  }, [users]);

  const pricingModelsByFranchise = useMemo(() => {
    const map = new Map<string, MasterPricingModel[]>();
    pricingModels.forEach((model) => {
      if (!map.has(model.franchiseId)) {
        map.set(model.franchiseId, []);
      }
      map.get(model.franchiseId)?.push(model);
    });
    return map;
  }, [pricingModels]);

  useEffect(() => {
    setCopyTargets((prev) => {
      let changed = false;
      const next = Object.fromEntries(
        Object.entries(prev).filter(([, franchiseId]) => {
          const keep = copyTargetOptionIds.has(franchiseId);
          if (!keep) changed = true;
          return keep;
        })
      );
      return changed ? next : prev;
    });
  }, [copyTargetOptionIds]);

  const filteredLedgerEvents = useMemo(() => {
    let rows = ledgerEvents;
    if (hideInactiveLedgerFranchises) {
      rows = rows.filter((event) => {
        if (!event.franchiseId) return true;
        const franchise = franchiseLookup.get(event.franchiseId);
        return !franchise || (!franchise.deletedAt && franchise.isActive !== false);
      });
    }
    if (ledgerFranchiseFilter !== 'all') {
      rows = rows.filter((event) => event.franchiseId === ledgerFranchiseFilter);
    }
    return rows;
  }, [ledgerEvents, ledgerFranchiseFilter, hideInactiveLedgerFranchises, franchiseLookup]);

  const visibleLedgerEvents = useMemo(
    () => filteredLedgerEvents.slice(0, visibleLedgerCount),
    [filteredLedgerEvents, visibleLedgerCount]
  );

  const hasMoreLedgerEvents = visibleLedgerEvents.length < filteredLedgerEvents.length;

  useEffect(() => {
    if (ledgerFranchiseFilter === 'all') return;
    const selectedStillExists = ledgerFranchiseOptionIds.has(ledgerFranchiseFilter);
    if (!selectedStillExists) {
      setLedgerFranchiseFilter('all');
    }
  }, [ledgerFranchiseFilter, ledgerFranchiseOptionIds]);

  useEffect(() => {
    setVisibleLedgerCount(LEDGER_PAGE_SIZE);
  }, [filteredLedgerEvents]);

  useEffect(() => {
    if (feedbackFranchiseFilter === 'all') return;
    if (feedbackFranchiseOptionIds.has(feedbackFranchiseFilter)) return;
    setFeedbackFranchiseFilter('all');
  }, [feedbackFranchiseFilter, feedbackFranchiseOptionIds]);

  useEffect(() => {
    if (!isMaster || !feedbackSectionOpen) return;
    void loadFeedback({
      status: showArchivedFeedback ? 'archived' : feedbackStatusView,
      franchiseId: feedbackFranchiseFilter === 'all' ? null : feedbackFranchiseFilter,
    });
  }, [feedbackFranchiseFilter, feedbackSectionOpen, feedbackStatusView, isMaster, showArchivedFeedback]);

  const ledgerCountLabel = useMemo(() => {
    if (ledgerEvents.length === 0) return '0 total';
    if (visibleLedgerEvents.length === filteredLedgerEvents.length) {
      if (filteredLedgerEvents.length === ledgerEvents.length) {
        return `${ledgerEvents.length} total`;
      }
      return `${filteredLedgerEvents.length} of ${ledgerEvents.length} total`;
    }
    if (filteredLedgerEvents.length === ledgerEvents.length) {
      return `Showing ${visibleLedgerEvents.length} of ${filteredLedgerEvents.length}`;
    }
    return `Showing ${visibleLedgerEvents.length} of ${filteredLedgerEvents.length} (${ledgerEvents.length} total)`;
  }, [filteredLedgerEvents.length, ledgerEvents.length, visibleLedgerEvents.length]);

  const handleShowMoreLedgerEvents = () => {
    setVisibleLedgerCount((current) => current + LEDGER_PAGE_SIZE);
  };

  const activeFeedbackStatus = showArchivedFeedback ? 'archived' : feedbackStatusView;
  const activeFeedbackCount = showArchivedFeedback
    ? feedbackSummary.archivedCount
    : feedbackStatusView === 'resolved'
    ? feedbackSummary.resolvedCount
    : feedbackSummary.newCount;

  const handleCreateFranchise = async () => {
    const trimmedName = franchiseName.trim();
    const trimmedCode = franchiseCode.trim().toUpperCase();
    const trimmedOwnerEmail = ownerEmail.trim().toLowerCase();
    const trimmedOwnerName = ownerName.trim();

    if (!trimmedName || !trimmedCode || !trimmedOwnerEmail || !trimmedOwnerName) {
      setFormError('Please enter a franchise name, code, owner email, and owner display name.');
      return;
    }

    setFormError(null);
    setCreating(true);
    try {
      const result = await createFranchiseWithOwner({
        franchiseName: trimmedName,
        franchiseCode: trimmedCode,
        ownerEmail: trimmedOwnerEmail,
        ownerName: trimmedOwnerName,
      });
      setTempPassword(result?.tempPassword || null);
      setShowCreateFranchiseModal(false);
      setFormError(null);
      setFranchiseName('');
      setFranchiseCode('');
      setOwnerEmail('');
      setOwnerName('');
      await refreshMasterData();
    } catch (error: any) {
      console.error('Failed to create franchise:', error);
      setFormError(error?.message || 'Unable to create franchise.');
    } finally {
      setCreating(false);
    }
  };

  const handleCloseCreateFranchiseModal = () => {
    if (creating) return;
    setShowCreateFranchiseModal(false);
    setFormError(null);
    setFranchiseName('');
    setFranchiseCode('');
    setOwnerEmail('');
    setOwnerName('');
  };

  const handleDeleteFranchise = async (franchiseId: string, franchiseName?: string | null) => {
    const confirmDelete = window.confirm(
      `Soft delete ${franchiseName || franchiseId}? Users will be disabled until restored.`
    );
    if (!confirmDelete) return;
    setDeletingId(franchiseId);
    try {
      await softDeleteFranchise(franchiseId);
      await refreshMasterData();
    } catch (error) {
      console.error('Failed to delete franchise:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const getFranchiseLabel = (franchiseId: string) => {
    const franchise = franchiseLookup.get(franchiseId);
    return franchise?.name || franchise?.franchiseCode || franchiseId;
  };

  const handleCopyTargetChange = (modelId: string, value: string) => {
    setCopyTargets((prev) => ({ ...prev, [modelId]: value }));
  };

  const handleCopyPricingModel = async (model: MasterPricingModel) => {
    const targetFranchiseId = copyTargets[model.id];
    if (!targetFranchiseId) {
      setCopyError('Select a target franchise before copying.');
      setCopySuccess(null);
      return;
    }
    setCopyError(null);
    setCopySuccess(null);
    setCopyingId(model.id);
    try {
      const loaded = await loadPricingModel(model.franchiseId, model.id);
      if (!loaded?.pricing) {
        throw new Error('Unable to load pricing model details.');
      }
      const name = loaded.pricingModelName || model.name || 'Pricing Model';
      await savePricingModel({
        franchiseId: targetFranchiseId,
        name,
        pricing: loaded.pricing,
        version: loaded.version,
        updatedBy: session?.userEmail || session?.userName || null,
        createNew: true,
        copiedFromFranchiseId: model.franchiseId,
        copiedFromFranchiseName: getFranchiseLabel(model.franchiseId),
        copiedFromPricingModelId: model.id,
        copiedFromPricingModelName: name,
      });
      setCopySuccess(`Copied "${name}" to ${getFranchiseLabel(targetFranchiseId)}.`);
      await Promise.all([loadPricingModels(), loadLedger()]);
    } catch (error: any) {
      console.error('Failed to copy pricing model:', error);
      setCopyError(error?.message || 'Unable to copy pricing model.');
    } finally {
      setCopyingId(null);
    }
  };

  const handleActAsFranchise = (franchise: MasterFranchise) => {
    if (!onActAsFranchise) return;
    onActAsFranchise(franchise);
  };

  const handleEditFranchise = (franchise: MasterFranchise) => {
    setCopyError(null);
    setCopySuccess(null);
    setEditingFranchise(franchise);
    void Promise.all([loadData(), loadPricingModels()]);
  };

  const handleCloseFranchiseEditor = () => {
    setCopyError(null);
    setCopySuccess(null);
    setEditingFranchise(null);
  };

  const handleFranchiseUpdated = (franchise: MasterFranchise) => {
    setEditingFranchise(franchise);
    setFranchises((prev) => prev.map((row) => (row.id === franchise.id ? { ...row, ...franchise } : row)));
    onFranchiseUpdated?.(franchise);
    void loadLedger();
  };

  const getLedgerFranchiseLabel = (event: LedgerEvent) => {
    if (event.franchiseName) return event.franchiseName;
    if (event.franchiseId) return getFranchiseLabel(event.franchiseId);
    return 'System';
  };

  const getLedgerUserLabel = (event: LedgerEvent) => {
    const actorName = String(event.actorName || '').trim();
    const actorEmail = String(event.actorEmail || '').trim();
    return actorName || actorEmail || 'Unknown User';
  };

  const selectedLedgerEntries = useMemo(() => {
    if (!selectedLedgerEvent?.details) return [] as Array<[string, unknown]>;
    return Object.entries(selectedLedgerEvent.details).filter(([, value]) => value !== undefined);
  }, [selectedLedgerEvent]);

  const handleToggleFeedbackSection = () => {
    setFeedbackSectionOpen((current) => !current);
    setFeedbackStatusMessage(null);
  };

  const refreshFeedback = async (nextStatus?: FeedbackStatus) => {
    await loadFeedbackSummary();
    if (feedbackSectionOpen) {
      await loadFeedback({
        status: nextStatus || activeFeedbackStatus,
        franchiseId: feedbackFranchiseFilter === 'all' ? null : feedbackFranchiseFilter,
      });
    }
  };

  const handleGlobalFeedbackToggle = async (turnOffFeedback: boolean) => {
    setUpdatingGlobalFeedbackEnabled(true);
    setFeedbackStatusMessage(null);
    try {
      await setGlobalFeedbackEnabled(!turnOffFeedback);
      setFeedbackStatusMessage({
        type: 'success',
        message: turnOffFeedback ? 'Global feedback turned off.' : 'Global feedback turned on.',
      });
    } catch (error: any) {
      if (!isFeedbackFeatureUnavailableError(error)) {
        console.error('Failed to update global feedback setting:', error);
      }
      setFeedbackStatusMessage({
        type: 'error',
        message: error?.message || 'Unable to update the global feedback setting.',
      });
    } finally {
      setUpdatingGlobalFeedbackEnabled(false);
    }
  };

  const handleResolveFeedback = async () => {
    const target = feedbackResolveTarget;
    const trimmedMessage = feedbackResolutionMessage.trim();
    if (!target) return;
    if (!trimmedMessage) {
      setFeedbackStatusMessage({ type: 'error', message: 'Enter a resolution message before sending.' });
      return;
    }

    setResolvingFeedback(true);
    setFeedbackStatusMessage(null);
    try {
      await resolveFeedback(target.id, trimmedMessage);
      setFeedbackResolveTarget(null);
      setFeedbackResolutionMessage('');
      setFeedbackStatusMessage({ type: 'success', message: 'Feedback reply sent.' });
      await refreshFeedback('resolved');
      if (!showArchivedFeedback) {
        setFeedbackStatusView('resolved');
      }
      setShowArchivedFeedback(false);
    } catch (error: any) {
      if (!isFeedbackFeatureUnavailableError(error)) {
        console.error('Failed to resolve feedback:', error);
      }
      setFeedbackStatusMessage({
        type: 'error',
        message: error?.message || 'Unable to resolve this feedback item.',
      });
    } finally {
      setResolvingFeedback(false);
    }
  };

  const handleArchiveFeedback = async (entry: FeedbackEntry) => {
    setFeedbackActionId(entry.id);
    setFeedbackStatusMessage(null);
    try {
      await archiveFeedback(entry.id);
      setFeedbackStatusMessage({ type: 'success', message: 'Feedback archived.' });
      await refreshFeedback();
    } catch (error: any) {
      if (!isFeedbackFeatureUnavailableError(error)) {
        console.error('Failed to archive feedback:', error);
      }
      setFeedbackStatusMessage({
        type: 'error',
        message: error?.message || 'Unable to archive this feedback item.',
      });
    } finally {
      setFeedbackActionId(null);
    }
  };

  const handleDeleteFeedback = async (entry: FeedbackEntry) => {
    const confirmed = window.confirm('Delete this feedback item permanently?');
    if (!confirmed) return;

    setFeedbackActionId(entry.id);
    setFeedbackStatusMessage(null);
    try {
      await deleteFeedback(entry.id);
      setFeedbackStatusMessage({ type: 'success', message: 'Feedback deleted.' });
      await refreshFeedback();
    } catch (error: any) {
      if (!isFeedbackFeatureUnavailableError(error)) {
        console.error('Failed to delete feedback:', error);
      }
      setFeedbackStatusMessage({
        type: 'error',
        message: error?.message || 'Unable to delete this feedback item.',
      });
    } finally {
      setFeedbackActionId(null);
    }
  };

  if (!isMaster) {
    return (
      <div className="master-page">
        <div className="master-locked-card">
          <h2>Master access required</h2>
          <p>Sign in with the master account to manage franchises.</p>
          <button className="master-primary-btn" type="button" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="master-page">
      <div className="master-header">
        <h1>Master Console</h1>
      </div>

      <div className="master-grid">
        <div className="master-card">
          <div className="master-card-header">
            <div className="master-card-title-actions">
              <h2>Franchises</h2>
              <button
                className="master-primary-btn master-small-btn"
                type="button"
                onClick={() => {
                  setFormError(null);
                  setShowCreateFranchiseModal(true);
                }}
              >
                Create Franchise
              </button>
            </div>
            <label className="master-toggle">
              <input
                type="checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
              />
              Hide inactive
            </label>
          </div>
          {loading ? (
            <div className="master-empty">Loading franchises...</div>
          ) : visibleFranchises.length === 0 ? (
            <div className="master-empty">No franchises found.</div>
          ) : (
            <div className="master-franchise-list">
              {visibleFranchises.map((franchise) => {
                const franchiseUsers = (usersByFranchise.get(franchise.id) || []).filter((user) => user.isActive !== false);
                const owners = franchiseUsers.filter((u) => u.role === 'owner');
                const admins = franchiseUsers.filter((u) => u.role === 'admin');
                const bookkeepers = franchiseUsers.filter((u) => u.role === 'bookkeeper');
                const designers = franchiseUsers.filter((u) => u.role === 'designer');
                const designerNames = designers
                  .map((designer) => (designer.name || '').trim())
                  .filter((name) => name.length > 0);
                const designerLabel = designerNames.length
                  ? designerNames.join(', ')
                  : designers.length
                  ? 'Unnamed'
                  : 'None';
                const inactive = franchise.deletedAt || franchise.isActive === false;
                const canActAs = Boolean(onActAsFranchise);
                const isActing = Boolean(actingFranchiseId && actingFranchiseId === franchise.id);
                return (
                  <div
                    className={`master-franchise-row is-clickable${inactive ? ' is-inactive' : ''}${isActing ? ' is-acting' : ''}`}
                    key={franchise.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleEditFranchise(franchise)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleEditFranchise(franchise);
                      }
                    }}
                    title="Edit franchise settings"
                  >
                    <div className="master-franchise-meta">
                      <div className="master-franchise-name">{franchise.name || franchise.id}</div>
                      <div className="master-franchise-code">{franchise.franchiseCode || 'No code'}</div>
                      {isActing && <div className="master-franchise-acting">Acting as Owner</div>}
                      {inactive && <div className="master-franchise-status">Inactive</div>}
                    </div>
                    <div className="master-franchise-users">
                      <div>
                        <strong>Owners:</strong>{' '}
                        {owners.length ? owners.map((u) => getUserNameLabel(u)).join(', ') : 'None'}
                      </div>
                      <div>
                        <strong>Admins:</strong>{' '}
                        {admins.length ? admins.map((u) => getUserNameLabel(u)).join(', ') : 'None'}
                      </div>
                      <div>
                        <strong>Book Keepers:</strong>{' '}
                        {bookkeepers.length ? bookkeepers.map((u) => getUserNameLabel(u)).join(', ') : 'None'}
                      </div>
                      <div>
                        <strong>Designers:</strong>{' '}
                        {designerLabel}
                      </div>
                    </div>
                    <div className="master-franchise-actions">
                      <button
                        className="master-secondary-btn"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleEditFranchise(franchise);
                        }}
                      >
                        Franchise Config
                      </button>
                      <button
                        className="master-secondary-btn"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleActAsFranchise(franchise);
                        }}
                        disabled={!canActAs}
                      >
                        Act as Owner
                      </button>
                      <button
                        className="master-danger-btn"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteFranchise(franchise.id, franchise.name);
                        }}
                        disabled={deletingId === franchise.id}
                      >
                        {deletingId === franchise.id ? 'Deleting...' : 'Soft Delete'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <TestAccountsPanel />

        <div className="master-card">
          <div className="master-card-header">
            <div className="master-feedback-heading">
              <div className="master-feedback-title-row">
                <h2>Feedback</h2>
                <button
                  className="master-primary-btn master-small-btn"
                  type="button"
                  onClick={handleToggleFeedbackSection}
                >
                  {feedbackSectionOpen ? 'Close' : 'Open'}
                </button>
                {feedbackSummary.newCount > 0 && (
                  <span className="master-feedback-badge">{feedbackSummary.newCount} New</span>
                )}
              </div>
              <p className="master-kicker">Franchise requests, fixes, and feature suggestions</p>
            </div>
            <label className="master-toggle master-toggle--feedback-header">
              <input
                type="checkbox"
                checked={!globalFeedbackEnabled}
                onChange={(e) => {
                  void handleGlobalFeedbackToggle(e.target.checked);
                }}
                disabled={globalFeedbackEnabledLoading || updatingGlobalFeedbackEnabled}
              />
              Turn Off Global Feedback
            </label>
          </div>
          {feedbackStatusMessage && (
            <div className={feedbackStatusMessage.type === 'error' ? 'master-error' : 'master-success'}>
              {feedbackStatusMessage.message}
            </div>
          )}
          {!feedbackSectionOpen ? (
            <div className="master-empty">
              {!globalFeedbackEnabled
                ? feedbackSummary.newCount > 0
                  ? `Global feedback is turned off. ${feedbackSummary.newCount} submitted item${
                      feedbackSummary.newCount === 1 ? '' : 's'
                    } still waiting.`
                  : 'Global feedback is turned off. You can still open this section to review prior submissions.'
                : feedbackSummary.newCount > 0
                ? `${feedbackSummary.newCount} new feedback item${feedbackSummary.newCount === 1 ? '' : 's'} waiting.`
                : 'No new feedback waiting.'}
            </div>
          ) : (
            <>
              <div className="master-table-actions">
                <div className="master-filter">
                  <label htmlFor="feedback-franchise">Franchise</label>
                  <select
                    id="feedback-franchise"
                    value={feedbackFranchiseFilter}
                    onChange={(e) => setFeedbackFranchiseFilter(e.target.value)}
                  >
                    <option value="all">All franchises</option>
                    {franchiseOptions.map((franchise) => (
                      <option key={franchise.id} value={franchise.id}>
                        {franchise.name || franchise.franchiseCode || franchise.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="master-feedback-view-toggle" role="group" aria-label="Filter feedback by status">
                  <button
                    type="button"
                    className={`master-feedback-view-btn${!showArchivedFeedback && feedbackStatusView === 'new' ? ' is-active' : ''}`}
                    onClick={() => {
                      setShowArchivedFeedback(false);
                      setFeedbackStatusView('new');
                    }}
                  >
                    New ({feedbackSummary.newCount})
                  </button>
                  <button
                    type="button"
                    className={`master-feedback-view-btn${!showArchivedFeedback && feedbackStatusView === 'resolved' ? ' is-active' : ''}`}
                    onClick={() => {
                      setShowArchivedFeedback(false);
                      setFeedbackStatusView('resolved');
                    }}
                  >
                    Resolved ({feedbackSummary.resolvedCount})
                  </button>
                </div>
                <button
                  type="button"
                  className={`master-feedback-archive-toggle${showArchivedFeedback ? ' is-active' : ''}`}
                  onClick={() => setShowArchivedFeedback((current) => !current)}
                >
                  Archived ({feedbackSummary.archivedCount})
                </button>
                <button
                  className="master-primary-btn master-small-btn"
                  type="button"
                  onClick={() => void refreshFeedback()}
                  disabled={feedbackLoading}
                >
                  {feedbackLoading ? 'Refreshing...' : 'Refresh'}
                </button>
                <div className="master-table-meta">
                  {activeFeedbackCount} {formatFeedbackStatusLabel(activeFeedbackStatus)}
                </div>
              </div>
              {feedbackError && <div className="master-error">{feedbackError}</div>}
              {feedbackLoading && feedbackEntries.length === 0 ? (
                <div className="master-empty">Loading feedback...</div>
              ) : feedbackEntries.length === 0 ? (
                <div className="master-empty">
                  No {formatFeedbackStatusLabel(activeFeedbackStatus).toLowerCase()} feedback found.
                </div>
              ) : (
                <div className="master-table-wrapper">
                  <table className="master-table master-feedback-table">
                    <colgroup>
                      <col style={{ width: '142px' }} />
                      <col style={{ width: '146px' }} />
                      <col style={{ width: '72px' }} />
                      <col style={{ width: '104px' }} />
                      <col style={{ width: '82px' }} />
                      <col />
                      <col style={{ width: '126px' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Name</th>
                        <th>Role</th>
                        <th>Franchise</th>
                        <th>Version</th>
                        <th>Message</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feedbackEntries.map((entry) => {
                        const entryBusy = feedbackActionId === entry.id;
                        const feedbackFranchiseLabel =
                          entry.franchiseName || getFranchiseLabel(entry.franchiseId);
                        const resolvedRead = Boolean(entry.responseReadAt);
                        return (
                          <tr key={entry.id}>
                            <td>{renderDateTimeCell(entry.createdAt)}</td>
                            <td>
                              <div className="master-table-primary">{entry.submitterName}</div>
                              {entry.submitterEmail && (
                                <div className="master-table-secondary master-table-secondary--muted">
                                  {entry.submitterEmail}
                                </div>
                              )}
                            </td>
                            <td>{formatRoleLabel(entry.submitterRole)}</td>
                            <td>{feedbackFranchiseLabel}</td>
                            <td>{formatReportedAppVersion(entry.appVersion) || 'N/A'}</td>
                            <td>
                              <div className="master-feedback-message">{entry.message}</div>
                              {entry.resolutionMessage && (
                                <div className="master-feedback-reply-block">
                                  <div className="master-feedback-reply-label">Reply</div>
                                  <div className="master-feedback-reply-text">{entry.resolutionMessage}</div>
                                  <div className="master-feedback-reply-meta">
                                    <span>
                                      {entry.resolvedByName || 'Master'} on {formatDateTime(entry.resolvedAt || entry.updatedAt)}
                                    </span>
                                    {entry.status === 'resolved' && (
                                      <span
                                        className={`master-feedback-read-indicator${resolvedRead ? ' is-read' : ''}`}
                                        title={resolvedRead ? 'Reply read by submitter' : 'Awaiting submitter acknowledgment'}
                                      >
                                        <svg viewBox="0 0 16 16" aria-hidden="true">
                                          <path d="M3.2 8.1 6.4 11.3 12.8 4.9" />
                                        </svg>
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                              {entry.status === 'archived' && entry.archivedAt && (
                                <div className="master-feedback-archived-note">
                                  Archived {formatDateTime(entry.archivedAt)}
                                </div>
                              )}
                            </td>
                            <td>
                              <div className="master-feedback-actions">
                                {entry.status !== 'resolved' && (
                                  <FeedbackActionIconButton
                                    label="Resolve"
                                    onClick={() => {
                                      setFeedbackResolveTarget(entry);
                                      setFeedbackResolutionMessage('');
                                      setFeedbackStatusMessage(null);
                                    }}
                                    disabled={entryBusy || resolvingFeedback}
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <path d="M9 7 4 12l5 5" />
                                      <path d="M4 12h8a6 6 0 0 1 6 6" />
                                    </svg>
                                  </FeedbackActionIconButton>
                                )}
                                {entry.status !== 'archived' && (
                                  <FeedbackActionIconButton
                                    label="Archive"
                                    onClick={() => {
                                      void handleArchiveFeedback(entry);
                                    }}
                                    disabled={entryBusy || resolvingFeedback}
                                  >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      <rect x="3.5" y="4.5" width="17" height="4.5" rx="1.3" />
                                      <path d="M5.5 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9" />
                                      <path d="M10 12h4" />
                                    </svg>
                                  </FeedbackActionIconButton>
                                )}
                                <FeedbackActionIconButton
                                  label="Delete"
                                  danger
                                  onClick={() => {
                                    void handleDeleteFeedback(entry);
                                  }}
                                  disabled={entryBusy || resolvingFeedback}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="12" cy="12" r="8" />
                                    <path d="m9.25 9.25 5.5 5.5" />
                                    <path d="m14.75 9.25-5.5 5.5" />
                                  </svg>
                                </FeedbackActionIconButton>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <div className="master-card">
          <div className="master-card-header">
            <div>
              <h2>Ledger</h2>
              <p className="master-kicker">Recent Franchise Activity</p>
            </div>
            <button
              className="master-primary-btn master-small-btn"
              type="button"
              onClick={() => void loadLedger()}
              disabled={ledgerLoading}
            >
              {ledgerLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          <div className="master-table-actions">
            <div className="master-filter">
              <label htmlFor="ledger-franchise">Franchise</label>
              <select
                id="ledger-franchise"
                value={ledgerFranchiseFilter}
                onChange={(e) => setLedgerFranchiseFilter(e.target.value)}
              >
                <option value="all">All franchises</option>
                {ledgerFranchiseOptions.map((franchise) => (
                  <option key={franchise.id} value={franchise.id}>
                    {franchise.name || franchise.franchiseCode || franchise.id}
                  </option>
                ))}
              </select>
            </div>
            <label className="master-toggle master-toggle--table">
              <input
                type="checkbox"
                checked={hideInactiveLedgerFranchises}
                onChange={(e) => setHideInactiveLedgerFranchises(e.target.checked)}
              />
              Hide Inactive Franchises
            </label>
            <div className="master-table-meta">{ledgerCountLabel}</div>
          </div>
          {ledgerError && <div className="master-error">{ledgerError}</div>}
          {ledgerLoading ? (
            <div className="master-empty">Loading ledger...</div>
          ) : filteredLedgerEvents.length === 0 ? (
            <div className="master-empty">
              {ledgerEvents.length === 0
                ? 'No ledger events recorded yet.'
                : 'No ledger events match the selected franchise.'}
            </div>
          ) : (
            <>
              <div className="master-table-wrapper">
                <table className="master-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Franchise Name</th>
                      <th>User</th>
                      <th>Role</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedgerEvents.map((event) => {
                      const userLabel = getLedgerUserLabel(event);
                      const userEmail = String(event.actorEmail || '').trim();
                      return (
                        <tr
                          key={event.id}
                          className="master-ledger-row"
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedLedgerEvent(event)}
                          onKeyDown={(keyboardEvent) => {
                            if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                              keyboardEvent.preventDefault();
                              setSelectedLedgerEvent(event);
                            }
                          }}
                        >
                          <td>{renderDateTimeCell(event.createdAt)}</td>
                          <td>
                            <div className="master-table-primary">{getLedgerFranchiseLabel(event)}</div>
                          </td>
                          <td>
                            <div className="master-table-primary">{userLabel}</div>
                            {userEmail && userEmail !== userLabel && (
                              <div className="master-table-secondary master-table-secondary--muted">{userEmail}</div>
                            )}
                          </td>
                          <td>{getLedgerRoleLabel(event)}</td>
                          <td>
                            <div className="master-table-primary">{event.action}</div>
                            <div className="master-table-secondary master-table-secondary--muted">View details</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {hasMoreLedgerEvents && (
                <div className="master-ledger-load-more">
                  <button
                    className="master-primary-btn master-small-btn"
                    type="button"
                    onClick={handleShowMoreLedgerEvents}
                  >
                    Show 10 more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCreateFranchiseModal && (
        <div className="master-ledger-backdrop" onClick={handleCloseCreateFranchiseModal}>
          <div
            className="master-create-franchise-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create franchise"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="master-editor-header">
              <div>
                <p className="master-editor-kicker">Franchises</p>
                <h2 className="master-editor-title">Create Franchise</h2>
              </div>
              <button
                className="master-editor-close"
                type="button"
                onClick={handleCloseCreateFranchiseModal}
                aria-label="Close create franchise dialog"
                disabled={creating}
              >
                x
              </button>
            </div>
            <p className="master-create-franchise-copy">
              Add the franchise details and assign the initial owner account.
            </p>
            <form
              className="master-form master-create-franchise-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateFranchise();
              }}
            >
              <input
                type="text"
                value={franchiseName}
                onChange={(e) => setFranchiseName(e.target.value)}
                placeholder="Franchise name"
                autoFocus
              />
              <input
                type="text"
                value={franchiseCode}
                onChange={(e) => setFranchiseCode(e.target.value.toUpperCase())}
                placeholder="Franchise code"
              />
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="Owner email"
              />
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Owner display name"
              />
              {formError && <div className="master-error">{formError}</div>}
              <div className="master-create-franchise-actions">
                <button
                  className="master-secondary-btn"
                  type="button"
                  onClick={handleCloseCreateFranchiseModal}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button className="master-primary-btn" type="submit" disabled={creating}>
                  {creating ? 'Creating...' : 'Create New Franchise'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tempPassword && (
        <TempPasswordModal
          tempPassword={tempPassword}
          onClose={() => setTempPassword(null)}
          title="Owner Temporary Password"
          description="Copy this password for the owner. It will only be shown once."
        />
      )}

      {editingFranchise && (
        <MasterFranchiseEditorModal
          franchise={editingFranchise}
          users={usersByFranchise.get(editingFranchise.id) || []}
          pricingModels={pricingModelsByFranchise.get(editingFranchise.id) || []}
          pricingLoading={pricingLoading}
          pricingError={pricingError}
          copyTargets={copyTargets}
          copyTargetOptions={copyTargetOptions}
          copyingId={copyingId}
          copyError={copyError}
          copySuccess={copySuccess}
          onCopyTargetChange={handleCopyTargetChange}
          onCopyPricingModel={handleCopyPricingModel}
          updatedBy={session?.userEmail || session?.userName || null}
          onClose={handleCloseFranchiseEditor}
          onRefresh={refreshMasterData}
          onFranchiseUpdated={handleFranchiseUpdated}
        />
      )}

      {feedbackResolveTarget && (
        <div
          className="master-ledger-backdrop"
          onClick={() => {
            if (!resolvingFeedback) setFeedbackResolveTarget(null);
          }}
        >
          <div
            className="master-feedback-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="master-editor-header">
              <div>
                <p className="master-editor-kicker">Resolve Feedback</p>
                <h2 className="master-editor-title">{feedbackResolveTarget.submitterName}</h2>
              </div>
              <button
                className="master-editor-close"
                type="button"
                onClick={() => setFeedbackResolveTarget(null)}
                aria-label="Close feedback resolution"
                disabled={resolvingFeedback}
              >
                x
              </button>
            </div>
            <div className="master-feedback-modal-meta">
              <div>
                <strong>Franchise:</strong> {feedbackResolveTarget.franchiseName || getFranchiseLabel(feedbackResolveTarget.franchiseId)}
              </div>
              <div>
                <strong>Original:</strong> {feedbackResolveTarget.message}
              </div>
            </div>
            <textarea
              className="master-feedback-modal-textarea"
              value={feedbackResolutionMessage}
              onChange={(event) => setFeedbackResolutionMessage(event.target.value)}
              placeholder="Type the reply that should appear in the submitter's dashboard inbox..."
              maxLength={4000}
              disabled={resolvingFeedback}
            />
            <div className="master-feedback-modal-footer">
              <div className="master-table-secondary master-table-secondary--muted">
                {feedbackResolutionMessage.trim().length}/4000
              </div>
              <div className="master-feedback-actions">
                <button
                  className="master-secondary-btn master-small-btn"
                  type="button"
                  onClick={() => setFeedbackResolveTarget(null)}
                  disabled={resolvingFeedback}
                >
                  Cancel
                </button>
                <button
                  className="master-primary-btn master-small-btn"
                  type="button"
                  onClick={() => void handleResolveFeedback()}
                  disabled={resolvingFeedback}
                >
                  {resolvingFeedback ? 'Sending...' : 'Send Reply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedLedgerEvent && (
        <div className="master-ledger-backdrop" onClick={() => setSelectedLedgerEvent(null)}>
          <div
            className="master-ledger-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="master-editor-header">
              <div>
                <p className="master-editor-kicker">Ledger Detail</p>
                <h2 className="master-editor-title">{selectedLedgerEvent.action}</h2>
              </div>
              <button
                className="master-editor-close"
                type="button"
                onClick={() => setSelectedLedgerEvent(null)}
                aria-label="Close ledger detail"
              >
                x
              </button>
            </div>
            <div className="master-ledger-meta">
              <div className="master-ledger-meta-row">
                <span>Time</span>
                <strong>{formatDateTime(selectedLedgerEvent.createdAt)}</strong>
              </div>
              <div className="master-ledger-meta-row">
                <span>Franchise</span>
                <strong>{getLedgerFranchiseLabel(selectedLedgerEvent)}</strong>
              </div>
              <div className="master-ledger-meta-row">
                <span>User</span>
                <strong>{getLedgerUserLabel(selectedLedgerEvent)}</strong>
              </div>
              <div className="master-ledger-meta-row">
                <span>Role</span>
                <strong>{getLedgerRoleLabel(selectedLedgerEvent)}</strong>
              </div>
            </div>
            <div className="master-ledger-details">
              <h3>Stored Detail</h3>
              {selectedLedgerEntries.length === 0 ? (
                <div className="master-empty">No additional details recorded.</div>
              ) : (
                <div className="master-ledger-detail-list">
                  {selectedLedgerEntries.map(([key, value]) => (
                    <div className="master-ledger-detail-row" key={key}>
                      <div className="master-ledger-detail-key">{formatDetailLabel(key)}</div>
                      <pre className="master-ledger-detail-value">{formatDetailValue(value)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MasterPage;
