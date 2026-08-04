import { useState } from 'react';
import './TempPasswordModal.css';

type TempPasswordModalProps = {
  title?: string;
  description?: string;
  tempPassword: string;
  onClose: () => void;
};

const TempPasswordModal = ({ title, description, tempPassword, onClose }: TempPasswordModalProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setCopied(false);
    }
  };

  return (
    <div className="temp-password-backdrop" data-scroll-lock="true">
      <div className="temp-password-modal">
        <h2>{title || 'Temporary Password'}</h2>
        <p className="temp-password-subtitle">
          {description || 'Copy this password now. It will only be shown once.'}
        </p>
        <div className="temp-password-box">
          <span className="temp-password-value">{tempPassword}</span>
          <button type="button" className="temp-password-copy" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <button type="button" className="temp-password-close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
};

export default TempPasswordModal;
