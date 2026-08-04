import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import submergeLogo from '../../Submerge Logo.png';
import { useAdminPanelPin } from '../hooks/useAdminPanelPin';
import { useFranchiseAppName } from '../hooks/useFranchiseAppName';
import { useFranchiseLogo } from '../hooks/useFranchiseLogo';
import {
  ADMIN_PANEL_PIN_LENGTH,
  DEFAULT_ADMIN_PANEL_PIN,
  MAX_ADMIN_PANEL_PIN_LENGTH,
  resetAdminPanelPin,
  sanitizeAdminPanelPinInput,
  saveAdminPanelPin,
} from '../services/adminPanelPin';
import {
  DEFAULT_APP_NAME,
  saveFranchiseAppName,
  saveFranchiseLogo,
} from '../services/franchiseBranding';
import { saveFranchiseCode } from '../services/franchisesAdapter';
import {
  getSessionFranchiseCode,
  getSessionFranchiseId,
  getSessionUserName,
  readMasterImpersonation,
  readSession,
  saveMasterImpersonation,
  updateSession,
} from '../services/session';
import './AdminSettingsModal.css';

const MAX_LOGO_BYTES = 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];

type StatusMessage = { type: 'success' | 'error' | 'info'; message: string } | null;

interface AdminSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEditProposalNotes?: () => void;
}

function AdminSettingsModal({ isOpen, onClose, onEditProposalNotes }: AdminSettingsModalProps) {
  const franchiseId = getSessionFranchiseId();
  const sessionFranchiseCode = getSessionFranchiseCode() || '';
  const { appName: savedAppName, displayName, isLoading: appNameLoading } = useFranchiseAppName(franchiseId);
  const { logoUrl: savedLogoUrl, isLoading: logoLoading } = useFranchiseLogo(franchiseId);
  const { adminPanelPin: currentAdminPin, isLoading: adminPinLoading } = useAdminPanelPin(franchiseId);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [currentFranchiseCode, setCurrentFranchiseCode] = useState(sessionFranchiseCode);
  const [pendingFranchiseCode, setPendingFranchiseCode] = useState(sessionFranchiseCode);
  const [franchiseCodeSaving, setFranchiseCodeSaving] = useState(false);
  const [franchiseCodeStatus, setFranchiseCodeStatus] = useState<StatusMessage>(null);

  const [pendingLogoUrl, setPendingLogoUrl] = useState<string | null>(null);
  const [pendingLogoName, setPendingLogoName] = useState('');
  const [logoSaving, setLogoSaving] = useState(false);
  const [logoStatus, setLogoStatus] = useState<StatusMessage>(null);

  const [pendingAppName, setPendingAppName] = useState('');
  const [appNameSaving, setAppNameSaving] = useState(false);
  const [appNameStatus, setAppNameStatus] = useState<StatusMessage>(null);

  const [pendingAdminPin, setPendingAdminPin] = useState('');
  const [adminPinStatus, setAdminPinStatus] = useState<StatusMessage>(null);
  const [adminPinSaving, setAdminPinSaving] = useState(false);
  const [showAdminPin, setShowAdminPin] = useState(false);

  const previewLogoUrl = pendingLogoUrl || savedLogoUrl || submergeLogo;
  const hasCustomLogo = Boolean(savedLogoUrl);
  const hasPendingLogo = Boolean(pendingLogoUrl);
  const normalizedPendingName = pendingAppName.trim();
  const normalizedDisplayName = displayName.trim();
  const normalizedSavedName = (savedAppName || '').trim();
  const normalizedDefaultAppName = DEFAULT_APP_NAME.trim();
  const hasCustomAppName = Boolean(normalizedSavedName);
  const hasPendingNameChange = normalizedPendingName !== normalizedDisplayName;
  const canResetAppName = hasCustomAppName || hasPendingNameChange;
  const normalizedPendingCode = pendingFranchiseCode.trim().toUpperCase();
  const normalizedCurrentCode = (currentFranchiseCode || '').trim().toUpperCase();
  const hasPendingCodeChange = normalizedPendingCode !== normalizedCurrentCode;
  const hasPendingCodeValue = normalizedPendingCode.length > 0;
  const canResetFranchiseCode = hasPendingCodeChange;
  const normalizedPendingAdminPin = sanitizeAdminPanelPinInput(pendingAdminPin);
  const effectiveCurrentAdminPin = currentAdminPin || DEFAULT_ADMIN_PANEL_PIN;
  const hasPendingAdminPinChange = normalizedPendingAdminPin !== effectiveCurrentAdminPin;
  const isCurrentAdminPinDefault = effectiveCurrentAdminPin === DEFAULT_ADMIN_PANEL_PIN;
  const canResetAdminPin = hasPendingAdminPinChange || !isCurrentAdminPinDefault;
  const modalRoot = typeof document !== 'undefined' ? document.body : null;
  const activeSession = readSession();
  const activeImpersonation = readMasterImpersonation();

  useEffect(() => {
    if (!isOpen) {
      setPendingLogoUrl(null);
      setPendingLogoName('');
      setLogoStatus(null);
      setAppNameStatus(null);
      setFranchiseCodeStatus(null);
      setAdminPinStatus(null);
      setPendingAppName(displayName);
      setPendingFranchiseCode(sessionFranchiseCode);
      setPendingAdminPin(effectiveCurrentAdminPin);
      setShowAdminPin(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [displayName, effectiveCurrentAdminPin, isOpen, onClose, sessionFranchiseCode]);

  useEffect(() => {
    setPendingAppName(displayName);
  }, [displayName]);

  useEffect(() => {
    setCurrentFranchiseCode(sessionFranchiseCode);
    setPendingFranchiseCode(sessionFranchiseCode);
    setFranchiseCodeStatus(null);
  }, [franchiseId, sessionFranchiseCode]);

  useEffect(() => {
    if (adminPinLoading) return;
    setPendingAdminPin(effectiveCurrentAdminPin);
    setAdminPinStatus(null);
  }, [adminPinLoading, effectiveCurrentAdminPin, franchiseId]);

  const updateStoredSessionCode = (nextCode: string) => {
    const session = readSession();
    if (!session) return;
    if ((session.role || '').toLowerCase() === 'master') {
      const impersonation = readMasterImpersonation();
      if (impersonation?.franchiseId) {
        saveMasterImpersonation({
          ...impersonation,
          franchiseCode: nextCode,
        });
        return;
      }
    }
    updateSession({ franchiseCode: nextCode });
  };

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setLogoStatus(null);
    const file = event.target.files?.[0];
    if (!file) {
      setPendingLogoUrl(null);
      setPendingLogoName('');
      return;
    }

    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setLogoStatus({ type: 'error', message: 'Logo must be a PNG, JPG, SVG, or WebP file.' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setLogoStatus({ type: 'error', message: 'Logo must be smaller than 1 MB.' });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setLogoStatus({ type: 'error', message: 'Unable to read logo file.' });
        return;
      }
      setPendingLogoUrl(result);
      setPendingLogoName(file.name);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.onerror = () => {
      setLogoStatus({ type: 'error', message: 'Unable to read logo file.' });
    };
    reader.readAsDataURL(file);
  };

  const handleDiscardLogo = () => {
    setPendingLogoUrl(null);
    setPendingLogoName('');
    setLogoStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveLogo = async () => {
    if (!pendingLogoUrl) return;
    setLogoSaving(true);
    setLogoStatus(null);
    try {
      await saveFranchiseLogo({
        franchiseId,
        logoUrl: pendingLogoUrl,
        updatedBy: getSessionUserName(),
      });
      setPendingLogoUrl(null);
      setPendingLogoName('');
      setLogoStatus({ type: 'success', message: 'Franchise logo updated.' });
    } catch (error) {
      console.error('Failed to save franchise logo:', error);
      setLogoStatus({ type: 'error', message: 'Unable to save the franchise logo.' });
    } finally {
      setLogoSaving(false);
    }
  };

  const handleResetLogo = async () => {
    if (!hasCustomLogo && !pendingLogoUrl) return;
    setLogoSaving(true);
    setLogoStatus(null);
    try {
      await saveFranchiseLogo({
        franchiseId,
        logoUrl: null,
        updatedBy: getSessionUserName(),
      });
      setPendingLogoUrl(null);
      setPendingLogoName('');
      setLogoStatus({ type: 'success', message: 'Franchise logo reset to default.' });
    } catch (error) {
      console.error('Failed to reset franchise logo:', error);
      setLogoStatus({ type: 'error', message: 'Unable to reset the franchise logo.' });
    } finally {
      setLogoSaving(false);
    }
  };

  const handleSaveAppName = async () => {
    if (!hasPendingNameChange) return;
    setAppNameSaving(true);
    setAppNameStatus(null);
    const nextName =
      normalizedPendingName && normalizedPendingName !== normalizedDefaultAppName
        ? normalizedPendingName
        : null;
    try {
      await saveFranchiseAppName({
        franchiseId,
        appName: nextName,
        updatedBy: getSessionUserName(),
      });
      setPendingAppName(nextName ?? DEFAULT_APP_NAME);
      setAppNameStatus({
        type: 'success',
        message: nextName ? 'App name updated.' : 'App name reset to default.',
      });
    } catch (error) {
      console.error('Failed to save app name:', error);
      setAppNameStatus({ type: 'error', message: 'Unable to save the app name.' });
    } finally {
      setAppNameSaving(false);
    }
  };

  const handleResetAppName = async () => {
    if (!hasCustomAppName) {
      setPendingAppName(DEFAULT_APP_NAME);
      setAppNameStatus(null);
      return;
    }
    setAppNameSaving(true);
    setAppNameStatus(null);
    try {
      await saveFranchiseAppName({
        franchiseId,
        appName: null,
        updatedBy: getSessionUserName(),
      });
      setPendingAppName(DEFAULT_APP_NAME);
      setAppNameStatus({ type: 'success', message: 'App name reset to default.' });
    } catch (error) {
      console.error('Failed to reset app name:', error);
      setAppNameStatus({ type: 'error', message: 'Unable to reset the app name.' });
    } finally {
      setAppNameSaving(false);
    }
  };

  const handleResetFranchiseCode = () => {
    setPendingFranchiseCode(normalizedCurrentCode);
    setFranchiseCodeStatus(null);
  };

  const handleSaveFranchiseCode = async () => {
    if (!hasPendingCodeChange) return;
    if (!hasPendingCodeValue) {
      setFranchiseCodeStatus({ type: 'error', message: 'Franchise code is required.' });
      return;
    }
    setFranchiseCodeSaving(true);
    setFranchiseCodeStatus(null);
    const franchiseName =
      (activeSession?.role || '').toLowerCase() === 'master'
        ? activeImpersonation?.franchiseName || activeSession?.franchiseName
        : activeSession?.franchiseName;
    try {
      await saveFranchiseCode({
        franchiseId,
        franchiseCode: normalizedPendingCode,
        previousCode: currentFranchiseCode,
        franchiseName,
      });
      setCurrentFranchiseCode(normalizedPendingCode);
      setPendingFranchiseCode(normalizedPendingCode);
      updateStoredSessionCode(normalizedPendingCode);
      setFranchiseCodeStatus({ type: 'success', message: 'Franchise code updated.' });
    } catch (error: any) {
      console.error('Failed to update franchise code:', error);
      setFranchiseCodeStatus({
        type: 'error',
        message: error?.message || 'Unable to update the franchise code.',
      });
    } finally {
      setFranchiseCodeSaving(false);
    }
  };

  const handleSaveAdminPin = async () => {
    if (!hasPendingAdminPinChange) return;
    if (normalizedPendingAdminPin.length !== ADMIN_PANEL_PIN_LENGTH) {
      setAdminPinStatus({
        type: 'error',
        message: `PIN must be exactly ${ADMIN_PANEL_PIN_LENGTH} digits.`,
      });
      return;
    }

    try {
      setAdminPinSaving(true);
      const savedPin = await saveAdminPanelPin(franchiseId, normalizedPendingAdminPin, {
        updatedBy: getSessionUserName(),
      });
      setPendingAdminPin(savedPin);
      setAdminPinStatus({ type: 'success', message: 'Admin panel PIN updated.' });
    } catch (error: any) {
      console.error('Failed to save admin panel PIN:', error);
      setAdminPinStatus({
        type: 'error',
        message: error?.message || 'Unable to save the admin panel PIN.',
      });
    } finally {
      setAdminPinSaving(false);
    }
  };

  const handleResetAdminPin = async () => {
    if (isCurrentAdminPinDefault) {
      setPendingAdminPin(DEFAULT_ADMIN_PANEL_PIN);
      setAdminPinStatus(null);
      return;
    }
    try {
      setAdminPinSaving(true);
      const nextPin = await resetAdminPanelPin(franchiseId, {
        updatedBy: getSessionUserName(),
      });
      setPendingAdminPin(nextPin);
      setAdminPinStatus({
        type: 'success',
        message: 'Admin panel PIN reset to default.',
      });
    } catch (error) {
      console.error('Failed to reset admin panel PIN:', error);
      setAdminPinStatus({
        type: 'error',
        message: 'Unable to reset the admin panel PIN.',
      });
    } finally {
      setAdminPinSaving(false);
    }
  };

  if (!isOpen || !modalRoot) return null;

  return createPortal(
    <div className="admin-settings-backdrop" onClick={onClose}>
      <div
        className="admin-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-settings-header">
          <div>
            <p className="admin-settings-kicker">Protected Settings</p>
            <h2 id="admin-settings-title">Admin Settings</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="admin-settings-close"
            onClick={onClose}
            aria-label="Close admin settings"
          >
            X
          </button>
        </div>

        <div className="admin-settings-body">
          <section className="admin-settings-item">
            <div className="admin-settings-item-header">
              <div>
                <h3>Global Logo</h3>
                <p>Upload a franchise-wide logo to replace the default branding throughout the app.</p>
              </div>
            </div>
            <div className="admin-settings-item-panel">
              <div className="admin-settings-logo-layout">
                <div className="admin-settings-logo-preview">
                  <span className="admin-settings-field-label">Current logo</span>
                  <div className="admin-settings-logo-frame">
                    <img src={previewLogoUrl} alt="Franchise logo preview" />
                  </div>
                  <p className="admin-settings-note">Recommended: transparent PNG or SVG, max 1 MB.</p>
                </div>
                <div className="admin-settings-logo-controls">
                  <label className="admin-settings-field">
                    <span className="admin-settings-field-label">Upload new logo</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="admin-settings-file-input"
                      accept={ALLOWED_LOGO_TYPES.join(',')}
                      onChange={handleLogoFileChange}
                      disabled={logoSaving}
                    />
                  </label>
                  {pendingLogoName && (
                    <div className="admin-settings-inline-note">Selected: {pendingLogoName}</div>
                  )}
                  <div className="admin-settings-actions">
                    <button
                      type="button"
                      className="admin-settings-button admin-settings-button--primary"
                      onClick={handleSaveLogo}
                      disabled={!hasPendingLogo || logoSaving}
                    >
                      {logoSaving && hasPendingLogo ? 'Saving...' : 'Save Logo'}
                    </button>
                    {hasPendingLogo && (
                      <button
                        type="button"
                        className="admin-settings-button admin-settings-button--ghost"
                        onClick={handleDiscardLogo}
                        disabled={logoSaving}
                      >
                        Discard
                      </button>
                    )}
                    <button
                      type="button"
                      className="admin-settings-button admin-settings-button--danger"
                      onClick={handleResetLogo}
                      disabled={!hasCustomLogo || logoSaving}
                    >
                      Reset to Default
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {logoStatus && <div className={`admin-settings-feedback ${logoStatus.type}`}>{logoStatus.message}</div>}
            {!logoStatus && logoLoading && (
              <div className="admin-settings-feedback info">Loading current logo...</div>
            )}
          </section>

          <section className="admin-settings-item">
            <div className="admin-settings-item-header">
              <div>
                <h3>App Name</h3>
                <p>Replace the app name throughout the app, except the About section.</p>
              </div>
            </div>
            <div className="admin-settings-item-panel">
              <div className="admin-settings-field-row">
                <label className="admin-settings-field">
                  <span className="admin-settings-field-label">Name</span>
                  <input
                    type="text"
                    className="admin-settings-input"
                    placeholder="Enter app name"
                    value={pendingAppName}
                    onChange={(event) => {
                      setAppNameStatus(null);
                      setPendingAppName(event.target.value);
                    }}
                    disabled={appNameSaving}
                  />
                </label>
              </div>
              <div className="admin-settings-actions">
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--primary"
                  onClick={handleSaveAppName}
                  disabled={!hasPendingNameChange || appNameSaving}
                >
                  {appNameSaving ? 'Saving...' : 'Save Name'}
                </button>
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--danger"
                  onClick={handleResetAppName}
                  disabled={!canResetAppName || appNameSaving}
                >
                  Reset to Default
                </button>
              </div>
            </div>
            {appNameStatus && (
              <div className={`admin-settings-feedback ${appNameStatus.type}`}>{appNameStatus.message}</div>
            )}
            {!appNameStatus && appNameLoading && (
              <div className="admin-settings-feedback info">Loading app name...</div>
            )}
          </section>

          <section className="admin-settings-item">
            <div className="admin-settings-item-header">
              <div>
                <h3>Franchise Code</h3>
                <p>Used when logging in to select the correct franchise.</p>
              </div>
            </div>
            <div className="admin-settings-item-panel">
              <div className="admin-settings-field-row">
                <label className="admin-settings-field">
                  <span className="admin-settings-field-label">Code</span>
                  <input
                    type="text"
                    className="admin-settings-input admin-settings-input--code"
                    placeholder="Enter franchise code"
                    value={pendingFranchiseCode}
                    onChange={(event) => {
                      setFranchiseCodeStatus(null);
                      setPendingFranchiseCode(event.target.value.toUpperCase());
                    }}
                    disabled={franchiseCodeSaving}
                  />
                </label>
              </div>
              <div className="admin-settings-actions">
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--primary"
                  onClick={handleSaveFranchiseCode}
                  disabled={!hasPendingCodeChange || !hasPendingCodeValue || franchiseCodeSaving}
                >
                  {franchiseCodeSaving ? 'Saving...' : 'Save Code'}
                </button>
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--ghost"
                  onClick={handleResetFranchiseCode}
                  disabled={!canResetFranchiseCode || franchiseCodeSaving}
                >
                  Reset to Current
                </button>
              </div>
            </div>
            {franchiseCodeStatus && (
              <div className={`admin-settings-feedback ${franchiseCodeStatus.type}`}>
                {franchiseCodeStatus.message}
              </div>
            )}
            {!franchiseCodeStatus && franchiseCodeSaving && (
              <div className="admin-settings-feedback info">Updating franchise code...</div>
            )}
          </section>

          <section className="admin-settings-item">
            <div className="admin-settings-item-header">
              <div>
                <h3>Proposal Builder Notes</h3>
                <p>Manage the guidance and notes shown throughout the proposal-building experience.</p>
              </div>
            </div>
            <div className="admin-settings-item-panel">
              <div className="admin-settings-actions">
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--primary"
                  onClick={() => {
                    onClose();
                    onEditProposalNotes?.();
                  }}
                  disabled={!onEditProposalNotes}
                >
                  Edit Notes for Proposal Builder
                </button>
              </div>
            </div>
          </section>

          <section className="admin-settings-item">
            <div className="admin-settings-item-header">
              <div>
                <h3>Admin Panel PIN</h3>
                <p>Require a PIN before anyone on this franchise can open the Admin tab.</p>
              </div>
            </div>
            <div className="admin-settings-item-panel">
              <div className="admin-settings-field-row">
                <label className="admin-settings-field">
                  <span className="admin-settings-field-label">PIN</span>
                  <div className="admin-settings-input-row">
                    <input
                      type={showAdminPin ? 'text' : 'password'}
                      className="admin-settings-input admin-settings-input--pin"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={MAX_ADMIN_PANEL_PIN_LENGTH}
                      placeholder="Enter admin PIN"
                      value={pendingAdminPin}
                      onChange={(event) => {
                        setAdminPinStatus(null);
                        setPendingAdminPin(sanitizeAdminPanelPinInput(event.target.value));
                      }}
                      disabled={adminPinLoading || adminPinSaving}
                    />
                    <button
                      type="button"
                      className="admin-settings-button admin-settings-button--ghost admin-settings-pin-toggle"
                      onClick={() => setShowAdminPin((current) => !current)}
                      disabled={adminPinLoading || adminPinSaving}
                    >
                      {showAdminPin ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="admin-settings-note">Use exactly {ADMIN_PANEL_PIN_LENGTH} digits.</p>
                </label>
              </div>
              <div className="admin-settings-actions">
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--primary"
                  onClick={handleSaveAdminPin}
                  disabled={!hasPendingAdminPinChange || adminPinLoading || adminPinSaving}
                >
                  {adminPinSaving ? 'Saving...' : 'Save PIN'}
                </button>
                <button
                  type="button"
                  className="admin-settings-button admin-settings-button--danger"
                  onClick={handleResetAdminPin}
                  disabled={!canResetAdminPin || adminPinLoading || adminPinSaving}
                >
                  Reset to Default
                </button>
              </div>
            </div>
            {adminPinStatus && (
              <div className={`admin-settings-feedback ${adminPinStatus.type}`}>{adminPinStatus.message}</div>
            )}
            {!adminPinStatus && adminPinLoading && (
              <div className="admin-settings-feedback info">Loading current PIN...</div>
            )}
          </section>
        </div>
      </div>
    </div>,
    modalRoot
  );
}

export default AdminSettingsModal;
