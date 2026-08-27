import { useEffect, useState, type ReactNode } from 'react';
import { InteriorFinish, InteriorFinishType } from '../types/proposal-new';
import pricingData from '../services/pricingData';
import { subscribeToPricingData } from '../services/pricingDataStore';
import {
  getInteriorFinishPriceImpactTargetKey,
  type InteriorFinishPriceImpactTarget,
  type PriceImpactResult,
} from '../services/priceImpact';
import { getCustomOptionTotal } from '../utils/customOptions';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import CustomOptionsSection from './CustomOptionsSection';
import { TooltipAnchor } from './AppTooltip';
import PriceImpactPopover from './PriceImpactPopover';
import ProposalNote from './ProposalNote';
import './SectionStyles.css';
import { isBronzePricingTier } from '../services/pricingTiers';

interface Props {
  data: InteriorFinish;
  onChange: (data: InteriorFinish) => void;
  hasSpa: boolean;
  isFiberglass: boolean;
  supportsMicroglass?: boolean;
  colorFieldLabel?: string;
  includeAssignLaterColor?: boolean;
  pricingTierId?: string;
  noteOverrides?: ProposalNoteOverrides;
  priceImpactRequestKey?: string;
  getInteriorFinishPriceImpact?: (
    target: InteriorFinishPriceImpactTarget
  ) => PriceImpactResult | Promise<PriceImpactResult>;
}

const CompactSelect = ({
  value,
  onChange,
  disabled,
  children,
  priceImpact,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  children: ReactNode;
  priceImpact?: ReactNode;
}) => (
  <div className={`compact-input-wrapper${priceImpact ? ' has-price-impact' : ''}`}>
    <select
      className="compact-input"
      value={value}
      onChange={onChange}
      disabled={disabled}
    >
      {children}
    </select>
    {priceImpact && <span className="compact-input-endcap">{priceImpact}</span>}
  </div>
);

function InteriorFinishSectionNew({
  data,
  onChange,
  hasSpa,
  isFiberglass,
  supportsMicroglass = true,
  colorFieldLabel = 'Color / Style',
  includeAssignLaterColor = false,
  pricingTierId,
  noteOverrides,
  priceImpactRequestKey,
  getInteriorFinishPriceImpact,
}: Props) {
  const [finishes, setFinishes] = useState(pricingData.interiorFinish.finishes || []);
  const fiberglassDisabledMessage = 'Cannot be adjusted, Fiberglass selected';
  const isBronzeTier = isBronzePricingTier(pricingTierId);

  useEffect(() => {
    const unsubscribe = subscribeToPricingData((snapshot) => {
      setFinishes(snapshot.interiorFinish.finishes || []);
    });
    return unsubscribe;
  }, []);

  const configuredFinish = finishes.find(
    (finish) => finish.id === data.finishType || finish.name === data.finishType
  );
  const selectedFinish = configuredFinish || finishes[0];
  const effectiveFinishType = selectedFinish?.id || data.finishType || '';
  const finishTypes: { value: InteriorFinishType; label: string }[] =
    finishes.length > 0
      ? finishes.map((finish) => ({
          value: finish.id,
          label: finish.name,
        }))
      : data.finishType
        ? [{ value: data.finishType, label: data.finishType }]
        : [{ value: '', label: 'No finishes configured' }];
  const rawColors = selectedFinish?.colors as any;
  const configuredColorOptions = Array.isArray(rawColors)
    ? rawColors
    : typeof rawColors === 'string'
      ? rawColors.split(',').map((c: string) => c.trim()).filter(Boolean)
      : [];
  const colorOptions = includeAssignLaterColor
    ? [
        'Assign Later',
        ...configuredColorOptions.filter(
          (color) => String(color || '').trim().toLowerCase() !== 'assign later'
        ),
      ]
    : configuredColorOptions;
  const colorMatchesOption = colorOptions.some(
    (option) => option.toLowerCase() === (data.color || '').toLowerCase()
  );
  const selectedColorValue = colorMatchesOption ? data.color : '';

  const includeMicroglass = supportsMicroglass && !isBronzeTier && (data.hasWaterproofing ?? true);

  const handleChange = (field: keyof InteriorFinish, value: any) => {
    onChange({ ...data, [field]: value });
  };
  const handleFinishChange = (finishType: InteriorFinishType) => {
    const finish = finishes.find((entry) => entry.id === finishType);
    const rawNextColors = finish?.colors as any;
    const nextConfiguredColors = Array.isArray(rawNextColors)
      ? rawNextColors
      : typeof rawNextColors === 'string'
        ? rawNextColors.split(',').map((color: string) => color.trim()).filter(Boolean)
        : [];
    const nextColors = includeAssignLaterColor
      ? [
          'Assign Later',
          ...nextConfiguredColors.filter(
            (color) => String(color || '').trim().toLowerCase() !== 'assign later'
          ),
        ]
      : nextConfiguredColors;
    onChange({
      ...data,
      finishType,
      color: nextColors[0] || '',
      hasSpa,
    });
  };
  const renderPriceImpact = (
    target: InteriorFinishPriceImpactTarget,
    controlLabel: string
  ) => {
    if (!getInteriorFinishPriceImpact) return null;
    return (
      <PriceImpactPopover
        controlLabel={controlLabel}
        requestKey={`${priceImpactRequestKey}:${getInteriorFinishPriceImpactTargetKey(target)}`}
        loadImpact={() => getInteriorFinishPriceImpact(target)}
      />
    );
  };

  return (
    <div className="section-form">
      <div className="spec-block">
        <div className="spec-block-header">
          <h2 className="spec-block-title">Finish Type</h2>
          <ProposalNote categoryKey="interiorFinish" subcategoryId="finishType" overrides={noteOverrides} />
        </div>

        {isFiberglass && (
          <div
            className="info-box"
            style={{ marginBottom: '12px', background: '#eff6ff', borderColor: '#93c5fd', color: '#1d4ed8' }}
          >
            Interior finish pricing does not apply to Fiberglass Shells.
          </div>
        )}

        <div className="spec-grid spec-grid-2">
          <div className="spec-field">
            <label className="spec-label required">Finish</label>
            <TooltipAnchor as="div" tooltip={isFiberglass ? fiberglassDisabledMessage : undefined}>
              <CompactSelect
                value={effectiveFinishType}
                onChange={(e) => handleFinishChange(e.target.value as InteriorFinishType)}
                disabled={isFiberglass}
                priceImpact={
                  !isFiberglass && configuredFinish
                    ? renderPriceImpact({ kind: 'finishType' }, selectedFinish?.name || 'Interior Finish')
                    : null
                }
              >
                {finishTypes.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </CompactSelect>
            </TooltipAnchor>
          </div>

          <div className="spec-field">
            <label className="spec-label">{colorFieldLabel}</label>
            <TooltipAnchor as="div" tooltip={isFiberglass ? fiberglassDisabledMessage : undefined}>
              <select
                className="compact-input"
                value={selectedColorValue || ''}
                onChange={(e) => handleChange('color', e.target.value)}
                disabled={isFiberglass}
              >
                <option value="" disabled>
                  Select color/style
                </option>
                {colorOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {colorOptions.length === 0 && <option value="">No colors configured</option>}
              </select>
            </TooltipAnchor>
          </div>

        </div>
      </div>

      {supportsMicroglass && (
        <div className="spec-block interior-finish-additional-options-card">
          <div className="spec-block-header">
            <h2 className="spec-block-title">Additional Options</h2>
            <ProposalNote
              categoryKey="interiorFinish"
              subcategoryId="additionalOptions"
              overrides={noteOverrides}
            />
          </div>
          <div className="excavation-option-list">
            <div className={`excavation-option-row${isFiberglass || isBronzeTier ? ' is-disabled' : ''}`}>
              <div className="excavation-option-copy">
                <span className="excavation-option-title">
                  Microglass (Waterproofing)
                </span>
                <div className="spec-subcard-subtitle">
                  Enable or Disable Microglass
                </div>
              </div>
              <div className="excavation-option-actions">
                {includeMicroglass && !isFiberglass && !isBronzeTier
                  ? renderPriceImpact(
                      { kind: 'waterproofing' },
                      'Microglass (Waterproofing)'
                    )
                  : null}
                <TooltipAnchor
                  tooltip={
                    isFiberglass
                      ? fiberglassDisabledMessage
                      : isBronzeTier
                        ? 'Microglass is not available in Bronze pricing.'
                        : undefined
                  }
                >
                  <label
                    className={`equipment-selection-toggle ${includeMicroglass ? 'is-on' : 'is-off'}${
                      isFiberglass || isBronzeTier ? ' is-disabled' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Microglass (Waterproofing)"
                      checked={includeMicroglass}
                      disabled={isFiberglass || isBronzeTier}
                      onChange={(event) =>
                        handleChange('hasWaterproofing', event.target.checked)
                      }
                    />
                    <span className="equipment-selection-toggle__track" aria-hidden="true">
                      <span className="equipment-selection-toggle__thumb" />
                    </span>
                  </label>
                </TooltipAnchor>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isFiberglass && (
        <CustomOptionsSection
          data={data.customOptions || []}
          onChange={(customOptions) => onChange({ ...data, customOptions })}
          noteCategoryKey="interiorFinish"
          noteOverrides={noteOverrides}
          compactToggle
          renderPriceImpact={(index, option) =>
            getCustomOptionTotal(option) > 0
              ? renderPriceImpact(
                  { kind: 'customOption', index },
                  option.name?.trim() || `Interior Finish Custom Option ${index + 1}`
                )
              : null
          }
        />
      )}
    </div>
  );
}

export default InteriorFinishSectionNew;
