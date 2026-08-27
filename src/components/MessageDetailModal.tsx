import { useEffect, useMemo, useState } from 'react';
import type { FranchiseMessage, MessageRecipient } from '../services/messages';
import MessageBody from './MessageBody';
import './MessageUi.css';

type MessageDetailMode = 'received' | 'sent' | 'delivery';

type MessageDetailModalProps = {
  message: FranchiseMessage | null;
  mode: MessageDetailMode;
  onClose?: () => void;
  onConfirm?: (message: FranchiseMessage) => Promise<void>;
};

function formatMessageDateTime(value?: string | null) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatRole(role: string) {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Admin';
  if (role === 'bookkeeper') return 'Book Keeper';
  return 'Designer';
}

function RecipientStatusList({ title, recipients, seen }: { title: string; recipients: MessageRecipient[]; seen: boolean }) {
  return (
    <section className={`message-status-group${seen ? ' is-seen' : ' is-unseen'}`}>
      <header>
        <span className="message-status-dot" aria-hidden="true" />
        <h4>{title}</h4>
        <strong>{recipients.length}</strong>
      </header>
      <div className="message-status-list">
        {recipients.map((recipient) => (
          <div className="message-status-row" key={`${recipient.messageId}-${recipient.authUserId}`}>
            <span className="message-recipient-avatar">{recipient.displayName.charAt(0).toUpperCase()}</span>
            <span>
              <strong>{recipient.displayName}</strong>
              <small>{recipient.email || formatRole(recipient.role)} · {formatRole(recipient.role)}</small>
            </span>
            <time>{seen ? formatMessageDateTime(recipient.confirmedAt) : 'Awaiting confirmation'}</time>
          </div>
        ))}
        {recipients.length === 0 && <div className="message-status-empty">No recipients in this group.</div>}
      </div>
    </section>
  );
}

function MessageDetailModal({ message, mode, onClose, onConfirm }: MessageDetailModalProps) {
  const ownRecipient = message?.recipients[0];
  const needsConfirmation = mode !== 'sent' && !ownRecipient?.confirmedAt;
  const dismissible = !needsConfirmation && mode !== 'delivery';
  const [confirmationEnabled, setConfirmationEnabled] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    setConfirmationEnabled(false);
    setConfirming(false);
    setErrorMessage('');
    if (!message || !needsConfirmation) return;
    const timer = window.setTimeout(() => setConfirmationEnabled(true), 2000);
    return () => window.clearTimeout(timer);
  }, [message?.id, needsConfirmation]);

  useEffect(() => {
    if (!message || !dismissible || !onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dismissible, message, onClose]);

  const recipientGroups = useMemo(() => {
    const recipients = message?.recipients || [];
    return {
      seen: recipients.filter((recipient) => Boolean(recipient.confirmedAt)),
      unseen: recipients.filter((recipient) => !recipient.confirmedAt),
    };
  }, [message]);

  if (!message) return null;

  const handleConfirm = async () => {
    if (!confirmationEnabled || confirming || !onConfirm) return;
    setConfirming(true);
    setErrorMessage('');
    try {
      await onConfirm(message);
    } catch (error: any) {
      console.error('Unable to confirm message:', error);
      setErrorMessage(error?.message || 'Unable to confirm this message. Check your connection and try again.');
      setConfirming(false);
    }
  };

  return (
    <div
      className={`message-modal-backdrop${mode === 'delivery' ? ' message-delivery-backdrop' : ''}`}
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose?.();
      }}
    >
      <section
        className={`message-detail-modal message-detail-modal--${mode}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="message-modal-header message-detail-header">
          <div className="message-detail-heading">
            <span className={`message-sender-mark is-${message.senderType}`} aria-hidden="true">
              {message.senderType === 'franchise' ? 'F' : message.senderDisplayName.charAt(0).toUpperCase()}
            </span>
            <div>
              <p>{mode === 'sent' ? 'Sent Message' : `From ${message.senderDisplayName}`}</p>
              <h2 id="message-detail-title">{message.subject}</h2>
            </div>
          </div>
          {dismissible && (
            <button type="button" className="message-icon-button" onClick={onClose} aria-label="Close message">×</button>
          )}
        </header>

        <div className={`message-detail-meta message-detail-meta--${mode}`}>
          <span><strong>Sender</strong>{message.senderDisplayName}</span>
          {mode === 'sent' && <span><strong>Author</strong>{message.authorDisplayName}</span>}
          <span><strong>Sent</strong>{formatMessageDateTime(message.createdAt)}</span>
          <span>
            <strong>Audience</strong>
            {message.audienceType === 'broadcast' ? 'Entire Franchise' : `${message.totalRecipientCount} selected recipient${message.totalRecipientCount === 1 ? '' : 's'}`}
          </span>
        </div>

        <div className="message-detail-scroll">
          <MessageBody document={message.bodyDocument} plainText={message.bodyPlainText} />

          {mode === 'sent' && (
            <div className="message-delivery-status">
              <div className="message-delivery-status__summary">
                <div>
                  <span>Confirmed</span>
                  <strong>{recipientGroups.seen.length} / {message.totalRecipientCount}</strong>
                </div>
                <div className="message-progress-track" aria-hidden="true">
                  <span style={{ width: `${message.totalRecipientCount ? (recipientGroups.seen.length / message.totalRecipientCount) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="message-status-columns">
                <RecipientStatusList title="Seen" recipients={recipientGroups.seen} seen />
                <RecipientStatusList title="Not Seen" recipients={recipientGroups.unseen} seen={false} />
              </div>
            </div>
          )}

          {errorMessage && <div className="message-inline-error" role="alert">{errorMessage}</div>}
        </div>

        {needsConfirmation && (
          <footer className="message-confirm-footer">
            <span>{confirmationEnabled ? 'Please confirm that you have read this message.' : 'Confirm will be available in a moment…'}</span>
            <button
              type="button"
              className="message-button message-button--primary"
              disabled={!confirmationEnabled || confirming}
              onClick={() => void handleConfirm()}
            >
              {confirming ? 'Confirming...' : 'Confirm'}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}

export { formatMessageDateTime };
export default MessageDetailModal;
