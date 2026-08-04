import { useState } from 'react';
import './LoginModal.css';

type LoginPayload = {
  email: string;
  password: string;
  franchiseCode?: string;
};

interface LoginModalProps {
  onSubmit: (payload: LoginPayload) => Promise<void>;
  existingEmail?: string;
}

const LoginModal = ({ onSubmit, existingEmail }: LoginModalProps) => {
  const [email, setEmail] = useState(existingEmail || '');
  const [password, setPassword] = useState('');
  const [franchiseCode, setFranchiseCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }

    try {
      setLoading(true);
      await onSubmit({
        email: email.trim(),
        password: password.trim(),
        franchiseCode: franchiseCode.trim() || undefined,
      });
    } catch (err: any) {
      setError(err?.message || 'Unable to log in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-modal-backdrop" data-scroll-lock="true">
      <div className="login-modal">
        <h2>Welcome</h2>
        <p className="login-subtitle">Enter your email, password, and franchise code to continue.</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label className="login-label">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="login-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="login-label">
            Franchise Code
            <input
              type="text"
              value={franchiseCode}
              onChange={(e) => setFranchiseCode(e.target.value)}
            />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginModal;
