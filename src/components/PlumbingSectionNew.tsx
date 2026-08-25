import { Plumbing, PlumbingRuns } from '../types/proposal-new';
import type { ReactNode } from 'react';
import pricingData from '../services/pricingData';
import {
  getPlumbingPriceImpactTargetKey,
  type PlumbingPriceImpactRunField,
  type PlumbingPriceImpactTarget,
  type PriceImpactResult,
} from '../services/priceImpact';
import { getCustomOptionTotal } from '../utils/customOptions';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import CustomOptionsSection from './CustomOptionsSection';
import PriceImpactPopover from './PriceImpactPopover';
import ProposalNote from './ProposalNote';
import './SectionStyles.css';

interface Props {
  data: Plumbing;
  onChange: (data: Plumbing) => void;
  allowSpaRunInput: boolean;
  hasSpa: boolean;
  additionalPumpCount?: number;
  noteOverrides?: ProposalNoteOverrides;
  priceImpactRequestKey?: string;
  getPlumbingPriceImpact?: (
    target: PlumbingPriceImpactTarget
  ) => PriceImpactResult | Promise<PriceImpactResult>;
}

// Compact input mirrors Pool Specs / Excavation styling with inline unit label
const CompactInput = ({
  type = 'number',
  value,
  onChange,
  unit,
  min,
  step,
  readOnly = false,
  placeholder,
  priceImpact,
}: {
  type?: string;
  value: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  unit?: string;
  min?: string;
  step?: string;
  readOnly?: boolean;
  placeholder?: string;
  priceImpact?: ReactNode;
}) => {
  const displayValue = type === 'number' && value === 0 && !readOnly ? '' : value;
  const finalPlaceholder = placeholder ?? (type === 'number' ? '0' : undefined);

  return (
    <div className={`compact-input-wrapper${priceImpact ? ' has-price-impact' : ''}`}>
      <input
        type={type}
        className="compact-input"
        value={displayValue}
        onChange={onChange}
        min={min}
        step={step}
        readOnly={readOnly}
        placeholder={finalPlaceholder}
        style={readOnly ? { backgroundColor: '#f0f0f0', cursor: 'not-allowed' } : {}}
      />
      {priceImpact ? (
        <span className="plumbing-input-endcap">
          {unit && <span className="compact-input-unit">{unit}</span>}
          {priceImpact}
        </span>
      ) : (
        unit && <span className="compact-input-unit">{unit}</span>
      )}
    </div>
  );
};

function PlumbingSectionNew({
  data,
  onChange,
  allowSpaRunInput,
  hasSpa,
  additionalPumpCount = 0,
  noteOverrides,
  priceImpactRequestKey = '',
  getPlumbingPriceImpact,
}: Props) {
  const handleRunChange = (field: keyof PlumbingRuns, value: number) => {
    onChange({
      ...data,
      runs: { ...data.runs, [field]: value },
    });
  };

  const SKIMMER_THRESHOLD = pricingData.plumbing.poolOverrunThreshold;
  const skimmerOverrun = Math.max(0, (data.runs.skimmerRun || 0) - SKIMMER_THRESHOLD);
  const skimmerOverrunMessage = 'Additional charges apply';
  const activeAdditionalPumpCount = Math.max(0, Math.floor(additionalPumpCount || 0));
  const mainDrainRunMultiplier = 1 + activeAdditionalPumpCount;
  const enteredMainDrainRun = Math.max(0, data.runs.mainDrainRun || 0);
  const billedMainDrainRun = enteredMainDrainRun * mainDrainRunMultiplier;
  const mainDrainHelper =
    activeAdditionalPumpCount > 0
      ? `Main drain to equipment; billed ${mainDrainRunMultiplier} times because ${activeAdditionalPumpCount} additional pump${activeAdditionalPumpCount === 1 ? '' : 's'} ${activeAdditionalPumpCount === 1 ? 'is' : 'are'} selected`
      : 'Main drain to equipment; each added pump repeats this run';

  const renderPriceImpact = (
    target: PlumbingPriceImpactTarget,
    controlLabel: string
  ) => {
    if (!getPlumbingPriceImpact) return null;
    return (
      <PriceImpactPopover
        controlLabel={controlLabel}
        requestKey={`${priceImpactRequestKey}:${getPlumbingPriceImpactTargetKey(target)}`}
        loadImpact={() => getPlumbingPriceImpact(target)}
      />
    );
  };

  const renderRunInput = (
    label: string,
    field: PlumbingPriceImpactRunField,
    helper?: string,
    opts?: { unit?: string; readOnly?: boolean; placeholder?: string }
  ) => {
    const isReadOnly = opts?.readOnly;
    const valueForInput = isReadOnly ? '' : (data.runs[field] ?? 0);
    return (
      <div className="spec-field">
        <label className="spec-label">{label}</label>
        <CompactInput
          value={valueForInput}
          onChange={
            isReadOnly
              ? undefined
              : (e) => handleRunChange(field, parseFloat(e.target.value) || 0)
          }
          unit={opts?.unit ?? 'LNFT'}
          min="0"
          step="1"
          readOnly={isReadOnly}
          placeholder={opts?.placeholder ?? '0'}
          priceImpact={
            !isReadOnly && Number(data.runs[field] || 0) > 0
              ? renderPriceImpact({ kind: 'run', field }, label)
              : null
          }
        />
        {helper && <small className="form-help">{helper}</small>}
      </div>
    );
  };

  return (
    <div className="section-form">
      <div className="spec-block">
        <div className="spec-block-header">
          <h2 className="spec-block-title">Core Plumbing</h2>
          <ProposalNote categoryKey="plumbing" subcategoryId="corePlumbing" overrides={noteOverrides} />
        </div>

        <div className="spec-grid spec-grid-3">
          {renderRunInput('Total Skimmer Run', 'skimmerRun', 'All skimmers to equipment pad')}
          {renderRunInput('Main Drain Run', 'mainDrainRun', mainDrainHelper)}
          {allowSpaRunInput
            ? renderRunInput(
                'Spa Run',
                'spaRun',
                hasSpa ? 'Spa to equipment' : 'Spa to equipment for integrated fiberglass spas'
              )
            : renderRunInput('Spa Run', 'spaRun', 'Enable a spa in Pool Specs to activate', { readOnly: true, placeholder: '0' })}
        </div>

        {activeAdditionalPumpCount > 0 && (
          <div className="info-box" style={{ marginTop: '8px' }}>
            <strong>Main Drain Multiplier:</strong>{' '}
            {enteredMainDrainRun > 0
              ? `${enteredMainDrainRun} LNFT x ${mainDrainRunMultiplier} pump runs = ${billedMainDrainRun} LNFT billed.`
              : `Enter the main drain run once; pricing will bill it ${mainDrainRunMultiplier} times.`}
          </div>
        )}

        {skimmerOverrun > 0 && (
          <div className="info-box" style={{ marginTop: '8px', background: '#fff7ed', borderColor: '#fdba74', color: '#9a3412' }}>
            <strong>Skimmer Overrun:</strong> {skimmerOverrun} ft over {SKIMMER_THRESHOLD} ft maximum. {skimmerOverrunMessage}
          </div>
        )}

        <div className="spec-subcard">
          <div className="spec-subcard-header">
            <h4 className="spec-subcard-title">Additional Skimmers</h4>
            <span className="info-pill">1 skimmer included</span>
          </div>
          <div className="spec-grid">
            <div className="spec-field" style={{ maxWidth: '220px' }}>
              <label className="spec-label">Extra Skimmers</label>
              <CompactInput
                value={data.runs.additionalSkimmers ?? 0}
                onChange={(e) => handleRunChange('additionalSkimmers', parseInt(e.target.value) || 0)}
                unit="ea"
                min="0"
                step="1"
                placeholder="0"
                priceImpact={
                  Number(data.runs.additionalSkimmers || 0) > 0
                    ? renderPriceImpact(
                        { kind: 'run', field: 'additionalSkimmers' },
                        'Extra Skimmers'
                      )
                    : null
                }
              />
              <small className="form-help">Beyond base package</small>
            </div>
          </div>
        </div>
      </div>

      <CustomOptionsSection
        data={data.customOptions || []}
        onChange={(customOptions) => onChange({ ...data, customOptions })}
        noteCategoryKey="plumbing"
        noteOverrides={noteOverrides}
        renderPriceImpact={(index, option) =>
          getCustomOptionTotal(option) > 0
            ? renderPriceImpact(
                { kind: 'customOption', index },
                option.name?.trim() || `Plumbing Custom Option ${index + 1}`
              )
            : null
        }
      />
    </div>
  );
}

export default PlumbingSectionNew;
