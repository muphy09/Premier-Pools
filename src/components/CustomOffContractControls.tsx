interface CustomOffContractToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function CustomOffContractToggle({
  checked,
  onChange,
  label = 'Off-contract',
}: CustomOffContractToggleProps) {
  return (
    <label className="custom-option-toggle">
      <span className="custom-option-toggle-label">{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="custom-option-toggle-track" aria-hidden="true">
        <span className="custom-option-toggle-thumb" />
      </span>
    </label>
  );
}

interface CustomOffContractEditActionsProps extends CustomOffContractToggleProps {
  onRemove: () => void;
}

export function CustomOffContractEditActions({
  checked,
  onChange,
  onRemove,
}: CustomOffContractEditActionsProps) {
  return (
    <div className="stacked-primary-actions custom-option-edit-actions">
      <CustomOffContractToggle checked={checked} onChange={onChange} />
      <span className="custom-option-action-divider" aria-hidden="true" />
      <button type="button" className="custom-option-remove-btn" onClick={onRemove}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h16" />
          <path d="M9 7V4h6v3" />
          <path d="M7 7l1 13h8l1-13" />
          <path d="M10 11v5M14 11v5" />
        </svg>
        <span>Remove</span>
      </button>
    </div>
  );
}
