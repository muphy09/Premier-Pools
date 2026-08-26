import { useEffect, useState, type ReactNode } from 'react';
import { CustomOption } from '../types/proposal-new';
import { getCustomOptionTotal, normalizeCustomOption } from '../utils/customOptions';
import {
  type ProposalNoteCategoryKey,
  type ProposalNoteOverrides,
} from '../utils/proposalNotes';
import ProposalNote from './ProposalNote';
import {
  CustomOffContractEditActions,
  CustomOffContractToggle,
} from './CustomOffContractControls';
import './SectionStyles.css';

interface Props {
  data: CustomOption[];
  onChange: (data: CustomOption[]) => void;
  noteCategoryKey?: ProposalNoteCategoryKey;
  noteOverrides?: ProposalNoteOverrides;
  renderPriceImpact?: (index: number, option: CustomOption) => ReactNode;
  compactToggle?: boolean;
  titleIcon?: ReactNode;
}

function CustomOptionsSection({
  data,
  onChange,
  noteCategoryKey,
  noteOverrides,
  renderPriceImpact,
  compactToggle = false,
  titleIcon,
}: Props) {
  const [activeOptionIndex, setActiveOptionIndex] = useState<number | null>(null);
  const maxOptions = 7;

  const toNumber = (value: any) => Number(value) || 0;
  const formatCurrency = (value?: number) =>
    `$${toNumber(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const optionTotal = (option: CustomOption) => getCustomOptionTotal(option);
  const recalcTotals = (options: CustomOption[]) => {
    const normalized = options.map((option) => normalizeCustomOption(option));
    onChange(normalized);
  };

  useEffect(() => {
    if (activeOptionIndex !== null && activeOptionIndex >= data.length) {
      setActiveOptionIndex(null);
    }
  }, [activeOptionIndex, data.length]);

  const addOption = () => {
    const newOption: CustomOption = {
      name: '',
      description: '',
      laborCost: 0,
      materialCost: 0,
      totalCost: 0,
      isOffContract: false,
    };
    if (data.length >= maxOptions) return;
    const next = [...data, newOption];
    recalcTotals(next);
    setActiveOptionIndex(next.length - 1);
  };

  const updateOption = (index: number, field: keyof CustomOption, value: any) => {
    const updated = data.map((option, i) =>
      i === index ? { ...option, [field]: value } : option,
    );
    recalcTotals(updated);
  };

  const removeOption = (index: number) => {
    const updated = data.filter((_, i) => i !== index);
    recalcTotals(updated);
    setActiveOptionIndex(null);
  };

  const toggleCustomOptions = (checked: boolean) => {
    if (checked) {
      if (data.length === 0) addOption();
      return;
    }
    recalcTotals([]);
    setActiveOptionIndex(null);
  };

  return (
    <div className="spec-block custom-options-block">
      <div className="spec-block-header">
        {compactToggle ? (
          <div className="equipment-category-title-row">
            {titleIcon}
            <div className="equipment-category-title-copy">
              <h2 className="spec-block-title">Custom Options</h2>
            </div>
          </div>
        ) : (
          <h2 className="spec-block-title">Custom Options</h2>
        )}
        {noteCategoryKey && (
          <ProposalNote
            categoryKey={noteCategoryKey}
            subcategoryId="customOptions"
            overrides={noteOverrides}
          />
        )}
      </div>

      {compactToggle && (
        <div className="equipment-selection-controls">
          <div className="equipment-selection-toggle-anchor">
            <label className={`equipment-selection-toggle ${data.length > 0 ? 'is-on' : 'is-off'}`}>
              <span className="equipment-selection-toggle__status">
                {data.length > 0 ? 'Added' : 'Not added'}
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Custom Options selection"
                checked={data.length > 0}
                onChange={(event) => toggleCustomOptions(event.target.checked)}
              />
              <span className="equipment-selection-toggle__track" aria-hidden="true">
                <span className="equipment-selection-toggle__thumb" />
              </span>
            </label>
          </div>
          {data.length > 0 && data.length < maxOptions && (
            <button
              type="button"
              className="action-btn secondary equipment-add-another-btn"
              onClick={addOption}
            >
              Add Another
            </button>
          )}
        </div>
      )}

      {data.map((option, index) => {
        const isEditing = activeOptionIndex === index;
        const total = optionTotal(option);
        const isOffContract = Boolean(option.isOffContract);
        const subtitle = option.description?.trim() || 'No description provided';
        const clippedSubtitle = subtitle.length > 120 ? `${subtitle.slice(0, 120)}...` : subtitle;

        return (
          <div key={index} className="spec-subcard" style={{ marginBottom: '1rem' }}>
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{option.name?.trim() || `Custom Option #${index + 1}`}</div>
                {!isEditing && (
                  <>
                    <div className="spec-subcard-subtitle">{clippedSubtitle}</div>
                    <div className="spec-subcard-subtitle">
                      {isOffContract
                        ? `Off Contract | Total: ${formatCurrency(total)}`
                        : `Labor: ${formatCurrency(option.laborCost)} | Material: ${formatCurrency(
                            option.materialCost
                          )} | Total: ${formatCurrency(total)}`}
                    </div>
                  </>
                )}
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact?.(index, option)}
                  {isEditing && compactToggle && (
                    <CustomOffContractToggle
                      checked={isOffContract}
                      onChange={(checked) => updateOption(index, 'isOffContract', checked)}
                    />
                  )}
                  {isEditing && !compactToggle ? (
                    <CustomOffContractEditActions
                      checked={isOffContract}
                      onChange={(checked) => updateOption(index, 'isOffContract', checked)}
                      onRemove={() => removeOption(index)}
                    />
                  ) : !isEditing ? (
                    <>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setActiveOptionIndex(index)}
                    >
                      Edit
                    </button>
                    {!compactToggle && (
                      <button
                        type="button"
                        className="link-btn danger"
                        onClick={() => removeOption(index)}
                      >
                        Remove
                      </button>
                    )}
                    {compactToggle && index > 0 && (
                      <label className="equipment-selection-toggle equipment-item-toggle is-on">
                        <span className="equipment-selection-toggle__status">Additional</span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-label={`Additional Custom Option ${index} selection`}
                          checked
                          onChange={(event) => {
                            if (!event.target.checked) removeOption(index);
                          }}
                        />
                        <span className="equipment-selection-toggle__track" aria-hidden="true">
                          <span className="equipment-selection-toggle__thumb" />
                        </span>
                      </label>
                    )}
                    </>
                  ) : null}
                </div>
                {!compactToggle && !isEditing && data.length < maxOptions && (
                  <button type="button" className="link-btn small" onClick={addOption}>
                    Add Another
                  </button>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="spec-field" style={{ marginTop: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Custom Option Name</label>
                  <input
                    type="text"
                    className="form-input"
                    value={option.name}
                    onChange={(e) => updateOption(index, 'name', e.target.value)}
                    placeholder="e.g., Specialty item"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-input"
                    value={option.description}
                    onChange={(e) => updateOption(index, 'description', e.target.value)}
                    placeholder="Description of the custom option..."
                    rows={3}
                    style={{ resize: 'vertical' }}
                  />
                </div>

                {isOffContract ? (
                  <div className="form-row custom-option-single-cost-row">
                    <div className="form-group">
                      <label className="form-label">Total Cost</label>
                      <input
                        type="number"
                        className="form-input"
                        value={option.totalCost || ''}
                        onChange={(e) => updateOption(index, 'totalCost', parseFloat(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        placeholder="0"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="form-row">
                    <div className="form-group">
                      <label className="form-label">Labor Cost</label>
                      <input
                        type="number"
                        className="form-input"
                        value={option.laborCost || ''}
                        onChange={(e) => updateOption(index, 'laborCost', parseFloat(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        placeholder="0"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Material Cost</label>
                      <input
                        type="number"
                        className="form-input"
                        value={option.materialCost || ''}
                        onChange={(e) => updateOption(index, 'materialCost', parseFloat(e.target.value) || 0)}
                        min="0"
                        step="0.01"
                        placeholder="0"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Total Cost (Auto)</label>
                      <input
                        type="text"
                        className="form-input"
                        value={formatCurrency(total)}
                        readOnly
                        style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
                      />
                    </div>
                  </div>
                )}

                <div
                  className="action-row"
                  style={{ marginTop: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}
                >
                  <button type="button" className="action-btn" onClick={() => setActiveOptionIndex(null)}>
                    Done
                  </button>
                  {!compactToggle && data.length < maxOptions && (
                    <button type="button" className="action-btn secondary" onClick={addOption}>
                      Add Another
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {!compactToggle && data.length === 0 && data.length < maxOptions && (
        <button type="button" className="btn btn-add" onClick={addOption}>
          + Add Custom Option
        </button>
      )}
      {!compactToggle && data.length > 0 && data.length < maxOptions && activeOptionIndex === null && (
        <button type="button" className="btn btn-add" onClick={addOption} style={{ marginTop: '0.75rem' }}>
          + Add Custom Option
        </button>
      )}
    </div>
  );
}

export default CustomOptionsSection;
