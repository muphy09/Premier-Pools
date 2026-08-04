import React, { useState } from 'react';
import ChangelogModal from '../components/ChangelogModal';
import { useFranchiseAppName } from '../hooks/useFranchiseAppName';
import { getSessionFranchiseCode, getSessionFranchiseId, getSessionRole } from '../services/session';
import { formatFranchiseAppVersion, getUpdateChannel } from '../services/franchiseRelease';
import './SettingsPage.css';

type UpdateStatusMessage = {
  text: string;
  tone: 'info' | 'success' | 'error';
};

const SettingsPage: React.FC = () => {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<UpdateStatusMessage | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);

  const franchiseId = getSessionFranchiseId();
  const sessionRole = getSessionRole();
  const canViewChangelog =
    sessionRole === 'designer' || sessionRole === 'admin' || sessionRole === 'owner' || sessionRole === 'master';
  const isChangelogDisabled = !canViewChangelog;
  const { displayName } = useFranchiseAppName(franchiseId);
  const displayAppVersion = formatFranchiseAppVersion(window.electron?.appVersion || '1.0.5');

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
