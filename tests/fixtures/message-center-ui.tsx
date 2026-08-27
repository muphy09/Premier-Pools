import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import MessageComposerModal from '../../src/components/MessageComposerModal';
import MessageDetailModal from '../../src/components/MessageDetailModal';
import MessagesPage from '../../src/pages/MessagesPage';
import type { FranchiseMessage } from '../../src/services/messages';
import '../../src/index.css';

declare global {
  interface Window {
    messageConfirmed: boolean;
  }
}

window.messageConfirmed = false;

const baseMessage: FranchiseMessage = {
  id: 'message-1',
  franchiseId: 'franchise-1',
  subject: 'Pool season readiness update',
  bodyDocument: {
    version: 1,
    html: '<p>Please review the <strong>updated opening checklist</strong>.</p><ul><li>Confirm equipment</li><li>Contact customers</li></ul><img src="x" onerror="window.messageConfirmed=true"><script>window.messageConfirmed=true</script>',
  },
  bodyPlainText: 'Please review the updated opening checklist. Confirm equipment. Contact customers.',
  audienceType: 'broadcast',
  senderType: 'franchise',
  senderDisplayName: 'PPAS West',
  authorAuthUserId: 'author-1',
  authorProfileId: 'profile-author-1',
  authorDisplayName: 'Alex Owner',
  authorEmail: 'alex@example.com',
  authorRole: 'owner',
  totalRecipientCount: 2,
  createdAt: '2026-08-26T18:24:00.000Z',
  recipients: [
    {
      messageId: 'message-1',
      franchiseId: 'franchise-1',
      authUserId: 'recipient-1',
      profileId: 'profile-1',
      displayName: 'Jordan Designer',
      email: 'jordan@example.com',
      role: 'designer',
      messageCreatedAt: '2026-08-26T18:24:00.000Z',
      confirmedAt: null,
    },
    {
      messageId: 'message-1',
      franchiseId: 'franchise-1',
      authUserId: 'recipient-2',
      profileId: 'profile-2',
      displayName: 'Taylor Admin',
      email: 'taylor@example.com',
      role: 'admin',
      messageCreatedAt: '2026-08-26T18:24:00.000Z',
      confirmedAt: '2026-08-26T18:30:00.000Z',
    },
  ],
};

function Fixture() {
  const mode = new URLSearchParams(window.location.search).get('mode') || 'delivery';
  const [message, setMessage] = useState<FranchiseMessage | null>(baseMessage);

  if (mode === 'composer') {
    return (
      <MessageComposerModal
        isOpen
        franchiseId="franchise-1"
        franchiseName="PPAS West"
        recipients={[
          { id: 'profile-1', displayName: 'Jordan Designer', email: 'jordan@example.com', role: 'designer' },
          { id: 'profile-2', displayName: 'Taylor Admin', email: 'taylor@example.com', role: 'admin' },
        ]}
        onClose={() => {}}
      />
    );
  }

  if (mode === 'owner-composer') {
    return (
      <MemoryRouter initialEntries={['/admin/messages']}>
        <MessagesPage
          session={{
            userId: 'master-auth-1',
            userName: 'Master User',
            role: 'owner',
            franchiseId: 'franchise-1',
            franchiseName: 'PPAS West',
            franchiseCode: '5555',
          }}
          adminMode
          masterActingAsOwner
          recipientOptionsLoader={async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            return [
              { id: 'profile-dedra', displayName: 'Dedra Erwin', email: 'dedra@example.com', role: 'designer' },
              { id: 'profile-john', displayName: 'John Neely', email: 'john@example.com', role: 'designer' },
            ];
          }}
        />
      </MemoryRouter>
    );
  }

  return (
    <MessageDetailModal
      message={message}
      mode={mode === 'sent' ? 'sent' : 'delivery'}
      onClose={() => setMessage(null)}
      onConfirm={async () => {
        window.messageConfirmed = true;
        setMessage(null);
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Fixture />);
