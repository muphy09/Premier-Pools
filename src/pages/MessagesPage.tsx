import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MessageComposerModal, { type MessageRecipientOption } from '../components/MessageComposerModal';
import MessageDetailModal, { formatMessageDateTime } from '../components/MessageDetailModal';
import TablePagination from '../components/TablePagination';
import {
  listAllFranchises,
  type MasterFranchise,
} from '../services/masterAdminAdapter';
import {
  confirmFranchiseMessage,
  isMessagingFeatureUnavailableError,
  listMessageRecipientOptions,
  listPersonalMessages,
  listSentMessages,
  type FranchiseMessage,
  type MessageListFilter,
} from '../services/messages';
import type { UserSession } from '../services/session';
import './MessagesPage.css';

const PAGE_SIZE = 20;

type MessagesPageProps = {
  session?: UserSession | null;
  adminMode?: boolean;
  masterActingAsOwner?: boolean;
  recipientOptionsLoader?: typeof listMessageRecipientOptions;
};

function getAudienceLabel(message: FranchiseMessage) {
  if (message.audienceType === 'broadcast') return 'Entire Franchise';
  if (message.totalRecipientCount === 1) {
    return message.recipients[0]?.displayName || '1 recipient';
  }
  return `${message.totalRecipientCount} recipients`;
}

function MessagesPage({
  session,
  adminMode = false,
  masterActingAsOwner = false,
  recipientOptionsLoader = listMessageRecipientOptions,
}: MessagesPageProps) {
  const navigate = useNavigate();
  const isMaster = String(session?.role || '').toLowerCase() === 'master';
  const [activeView, setActiveView] = useState<'inbox' | 'sent'>(adminMode ? 'sent' : 'inbox');
  const [messages, setMessages] = useState<FranchiseMessage[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [draftSearch, setDraftSearch] = useState('');
  const [search, setSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState<MessageListFilter>('all');
  const [sentAudienceFilter, setSentAudienceFilter] = useState<'all' | 'broadcast' | 'selected'>('all');
  const [selectedMessage, setSelectedMessage] = useState<FranchiseMessage | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [recipientOptions, setRecipientOptions] = useState<MessageRecipientOption[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsError, setRecipientsError] = useState('');
  const [recipientReloadRequest, setRecipientReloadRequest] = useState(0);
  const [franchises, setFranchises] = useState<MasterFranchise[]>([]);
  const [franchiseFilter, setFranchiseFilter] = useState('all');
  const loadRequestRef = useRef(0);

  const effectiveView = adminMode ? 'sent' : activeView;
  const franchiseId = String(session?.franchiseId || '');
  const showMasterTabs = isMaster && !adminMode;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(draftSearch.trim());
      setCurrentPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draftSearch]);

  useEffect(() => {
    if (!adminMode || !franchiseId || !composerOpen) {
      setRecipientOptions([]);
      setRecipientsLoading(false);
      setRecipientsError('');
      return;
    }
    let cancelled = false;
    setRecipientsLoading(true);
    setRecipientsError('');
    void recipientOptionsLoader(franchiseId)
      .then((recipients) => {
        if (cancelled) return;
        setRecipientOptions(recipients);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Unable to load message recipients:', error);
        setRecipientOptions([]);
        setRecipientsError('Unable to load franchise members. Close this window and try again.');
      })
      .finally(() => {
        if (!cancelled) setRecipientsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminMode, composerOpen, franchiseId, recipientOptionsLoader, recipientReloadRequest]);

  useEffect(() => {
    if (!showMasterTabs) return;
    let cancelled = false;
    void listAllFranchises()
      .then((rows) => {
        if (!cancelled) setFranchises(rows.filter((franchise) => franchise.isActive !== false && !franchise.deletedAt));
      })
      .catch((error) => {
        if (!cancelled) console.warn('Unable to load franchise message filters:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [showMasterTabs]);

  const loadMessages = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setErrorMessage('');
    try {
      const page = effectiveView === 'inbox'
        ? await listPersonalMessages({
            page: currentPage,
            pageSize: PAGE_SIZE,
            filter: inboxFilter,
            search,
          })
        : await listSentMessages({
            franchiseId: adminMode
              ? franchiseId
              : franchiseFilter === 'all'
                ? null
                : franchiseFilter,
            authorAuthUserId: isMaster && !adminMode ? session?.userId : null,
            excludeMasterDirect: adminMode,
            audienceType: sentAudienceFilter === 'all' ? null : sentAudienceFilter,
            page: currentPage,
            pageSize: PAGE_SIZE,
            search,
          });
      if (requestId !== loadRequestRef.current) return;
      setMessages(page.messages);
      setTotalMessages(page.total);
      const totalPages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
      if (currentPage > totalPages) setCurrentPage(totalPages);
    } catch (error: any) {
      if (requestId !== loadRequestRef.current) return;
      console.error('Unable to load messages:', error);
      setMessages([]);
      setTotalMessages(0);
      setErrorMessage(
        isMessagingFeatureUnavailableError(error)
          ? 'Message Center will be available after the messaging database update is deployed.'
          : error?.message || 'Unable to load messages.'
      );
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [adminMode, currentPage, effectiveView, franchiseFilter, franchiseId, inboxFilter, isMaster, search, sentAudienceFilter, session?.userId]);

  useEffect(() => {
    void loadMessages();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadMessages]);

  useEffect(() => {
    setCurrentPage(1);
    setSelectedMessage(null);
  }, [effectiveView, franchiseFilter, inboxFilter, sentAudienceFilter]);

  const franchiseNames = useMemo(
    () => new Map(franchises.map((franchise) => [franchise.id, franchise.name || franchise.franchiseCode || franchise.id])),
    [franchises]
  );

  const totalPages = Math.max(1, Math.ceil(totalMessages / PAGE_SIZE));
  const startIndex = totalMessages ? (currentPage - 1) * PAGE_SIZE : 0;
  const endIndex = Math.min(currentPage * PAGE_SIZE, totalMessages);
  const pageTitle = adminMode ? 'Message Center' : 'Messages';
  const pageSubtitle = adminMode
    ? 'Review franchise communications and delivery status'
    : effectiveView === 'sent'
      ? 'Messages you have sent across franchises'
      : 'Your personal franchise communications';

  const handleConfirm = async (message: FranchiseMessage) => {
    await confirmFranchiseMessage(message.id);
    setSelectedMessage(null);
    await loadMessages();
  };

  return (
    <div className="messages-page">
      <div className="messages-shell">
        <header className="messages-page-header">
          <div>
            <p>{adminMode ? 'Administration' : 'Communications'}</p>
            <h1>{pageTitle}</h1>
            <span>{pageSubtitle}</span>
          </div>
          <div className="messages-page-actions">
            {adminMode && (
              <>
                <button type="button" className="message-button message-button--ghost" onClick={() => navigate('/admin')}>Back to Admin Panel</button>
                <button type="button" className="message-button message-button--primary" onClick={() => setComposerOpen(true)}>Create New Message</button>
              </>
            )}
          </div>
        </header>

        {showMasterTabs && (
          <div className="messages-tabs" role="tablist" aria-label="Message views">
            <button type="button" role="tab" aria-selected={activeView === 'inbox'} className={activeView === 'inbox' ? 'is-active' : ''} onClick={() => setActiveView('inbox')}>Inbox</button>
            <button type="button" role="tab" aria-selected={activeView === 'sent'} className={activeView === 'sent' ? 'is-active' : ''} onClick={() => setActiveView('sent')}>Sent</button>
          </div>
        )}

        <section className="messages-card">
          <div className="messages-toolbar">
            <label className="messages-search">
              <span>Search</span>
              <div>
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></svg>
                <input type="search" value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Search subject, sender, or author" />
              </div>
            </label>
            {effectiveView === 'inbox' && (
              <div className="messages-filter" role="group" aria-label="Inbox filter">
                <button type="button" className={inboxFilter === 'all' ? 'is-active' : ''} onClick={() => setInboxFilter('all')}>All</button>
                <button type="button" className={inboxFilter === 'unread' ? 'is-active' : ''} onClick={() => setInboxFilter('unread')}>Unread</button>
              </div>
            )}
            {effectiveView === 'sent' && (
              <div className="messages-filter" role="group" aria-label="Sent message filter">
                <button type="button" className={sentAudienceFilter === 'all' ? 'is-active' : ''} onClick={() => setSentAudienceFilter('all')}>All</button>
                <button type="button" className={sentAudienceFilter === 'broadcast' ? 'is-active' : ''} onClick={() => setSentAudienceFilter('broadcast')}>Broadcasts</button>
                <button type="button" className={sentAudienceFilter === 'selected' ? 'is-active' : ''} onClick={() => setSentAudienceFilter('selected')}>Direct</button>
              </div>
            )}
            {effectiveView === 'sent' && isMaster && !adminMode && (
              <label className="messages-franchise-filter">
                <span>Franchise</span>
                <select value={franchiseFilter} onChange={(event) => setFranchiseFilter(event.target.value)}>
                  <option value="all">All Franchises</option>
                  {franchises.map((franchise) => (
                    <option key={franchise.id} value={franchise.id}>{franchise.name || franchise.franchiseCode || franchise.id}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="messages-count">{totalMessages.toLocaleString('en-US')} message{totalMessages === 1 ? '' : 's'}</div>
          </div>

          {loading ? (
            <div className="messages-empty"><span className="messages-loading-mark" />Loading messages...</div>
          ) : errorMessage ? (
            <div className="messages-empty messages-empty--error">{errorMessage}</div>
          ) : messages.length === 0 ? (
            <div className="messages-empty">
              <span className="messages-empty-icon" aria-hidden="true">✉</span>
              <strong>{search || inboxFilter === 'unread' ? 'No matching messages' : effectiveView === 'sent' ? 'No messages have been sent yet' : 'Your inbox is clear'}</strong>
              <span>{search || inboxFilter === 'unread' ? 'Try changing the search or filter.' : 'New messages will appear here.'}</span>
            </div>
          ) : (
            <>
              <div className="messages-table-wrapper">
                <table className="messages-table">
                  <thead>
                    <tr>
                      {effectiveView === 'inbox' ? (
                        <>
                          <th className="messages-unread-column"><span className="sr-only">Unread</span></th>
                          <th>Subject</th>
                          <th>Sender</th>
                          <th>Time Sent</th>
                        </>
                      ) : (
                        <>
                          <th>Subject</th>
                          <th>Author</th>
                          {isMaster && !adminMode && <th>Franchise</th>}
                          <th>Audience</th>
                          <th>Total Seen</th>
                          <th>Time Created</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((message) => {
                      const unread = effectiveView === 'inbox' && !message.recipients[0]?.confirmedAt;
                      const seenCount = message.recipients.filter((recipient) => Boolean(recipient.confirmedAt)).length;
                      return (
                        <tr
                          key={message.id}
                          className={unread ? 'is-unread' : ''}
                          tabIndex={0}
                          onClick={() => setSelectedMessage(message)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedMessage(message);
                            }
                          }}
                        >
                          {effectiveView === 'inbox' ? (
                            <>
                              <td className="messages-unread-column">{unread && <span className="messages-unread-dot" title="Unread" />}</td>
                              <td className="messages-subject-cell">{message.subject}</td>
                              <td>{message.senderDisplayName}</td>
                              <td><time>{formatMessageDateTime(message.createdAt)}</time></td>
                            </>
                          ) : (
                            <>
                              <td className="messages-subject-cell">{message.subject}</td>
                              <td>{message.authorDisplayName}</td>
                              {isMaster && !adminMode && <td>{franchiseNames.get(message.franchiseId) || message.franchiseId}</td>}
                              <td><span className={`messages-audience-badge is-${message.audienceType}`}>{getAudienceLabel(message)}</span></td>
                              <td><span className="messages-seen-count">{seenCount}/{message.totalRecipientCount}</span></td>
                              <td><time>{formatMessageDateTime(message.createdAt)}</time></td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <TablePagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalMessages}
                startIndex={startIndex}
                endIndex={endIndex}
                onPageChange={setCurrentPage}
                itemLabel="messages"
              />
            </>
          )}
        </section>
      </div>

      <MessageDetailModal
        message={selectedMessage}
        mode={effectiveView === 'sent' ? 'sent' : 'received'}
        onClose={() => setSelectedMessage(null)}
        onConfirm={handleConfirm}
      />

      {adminMode && (
        <MessageComposerModal
          isOpen={composerOpen}
          franchiseId={franchiseId}
          franchiseName={session?.franchiseName || session?.franchiseCode}
          recipients={recipientOptions}
          recipientsLoading={recipientsLoading}
          recipientsError={recipientsError}
          onRetryRecipients={() => setRecipientReloadRequest((request) => request + 1)}
          allowBroadcast
          actingAsOwner={masterActingAsOwner}
          onClose={() => setComposerOpen(false)}
          onSent={async () => {
            setCurrentPage(1);
            await loadMessages();
          }}
        />
      )}
    </div>
  );
}

export default MessagesPage;
