import React, { useState } from 'react';
import { TooltipAnchor } from '../components/AppTooltip';
import ChangelogModal from '../components/ChangelogModal';
import { useFranchiseAppName } from '../hooks/useFranchiseAppName';
import { useFranchiseCapability } from '../hooks/useFranchiseCapability';
import { usePriceImpactPreferences } from '../hooks/usePriceImpactPreferences';
import {
  DEFAULT_PRICE_IMPACT_ENABLED,
  PRICE_IMPACT_CAPABILITY,
} from '../services/franchiseConfiguration';
import { getSessionFranchiseCode, getSessionFranchiseId, getSessionRole } from '../services/session';
import { formatFranchiseAppVersion, getUpdateChannel } from '../services/franchiseRelease';
import { savePriceImpactPreferences } from '../services/userPreferences';
import './SettingsPage.css';

type UpdateStatusMessage = {
  text: string;
  tone: 'info' | 'success' | 'error';
};

const SettingsPage: React.FC = () => {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<UpdateStatusMessage | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [priceImpactSaving, setPriceImpactSaving] = useState(false);
  const [priceImpactError, setPriceImpactError] = useState<string | null>(null);

  const franchiseId = getSessionFranchiseId();
  const sessionRole = getSessionRole();
  const canViewChangelog =
    sessionRole === 'designer' || sessionRole === 'admin' || sessionRole === 'owner' || sessionRole === 'master';
  const isChangelogDisabled = !canViewChangelog;
  const { displayName } = useFranchiseAppName(franchiseId);
  const {
    enabled: franchisePriceImpactEnabled,
    isLoading: franchisePriceImpactLoading,
  } = useFranchiseCapability(
    PRICE_IMPACT_CAPABILITY,
    franchiseId,
    DEFAULT_PRICE_IMPACT_ENABLED
  );
  const priceImpactPreferences = usePriceImpactPreferences();
  const displayAppVersion = formatFranchiseAppVersion(window.electron?.appVersion || '1.0.5');
  const priceImpactControlsDisabled =
    !franchisePriceImpactEnabled ||
    franchisePriceImpactLoading ||
    priceImpactPreferences.isLoading ||
    priceImpactSaving;
  const priceImpactBasisDisabled =
    priceImpactControlsDisabled || !priceImpactPreferences.enabled;

  const updatePriceImpactPreferences = async (
    next: Parameters<typeof savePriceImpactPreferences>[0]
  ) => {
    if (!franchisePriceImpactEnabled || priceImpactSaving) return;
    setPriceImpactSaving(true);
    setPriceImpactError(null);
    try {
      await savePriceImpactPreferences(next);
    } catch (error) {
      console.error('Unable to save Price Impact preferences:', error);
      setPriceImpactError(
        error instanceof Error ? error.message : 'Unable to save Price Impact settings.'
      );
    } finally {
      setPriceImpactSaving(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setChecking(true);
    setMessage({ text: 'Checking for updates...', tone: 'info' });

    try {
      const channel = getUpdateChannel(sessionRole, getSessionFranchiseCode());
      const result = await window.electron.checkForUpdates(channel ? { channel } : undefined);

      if (result.message) {
        setMessage({ text: result.message, tone: 'error' });
      } else if (result.available) {
        setMessage({ text: 'Update found. Download will start automatically.', tone: 'info' });
      } else {
        setMessage({ text: 'Up to date!', tone: 'success' });
      }
    } catch (error) {
      setMessage({ text: 'Error checking for updates', tone: 'error' });
      console.error('Update check error:', error);
    } finally {
      setChecking(false);
      window.setTimeout(() => setMessage(null), 3000);
    }
  };

  const openChangelog = () => {
    if (!canViewChangelog) return;
    setShowChangelog(true);
  };

  return (
    <div className="settings-page">
      <div className="settings-page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-page-content">
        <div className="settings-card settings-price-impact-card">
          <h2>Price Impact</h2>
          <p className="settings-description">
            Choose whether Price Impact is shown in the proposal builder and which cost basis it uses.
          </p>
          <TooltipAnchor
            as="div"
            className="settings-price-impact-tooltip"
            tooltip={!franchisePriceImpactEnabled ? 'Price Impact is disabled for your franchise' : undefined}
          >
            <div
              className={`settings-preference-panel${!franchisePriceImpactEnabled ? ' is-franchise-disabled' : ''}`}
              aria-disabled={!franchisePriceImpactEnabled}
            >
              <div className="settings-preference-row">
                <div className="settings-preference-copy">
                  <strong>Enable Price Impact</strong>
                  <span>Show Price Impact icons throughout the proposal builder.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Enable Price Impact"
                  aria-checked={priceImpactPreferences.enabled}
                  className={`settings-toggle-switch${priceImpactPreferences.enabled ? ' is-on' : ' is-off'}`}
                  disabled={priceImpactControlsDisabled}
                  onClick={() => void updatePriceImpactPreferences({
                    enabled: !priceImpactPreferences.enabled,
                    displayBasis: priceImpactPreferences.displayBasis,
                  })}
                >
                  <span className="settings-toggle-track" aria-hidden="true">
                    <span className="settings-toggle-thumb" />
                  </span>
                  <span>{priceImpactPreferences.enabled ? 'Enabled' : 'Disabled'}</span>
                </button>
              </div>

              <div
                className={`settings-preference-row settings-preference-row--child${priceImpactBasisDisabled ? ' is-disabled' : ''}`}
                aria-disabled={priceImpactBasisDisabled}
              >
                <div className="settings-preference-copy">
                  <strong>Retail Cost / COGS Cost</strong>
                  <span>Select the amounts shown inside each Price Impact.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="Price Impact cost basis"
                  aria-checked={priceImpactPreferences.displayBasis === 'cogs'}
                  className={`settings-basis-switch${priceImpactPreferences.displayBasis === 'cogs' ? ' is-cogs' : ' is-retail'}`}
                  disabled={priceImpactBasisDisabled}
                  onClick={() => void updatePriceImpactPreferences({
                    enabled: priceImpactPreferences.enabled,
                    displayBasis: priceImpactPreferences.displayBasis === 'retail' ? 'cogs' : 'retail',
                  })}
                >
                  <span className="settings-basis-label">Retail Cost</span>
                  <span className="settings-basis-track" aria-hidden="true">
                    <span className="settings-basis-thumb" />
                  </span>
                  <span className="settings-basis-label">COGS Cost</span>
                </button>
              </div>
            </div>
          </TooltipAnchor>
          {priceImpactSaving && (
            <div className="settings-preference-status" role="status">Saving Price Impact settings...</div>
          )}
          {priceImpactError && (
            <div className="settings-preference-status is-error" role="alert">{priceImpactError}</div>
          )}
        </div>

        <div className="settings-card">
          <h2>Updates</h2>
          <p className="settings-description">
            Check for the latest version of {displayName} Proposal Builder
          </p>
          <button
            className="settings-button check-updates-button"
            onClick={handleCheckForUpdates}
            disabled={checking}
          >
            {checking ? 'Checking...' : 'Check for Updates'}
          </button>
          {message && (
            <div className={`settings-update-message settings-update-message--${message.tone}`}>
              {message.text}
            </div>
          )}
          <div className="section-row">
            <div>
              <h3>Patch Notes</h3>
            </div>
            <button
              className="settings-button view-changelog-button"
              onClick={openChangelog}
              disabled={isChangelogDisabled}
            >
              View Changelog
            </button>
          </div>
        </div>

        <div className="settings-card">
          <h2>About</h2>
          <p className="about-text">{displayName} Proposal Builder</p>
          <p className="about-text">Version {displayAppVersion}</p>
          <p className="about-text">(c) {new Date().getFullYear()} Submerge - Designed by Brian Kummer</p>
        </div>
      </div>

      <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
    </div>
  );
};

export default SettingsPage;
