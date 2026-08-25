import React from 'react';
import ReactDOM from 'react-dom/client';
import AdminSettingsModal from '../../src/components/AdminSettingsModal';
import { SESSION_STORAGE_KEY } from '../../src/services/session';
import '../../src/index.css';

localStorage.setItem(
  SESSION_STORAGE_KEY,
  JSON.stringify({
    userId: 'playwright-owner',
    userEmail: 'owner@playwright.invalid',
    userName: 'Playwright Owner',
    franchiseId: 'playwright-franchise',
    franchiseCode: 'PWTEST',
    role: 'owner',
    isTestAccount: true,
  })
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AdminSettingsModal isOpen onClose={() => undefined} />
  </React.StrictMode>
);
