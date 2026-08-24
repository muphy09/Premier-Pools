import { useEffect, useState } from 'react';
import { CustomOption } from '../types/proposal-new';
import { getCustomOptionTotal, normalizeCustomOption } from '../utils/customOptions';
import {
  type ProposalNoteCategoryKey,
  type ProposalNoteOverrides,
} from '../utils/proposalNotes';
import ProposalNote from './ProposalNote';
import { CustomOffContractEditActions } from './CustomOffContractControls';
import './SectionStyles.css';

interface Props {
  data: CustomOption[];
  onChange: (data: CustomOption[]) => void;
  noteCategoryKey?: ProposalNoteCategoryKey;
  noteOverrides?: ProposalNoteOverrides;
}

function CustomOptionsSection({ data, onChange, noteCategoryKey, noteOverrides }: Props) {
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

  return (
    <div className="spec-block custom-options-block">
      <div className="spec-block-header">
        <h2 className="spec-block-title">Custom Options</h2>
        {noteCategoryKey && (
          <ProposalNote
            categoryKey={noteCategoryKey}
            subcategoryId="customOptions"
            overrides={noteOverrides}
          />
        )}
      </div>

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
                {isEditing ? (
                  <CustomOffContractEditActions
                    checked={isOffContract}
                    onChange={(checked) => updateOption(index, 'isOffContract', checked)}
                    onRemove={() => removeOption(index)}
                  />
                ) : (
                  <div className="stacked-primary-actions">
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setActiveOptionIndex(index)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => removeOption(index)}
                    >
                      Remove
                    </button>
                  </div>
                )}
                {!isEditing && data.length < maxOptions && (
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
                  {data.length < maxOptions && (
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

      {data.length === 0 && data.length < maxOptions && (
        <button type="button" className="btn btn-add" onClick={addOption}>
          + Add Custom Option
        </button>
      )}
      {data.length > 0 && data.length < maxOptions && activeOptionIndex === null && (
        <button type="button" className="btn btn-add" onClick={addOption} style={{ marginTop: '0.75rem' }}>
          + Add Custom Option
        </button>
      )}
    </div>
  );
}

export default CustomOptionsSection;
