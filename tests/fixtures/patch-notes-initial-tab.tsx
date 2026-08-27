import React from 'react';
import ReactDOM from 'react-dom/client';
import ChangelogModal from '../../src/components/ChangelogModal';
import { SESSION_STORAGE_KEY } from '../../src/services/session';
import '../../src/index.css';

const role = new URLSearchParams(window.location.search).get('role') || 'admin';

localStorage.setItem(
  SESSION_STORAGE_KEY,
  JSON.stringify({
    userId: 'playwright-user',
    franchiseId: 'playwright-franchise',
    franchiseName: 'Playwright Franchise',
    franchiseCode: 'PWTEST',
    role,
  })
);

(window as any).electron = {
  readChangelog: async () => ({
    globalNotes: '## [1.2.3] Global updates\n- Global patch note',
    franchiseNotes: '## [1.2.3] Franchise updates\n- Franchise patch note',
    franchiseNoteGroups: [],
  }),
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChangelogModal isOpen initialTab="global" onClose={() => {}} />
  </React.StrictMode>
);
