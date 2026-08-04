import { useState } from 'react';
import './PasswordResetModal.css';

type PasswordResetModalProps = {
  onSubmit: (newPassword: string) => Promise<void>;
  onLogout?: () => void;
};

const PasswordResetModal = ({ onSubmit, onLogout }: PasswordResetModalProps) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!password.trim()) {
      setError('Please enter a new password.');
      return;
    }
    if (password.trim() !== confirmPassword.trim()) {
      setError('Passwords do not match.');
      return;
    }
    try {
      setLoading(true);
      await onSubmit(password.trim());
    } catch (err: any) {
      setError(err?.message || 'Unable to update password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="password-reset-backdrop" data-scroll-lock="true">
      <div className="password-reset-modal">
        <h2>Set a New Password</h2>
        <p className="password-reset-subtitle">
          You signed in with a temporary password. Please set a new password to continue.
        </p>
        <form onSubmit={handleSubmit} className="password-reset-form">
          <label className="password-reset-label">
            New Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </label>
          <label className="password-reset-label">
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
            />
          </label>
          {error && <div className="password-reset-error">{error}</div>}
          <div className="password-reset-actions">
            {onLogout && (
              <button
                className="password-reset-secondary"
                type="button"
                onClick={onLogout}
                disabled={loading}
              >
                Logout
              </button>
            )}
            <button className="password-reset-primary" type="submit" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PasswordResetModal;
