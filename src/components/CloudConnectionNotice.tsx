import './CloudConnectionNotice.css';

export type CloudConnectionIssue = 'server-issue' | 'no-internet' | null;
type CloudConnectionNoticePlacement = 'bottom' | 'header' | 'inline';

interface CloudConnectionNoticeProps {
  reason: CloudConnectionIssue;
  placement?: CloudConnectionNoticePlacement;
}

export default function CloudConnectionNotice({
  reason,
  placement = 'bottom',
}: CloudConnectionNoticeProps) {
  if (!reason) return null;

  const message =
    reason === 'no-internet'
      ? 'Offline - Changes will be saved locally'
      : 'Cloud connection unavailable - Changes will be saved locally';

  return (
    <div className={`cloud-notice cloud-notice-${reason} cloud-notice-${placement}`}>
      <div className="cloud-notice-indicator" />
      <span className="cloud-notice-text">{message}</span>
    </div>
  );
}
