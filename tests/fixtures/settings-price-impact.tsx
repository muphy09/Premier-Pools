import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsPage from '../../src/pages/SettingsPage';
import { SESSION_STORAGE_KEY } from '../../src/services/session';
import '../../src/index.css';

const userId = 'playwright-user';
const franchiseId = 'playwright-franchise';
const params = new URLSearchParams(window.location.search);
const franchiseEnabled = params.get('franchise') !== 'off';
const preferenceKey = `submerge.userPreferences.priceImpact.v1.${userId}`;

localStorage.setItem(
  SESSION_STORAGE_KEY,
  JSON.stringify({
    userId,
    userEmail: 'designer@playwright.invalid',
    userName: 'Playwright Designer',
    franchiseId,
    franchiseCode: 'PWTEST',
    role: 'designer',
    isTestAccount: true,
  })
);

localStorage.setItem(
  `submerge.franchiseConfiguration.v1.${franchiseId}`,
  JSON.stringify({
    franchiseId,
    revisionId: 'playwright-revision',
    revisionNumber: 1,
    schemaVersion: 1,
    configuration: {
      themeProfile: 'default',
      proposalLayout: 'standard',
      locationInputMode: 'state',
      contractResolutionMode: 'state_and_pool_type',
      capabilities: { priceImpact: franchiseEnabled },
    },
    source: 'cache',
  })
);

if (!localStorage.getItem(preferenceKey)) {
  localStorage.setItem(
    preferenceKey,
    JSON.stringify({
      enabled: params.get('user') !== 'off',
      displayBasis: params.get('basis') === 'cogs' ? 'cogs' : 'retail',
    })
  );
}

(window as any).electron = {
  appVersion: '1.0.5',
  checkForUpdates: async () => ({ available: false }),
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsPage />
  </React.StrictMode>
);
