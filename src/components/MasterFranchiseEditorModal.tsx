import { useEffect, useMemo, useState } from 'react';
import type { Proposal } from '../types/proposal-new';
import TempPasswordModal from './TempPasswordModal';
import './MasterFranchiseEditorModal.css';
import { useFranchiseSignedWorkflowDisabled } from '../hooks/useFranchiseSignedWorkflowDisabled';
import { formatReportedAppVersion } from '../services/appVersionReporter';
import { getLatestFranchiseAppVersion } from '../services/franchiseRelease';
import {
  saveMasterFranchiseSettings,
  type MasterFranchise,
  type MasterPricingModel,
  type MasterUser,
} from '../services/masterAdminAdapter';
import { saveFranchiseSignedWorkflowDisabled } from '../services/franchiseBranding';
import {
  createFranchiseUser,
  deleteFranchiseUser,
  resetFranchiseUserPassword,
  updateFranchiseUserRole,
} from '../services/franchiseUsersAdapter';
import { listProposals } from '../services/proposalsAdapter';
import {
  loadFranchiseConfiguration,
  publishFranchiseConfiguration,
  type FranchiseConfiguration,
  type LoadedFranchiseConfiguration,
} from '../services/franchiseConfiguration';

type StatusMessage = {
  type: 'success' | 'error';
  message: string;
} | null;

type TempPasswordState = {
  password: string;
  title: string;
  description: string;
} | null;

type MasterFranchiseEditorModalProps = {
  franchise: MasterFranchise;
  users: MasterUser[];
  pricingModels: MasterPricingModel[];
  pricingLoading: boolean;
  pricingError: string | null;
  copyTargets: Record<string, string>;
  copyTargetOptions: MasterFranchise[];
  copyingId: string | null;
  copyError: string | null;
  copySuccess: string | null;
  onCopyTargetChange: (modelId: string, value: string) => void;
  onCopyPricingModel: (model: MasterPricingModel) => void | Promise<void>;
  updatedBy?: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onFranchiseUpdated?: (franchise: MasterFranchise) => void;
};

const getDisplayName = (user: Pick<MasterUser, 'name' | 'email'>) => {
  const trimmedName = String(user.name || '').trim();
  return trimmedName || user.email;
};

const normalizeComparableText = (value?: string | null) => String(value || '').trim().toLowerCase();

const formatPricingModelDate = (value?: string) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
};

function MasterFranchiseEditorModal({
  franchise,
  users,
  pricingModels,
  pricingLoading,
  pricingError,
  copyTargets,
  copyTargetOptions,
  copyingId,
  copyError,
  copySuccess,
  onCopyTargetChange,
  onCopyPricingModel,
  updatedBy,
  onClose,
  onRefresh,
  onFranchiseUpdated,
}: MasterFranchiseEditorModalProps) {
  const {
    disableSignedWorkflow,
    isLoading: signedWorkflowSettingLoading,
  } = useFranchiseSignedWorkflowDisabled(franchise.id);
  const [pendingName, setPendingName] = useState(franchise.name || '');
  const [pendingCode, setPendingCode] = useState(franchise.franchiseCode || '');
  const [pendingDisableSignedWorkflow, setPendingDisableSignedWorkflow] = useState<boolean>(
    disableSignedWorkflow === true
  );
  const [newDesignerName, setNewDesignerName] = useState('');
  const [newDesignerEmail, setNewDesignerEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'designer' | 'bookkeeper'>('designer');
  const [status, setStatus] = useState<StatusMessage>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [addingDesigner, setAddingDesigner] = useState(false);
  const [promotingUserId, setPromotingUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [demotingUserId, setDemotingUserId] = useState<string | null>(null);
  const [makingOwnerId, setMakingOwnerId] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<TempPasswordState>(null);
  const [proposalCountsByUserId, setProposalCountsByUserId] = useState<Record<string, number>>({});
  const [loadingProposalCounts, setLoadingProposalCounts] = useState(false);
  const [transferTargetsByUserId, setTransferTargetsByUserId] = useState<Record<string, string>>({});
  const [loadedConfiguration, setLoadedConfiguration] = useState<LoadedFranchiseConfiguration | null>(null);
  const [pendingConfiguration, setPendingConfiguration] = useState<FranchiseConfiguration | null>(null);
  const [configurationSummary, setConfigurationSummary] = useState('');
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [configurationSaving, setConfigurationSaving] = useState(false);
  const [configurationStatus, setConfigurationStatus] = useState<StatusMessage>(null);
  const latestFranchiseVersionLabel = formatReportedAppVersion(
    getLatestFranchiseAppVersion(franchise.franchiseCode)
  );

  useEffect(() => {
    setPendingName(franchise.name || '');
    setPendingCode(franchise.franchiseCode || '');
    setPendingDisableSignedWorkflow(disableSignedWorkflow === true);
    setStatus(null);
    setNewDesignerName('');
    setNewDesignerEmail('');
    setNewUserRole('designer');
    setTransferTargetsByUserId({});
  }, [disableSignedWorkflow, franchise.franchiseCode, franchise.id, franchise.name]);

  useEffect(() => {
    let cancelled = false;
    setConfigurationLoading(true);
    setConfigurationStatus(null);
    void loadFranchiseConfiguration(franchise.id, { force: true })
      .then((loaded) => {
        if (cancelled) return;
        setLoadedConfiguration(loaded);
        setPendingConfiguration({
          ...loaded.configuration,
          capabilities: { ...loaded.configuration.capabilities },
        });
      })
      .catch((error: any) => {
        if (!cancelled) {
          setConfigurationStatus({ type: 'error', message: error?.message || 'Unable to load franchise configuration.' });
        }
      })
      .finally(() => {
        if (!cancelled) setConfigurationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [franchise.id]);

  const handlePublishConfiguration = async () => {
    if (!pendingConfiguration || configurationSaving) return;
    setConfigurationSaving(true);
    setConfigurationStatus(null);
    try {
      const published = await publishFranchiseConfiguration({
        franchiseId: franchise.id,
        configuration: pendingConfiguration,
        changeSummary: configurationSummary.trim() || 'Franchise configuration updated from Master UI',
        publishedBy: updatedBy || null,
      });
      setLoadedConfiguration(published);
      setPendingConfiguration({
        ...published.configuration,
        capabilities: { ...published.configuration.capabilities },
      });
      setConfigurationSummary('');
      setConfigurationStatus({
        type: 'success',
        message: `Configuration revision ${published.revisionNumber} published.`,
      });
    } catch (error: any) {
      setConfigurationStatus({ type: 'error', message: error?.message || 'Unable to publish franchise configuration.' });
    } finally {
      setConfigurationSaving(false);
    }
  };

  useEffect(() => {
    setTransferTargetsByUserId((current) => {
      const nextEntries = Object.entries(current).filter(([userId, transferUserId]) => {
        if (!transferUserId) return false;
        const sourceUser = users.find((user) => user.id === userId && user.isActive !== false);
        const targetUser = users.find((user) => user.id === transferUserId && user.isActive !== false);
        if (!sourceUser || !targetUser) return false;
        if (sourceUser.franchiseId !== targetUser.franchiseId) return false;
        return targetUser.role === 'owner' || targetUser.role === 'admin' || targetUser.role === 'designer';
      });

      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }

      return Object.fromEntries(nextEntries);
    });
  }, [users]);

  const activeUsers = useMemo(() => {
    const roleWeight = { owner: 4, admin: 3, bookkeeper: 2, designer: 1, master: 0 } as Record<string, number>;
    return [...users]
      .filter((user) => user.isActive !== false)
      .sort(
        (a, b) =>
          (roleWeight[b.role] || 0) - (roleWeight[a.role] || 0) ||
          getDisplayName(a).localeCompare(getDisplayName(b)) ||
          a.email.localeCompare(b.email)
      );
  }, [users]);

  const owners = activeUsers.filter((user) => user.role === 'owner');
  const admins = activeUsers.filter((user) => user.role === 'admin');
  const bookkeepers = activeUsers.filter((user) => user.role === 'bookkeeper');
  const designers = activeUsers.filter((user) => user.role === 'designer');
  const transferEligibleUsers = activeUsers.filter(
    (user) => user.role === 'owner' || user.role === 'admin' || user.role === 'designer'
  );
  const isInactive = Boolean(franchise.deletedAt || franchise.isActive === false);
  const sortedPricingModels = useMemo(() => {
    const rows = [...pricingModels];
    rows.sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return (a.name || '').localeCompare(b.name || '');
    });
    return rows;
  }, [pricingModels]);

  const normalizedPendingName = pendingName.trim();
  const normalizedPendingCode = pendingCode.trim().toUpperCase();
  const normalizedCurrentName = String(franchise.name || '').trim();
  const normalizedCurrentCode = String(franchise.franchiseCode || '').trim().toUpperCase();
  const hasCoreSettingsChange =
    normalizedPendingName !== normalizedCurrentName || normalizedPendingCode !== normalizedCurrentCode;
  const hasSettingsChange =
    hasCoreSettingsChange || pendingDisableSignedWorkflow !== (disableSignedWorkflow === true);
  const hasConfigurationChanges = Boolean(
    pendingConfiguration &&
    loadedConfiguration &&
    JSON.stringify(pendingConfiguration) !== JSON.stringify(loadedConfiguration.configuration)
  );

  useEffect(() => {
    let cancelled = false;

    const loadProposalCounts = async () => {
      setLoadingProposalCounts(true);
      try {
        const franchiseProposals = await listProposals(franchise.id);
        if (cancelled) return;

        const nextCounts = activeUsers.reduce<Record<string, number>>((counts, user) => {
          const identifiers = new Set(
            [normalizeComparableText(user.name), normalizeComparableText(user.email)].filter(Boolean)
          );
          counts[user.id] = franchiseProposals.filter((proposal: Proposal) => {
            const proposalDesigner = normalizeComparableText(proposal.designerName);
            return Boolean(proposalDesigner) && identifiers.has(proposalDesigner);
          }).length;
          return counts;
        }, {});

        setProposalCountsByUserId(nextCounts);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load franchise proposal counts:', error);
          setProposalCountsByUserId({});
        }
      } finally {
        if (!cancelled) {
          setLoadingProposalCounts(false);
        }
      }
    };

    void loadProposalCounts();

    return () => {
      cancelled = true;
    };
  }, [activeUsers, franchise.id]);

  const handleSaveSettings = async () => {
    if (!normalizedPendingName) {
      setStatus({ type: 'error', message: 'Franchise name is required.' });
      return;
    }
    if (!normalizedPendingCode) {
      setStatus({ type: 'error', message: 'Franchise code is required.' });
      return;
    }

    setSavingSettings(true);
    setStatus(null);
    try {
      if (hasCoreSettingsChange) {
        const updatedFranchise = await saveMasterFranchiseSettings({
          franchiseId: franchise.id,
          franchiseName: normalizedPendingName,
          franchiseCode: normalizedPendingCode,
          previousName: franchise.name,
          previousCode: franchise.franchiseCode,
          updatedBy: updatedBy ?? null,
        });
        onFranchiseUpdated?.(updatedFranchise);
      }
      if (pendingDisableSignedWorkflow !== (disableSignedWorkflow === true)) {
        await saveFranchiseSignedWorkflowDisabled({
          franchiseId: franchise.id,
          disableSignedWorkflow: pendingDisableSignedWorkflow,
          updatedBy: updatedBy ?? null,
        });
      }
      await onRefresh();
      setStatus({ type: 'success', message: 'Franchise settings updated.' });
    } catch (error: any) {
      console.error('Failed to save franchise settings:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to save franchise settings.',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddDesigner = async () => {
    const trimmedName = newDesignerName.trim();
    const trimmedEmail = newDesignerEmail.trim().toLowerCase();
    if (!trimmedName) {
      setStatus({ type: 'error', message: 'Designer name is required.' });
      return;
    }
    if (!trimmedEmail) {
      setStatus({ type: 'error', message: 'Designer email is required.' });
      return;
    }

    setAddingDesigner(true);
    setStatus(null);
    try {
      const result = await createFranchiseUser({
        franchiseId: franchise.id,
        email: trimmedEmail,
        name: trimmedName,
        role: newUserRole,
      });
      setNewDesignerName('');
      setNewDesignerEmail('');
      setNewUserRole('designer');
      await onRefresh();
      setStatus({
        type: 'success',
        message: `${newUserRole === 'bookkeeper' ? 'Book Keeper' : 'Designer'} created.`,
      });
      if (result?.tempPassword) {
        setTempPassword({
          password: result.tempPassword,
          title: `${newUserRole === 'bookkeeper' ? 'Book Keeper' : 'Designer'} Temporary Password`,
          description: `Copy this password for the new ${newUserRole === 'bookkeeper' ? 'book keeper' : 'designer'}. It will only be shown once.`,
        });
      }
    } catch (error: any) {
      console.error('Failed to create designer:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to create the designer.',
      });
    } finally {
      setAddingDesigner(false);
    }
  };

  const handleMakeBookkeeper = async (user: MasterUser) => {
    setPromotingUserId(user.id);
    setStatus(null);
    try {
      await updateFranchiseUserRole(user.id, 'bookkeeper');
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} is now a book keeper.` });
    } catch (error: any) {
      console.error('Failed to make user a bookkeeper:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to update this user to Book Keeper.',
      });
    } finally {
      setPromotingUserId(null);
    }
  };

  const handlePromoteDesigner = async (user: MasterUser) => {
    setPromotingUserId(user.id);
    setStatus(null);
    try {
      await updateFranchiseUserRole(user.id, 'admin');
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} is now an admin.` });
    } catch (error: any) {
      console.error('Failed to promote designer:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to promote the designer.',
      });
    } finally {
      setPromotingUserId(null);
    }
  };

  const handleResetPassword = async (user: MasterUser) => {
    setResettingUserId(user.id);
    setStatus(null);
    try {
      const result = await resetFranchiseUserPassword(user.id);
      if (result?.tempPassword) {
        setTempPassword({
          password: result.tempPassword,
          title: 'Temporary Password',
          description: `Copy this password for ${getDisplayName(user)}. It will only be shown once.`,
        });
      }
      setStatus({ type: 'success', message: `Password reset for ${getDisplayName(user)}.` });
    } catch (error: any) {
      console.error('Failed to reset password:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to reset the password.',
      });
    } finally {
      setResettingUserId(null);
    }
  };

  const handleRemoveDesigner = async (user: MasterUser) => {
    const proposalCount = proposalCountsByUserId[user.id] || 0;
    const transferToUserId = transferTargetsByUserId[user.id] || '';
    const transferOptions = transferEligibleUsers.filter((candidate) => candidate.id !== user.id);
    if (user.role === 'designer' && proposalCount > 0 && transferOptions.length === 0) {
      setStatus({
        type: 'error',
        message: `Add or promote another owner, admin, or designer before removing ${getDisplayName(user)}.`,
      });
      return;
    }
    if (user.role === 'designer' && proposalCount > 0 && !transferToUserId) {
      setStatus({
        type: 'error',
        message: `Choose a transfer user before removing ${getDisplayName(user)}.`,
      });
      return;
    }

    const confirmDelete = window.confirm(
      user.role === 'designer' && proposalCount > 0
        ? `Remove ${getDisplayName(user)} and transfer ${proposalCount} proposal${proposalCount === 1 ? '' : 's'}?`
        : `Remove ${getDisplayName(user)} from this franchise?`
    );
    if (!confirmDelete) return;

    setRemovingUserId(user.id);
    setStatus(null);
    try {
      await deleteFranchiseUser(user.id, proposalCount > 0 ? transferToUserId : null);
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} was removed.` });
    } catch (error: any) {
      console.error('Failed to remove designer:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to remove the user.',
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  const handleDemoteOwner = async (user: MasterUser) => {
    const confirmDemote = window.confirm(
      `Demote ${getDisplayName(user)} to admin? If no owner remains, you can promote an admin back to owner from this window.`
    );
    if (!confirmDemote) return;

    setDemotingUserId(user.id);
    setStatus(null);
    try {
      await updateFranchiseUserRole(user.id, 'admin');
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} is now an admin.` });
    } catch (error: any) {
      console.error('Failed to demote owner:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to demote the owner.',
      });
    } finally {
      setDemotingUserId(null);
    }
  };

  const handleMakeOwner = async (user: MasterUser) => {
    const confirmPromote = window.confirm(`Promote ${getDisplayName(user)} to owner?`);
    if (!confirmPromote) return;

    setMakingOwnerId(user.id);
    setStatus(null);
    try {
      await updateFranchiseUserRole(user.id, 'owner');
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} is now the owner.` });
    } catch (error: any) {
      console.error('Failed to promote admin to owner:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to promote this admin to owner.',
      });
    } finally {
      setMakingOwnerId(null);
    }
  };

  const handleDemoteAdmin = async (user: MasterUser) => {
    const confirmDemote = window.confirm(
      `Demote ${getDisplayName(user)} to designer? They will lose admin access for this franchise until promoted again.`
    );
    if (!confirmDemote) return;

    setDemotingUserId(user.id);
    setStatus(null);
    try {
      await updateFranchiseUserRole(user.id, 'designer');
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} is now a designer.` });
    } catch (error: any) {
      console.error('Failed to demote admin:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to demote this admin.',
      });
    } finally {
      setDemotingUserId(null);
    }
  };

  const handleDemoteBookkeeper = async (user: MasterUser) => {
    const confirmDemote = window.confirm(
      `Demote ${getDisplayName(user)} to designer? They will lose Book Keeper workflow access until promoted again.`
    );
    if (!confirmDemote) return;

    setDemotingUserId(user.id);
    setStatus(null);
    try {
      await updateFranchiseUserRole(user.id, 'designer');
      await onRefresh();
      setStatus({ type: 'success', message: `${getDisplayName(user)} is now a designer.` });
    } catch (error: any) {
      console.error('Failed to demote bookkeeper:', error);
      setStatus({
        type: 'error',
        message: error?.message || 'Unable to demote this Book Keeper.',
      });
    } finally {
      setDemotingUserId(null);
    }
  };

  const renderUserRow = (
    user: MasterUser,
    options: {
      canMakeOwner?: boolean;
      canPromoteDesigner?: boolean;
      canMakeBookkeeper?: boolean;
      canDemoteOwner?: boolean;
      canDemoteAdmin?: boolean;
      canDemoteBookkeeper?: boolean;
      canRemoveDesigner?: boolean;
    }
  ) => {
    const proposalCount = proposalCountsByUserId[user.id] || 0;
    const requiresTransfer = user.role === 'designer' && proposalCount > 0;
    const transferOptions = transferEligibleUsers.filter((candidate) => candidate.id !== user.id);
    const hasTransferOptions = transferOptions.length > 0;
    const isTransferBlocked = requiresTransfer && !hasTransferOptions;
    const reportedVersionLabel = formatReportedAppVersion(user.currentAppVersion);
    const isLatestRelease = Boolean(
      reportedVersionLabel && latestFranchiseVersionLabel && reportedVersionLabel === latestFranchiseVersionLabel
    );
    const versionStatusLabel = isLatestRelease
      ? 'Latest release'
      : latestFranchiseVersionLabel
        ? `Latest release: ${latestFranchiseVersionLabel}`
        : 'Latest release metadata unavailable';

    return (
    <div className={`master-editor-user-row role-${user.role}`} key={user.id}>
      <div className="master-editor-user-meta">
        <div className="master-editor-user-name">
          <span>{getDisplayName(user)}</span>
          {reportedVersionLabel && (
            <span
              className={`master-editor-user-version-tag ${isLatestRelease ? 'is-latest' : 'is-outdated'}`}
              title={versionStatusLabel}
              aria-label={`${reportedVersionLabel}, ${versionStatusLabel}`}
            >
              {reportedVersionLabel}
            </span>
          )}
        </div>
        <div className="master-editor-user-email">{user.email}</div>
        {options.canRemoveDesigner && (
          <div className="master-editor-user-transfer">
            {loadingProposalCounts ? (
              <div className="master-editor-user-transfer-note">Checking saved proposals...</div>
            ) : requiresTransfer ? (
              <>
                <div className="master-editor-user-transfer-note">
                  {proposalCount} proposal{proposalCount === 1 ? '' : 's'} must be transferred before removal
                </div>
                {hasTransferOptions ? (
                  <select
                    value={transferTargetsByUserId[user.id] || ''}
                    onChange={(event) =>
                      setTransferTargetsByUserId((current) => ({
                        ...current,
                        [user.id]: event.target.value,
                      }))
                    }
                    disabled={removingUserId === user.id || isInactive}
                  >
                    <option value="">Transfer proposals to...</option>
                    {transferOptions.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {`${getDisplayName(candidate)} (${candidate.role})`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="master-editor-user-transfer-note">
                    No active owner, admin, or designer is available to receive these proposals yet.
                  </div>
                )}
              </>
            ) : (
              <div className="master-editor-user-transfer-note">No saved proposals to transfer.</div>
            )}
          </div>
        )}
      </div>
      <div className="master-editor-user-actions">
        {options.canMakeOwner && (
          <button
            className="master-secondary-btn"
            type="button"
            onClick={() => handleMakeOwner(user)}
            disabled={makingOwnerId === user.id || isInactive}
          >
            {makingOwnerId === user.id ? 'Saving...' : 'Make Owner'}
          </button>
        )}
        {options.canPromoteDesigner && (
          <button
            className="master-secondary-btn"
            type="button"
            onClick={() => handlePromoteDesigner(user)}
            disabled={promotingUserId === user.id || isInactive}
          >
            {promotingUserId === user.id ? 'Saving...' : 'Make Admin'}
          </button>
        )}
        {options.canMakeBookkeeper && (
          <button
            className="master-secondary-btn"
            type="button"
            onClick={() => handleMakeBookkeeper(user)}
            disabled={promotingUserId === user.id || isInactive}
          >
            {promotingUserId === user.id ? 'Saving...' : 'Make Book Keeper'}
          </button>
        )}
        <button
          className="master-secondary-btn"
          type="button"
          onClick={() => handleResetPassword(user)}
          disabled={resettingUserId === user.id || isInactive}
        >
          {resettingUserId === user.id ? 'Resetting...' : 'Reset Password'}
        </button>
        {options.canDemoteOwner && (
          <button
            className="master-secondary-btn"
            type="button"
            onClick={() => handleDemoteOwner(user)}
            disabled={demotingUserId === user.id || isInactive}
          >
            {demotingUserId === user.id ? 'Saving...' : 'Demote to Admin'}
          </button>
        )}
        {options.canDemoteAdmin && (
          <button
            className="master-secondary-btn"
            type="button"
            onClick={() => handleDemoteAdmin(user)}
            disabled={demotingUserId === user.id || isInactive}
          >
            {demotingUserId === user.id ? 'Saving...' : 'Demote to Designer'}
          </button>
        )}
        {options.canDemoteBookkeeper && (
          <button
            className="master-secondary-btn"
            type="button"
            onClick={() => handleDemoteBookkeeper(user)}
            disabled={demotingUserId === user.id || isInactive}
          >
            {demotingUserId === user.id ? 'Saving...' : 'Make Designer'}
          </button>
        )}
        {options.canRemoveDesigner && (
          <button
            className="master-danger-btn"
            type="button"
            onClick={() => handleRemoveDesigner(user)}
            disabled={
              removingUserId === user.id ||
              isInactive ||
              isTransferBlocked ||
              (requiresTransfer && !transferTargetsByUserId[user.id])
            }
          >
            {removingUserId === user.id ? 'Removing...' : 'Remove User'}
          </button>
        )}
      </div>
    </div>
  );
  };

  return (
    <>
      <div className="master-editor-backdrop" onClick={onClose}>
        <div className="master-editor-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
          <div className="master-editor-header">
            <div>
              <p className="master-editor-kicker">Franchise Settings</p>
              <h2 className="master-editor-title">{franchise.name || franchise.id}</h2>
            </div>
            <button
              className="master-editor-close"
              type="button"
              onClick={onClose}
              aria-label="Close franchise editor"
            >
              x
            </button>
          </div>

          {status && <div className={status.type === 'error' ? 'master-error' : 'master-success'}>{status.message}</div>}

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Basic Settings</h3>
              </div>
              <button
                className="master-primary-btn master-small-btn"
                type="button"
                onClick={handleSaveSettings}
                disabled={!hasSettingsChange || savingSettings || signedWorkflowSettingLoading}
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
            <div className="master-editor-field-grid">
              <label className="master-editor-field">
                <span>Franchise Name</span>
                <input
                  type="text"
                  value={pendingName}
                  onChange={(event) => setPendingName(event.target.value)}
                  placeholder="Franchise name"
                  disabled={savingSettings}
                />
              </label>
              <label className="master-editor-field">
                <span>Franchise Code</span>
                <input
                  type="text"
                  value={pendingCode}
                  onChange={(event) => setPendingCode(event.target.value.toUpperCase())}
                  placeholder="Franchise code"
                  disabled={savingSettings}
                />
              </label>
            </div>
            <label className="master-editor-toggle">
              <input
                type="checkbox"
                checked={pendingDisableSignedWorkflow}
                onChange={(event) => setPendingDisableSignedWorkflow(event.target.checked)}
                disabled={savingSettings || signedWorkflowSettingLoading}
              />
              <div className="master-editor-toggle-copy">
                <span>Disable Signed Workflow</span>
                <p>
                  Keeps approved proposals in the submitted/approved workflow by disabling
                  <strong> Mark as Signed</strong> for this franchise.
                </p>
              </div>
            </label>
            {signedWorkflowSettingLoading && (
              <div className="master-editor-inline-note">Loading workflow settings...</div>
            )}
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Franchise Configuration</h3>
                <p className="master-editor-inline-note">
                  Current revision {loadedConfiguration?.revisionNumber || 0}. Publishing creates an immutable new revision for this franchise only.
                </p>
              </div>
              <button
                className="master-primary-btn master-small-btn"
                type="button"
                onClick={() => void handlePublishConfiguration()}
                disabled={!hasConfigurationChanges || configurationLoading || configurationSaving}
              >
                {configurationSaving ? 'Publishing...' : 'Publish Configuration'}
              </button>
            </div>
            {configurationStatus && (
              <div className={configurationStatus.type === 'error' ? 'master-error' : 'master-success'}>
                {configurationStatus.message}
              </div>
            )}
            {configurationLoading || !pendingConfiguration ? (
              <div className="master-empty">Loading franchise configuration...</div>
            ) : (
              <>
                <div className="master-editor-field-grid">
                  <label className="master-editor-field">
                    <span>Theme Profile</span>
                    <input
                      value={pendingConfiguration.themeProfile}
                      onChange={(event) => setPendingConfiguration({ ...pendingConfiguration, themeProfile: event.target.value })}
                      disabled={configurationSaving}
                    />
                  </label>
                  <label className="master-editor-field">
                    <span>Proposal Layout</span>
                    <input
                      value={pendingConfiguration.proposalLayout}
                      onChange={(event) => setPendingConfiguration({ ...pendingConfiguration, proposalLayout: event.target.value })}
                      disabled={configurationSaving}
                    />
                  </label>
                  <label className="master-editor-field">
                    <span>Location Input</span>
                    <select
                      value={pendingConfiguration.locationInputMode}
                      onChange={(event) => setPendingConfiguration({
                        ...pendingConfiguration,
                        locationInputMode: event.target.value === 'county' ? 'county' : 'state',
                      })}
                      disabled={configurationSaving}
                    >
                      <option value="state">State</option>
                      <option value="county">County</option>
                    </select>
                  </label>
                  <label className="master-editor-field">
                    <span>Contract Resolution</span>
                    <select
                      value={pendingConfiguration.contractResolutionMode}
                      onChange={(event) => setPendingConfiguration({
                        ...pendingConfiguration,
                        contractResolutionMode: event.target.value === 'pool_type_only' ? 'pool_type_only' : 'state_and_pool_type',
                      })}
                      disabled={configurationSaving}
                    >
                      <option value="state_and_pool_type">State + Pool Type</option>
                      <option value="pool_type_only">Pool Type Only</option>
                    </select>
                  </label>
                </div>
                <div className="master-editor-capabilities">
                  {[
                    ['pricingRevisionReview', 'Pricing revision review'],
                    ['contractTemplateLibrary', 'Contract template library'],
                    ['offlineDraftRecovery', 'Offline draft recovery'],
                    ['signedWorkflow', 'Signed workflow'],
                    ['offContractItems', 'Off-contract items'],
                    ['financingSection', 'Financing section'],
                    ['splitCustomerCostWarranty', 'Separate customer cost and warranty'],
                  ].map(([key, label]) => (
                    <label className="master-editor-toggle compact" key={key}>
                      <input
                        type="checkbox"
                        checked={pendingConfiguration.capabilities[key] === true}
                        onChange={(event) => setPendingConfiguration({
                          ...pendingConfiguration,
                          capabilities: {
                            ...pendingConfiguration.capabilities,
                            [key]: event.target.checked,
                          },
                        })}
                        disabled={configurationSaving}
                      />
                      <div className="master-editor-toggle-copy"><span>{label}</span></div>
                    </label>
                  ))}
                </div>
                <label className="master-editor-field master-editor-config-summary">
                  <span>Change Summary</span>
                  <input
                    value={configurationSummary}
                    onChange={(event) => setConfigurationSummary(event.target.value)}
                    placeholder="Describe what this revision changes"
                    disabled={configurationSaving}
                  />
                </label>
              </>
            )}
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Pricing Models</h3>
              </div>
            </div>
            {pricingError && <div className="master-error">{pricingError}</div>}
            {copyError && <div className="master-error">{copyError}</div>}
            {copySuccess && <div className="master-success">{copySuccess}</div>}
            {pricingLoading ? (
              <div className="master-empty">Loading pricing models...</div>
            ) : sortedPricingModels.length === 0 ? (
              <div className="master-empty">No pricing models found for this franchise.</div>
            ) : (
              <div className="master-table-wrapper master-editor-pricing-table-wrapper">
                <table className="master-table master-editor-pricing-table">
                  <colgroup>
                    <col />
                    <col style={{ width: '180px' }} />
                    <col style={{ width: '340px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Pricing Model Name</th>
                      <th>Date Modified</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPricingModels.map((model) => {
                      const modelFlags = [
                        model.isDefault ? 'Default' : null,
                        model.isHiddenFromView ? 'Hidden from view' : null,
                      ].filter(Boolean);
                      return (
                        <tr key={`${model.franchiseId}-${model.id}`}>
                          <td>
                            <div className="master-table-primary">{model.name || 'Unnamed model'}</div>
                            {modelFlags.length > 0 && (
                              <div className="master-table-secondary master-table-secondary--muted">
                                {modelFlags.join(' | ')}
                              </div>
                            )}
                          </td>
                          <td>{formatPricingModelDate(model.updatedAt || model.createdAt)}</td>
                          <td>
                            <div className="master-copy-controls master-editor-pricing-actions">
                              <select
                                value={copyTargets[model.id] || ''}
                                onChange={(event) => onCopyTargetChange(model.id, event.target.value)}
                                aria-label={`Copy ${model.name || 'pricing model'} to franchise`}
                              >
                                <option value="">Copy to franchise...</option>
                                {copyTargetOptions.map((franchiseOption) => (
                                  <option key={franchiseOption.id} value={franchiseOption.id}>
                                    {franchiseOption.name || franchiseOption.franchiseCode || franchiseOption.id}
                                  </option>
                                ))}
                              </select>
                              <button
                                className="master-primary-btn master-small-btn"
                                type="button"
                                onClick={() => {
                                  void onCopyPricingModel(model);
                                }}
                                disabled={copyingId === model.id}
                              >
                                {copyingId === model.id ? 'Copying...' : 'Copy'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Owner</h3>
              </div>
            </div>
            {owners.length === 0 ? (
              <div className="master-empty">No active owner is assigned to this franchise.</div>
            ) : (
              <div className="master-editor-user-list">
                {owners.map((user) => renderUserRow(user, { canDemoteOwner: true }))}
              </div>
            )}
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Admins</h3>
              </div>
            </div>
            {admins.length === 0 ? (
              <div className="master-empty">No active admins found.</div>
            ) : (
              <div className="master-editor-user-list">
                {admins.map((user) =>
                  renderUserRow(user, {
                    canMakeOwner: owners.length === 0,
                    canDemoteAdmin: true,
                  })
                )}
              </div>
            )}
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Create User</h3>
              </div>
            </div>
            <div className="master-editor-add-card">
              <label className="master-editor-field">
                <span>User Name</span>
                <input
                  type="text"
                  value={newDesignerName}
                  onChange={(event) => setNewDesignerName(event.target.value)}
                  placeholder="Enter user name"
                  disabled={addingDesigner || isInactive}
                />
              </label>
              <label className="master-editor-field">
                <span>User Email</span>
                <input
                  type="email"
                  value={newDesignerEmail}
                  onChange={(event) => setNewDesignerEmail(event.target.value)}
                  placeholder="Enter user email"
                  disabled={addingDesigner || isInactive}
                />
              </label>
              <label className="master-editor-field">
                <span>Role</span>
                <select
                  value={newUserRole}
                  onChange={(event) => setNewUserRole(event.target.value as 'designer' | 'bookkeeper')}
                  disabled={addingDesigner || isInactive}
                >
                  <option value="designer">Designer</option>
                  <option value="bookkeeper">Book Keeper</option>
                </select>
              </label>
              <button
                className="master-primary-btn master-small-btn"
                type="button"
                onClick={handleAddDesigner}
                disabled={addingDesigner || isInactive}
              >
                {addingDesigner ? 'Adding...' : 'Add User'}
              </button>
            </div>
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Designers</h3>
              </div>
            </div>
            {designers.length === 0 ? (
              <div className="master-empty">No active designers found.</div>
            ) : (
              <div className="master-editor-user-list">
                {designers.map((user) =>
                  renderUserRow(user, {
                    canPromoteDesigner: true,
                    canMakeBookkeeper: true,
                    canRemoveDesigner: true,
                  })
                )}
              </div>
            )}
          </div>

          <div className="master-editor-section">
            <div className="master-editor-section-header">
              <div>
                <h3>Book Keepers</h3>
              </div>
            </div>
            {bookkeepers.length === 0 ? (
              <div className="master-empty">No active book keepers found.</div>
            ) : (
              <div className="master-editor-user-list">
                {bookkeepers.map((user) =>
                  renderUserRow(user, {
                    canDemoteBookkeeper: true,
                    canRemoveDesigner: true,
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {tempPassword && (
        <TempPasswordModal
          tempPassword={tempPassword.password}
          onClose={() => setTempPassword(null)}
          title={tempPassword.title}
          description={tempPassword.description}
        />
      )}
    </>
  );
}

export default MasterFranchiseEditorModal;
