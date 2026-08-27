import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Proposal } from '../types/proposal-new';
import { listPricingModels, setDefaultPricingModel } from '../services/pricingModelsAdapter';
import { listProposals as listProposalsRemote } from '../services/proposalsAdapter';
import './AdminPanelPage.css';
import {
  createFranchiseUser,
  deleteFranchiseUser,
  listFranchiseUsers,
  resetFranchiseUserPassword,
  updateFranchiseUserApprovalSettings,
  updateFranchiseUserCommissionRates,
  updateFranchiseUserRole,
} from '../services/franchiseUsersAdapter';
import { updateSession } from '../services/session';
import {
  formatCommissionRatePercent,
  parseCommissionPercentInput,
} from '../services/userCommissionRates';
import {
  getReviewerPrimaryVersionId,
  getReviewerVisibleVersions,
  isApprovedButNotSigned,
} from '../services/proposalWorkflow';
import TempPasswordModal from '../components/TempPasswordModal';
import { getPricingTierName } from '../services/pricingTiers';
import {
  listContractTemplatesForFranchise,
  loadContractTemplatePreview,
  type ContractTemplateSummary,
} from '../services/contractTemplateRegistry';
import PdfCanvasViewer from '../components/PdfCanvasViewer';
import TablePagination from '../components/TablePagination';
import { useAdaptiveTablePagination } from '../hooks/useAdaptiveTablePagination';
import { useHorizontalWheelScroll } from '../hooks/useHorizontalWheelScroll';

const DEFAULT_FRANCHISE_ID = 'default';
type SessionInfo = {
  userName?: string;
  userEmail?: string;
  franchiseId?: string;
  franchiseName?: string;
  franchiseCode?: string;
  role?: 'master' | 'owner' | 'admin' | 'bookkeeper' | 'designer';
};

type SelectedUserStatus = {
  type: 'success' | 'error';
  message: string;
} | null;

type PricingModelFilterOption = {
  value: string;
  label: string;
  modelId?: string;
  legacyName?: string;
  isRemoved: boolean;
};

interface AdminPanelPageProps {
  onOpenPricingData?: (modelId?: string) => void;
  session?: SessionInfo | null;
}

const normalizeStatus = (status?: string | null) => String(status || '').trim().toLowerCase();

const formatStatusLabel = (status?: string | null) => {
  const normalized = normalizeStatus(status);
  if (!normalized) return 'Draft';
  if (normalized === 'changes_requested') return 'Returned';
  return normalized.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
};

const getRoleLabel = (role?: string) => {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'bookkeeper') return 'Book Keeper';
  return 'Designer';
};

const formatDate = (value?: string) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString();
};

const normalizeDesignerName = (value?: string | null) => (value ?? '').trim();
const normalizeUserEmail = (value?: string | null) => String(value || '').trim().toLowerCase();

const parseThresholdPercentInput = (value: string, label: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} must be 0 or greater.`);
  }
  return numeric;
};

const isSubmittedStatus = (status?: string) => {
  const normalized = normalizeStatus(status);
  return (
    normalized === 'submitted' ||
    normalized === 'approved' ||
    normalized === 'signed' ||
    normalized === 'completed' ||
    normalized === 'needs_approval' ||
    normalized === 'changes_requested'
  );
};

const getProposalDesignerName = (proposal: Proposal, fallbackName?: string | null) =>
  normalizeDesignerName(proposal.designerName) || normalizeDesignerName(fallbackName) || 'Designer';

const getAdminDisplayProposal = (proposal: Proposal) => {
  const reviewerVisibleVersions = getReviewerVisibleVersions(proposal);
  const reviewerPrimaryVersionId = getReviewerPrimaryVersionId(proposal);
  return (
    reviewerVisibleVersions.find(
      (entry) => (entry.versionId || 'original') === (reviewerPrimaryVersionId || 'original')
    ) || reviewerVisibleVersions[0] || proposal
  );
};

const getProposalDisplayStatus = (proposal: Proposal) => {
  const displayProposal = getAdminDisplayProposal(proposal);
  const pricingReviewNeeded =
    displayProposal.pricingRevisionReview?.decision === 'pending' &&
    !['draft', 'signed', 'completed'].includes(normalizeStatus(proposal.status));
  return pricingReviewNeeded ? 'user_review' : normalizeStatus(proposal.status) || 'draft';
};

const renderAdminActionIcon = (type: 'pricing' | 'contracts' | 'users' | 'messages') => {
  if (type === 'pricing') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M14.9 8.7c-.55-.62-1.5-1.05-2.78-1.05-1.48 0-2.62.72-2.62 1.87 0 1.22 1.02 1.66 2.72 2.02 1.67.35 2.78.82 2.78 2.08 0 1.22-1.15 2.08-2.83 2.08-1.37 0-2.53-.48-3.18-1.28M12 6.2v11.6" />
      </svg>
    );
  }
  if (type === 'contracts') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 3.5h7l4 4v13h-11z" />
        <path d="M13.5 3.5v4h4M9.5 12h5M9.5 15.5h5" />
      </svg>
    );
  }
  if (type === 'messages') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
        <path d="m5 7 7 5.7L19 7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3.8 18.5c.45-3.15 2.15-5 5.2-5s4.75 1.85 5.2 5M16 10.5a2.5 2.5 0 1 0 0-5M16.5 13.5c2.1.35 3.3 1.95 3.7 4.5" />
    </svg>
  );
};

function AdminPanelPage({ onOpenPricingData, session }: AdminPanelPageProps) {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(true);
  const [pricingModels, setPricingModels] = useState<any[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [activatingModelId, setActivatingModelId] = useState<string | null>(null);
  const [franchiseUsers, setFranchiseUsers] = useState<
    {
      id: string;
      authUserId?: string | null;
      name?: string | null;
      email: string;
      role: 'owner' | 'admin' | 'bookkeeper' | 'designer';
      isActive: boolean;
      digCommissionRate: number;
      closeoutCommissionRate: number;
      approvalMarginThresholdPercent: number;
      discountAllowanceThresholdPercent: number;
      alwaysRequireApproval: boolean;
    }[]
  >([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [addingUser, setAddingUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'designer' | 'bookkeeper'>('designer');
  const [userError, setUserError] = useState<string | null>(null);
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedUserStatus, setSelectedUserStatus] = useState<SelectedUserStatus>(null);
  const [selectedDigCommissionPercent, setSelectedDigCommissionPercent] = useState('');
  const [selectedCloseoutCommissionPercent, setSelectedCloseoutCommissionPercent] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'bookkeeper' | 'designer'>('designer');
  const [selectedApprovalMarginThresholdPercent, setSelectedApprovalMarginThresholdPercent] = useState('18');
  const [selectedDiscountAllowanceThresholdPercent, setSelectedDiscountAllowanceThresholdPercent] = useState('18');
  const [selectedAlwaysRequireApproval, setSelectedAlwaysRequireApproval] = useState(false);
  const [selectedTransferUserId, setSelectedTransferUserId] = useState('');
  const [savingCommissionUserId, setSavingCommissionUserId] = useState<string | null>(null);
  const [savingApprovalSettingsUserId, setSavingApprovalSettingsUserId] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [designerFilter, setDesignerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pricingModelFilter, setPricingModelFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [showPricingModels, setShowPricingModels] = useState(false);
  const [showContractTemplates, setShowContractTemplates] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [contractTemplates, setContractTemplates] = useState<ContractTemplateSummary[]>([]);
  const [loadingContractTemplates, setLoadingContractTemplates] = useState(true);
  const [contractPreview, setContractPreview] = useState<{ name: string; revisionNumber: number; pdfUrl: string } | null>(null);
  const [contractPreviewLoadingId, setContractPreviewLoadingId] = useState<string | null>(null);
  const [contractTemplateError, setContractTemplateError] = useState<string | null>(null);
  const userListRef = useRef<HTMLDivElement | null>(null);
  const userWheelLockRef = useRef<number>(0);

  const franchiseId = session?.franchiseId || DEFAULT_FRANCHISE_ID;
  const normalizedRole = (session?.role || '').toLowerCase();
  const isAdmin = normalizedRole === 'admin' || normalizedRole === 'owner';

  useEffect(() => {
    const previewUrl = contractPreview?.pdfUrl;
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [contractPreview?.pdfUrl]);

  useEffect(() => {
    if (!isAdmin) {
      setLoadingProposals(false);
      setLoadingModels(false);
      setLoadingUsers(false);
      setLoadingContractTemplates(false);
      return;
    }
    void loadProposals(franchiseId);
    void loadPricingModels(franchiseId);
    void loadUsers(franchiseId);
    void loadContractTemplatesForCurrentFranchise();
  }, [franchiseId, isAdmin, session?.franchiseCode]);

  const loadContractTemplatesForCurrentFranchise = async () => {
    setLoadingContractTemplates(true);
    setContractTemplateError(null);
    try {
      setContractTemplates(
        await listContractTemplatesForFranchise(franchiseId, session?.franchiseCode)
      );
    } catch (error: any) {
      setContractTemplateError(error?.message || 'Unable to load contract templates.');
    } finally {
      setLoadingContractTemplates(false);
    }
  };

  const handlePreviewContractTemplate = async (template: ContractTemplateSummary) => {
    setContractPreviewLoadingId(template.id);
    setContractTemplateError(null);
    try {
      setContractPreview(await loadContractTemplatePreview(template));
    } catch (error: any) {
      setContractTemplateError(error?.message || 'Unable to open this contract template.');
    } finally {
      setContractPreviewLoadingId(null);
    }
  };

  useEffect(() => {
    const handleModelsUpdated = () => {
      void loadPricingModels(franchiseId);
    };
    window.addEventListener('pricing-models-updated', handleModelsUpdated);
    return () => window.removeEventListener('pricing-models-updated', handleModelsUpdated);
  }, [franchiseId]);

  const loadProposals = async (targetFranchiseId: string) => {
    setLoadingProposals(true);
    try {
      // Proposal rows already contain their immutable saved pricing snapshot.
      // Recalculating the entire franchise here blocked the admin screen and
      // could replace historical values with a newer runtime calculation.
      setProposals((await listProposalsRemote(targetFranchiseId)) || []);
    } catch (error) {
      console.error('Failed to load proposals for admin panel:', error);
      setProposals([]);
    } finally {
      setLoadingProposals(false);
    }
  };

  const loadPricingModels = async (targetFranchiseId: string) => {
    setLoadingModels(true);
    try {
      const rows = await listPricingModels(targetFranchiseId);
      setPricingModels(rows || []);
    } catch (error) {
      console.error('Failed to load pricing models for admin panel:', error);
      setPricingModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const loadUsers = async (targetFranchiseId: string) => {
    setLoadingUsers(true);
    try {
      const rows = await listFranchiseUsers(targetFranchiseId);
      setFranchiseUsers(
        (rows || []).map((row: any) => ({
          id: row.id,
          authUserId: row.authUserId || null,
          name: row.name,
          email: row.email,
          role: row.role,
          isActive: Boolean(row.isActive),
          digCommissionRate: Number(row.digCommissionRate) || 0,
          closeoutCommissionRate: Number(row.closeoutCommissionRate) || 0,
          approvalMarginThresholdPercent: Number(row.approvalMarginThresholdPercent) || 18,
          discountAllowanceThresholdPercent: Number(row.discountAllowanceThresholdPercent) || 18,
          alwaysRequireApproval: row.alwaysRequireApproval === true,
        }))
      );
    } catch (error) {
      console.error('Failed to load franchise users:', error);
      setFranchiseUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const selectedUser = useMemo(
    () => franchiseUsers.find((user) => user.id === selectedUserId) || null,
    [franchiseUsers, selectedUserId]
  );

  useEffect(() => {
    if (selectedUserId && !selectedUser) {
      setSelectedUserId(null);
    }
  }, [selectedUser, selectedUserId]);

  useEffect(() => {
    if (!selectedUser) {
      setSelectedUserStatus(null);
      setSelectedDigCommissionPercent('');
      setSelectedCloseoutCommissionPercent('');
      setSelectedRole('designer');
      setSelectedApprovalMarginThresholdPercent('18');
      setSelectedDiscountAllowanceThresholdPercent('18');
      setSelectedAlwaysRequireApproval(false);
      setSelectedTransferUserId('');
      return;
    }

    setSelectedUserStatus(null);
    setSelectedDigCommissionPercent(formatCommissionRatePercent(selectedUser.digCommissionRate));
    setSelectedCloseoutCommissionPercent(formatCommissionRatePercent(selectedUser.closeoutCommissionRate));
    setSelectedRole(selectedUser.role);
    setSelectedApprovalMarginThresholdPercent(String(selectedUser.approvalMarginThresholdPercent ?? 18));
    setSelectedDiscountAllowanceThresholdPercent(String(selectedUser.discountAllowanceThresholdPercent ?? 18));
    setSelectedAlwaysRequireApproval(selectedUser.alwaysRequireApproval === true);
    setSelectedTransferUserId('');
  }, [selectedUser?.id]);

  const handleSetActiveModel = async (modelId: string) => {
    if (!modelId) return;
    setActivatingModelId(modelId);
    try {
      await setDefaultPricingModel({
        franchiseId,
        pricingModelId: modelId,
      });
      await loadPricingModels(franchiseId);
      window.dispatchEvent(new Event('pricing-models-updated'));
    } catch (error) {
      console.error('Failed to set active pricing model:', error);
    } finally {
      setActivatingModelId(null);
    }
  };

  const handleAddUser = async () => {
    const trimmedName = newUserName.trim();
    if (!newUserEmail.trim()) {
      setUserError('Please enter an email.');
      return;
    }
    if (!trimmedName) {
      setUserError('Please enter a display name.');
      return;
    }
    setUserError(null);
    setAddingUser(true);
    try {
      const result = await createFranchiseUser({
        franchiseId,
        email: newUserEmail.trim().toLowerCase(),
        name: trimmedName,
        role: newUserRole,
      });
      setNewUserName('');
      setNewUserEmail('');
      setNewUserRole('designer');
      setShowAddUserForm(false);
      if (result?.tempPassword) {
        setTempPassword(result.tempPassword);
      }
      await loadUsers(franchiseId);
    } catch (error: any) {
      console.error('Failed to add user:', error);
      setUserError(error?.message || 'Unable to add user.');
    } finally {
      setAddingUser(false);
    }
  };

  const handleChangeUserRole = async (
    userId: string,
    nextRole: 'owner' | 'admin' | 'bookkeeper' | 'designer'
  ) => {
    setSelectedUserStatus(null);
    setUpdatingRoleUserId(userId);
    try {
      await updateFranchiseUserRole(userId, nextRole);
      if (selectedUser && normalizeUserEmail(selectedUser.email) === normalizeUserEmail(session?.userEmail)) {
        updateSession({ role: nextRole });
      }
      await loadUsers(franchiseId);
      setSelectedUserStatus({ type: 'success', message: 'Role updated.' });
    } catch (error: any) {
      console.error('Failed to update user role:', error);
      setSelectedUserStatus({
        type: 'error',
        message: error?.message || 'Unable to update the user role.',
      });
    } finally {
      setUpdatingRoleUserId(null);
    }
  };

  const handleRemoveUser = async (userId: string, role: string) => {
    if (role !== 'designer' && role !== 'bookkeeper') {
      setSelectedUserStatus({
        type: 'error',
        message: 'Only designers and book keepers can be removed from this workspace.',
      });
      return;
    }
    setSelectedUserStatus(null);
    setRemovingUserId(userId);
    try {
      const selectedProposalCount = role === 'designer' ? selectedUserProposalCount : 0;
      const transferToUserId = selectedProposalCount > 0 ? selectedTransferUserId || null : null;
      if (selectedProposalCount > 0 && transferTargetOptions.length === 0) {
        throw new Error('Add or promote another owner, admin, or designer before removing this designer.');
      }
      if (selectedProposalCount > 0 && !transferToUserId) {
        throw new Error('Select a transfer user before removing this designer.');
      }
      await deleteFranchiseUser(userId, transferToUserId);
      await loadUsers(franchiseId);
      await loadProposals(franchiseId);
      setSelectedUserId(null);
    } catch (error: any) {
      console.error('Failed to remove user:', error);
      setSelectedUserStatus({
        type: 'error',
        message: error?.message || 'Unable to remove the user.',
      });
    } finally {
      setRemovingUserId(null);
    }
  };

  const handleResetPassword = async (userId: string) => {
    setResettingUserId(userId);
    setSelectedUserStatus(null);
    try {
      const result = await resetFranchiseUserPassword(userId);
      if (result?.tempPassword) {
        setTempPassword(result.tempPassword);
      }
      setSelectedUserStatus({ type: 'success', message: 'Temporary password generated.' });
    } catch (error: any) {
      console.error('Failed to reset password:', error);
      setSelectedUserStatus({
        type: 'error',
        message: error?.message || 'Unable to reset the user password.',
      });
    } finally {
      setResettingUserId(null);
    }
  };

  const promotingUserId = updatingRoleUserId;
  const handlePromoteUser = async (userId: string) => {
    await handleChangeUserRole(userId, 'admin');
  };

  const handleSaveCommissionRates = async (userId: string) => {
    setSelectedUserStatus(null);
    setSavingCommissionUserId(userId);
    try {
      const digCommissionRate = parseCommissionPercentInput(
        selectedDigCommissionPercent,
        'Dig Commission'
      );
      const closeoutCommissionRate = parseCommissionPercentInput(
        selectedCloseoutCommissionPercent,
        'Closeout Commission'
      );
      const saved = await updateFranchiseUserCommissionRates(userId, {
        digCommissionRate,
        closeoutCommissionRate,
      });
      if (selectedUser && normalizeUserEmail(selectedUser.email) === normalizeUserEmail(session?.userEmail)) {
        updateSession({
          digCommissionRate: saved?.digCommissionRate ?? digCommissionRate,
          closeoutCommissionRate: saved?.closeoutCommissionRate ?? closeoutCommissionRate,
        });
      }
      await loadUsers(franchiseId);
      setSelectedUserStatus({ type: 'success', message: 'Commission settings updated.' });
    } catch (error: any) {
      console.error('Failed to update commission settings:', error);
      setSelectedUserStatus({
        type: 'error',
        message: error?.message || 'Unable to update commission settings.',
      });
    } finally {
      setSavingCommissionUserId(null);
    }
  };

  const handleSaveApprovalSettings = async (userId: string) => {
    setSelectedUserStatus(null);
    setSavingApprovalSettingsUserId(userId);
    try {
      const approvalMarginThresholdPercent = parseThresholdPercentInput(
        selectedApprovalMarginThresholdPercent,
        'Approval margin threshold'
      );
      const discountAllowanceThresholdPercent = parseThresholdPercentInput(
        selectedDiscountAllowanceThresholdPercent,
        'Discount allowance threshold'
      );
      const saved = await updateFranchiseUserApprovalSettings(userId, {
        approvalMarginThresholdPercent,
        discountAllowanceThresholdPercent,
        alwaysRequireApproval: selectedAlwaysRequireApproval,
      });
      if (selectedUser && normalizeUserEmail(selectedUser.email) === normalizeUserEmail(session?.userEmail)) {
        updateSession({
          approvalMarginThresholdPercent: saved?.approvalMarginThresholdPercent ?? approvalMarginThresholdPercent,
          discountAllowanceThresholdPercent:
            saved?.discountAllowanceThresholdPercent ?? discountAllowanceThresholdPercent,
          alwaysRequireApproval: saved?.alwaysRequireApproval ?? selectedAlwaysRequireApproval,
        });
      }
      await loadUsers(franchiseId);
      setSelectedUserStatus({ type: 'success', message: 'Workflow approval settings updated.' });
    } catch (error: any) {
      console.error('Failed to update workflow approval settings:', error);
      setSelectedUserStatus({
        type: 'error',
        message: error?.message || 'Unable to update workflow approval settings.',
      });
    } finally {
      setSavingApprovalSettingsUserId(null);
    }
  };

  const handleCloseSelectedUser = () => {
    setSelectedUserId(null);
    setSelectedUserStatus(null);
  };

  const handleOpenAddUserForm = () => {
    setShowAddUserForm(true);
    setUserError(null);
    setSelectedUserId(null);
  };

  const handleCloseAddUserForm = () => {
    setShowAddUserForm(false);
    setNewUserName('');
    setNewUserEmail('');
    setNewUserRole('designer');
    setUserError(null);
  };

  const proposalBelongsToSelectedUser = (proposal: Proposal, user: NonNullable<typeof selectedUser>) => {
    if (proposal.designerAuthUserId && user.authUserId && proposal.designerAuthUserId === user.authUserId) {
      return true;
    }
    const proposalDesigner = normalizeDesignerName(proposal.designerName).toLowerCase();
    if (!proposalDesigner) return false;
    const candidates = [normalizeDesignerName(user.name), normalizeDesignerName(user.email)]
      .map((value) => value.toLowerCase())
      .filter(Boolean);
    return candidates.some((candidate) => candidate === proposalDesigner);
  };

  const selectedUserProposalCount = selectedUser
    ? proposals.filter((proposal) => proposalBelongsToSelectedUser(proposal, selectedUser)).length
    : 0;

  const transferTargetOptions = useMemo(
    () =>
      franchiseUsers.filter(
        (user) =>
          user.id !== selectedUserId &&
          user.isActive &&
          (user.role === 'designer' || user.role === 'admin' || user.role === 'owner')
      ),
    [franchiseUsers, selectedUserId]
  );

  useEffect(() => {
    if (!selectedTransferUserId) return;
    const selectedTargetStillAvailable = transferTargetOptions.some((user) => user.id === selectedTransferUserId);
    if (!selectedTargetStillAvailable) {
      setSelectedTransferUserId('');
    }
  }, [selectedTransferUserId, transferTargetOptions]);

  const modalRoot = typeof document !== 'undefined' ? document.body : null;

  const addUserModal =
    showAddUserForm && modalRoot
      ? createPortal(
          <div className="admin-user-modal-backdrop" onClick={handleCloseAddUserForm}>
            <div
              className="admin-user-modal"
              role="dialog"
              aria-modal="true"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="admin-user-modal-header">
                <div>
                  <p className="admin-user-modal-kicker">Franchise Users</p>
                  <h3 className="admin-user-modal-title">Add a New User</h3>
                </div>
                <button
                  className="admin-user-modal-close"
                  type="button"
                  onClick={handleCloseAddUserForm}
                  aria-label="Close add designer form"
                >
                  x
                </button>
              </div>
              <div className="admin-users-add">
                <div className="admin-users-add-card">
                  <div className="admin-users-add-field">
                    <label className="admin-users-add-label" htmlFor="designer-name-input">
                      User Name
                    </label>
                    <input
                      id="designer-name-input"
                      type="text"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="Enter Designer Name"
                      disabled={addingUser}
                      autoFocus
                    />
                  </div>
                  <div className="admin-users-add-field">
                    <label className="admin-users-add-label" htmlFor="designer-role-input">
                      Role
                    </label>
                    <select
                      id="designer-role-input"
                      value={newUserRole}
                      onChange={(event) => setNewUserRole(event.target.value as 'designer' | 'bookkeeper')}
                      disabled={addingUser}
                    >
                      <option value="designer">Designer</option>
                      <option value="bookkeeper">Book Keeper</option>
                    </select>
                  </div>
                  <div className="admin-users-add-field">
                    <label className="admin-users-add-label" htmlFor="designer-email-input">
                      User Email
                    </label>
                    <div className="admin-users-add-email">
                      <input
                        id="designer-email-input"
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="Enter Designer Email"
                        disabled={addingUser}
                      />
                      <button
                        className="admin-primary-btn"
                        type="button"
                        onClick={handleAddUser}
                        disabled={addingUser}
                      >
                        {addingUser ? 'Adding...' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {userError && <div className="admin-error">{userError}</div>}
            </div>
          </div>,
          modalRoot
        )
      : null;

  const selectedUserDetails = selectedUser ? (
            <>
              <div className="admin-user-modal-header">
                <div>
                  <p className="admin-user-modal-kicker">User Details</p>
                  <h3 id="user-details-title" className="admin-user-modal-title">{selectedUser.name || selectedUser.email}</h3>
                </div>
                <button
                  className="admin-user-modal-close"
                  type="button"
                  onClick={handleCloseSelectedUser}
                  aria-label="Back to user list"
                >
                  <span aria-hidden="true">←</span>
                  Back to User List
                </button>
              </div>
              <div className="admin-user-modal-details">
                <div className="admin-user-detail">
                  <span className="admin-user-detail-label">Role</span>
                  <span className="admin-user-detail-value">{getRoleLabel(selectedUser.role)}</span>
                </div>
                <div className="admin-user-detail">
                  <span className="admin-user-detail-label">Email</span>
                  <span className="admin-user-detail-value">{selectedUser.email}</span>
                </div>
              </div>
              {selectedUser.role !== 'owner' && (
                <div className="admin-user-commission-section">
                  <div className="admin-user-commission-header">
                    <div className="admin-user-commission-title">Access Role</div>
                    <div className="admin-user-commission-subtitle">Admin, Book Keeper, or designer access</div>
                  </div>
                  <div className="admin-user-commission-grid">
                    <label className="admin-user-commission-field" htmlFor="selected-user-role">
                      <span>Role</span>
                      <select
                        id="selected-user-role"
                        value={selectedRole}
                        onChange={(event) =>
                          setSelectedRole(
                            event.target.value as 'owner' | 'admin' | 'bookkeeper' | 'designer'
                          )
                        }
                        disabled={updatingRoleUserId === selectedUser.id}
                      >
                        <option value="admin">Admin</option>
                        <option value="bookkeeper">Book Keeper</option>
                        <option value="designer">Designer</option>
                      </select>
                    </label>
                  </div>
                  <button
                    className="admin-primary-btn"
                    type="button"
                    onClick={() => handleChangeUserRole(selectedUser.id, selectedRole)}
                    disabled={updatingRoleUserId === selectedUser.id || selectedRole === selectedUser.role}
                  >
                    {updatingRoleUserId === selectedUser.id ? 'Saving...' : 'Save Role'}
                  </button>
                </div>
              )}
              <div className="admin-user-commission-section">
                <div className="admin-user-commission-header">
                  <div className="admin-user-commission-title">Commission Settings</div>
                  <div className="admin-user-commission-subtitle">Percent of retail price</div>
                </div>
                <div className="admin-user-commission-grid">
                  <label className="admin-user-commission-field" htmlFor="closeout-commission-input">
                    <span>Closeout Commission</span>
                    <div className="admin-user-commission-input">
                      <input
                        id="closeout-commission-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="0.01"
                        value={selectedCloseoutCommissionPercent}
                        onChange={(event) => setSelectedCloseoutCommissionPercent(event.target.value)}
                        disabled={savingCommissionUserId === selectedUser.id}
                      />
                      <span>%</span>
                    </div>
                  </label>
                  <label className="admin-user-commission-field" htmlFor="dig-commission-input">
                    <span>Dig Commission</span>
                    <div className="admin-user-commission-input">
                      <input
                        id="dig-commission-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="0.01"
                        value={selectedDigCommissionPercent}
                        onChange={(event) => setSelectedDigCommissionPercent(event.target.value)}
                        disabled={savingCommissionUserId === selectedUser.id}
                      />
                      <span>%</span>
                    </div>
                  </label>
                </div>
                <button
                  className="admin-primary-btn"
                  type="button"
                  onClick={() => handleSaveCommissionRates(selectedUser.id)}
                  disabled={savingCommissionUserId === selectedUser.id}
                >
                  {savingCommissionUserId === selectedUser.id ? 'Saving...' : 'Save Commission Settings'}
                </button>
              </div>
              <div className="admin-user-commission-section">
                <div className="admin-user-commission-header">
                  <div className="admin-user-commission-title">Workflow Approval Settings</div>
                  <div className="admin-user-commission-subtitle">Per-user approval rules and submission thresholds</div>
                </div>
                <div className="admin-user-commission-grid">
                  <label className="admin-user-commission-field" htmlFor="approval-threshold-input">
                    <span className="admin-user-commission-label">
                      <span>Approval Margin Threshold</span>
                      <button
                        type="button"
                        className="admin-inline-tooltip-trigger"
                        data-tooltip="Triggers approval when the proposal gross profit margin falls below this percent."
                        aria-label="Approval Margin Threshold help"
                      >
                        ?
                      </button>
                    </span>
                    <div className="admin-user-commission-input">
                      <input
                        id="approval-threshold-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={selectedApprovalMarginThresholdPercent}
                        onChange={(event) => setSelectedApprovalMarginThresholdPercent(event.target.value)}
                        disabled={savingApprovalSettingsUserId === selectedUser.id}
                      />
                      <span>%</span>
                    </div>
                  </label>
                  <label className="admin-user-commission-field" htmlFor="discount-threshold-input">
                    <span className="admin-user-commission-label">
                      <span>Discount Allowance Threshold</span>
                      <button
                        type="button"
                        className="admin-inline-tooltip-trigger"
                        data-tooltip="Triggers approval when non-PAP discounts exceed this percent of the proposal retail price."
                        aria-label="Discount Allowance Threshold help"
                      >
                        ?
                      </button>
                    </span>
                    <div className="admin-user-commission-input">
                      <input
                        id="discount-threshold-input"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={selectedDiscountAllowanceThresholdPercent}
                        onChange={(event) => setSelectedDiscountAllowanceThresholdPercent(event.target.value)}
                        disabled={savingApprovalSettingsUserId === selectedUser.id}
                      />
                      <span>%</span>
                    </div>
                  </label>
                </div>
                <label className="admin-toggle">
                  <input
                    type="checkbox"
                    checked={selectedAlwaysRequireApproval}
                    onChange={(event) => setSelectedAlwaysRequireApproval(event.target.checked)}
                    disabled={savingApprovalSettingsUserId === selectedUser.id}
                  />
                  <span>Approval Required</span>
                </label>
                <button
                  className="admin-primary-btn"
                  type="button"
                  onClick={() => handleSaveApprovalSettings(selectedUser.id)}
                  disabled={savingApprovalSettingsUserId === selectedUser.id}
                >
                  {savingApprovalSettingsUserId === selectedUser.id ? 'Saving...' : 'Save Workflow Settings'}
                </button>
                {selectedUserStatus?.type === 'error' && (
                  <div className="admin-error">{selectedUserStatus.message}</div>
                )}
                {selectedUserStatus?.type === 'success' && (
                  <div className="admin-success">{selectedUserStatus.message}</div>
                )}
              </div>
              {selectedUser.role === 'designer' && selectedUserProposalCount > 0 && (
                <div className="admin-user-commission-section">
                  <div className="admin-user-commission-header">
                    <div className="admin-user-commission-title">Proposal Transfer Required</div>
                    <div className="admin-user-commission-subtitle">
                      {selectedUserProposalCount} saved proposal{selectedUserProposalCount === 1 ? '' : 's'} must be reassigned before removal
                    </div>
                  </div>
                  {transferTargetOptions.length > 0 ? (
                    <label className="admin-user-commission-field" htmlFor="designer-transfer-select">
                      <span>Transfer proposals to</span>
                      <select
                        id="designer-transfer-select"
                        value={selectedTransferUserId}
                        onChange={(event) => setSelectedTransferUserId(event.target.value)}
                        disabled={removingUserId === selectedUser.id}
                      >
                        <option value="">Select a transfer user...</option>
                        {transferTargetOptions.map((user) => (
                          <option key={user.id} value={user.id}>
                            {(user.name || user.email) + ` (${getRoleLabel(user.role)})`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="admin-user-commission-subtitle">
                      No active owner, admin, or designer is available to receive these proposals yet.
                    </div>
                  )}
                </div>
              )}
              <div className="admin-user-modal-actions">
                {selectedUser.role !== 'owner' && (
                  <button
                    className="admin-primary-btn ghost"
                    type="button"
                    onClick={() => handleResetPassword(selectedUser.id)}
                    disabled={resettingUserId === selectedUser.id}
                  >
                    {resettingUserId === selectedUser.id ? 'Resetting...' : 'Reset Password'}
                  </button>
                )}
                {(selectedUser.role === 'designer' || selectedUser.role === 'bookkeeper') && (
                  <button
                    className="admin-remove-btn"
                    type="button"
                    onClick={() => handleRemoveUser(selectedUser.id, selectedUser.role)}
                    disabled={
                      removingUserId === selectedUser.id ||
                      (selectedUser.role === 'designer' &&
                        selectedUserProposalCount > 0 &&
                        (transferTargetOptions.length === 0 || !selectedTransferUserId))
                    }
                  >
                    {removingUserId === selectedUser.id ? 'Removing...' : 'Remove User'}
                  </button>
                )}
              </div>
            </>
          ) : null;

  const submittedProposals = useMemo(
    () => proposals.filter((proposal) => isSubmittedStatus(proposal.status)),
    [proposals]
  );

  const sortedProposals = useMemo(
    () =>
      [...submittedProposals].sort(
        (a, b) => {
          const displayA = getAdminDisplayProposal(a);
          const displayB = getAdminDisplayProposal(b);
          return (
            new Date(displayB.lastModified || displayB.createdDate).getTime() -
            new Date(displayA.lastModified || displayA.createdDate).getTime()
          );
        }
      ),
    [submittedProposals]
  );

  const designerOptions = useMemo(() => {
    const names = new Set<string>();
    submittedProposals.forEach((proposal) => {
      const name = getProposalDesignerName(proposal, session?.userName);
      if (name) {
        names.add(name);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [submittedProposals, session?.userName]);

  useEffect(() => {
    if (designerFilter !== 'all' && !designerOptions.includes(designerFilter)) {
      setDesignerFilter('all');
    }
  }, [designerFilter, designerOptions]);

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(submittedProposals.map(getProposalDisplayStatus)))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [submittedProposals]
  );

  const pricingModelOptions = useMemo<PricingModelFilterOption[]>(() => {
    const currentModels = [...pricingModels]
      .filter((model) => model?.id && String(model?.name || '').trim())
      .map((model) => ({
        value: `current:${model.id}`,
        label: String(model.name).trim(),
        modelId: String(model.id),
        isRemoved: false,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const currentModelIds = new Set(currentModels.map((option) => option.modelId));
    const currentModelNames = new Set(currentModels.map((option) => option.label.toLowerCase()));
    const removedModels = new Map<string, PricingModelFilterOption>();

    submittedProposals.forEach((proposal) => {
      const displayProposal = getAdminDisplayProposal(proposal);
      const modelId = String(displayProposal.pricingModelId || '').trim();
      const modelName = String(displayProposal.pricingModelName || '').trim();
      if (!modelName) return;
      if (modelId && currentModelIds.has(modelId)) return;
      if (!modelId && currentModelNames.has(modelName.toLowerCase())) return;

      const value = modelId ? `removed:${modelId}` : `legacy:${modelName}`;
      if (!removedModels.has(value)) {
        removedModels.set(value, {
          value,
          label: modelName.toLowerCase().includes('(removed)') ? modelName : `${modelName} (Removed)`,
          ...(modelId ? { modelId } : { legacyName: modelName }),
          isRemoved: true,
        });
      }
    });

    return [
      ...currentModels,
      ...Array.from(removedModels.values()).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [pricingModels, submittedProposals]);

  useEffect(() => {
    if (pricingModelFilter !== 'all' && !pricingModelOptions.some((option) => option.value === pricingModelFilter)) {
      setPricingModelFilter('all');
    }
  }, [pricingModelFilter, pricingModelOptions]);

  const filteredProposals = useMemo(() => {
    const normalizedSearch = searchFilter.trim().toLowerCase();
    const dateCutoff = dateFilter ? new Date(`${dateFilter}T23:59:59.999`).getTime() : null;
    const selectedPricingModel = pricingModelOptions.find((option) => option.value === pricingModelFilter);
    return sortedProposals.filter((proposal) => {
      const displayProposal = getAdminDisplayProposal(proposal);
      const designerName = getProposalDesignerName(proposal, session?.userName);
      const customerName = String(displayProposal.customerInfo?.customerName || '').trim().toLowerCase();
      const proposalDate = new Date(displayProposal.lastModified || displayProposal.createdDate).getTime();
      const matchesSearch = !normalizedSearch || customerName.includes(normalizedSearch);
      const matchesDesigner = designerFilter === 'all' || designerName === designerFilter;
      const matchesStatus = statusFilter === 'all' || getProposalDisplayStatus(proposal) === statusFilter;
      const displayModelId = String(displayProposal.pricingModelId || '').trim();
      const displayModelName = String(displayProposal.pricingModelName || '').trim();
      const matchesPricingModel = pricingModelFilter === 'all' || Boolean(
        selectedPricingModel && (
          (selectedPricingModel.modelId && displayModelId === selectedPricingModel.modelId) ||
          (!displayModelId && !selectedPricingModel.isRemoved && displayModelName === selectedPricingModel.label) ||
          (selectedPricingModel.legacyName && displayModelName === selectedPricingModel.legacyName)
        )
      );
      const matchesDate = dateCutoff === null || (!Number.isNaN(proposalDate) && proposalDate <= dateCutoff);
      return matchesSearch && matchesDesigner && matchesStatus && matchesPricingModel && matchesDate;
    });
  }, [dateFilter, designerFilter, pricingModelFilter, pricingModelOptions, searchFilter, session?.userName, sortedProposals, statusFilter]);

  const filterResetKey = [searchFilter, designerFilter, statusFilter, pricingModelFilter, dateFilter].join('|');

  const {
    viewportRef: proposalTableViewportRef,
    currentPage: proposalPage,
    pageSize: proposalPageSize,
    totalPages: proposalTotalPages,
    startIndex: proposalStartIndex,
    endIndex: proposalEndIndex,
    goToPage: goToProposalPage,
  } = useAdaptiveTablePagination({
    itemCount: filteredProposals.length,
    maxPageSize: Math.max(filteredProposals.length, 1),
    estimatedRowHeight: 52,
    estimatedHeaderHeight: 48,
    resetKey: filterResetKey,
    fitToWindow: true,
    windowBottomOffset: 74,
  });
  useHorizontalWheelScroll(
    proposalTableViewportRef,
    !loadingProposals && filteredProposals.length > 0
  );
  const paginatedProposals = filteredProposals.slice(
    proposalStartIndex,
    proposalStartIndex + proposalPageSize
  );

  const sortedPricingModels = useMemo(
    () =>
      [...pricingModels]
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.updatedAt || a.createdAt || 0).getTime()
        )
        .sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))),
    [pricingModels]
  );

  const defaultPricingModelId = useMemo(
    () => pricingModels.find((m: any) => m.isDefault)?.id || null,
    [pricingModels]
  );

  const availablePricingModelIds = useMemo(
    () => new Set((pricingModels || []).map((m: any) => m.id)),
    [pricingModels]
  );

  const submittedProposalCountByUserId = useMemo(() => {
    const counts = new Map<string, number>();
    franchiseUsers.forEach((user) => counts.set(user.id, 0));
    submittedProposals.forEach((proposal) => {
      const matchedUser = franchiseUsers.find((user) => proposalBelongsToSelectedUser(proposal, user));
      if (matchedUser) {
        counts.set(matchedUser.id, (counts.get(matchedUser.id) || 0) + 1);
      }
    });
    return counts;
  }, [franchiseUsers, submittedProposals]);

  const pendingApprovalCount = useMemo(
    () => filteredProposals.filter((proposal) => normalizeStatus(proposal.status) === 'needs_approval').length,
    [filteredProposals]
  );

  const activeDesignerCount = useMemo(() => {
    const designers = new Set<string>();
    filteredProposals.forEach((proposal) => {
      const identifier =
        proposal.designerAuthUserId || getProposalDesignerName(proposal, session?.userName).toLowerCase();
      if (identifier) designers.add(identifier);
    });
    return designers.size;
  }, [filteredProposals, session?.userName]);

  const hasActiveFilters =
    searchFilter.trim().length > 0 ||
    designerFilter !== 'all' ||
    statusFilter !== 'all' ||
    pricingModelFilter !== 'all' ||
    Boolean(dateFilter);

  const clearFilters = () => {
    setSearchFilter('');
    setDesignerFilter('all');
    setStatusFilter('all');
    setPricingModelFilter('all');
    setDateFilter('');
  };

  const handleUserListWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = userListRef.current;
    if (!container) return;
    const now = Date.now();
    if (now - userWheelLockRef.current < 140) {
      e.preventDefault();
      return;
    }
    const firstRow = container.querySelector('.admin-user-row') as HTMLElement | null;
    const styles = window.getComputedStyle(container);
    const rowGap = parseFloat(styles.rowGap || '0') || 0;
    const step = (firstRow?.offsetHeight || 60) + rowGap;
    e.preventDefault();
    userWheelLockRef.current = now;
    container.scrollTop += e.deltaY > 0 ? step : -step;
  };

  const totalProposalsSubmitted = submittedProposals.length;
  const proposalCountLabel = hasActiveFilters
    ? `${filteredProposals.length} of ${totalProposalsSubmitted}`
    : `${totalProposalsSubmitted} total`;

  const getGrossProfitAmount = (proposal: Proposal) => proposal.pricing?.grossProfit || 0;
  const getGrossProfitPercent = (proposal: Proposal) => proposal.pricing?.grossProfitMargin || 0;

  if (!isAdmin) {
    return (
      <div className="admin-page">
        <div className="admin-locked-card">
          <h2>Admin access required</h2>
          <p>Switch to an admin account to view franchise performance and pricing tools.</p>
          <button className="admin-primary-btn" type="button" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-dashboard-shell">
        <header className="admin-page-header">
          <div className="admin-page-heading">
            <p>Administration</p>
            <h1>{session?.franchiseName || session?.franchiseCode || 'Franchise'} Admin Panel</h1>
          </div>
          <div className="admin-page-actions" aria-label="Admin tools">
            <button type="button" className="admin-page-action" onClick={() => setShowPricingModels(true)}>
              <span className="admin-page-action-icon">{renderAdminActionIcon('pricing')}</span>
              Franchise Pricing
            </button>
            <button type="button" className="admin-page-action" onClick={() => setShowContractTemplates(true)}>
              <span className="admin-page-action-icon">{renderAdminActionIcon('contracts')}</span>
              Contract Templates
            </button>
            <button type="button" className="admin-page-action" onClick={() => setShowUserManagement(true)}>
              <span className="admin-page-action-icon">{renderAdminActionIcon('users')}</span>
              User Management
            </button>
            <button type="button" className="admin-page-action" onClick={() => navigate('/admin/messages')}>
              <span className="admin-page-action-icon">{renderAdminActionIcon('messages')}</span>
              Message Center
            </button>
          </div>
        </header>

        <section className="admin-at-a-glance" aria-labelledby="admin-at-a-glance-title">
          <h2 id="admin-at-a-glance-title">At a Glance</h2>
          <div className="admin-metrics">
            <div className="admin-metric">
              <span>Total Proposals</span>
              <strong>{filteredProposals.length.toLocaleString('en-US')}</strong>
            </div>
            <div className="admin-metric admin-metric--pending">
              <span>Pending Approvals</span>
              <strong>{pendingApprovalCount.toLocaleString('en-US')}</strong>
            </div>
            <div className="admin-metric">
              <span>Active Designers</span>
              <strong>{activeDesignerCount.toLocaleString('en-US')}</strong>
            </div>
            <div className="admin-metric admin-metric--coming-soon">
              <span>Gross Profit YTD</span>
              <strong>Coming Soon</strong>
            </div>
          </div>
        </section>

        <section className="admin-table-card admin-table-card--workspace">
        <div className="admin-table-header">
          <div>
            <h2 className="admin-card-title">Franchise Proposals</h2>
            <p className="admin-kicker">Submitted proposal activity across the franchise</p>
          </div>
          <div className="admin-table-meta">{proposalCountLabel}</div>
        </div>

        <div className="admin-filter-toolbar">
          <label className="admin-filter-field admin-filter-search">
            <span>Search by Customer</span>
            <div className="admin-filter-input-shell">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="5.5" />
                <path d="m15 15 4 4" />
              </svg>
              <input
                type="search"
                value={searchFilter}
                onChange={(event) => setSearchFilter(event.target.value)}
                placeholder="Customer name"
              />
            </div>
          </label>
          <label className="admin-filter-field" htmlFor="designer-filter">
            <span>Designer</span>
              <select
                id="designer-filter"
                value={designerFilter}
                onChange={(e) => setDesignerFilter(e.target.value)}
              >
                <option value="all">All Designers</option>
                {designerOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
          </label>
          <label className="admin-filter-field" htmlFor="status-filter">
            <span>Status</span>
            <select id="status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All Statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{formatStatusLabel(status)}</option>
              ))}
            </select>
          </label>
          <label className="admin-filter-field" htmlFor="pricing-model-filter">
            <span>Pricing Model</span>
            <select
              id="pricing-model-filter"
              value={pricingModelFilter}
              onChange={(event) => setPricingModelFilter(event.target.value)}
            >
              <option value="all">All Pricing Models</option>
              {pricingModelOptions.some((option) => !option.isRemoved) && (
                <optgroup label="Current Models">
                  {pricingModelOptions.filter((option) => !option.isRemoved).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
              {pricingModelOptions.some((option) => option.isRemoved) && (
                <optgroup label="Removed Models">
                  {pricingModelOptions.filter((option) => option.isRemoved).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="admin-filter-field" htmlFor="date-filter">
            <span>Modified On or Before</span>
            <input
              id="date-filter"
              type="date"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="admin-clear-filters"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Clear Filters
          </button>
        </div>

        {loadingProposals ? (
          <div className="admin-empty padded">Loading proposals...</div>
        ) : filteredProposals.length === 0 ? (
          <div className="admin-empty padded">
            {sortedProposals.length === 0
              ? 'No submitted proposals for this franchise yet.'
              : 'No proposals match the selected filters.'}
          </div>
        ) : (
          <div className="admin-proposals-table-region">
            <div
              ref={proposalTableViewportRef}
              className="admin-table-wrapper"
            >
              <table className="admin-table">
              <colgroup>
                <col className="admin-col-designer" />
                <col className="admin-col-customer" />
                <col className="admin-col-date" />
                <col className="admin-col-status" />
                <col className="admin-col-model" />
                <col className="admin-col-tier" />
                <col className="admin-col-versions" />
                <col className="admin-col-money" />
                <col className="admin-col-money" />
                <col className="admin-col-percent" />
                <col className="admin-col-profit" />
              </colgroup>
              <thead>
                <tr>
                  <th>Designer</th>
                  <th>Customer Name</th>
                  <th>Date Modified</th>
                  <th>Proposal Status</th>
                  <th>Pricing Model</th>
                  <th>Pricing Tier</th>
                  <th className="th-center">Proposal Versions</th>
                  <th className="th-right">Retail Price</th>
                  <th className="th-right">Total COGS</th>
                  <th className="th-right">Gross Profit %</th>
                  <th className="th-right">Gross Profit Amount</th>
                </tr>
              </thead>
                <tbody>
                {paginatedProposals.map((proposal) => {
                  const reviewerVisibleVersions = getReviewerVisibleVersions(proposal);
                  const reviewerPrimaryVersionId = getReviewerPrimaryVersionId(proposal);
                  const displayProposal =
                    reviewerVisibleVersions.find(
                      (entry) => (entry.versionId || 'original') === (reviewerPrimaryVersionId || 'original')
                    ) ||
                    reviewerVisibleVersions[0] ||
                    proposal;
                  const retailPrice = displayProposal.pricing?.retailPrice || displayProposal.totalCost || 0;
                  const totalCOGS = displayProposal.pricing?.totalCOGS || 0;
                  const grossProfitAmount = getGrossProfitAmount(displayProposal);
                  const grossProfitPercent = getGrossProfitPercent(displayProposal);
                  const designerName = getProposalDesignerName(proposal, session?.userName);
                  const proposalVersionCount = reviewerVisibleVersions.length || 1;
                  const modelId = displayProposal.pricingModelId || '';
                  const explicitRemoved = (displayProposal.pricingModelName || '').toLowerCase().includes('(removed)');
                  const isRemoved = Boolean(modelId) && (!availablePricingModelIds.has(modelId) || explicitRemoved);
                  const isActive =
                    Boolean(modelId) &&
                    defaultPricingModelId &&
                    modelId === defaultPricingModelId &&
                    availablePricingModelIds.has(modelId) &&
                    !explicitRemoved;
                  const modelClass = isActive
                    ? 'proposal-model-pill active'
                    : isRemoved
                    ? 'proposal-model-pill removed'
                    : 'proposal-model-pill inactive';
                  const pricingReviewNeeded =
                    displayProposal.pricingRevisionReview?.decision === 'pending' &&
                    !['draft', 'signed', 'completed'].includes(normalizeStatus(proposal.status));
                  const normalizedStatus = pricingReviewNeeded ? 'user_review' : normalizeStatus(proposal.status) || 'draft';
                  const showApprovalMarker = isApprovedButNotSigned(proposal);
                  const statusLabel = pricingReviewNeeded
                    ? 'User Review*'
                    : `${formatStatusLabel(proposal.status)}${showApprovalMarker ? '*' : ''}`;
                  const statusClassName = `status-badge-table is-${normalizedStatus}`;

                  return (
                    <tr
                      key={proposal.proposalNumber}
                      onClick={() =>
                        navigate(`/proposal/view/${proposal.proposalNumber}`, {
                          state: {
                            reviewerReturnTo: 'admin-panel',
                            reviewerReturnPath: '/admin',
                          },
                        })
                      }
                      className="proposal-row"
                    >
                      <td className="designer-cell">{designerName}</td>
                      <td className="customer-name">{displayProposal.customerInfo.customerName}</td>
                      <td>{new Date(displayProposal.lastModified || displayProposal.createdDate).toLocaleDateString()}</td>
                      <td>
                        <div className="proposal-status-cell">
                          <span
                            className={statusClassName}
                            data-tooltip={
                              pricingReviewNeeded
                                ? 'Pricing Model has been modified. User review needed'
                                : showApprovalMarker
                                ? 'Proposal Approved but not Signed'
                                : undefined
                            }
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={modelClass}>
                          {(displayProposal.pricingModelName || 'Pricing Model') +
                            (isRemoved && !explicitRemoved ? ' (Removed)' : '')}
                        </span>
                      </td>
                      <td>
                        <span className="proposal-tier-pill">
                          {getPricingTierName(displayProposal.pricingTierId || displayProposal.pricingTierName)}
                        </span>
                      </td>
                      <td className="versions-cell">{proposalVersionCount}</td>
                      <td className="price-cell">
                        ${retailPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="price-cell">
                        ${totalCOGS.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="percent-cell">
                        {grossProfitPercent.toFixed(2)}%
                      </td>
                      <td className="price-cell profit-cell">
                        ${grossProfitAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
            <TablePagination
              currentPage={proposalPage}
              totalPages={proposalTotalPages}
              totalItems={filteredProposals.length}
              startIndex={proposalStartIndex}
              endIndex={proposalEndIndex}
              onPageChange={goToProposalPage}
            />
          </div>
        )}
        </section>
      </div>

      {showPricingModels && modalRoot && createPortal(
        <div className="admin-resource-modal-backdrop" onClick={() => setShowPricingModels(false)}>
          <div className="admin-resource-modal" role="dialog" aria-modal="true" aria-labelledby="pricing-models-title" onClick={(event) => event.stopPropagation()}>
            <div className="admin-resource-modal-header">
              <div>
                <p>Franchise Tools</p>
                <h2 id="pricing-models-title">Franchise Pricing</h2>
              </div>
              <button type="button" className="admin-resource-modal-close" onClick={() => setShowPricingModels(false)} aria-label="Close franchise pricing">×</button>
            </div>
            <div className="admin-resource-list">
              {loadingModels ? (
                <div className="admin-empty padded">Loading pricing models...</div>
              ) : sortedPricingModels.length === 0 ? (
                <div className="admin-empty padded">No pricing models found for this franchise.</div>
              ) : sortedPricingModels.map((model) => (
                <div className={`admin-resource-row${model.isDefault ? ' is-active' : ''}`} key={model.id}>
                  <div className="admin-resource-copy">
                    <strong>{model.name}</strong>
                    <span>Updated {formatDate(model.updatedAt || model.createdAt)}</span>
                  </div>
                  <div className="admin-resource-actions">
                    {model.isDefault ? (
                      <span className="admin-active-pill">Active</span>
                    ) : (
                      <button type="button" className="admin-secondary-action" onClick={() => void handleSetActiveModel(model.id)} disabled={activatingModelId === model.id}>
                        {activatingModelId === model.id ? 'Setting...' : 'Set Active'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="admin-primary-action"
                      onClick={() => {
                        setShowPricingModels(false);
                        onOpenPricingData?.(model.id);
                      }}
                      disabled={!onOpenPricingData}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        modalRoot
      )}

      {showContractTemplates && modalRoot && createPortal(
        <div className="admin-resource-modal-backdrop" onClick={() => setShowContractTemplates(false)}>
          <div className="admin-resource-modal" role="dialog" aria-modal="true" aria-labelledby="contract-templates-title" onClick={(event) => event.stopPropagation()}>
            <div className="admin-resource-modal-header">
              <div>
                <p>Franchise Tools</p>
                <h2 id="contract-templates-title">Contract Templates</h2>
              </div>
              <button type="button" className="admin-resource-modal-close" onClick={() => setShowContractTemplates(false)} aria-label="Close contract templates">×</button>
            </div>
            {contractTemplateError && <div className="admin-empty padded is-error">{contractTemplateError}</div>}
            <div className="admin-resource-list">
              {loadingContractTemplates ? (
                <div className="admin-empty padded">Loading contract templates...</div>
              ) : contractTemplates.length === 0 ? (
                <div className="admin-empty padded">No contract templates have been published for this franchise yet.</div>
              ) : contractTemplates.map((template) => (
                <div className="admin-resource-row" key={template.id}>
                  <div className="admin-resource-copy">
                    <strong>{template.name}</strong>
                    <span>{template.jurisdiction_key} / {template.pool_type}</span>
                  </div>
                  <button
                    type="button"
                    className="admin-primary-action"
                    disabled={contractPreviewLoadingId === template.id}
                    onClick={() => void handlePreviewContractTemplate(template)}
                  >
                    {contractPreviewLoadingId === template.id ? 'Opening...' : 'View Template'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>,
        modalRoot
      )}

      {showUserManagement && modalRoot && createPortal(
        <div
          className="admin-resource-modal-backdrop"
          onClick={() => {
            if (selectedUser) handleCloseSelectedUser();
            else setShowUserManagement(false);
          }}
        >
          <div
            className="admin-resource-modal admin-user-management-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={selectedUser ? 'user-details-title' : 'user-management-title'}
            onClick={(event) => event.stopPropagation()}
          >
            {selectedUser ? selectedUserDetails : (
              <>
                <div className="admin-resource-modal-header">
                  <div>
                    <p>Franchise Tools</p>
                    <h2 id="user-management-title">User Management</h2>
                  </div>
                  <div className="admin-user-management-header-actions">
                    <button type="button" className="admin-primary-action" onClick={handleOpenAddUserForm}>Add User</button>
                    <button type="button" className="admin-resource-modal-close" onClick={() => setShowUserManagement(false)} aria-label="Close user management">×</button>
                  </div>
                </div>
                <div className="admin-user-management-columns" aria-hidden="true">
                  <span>User</span><span>Role</span><span>Submitted Proposals</span>
                </div>
                {loadingUsers ? (
                  <div className="admin-empty padded">Loading users...</div>
                ) : franchiseUsers.length === 0 ? (
                  <div className="admin-empty padded">No users have been added yet.</div>
                ) : (
                  <div className="admin-user-management-list" role="list" ref={userListRef} onWheel={handleUserListWheel}>
                    {franchiseUsers.map((user) => (
                      <button
                        type="button"
                        className={`admin-user-management-row role-${user.role}`}
                        key={user.id}
                        role="listitem"
                        onClick={() => setSelectedUserId(user.id)}
                      >
                        <span className="admin-user-management-identity">
                          <strong>{user.name || user.email}</strong>
                          <small>{user.email}</small>
                        </span>
                        <span className="admin-user-role-pill">{getRoleLabel(user.role)}</span>
                        <span className="admin-user-proposal-count">{(submittedProposalCountByUserId.get(user.id) || 0).toLocaleString('en-US')}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        modalRoot
      )}

      {addUserModal}

      {false && showAddUserForm && (
        <div className="admin-user-modal-backdrop" onClick={handleCloseAddUserForm}>
          <div
            className="admin-user-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-user-modal-header">
              <div>
                <p className="admin-user-modal-kicker">Designers</p>
                <h3 className="admin-user-modal-title">Add a New Designer</h3>
              </div>
              <button
                className="admin-user-modal-close"
                type="button"
                onClick={handleCloseAddUserForm}
                aria-label="Close add designer form"
              >
                ×
              </button>
            </div>
            <div className="admin-users-add">
              <div className="admin-users-add-card">
                <div className="admin-users-add-field">
                  <label className="admin-users-add-label" htmlFor="designer-name-input">
                    Designer Name
                  </label>
                  <input
                    id="designer-name-input"
                    type="text"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Enter Designer Name"
                    disabled={addingUser}
                  />
                </div>
                <div className="admin-users-add-field">
                  <label className="admin-users-add-label" htmlFor="designer-email-input">
                    Designer Email
                  </label>
                  <div className="admin-users-add-email">
                    <input
                      id="designer-email-input"
                      type="email"
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="Enter Designer Email"
                      disabled={addingUser}
                    />
                    <button
                      className="admin-primary-btn"
                      type="button"
                      onClick={handleAddUser}
                      disabled={addingUser}
                    >
                      {addingUser ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {userError && <div className="admin-error">{userError}</div>}
          </div>
        </div>
      )}

      {false && selectedUser && (
        <div className="admin-user-modal-backdrop" onClick={handleCloseSelectedUser}>
          <div
            className="admin-user-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="admin-user-modal-header">
              <div>
                <p className="admin-user-modal-kicker">User Details</p>
                <h3 className="admin-user-modal-title">{selectedUser!.name || selectedUser!.email}</h3>
              </div>
              <button
                className="admin-user-modal-close"
                type="button"
                onClick={handleCloseSelectedUser}
                aria-label="Close user details"
              >
                ×
              </button>
            </div>
            <div className="admin-user-modal-details">
              <div className="admin-user-detail">
                <span className="admin-user-detail-label">Role</span>
                <span className="admin-user-detail-value">{getRoleLabel(selectedUser!.role)}</span>
              </div>
              <div className="admin-user-detail">
                <span className="admin-user-detail-label">Email</span>
                <span className="admin-user-detail-value">{selectedUser!.email}</span>
              </div>
            </div>
            <div className="admin-user-commission-section">
              <div className="admin-user-commission-header">
                <div className="admin-user-commission-title">Commission Settings</div>
                <div className="admin-user-commission-subtitle">Percent of retail price</div>
              </div>
              <div className="admin-user-commission-grid">
                <label className="admin-user-commission-field" htmlFor="closeout-commission-input">
                  <span>Closeout Commission</span>
                  <div className="admin-user-commission-input">
                    <input
                      id="closeout-commission-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={selectedCloseoutCommissionPercent}
                      onChange={(event) => setSelectedCloseoutCommissionPercent(event.target.value)}
                      disabled={savingCommissionUserId === selectedUser!.id}
                    />
                    <span>%</span>
                  </div>
                </label>
                <label className="admin-user-commission-field" htmlFor="dig-commission-input">
                  <span>Dig Commission</span>
                  <div className="admin-user-commission-input">
                    <input
                      id="dig-commission-input"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={selectedDigCommissionPercent}
                      onChange={(event) => setSelectedDigCommissionPercent(event.target.value)}
                      disabled={savingCommissionUserId === selectedUser!.id}
                    />
                    <span>%</span>
                  </div>
                </label>
              </div>
              <button
                className="admin-primary-btn"
                type="button"
                onClick={() => handleSaveCommissionRates(selectedUser!.id)}
                disabled={savingCommissionUserId === selectedUser!.id}
              >
                {savingCommissionUserId === selectedUser!.id ? 'Saving...' : 'Save Commission Settings'}
              </button>
              {selectedUserStatus?.type === 'error' && (
                <div className="admin-error">{selectedUserStatus!.message}</div>
              )}
              {selectedUserStatus?.type === 'success' && (
                <div className="admin-success">{selectedUserStatus!.message}</div>
              )}
            </div>
            <div className="admin-user-modal-actions">
              {selectedUser!.role === 'designer' && (
                <button
                  className="admin-primary-btn ghost"
                  type="button"
                  onClick={() => handlePromoteUser(selectedUser!.id)}
                  disabled={promotingUserId === selectedUser!.id}
                >
                  {promotingUserId === selectedUser!.id ? 'Promoting...' : 'Make Admin'}
                </button>
              )}
              {selectedUser!.role !== 'owner' && (
                <button
                  className="admin-primary-btn ghost"
                  type="button"
                  onClick={() => handleResetPassword(selectedUser!.id)}
                  disabled={resettingUserId === selectedUser!.id}
                >
                  {resettingUserId === selectedUser!.id ? 'Resetting...' : 'Reset Password'}
                </button>
              )}
              {selectedUser!.role === 'designer' && (
                <button
                  className="admin-remove-btn"
                  type="button"
                  onClick={() => handleRemoveUser(selectedUser!.id, selectedUser!.role)}
                >
                  Remove User
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {tempPassword && (
        <TempPasswordModal
          tempPassword={tempPassword}
          onClose={() => setTempPassword(null)}
          title="Temporary Password"
          description="Copy this password now. It will only be shown once."
        />
      )}
      {contractPreview && (
        <div className="admin-contract-preview-backdrop" role="dialog" aria-modal="true" aria-label="Blank contract template">
          <div className="admin-contract-preview-modal">
            <div className="admin-contract-preview-header">
              <div>
                <h2>{contractPreview.name}</h2>
                <p>Current revision {contractPreview.revisionNumber} - blank template</p>
              </div>
              <button type="button" className="admin-primary-btn ghost" onClick={() => setContractPreview(null)}>
                Close
              </button>
            </div>
            <PdfCanvasViewer
              src={contractPreview.pdfUrl}
              ariaLabel={`${contractPreview.name} blank template`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPanelPage;
