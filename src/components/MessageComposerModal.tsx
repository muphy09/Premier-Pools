import { useEffect, useMemo, useState } from 'react';
import MessageRichTextEditor from './MessageRichTextEditor';
import { sendFranchiseMessage, type MessageAudienceType } from '../services/messages';
import {
  createMessageDocument,
  MESSAGE_SUBJECT_MAX_LENGTH,
} from '../utils/messageRichText';
import './MessageUi.css';

export type MessageRecipientOption = {
  id: string;
  displayName: string;
  email?: string | null;
  role: string;
};

type MessageComposerModalProps = {
  isOpen: boolean;
  franchiseId: string;
  franchiseName?: string | null;
  recipients: MessageRecipientOption[];
  recipientsLoading?: boolean;
  recipientsError?: string | null;
  onRetryRecipients?: () => void;
  allowBroadcast?: boolean;
  lockedRecipientIds?: string[];
  actingAsOwner?: boolean;
  onClose: () => void;
  onSent?: (messageId: string) => void | Promise<void>;
};

function formatRole(role: string) {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'bookkeeper') return 'Book Keeper';
  return 'Designer';
}

function MessageComposerModal({
  isOpen,
  franchiseId,
  franchiseName,
  recipients,
  recipientsLoading = false,
  recipientsError = null,
  onRetryRecipients,
  allowBroadcast = true,
  lockedRecipientIds = [],
  actingAsOwner = false,
  onClose,
  onSent,
}: MessageComposerModalProps) {
  const [subject, setSubject] = useState('');
  const [messageHtml, setMessageHtml] = useState('');
  const [messagePlainText, setMessagePlainText] = useState('');
  const [audienceType, setAudienceType] = useState<MessageAudienceType>(allowBroadcast ? 'broadcast' : 'selected');
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>(lockedRecipientIds);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setSubject('');
    setMessageHtml('');
    setMessagePlainText('');
    setAudienceType(allowBroadcast ? 'broadcast' : 'selected');
    setSelectedRecipientIds(lockedRecipientIds);
    setRecipientSearch('');
    setSending(false);
    setErrorMessage('');
  }, [allowBroadcast, isOpen, lockedRecipientIds.join('|')]);

  useEffect(() => {
    if (!isOpen || sending) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, sending]);

  const lockedRecipients = useMemo(
    () => recipients.filter((recipient) => lockedRecipientIds.includes(recipient.id)),
    [lockedRecipientIds, recipients]
  );
  const normalizedSearch = recipientSearch.trim().toLowerCase();
  const filteredRecipients = useMemo(
    () => recipients.filter((recipient) => {
      if (!normalizedSearch) return true;
      return [recipient.displayName, recipient.email]
        .some((value) => String(value || '').toLowerCase().includes(normalizedSearch));
    }),
    [normalizedSearch, recipients]
  );

  if (!isOpen) return null;

  const isRecipientLocked = lockedRecipientIds.length > 0;
  const canSend =
    subject.trim().length > 0 &&
    messagePlainText.trim().length > 0 &&
    (audienceType === 'broadcast' || selectedRecipientIds.length > 0) &&
    !sending;

  const toggleRecipient = (recipientId: string) => {
    if (isRecipientLocked) return;
    setSelectedRecipientIds((current) =>
      current.includes(recipientId)
        ? current.filter((id) => id !== recipientId)
        : [...current, recipientId]
    );
  };

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setErrorMessage('');
    try {
      const messageId = await sendFranchiseMessage({
        franchiseId,
        subject: subject.trim(),
        bodyDocument: createMessageDocument(messageHtml),
        bodyPlainText: messagePlainText.trim(),
        audienceType,
        recipientProfileIds: audienceType === 'selected' ? selectedRecipientIds : undefined,
        sendAsFranchise: audienceType === 'broadcast',
        actingAsOwner,
      });
      await onSent?.(messageId);
      onClose();
    } catch (error: any) {
      console.error('Unable to send message:', error);
      setErrorMessage(error?.message || 'Unable to send the message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="message-modal-backdrop message-composer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !sending) onClose();
      }}
    >
      <section
        className="message-composer-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-composer-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="message-modal-header message-composer-header">
          <div>
            <p>Message Center</p>
            <h2 id="message-composer-title">Create New Message</h2>
          </div>
          <button type="button" className="message-icon-button" onClick={onClose} disabled={sending} aria-label="Close message composer">×</button>
        </header>

        <div className="message-composer-body">
          <label className="message-field">
            <span>Subject</span>
            <input
              type="text"
              value={subject}
              maxLength={MESSAGE_SUBJECT_MAX_LENGTH}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Enter a clear subject"
              autoFocus
              disabled={sending}
            />
            <small>{subject.length} / {MESSAGE_SUBJECT_MAX_LENGTH}</small>
          </label>

          {allowBroadcast && !isRecipientLocked && (
            <fieldset className="message-audience-choice">
              <legend>Recipients</legend>
              <button
                type="button"
                className={audienceType === 'broadcast' ? 'is-active' : ''}
                onClick={() => setAudienceType('broadcast')}
                disabled={sending}
              >
                <strong>Entire Franchise</strong>
                <span>Send as {franchiseName || 'the franchise'} to all active users</span>
              </button>
              <button
                type="button"
                className={audienceType === 'selected' ? 'is-active' : ''}
                onClick={() => setAudienceType('selected')}
                disabled={sending}
              >
                <strong>Selected Members</strong>
                <span>Send under your name to one or more users</span>
              </button>
            </fieldset>
          )}

          {isRecipientLocked && (
            <div className="message-fixed-recipient">
              <span>To</span>
              {lockedRecipients.map((recipient) => (
                <strong key={recipient.id}>{recipient.displayName}</strong>
              ))}
            </div>
          )}

          {audienceType === 'selected' && !isRecipientLocked && (
            <div className="message-recipient-picker">
              <div className="message-recipient-picker__heading">
                <label className="message-field message-field--search">
                  <span>Choose Members</span>
                  <input
                    type="search"
                    value={recipientSearch}
                    onChange={(event) => setRecipientSearch(event.target.value)}
                    placeholder="Search by name or email"
                    disabled={sending}
                  />
                </label>
                <span className="message-selection-count">{selectedRecipientIds.length} selected</span>
              </div>
              <div className="message-recipient-options">
                {recipientsLoading && (
                  <div className="message-picker-empty" role="status">Loading franchise members...</div>
                )}
                {!recipientsLoading && recipientsError && (
                  <div className="message-picker-empty message-picker-empty--error" role="alert">
                    <span>{recipientsError}</span>
                    {onRetryRecipients && (
                      <button type="button" onClick={onRetryRecipients} disabled={sending}>Try Again</button>
                    )}
                  </div>
                )}
                {!recipientsLoading && !recipientsError && filteredRecipients.map((recipient) => {
                  const checked = selectedRecipientIds.includes(recipient.id);
                  return (
                    <label key={recipient.id} className={`message-recipient-option${checked ? ' is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRecipient(recipient.id)}
                        disabled={sending}
                      />
                      <span className="message-recipient-avatar">{recipient.displayName.charAt(0).toUpperCase()}</span>
                      <span className="message-recipient-copy">
                        <strong>{recipient.displayName}</strong>
                        <small>{recipient.email || formatRole(recipient.role)} · {formatRole(recipient.role)}</small>
                      </span>
                    </label>
                  );
                })}
                {!recipientsLoading && !recipientsError && filteredRecipients.length === 0 && (
                  <div className="message-picker-empty">No active members match that search.</div>
                )}
              </div>
            </div>
          )}

          <label className="message-field">
            <span>Message</span>
            <MessageRichTextEditor
              value={messageHtml}
              onChange={(html, plainText) => {
                setMessageHtml(html);
                setMessagePlainText(plainText);
              }}
              disabled={sending}
            />
          </label>

          {errorMessage && <div className="message-inline-error" role="alert">{errorMessage}</div>}
        </div>

        <footer className="message-composer-footer">
          <span>
            {audienceType === 'broadcast'
              ? `${recipients.length} active franchise member${recipients.length === 1 ? '' : 's'}`
              : `${selectedRecipientIds.length} selected recipient${selectedRecipientIds.length === 1 ? '' : 's'}`}
          </span>
          <div>
            <button type="button" className="message-button message-button--ghost" onClick={onClose} disabled={sending}>Cancel</button>
            <button type="button" className="message-button message-button--primary" onClick={() => void handleSend()} disabled={!canSend}>
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export default MessageComposerModal;
