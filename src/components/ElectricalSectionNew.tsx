import type { ReactNode } from 'react';
import { Electrical, ElectricalRuns, PlumbingRuns, WaterFeatures } from '../types/proposal-new';
import pricingData from '../services/pricingData';
import {
  getElectricalPriceImpactTargetKey,
  type ElectricalPriceImpactTarget,
  type PriceImpactResult,
} from '../services/priceImpact';
import { getCustomOptionTotal } from '../utils/customOptions';
import { getDerivedWaterFeatureGasRunTotal, getTotalGasRunForBilling } from '../utils/waterFeatureCost';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import CustomOptionsSection from './CustomOptionsSection';
import PriceImpactPopover from './PriceImpactPopover';
import ProposalNote from './ProposalNote';
import './SectionStyles.css';

interface Props {
  data: Electrical;
  onChange: (data: Electrical) => void;
  plumbingRuns: PlumbingRuns;
  waterFeatures: WaterFeatures;
  onChangePlumbingRuns: (runs: Partial<PlumbingRuns>) => void;
  hasSpa: boolean;
  noteOverrides?: ProposalNoteOverrides;
  priceImpactRequestKey?: string;
  getElectricalPriceImpact?: (
    target: ElectricalPriceImpactTarget
  ) => PriceImpactResult | Promise<PriceImpactResult>;
}

// Reusable compact input to mirror Pool Specs / Excavation styling
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
        <span className="compact-input-endcap">
          {unit && <span className="compact-input-unit">{unit}</span>}
          {priceImpact}
        </span>
      ) : (
        unit && <span className="compact-input-unit">{unit}</span>
      )}
    </div>
  );
};

function ElectricalSectionNew({
  data,
  onChange,
  plumbingRuns,
  waterFeatures,
  onChangePlumbingRuns,
  hasSpa,
  noteOverrides,
  priceImpactRequestKey = '',
  getElectricalPriceImpact,
}: Props) {
  const handleRunChange = (field: keyof ElectricalRuns, value: number) => {
    onChange({
      ...data,
      runs: { ...data.runs, [field]: value },
    });
  };

  const handleGasRunChange = (value: number) => {
    onChangePlumbingRuns({ gasRun: value });
  };

  // Pricing constants
  const ELECTRICAL_THRESHOLD = pricingData.electrical.overrunThreshold;
  const gasRun = plumbingRuns?.gasRun ?? 0;
  const derivedWaterFeatureGasRun = getDerivedWaterFeatureGasRunTotal(
    waterFeatures?.selections || [],
    plumbingRuns,
    pricingData.waterFeatures
  );
  const billedGasRun = getTotalGasRunForBilling(
    plumbingRuns,
    waterFeatures?.selections || [],
    pricingData.waterFeatures
  );
  const GAS_THRESHOLD = pricingData.plumbing.gasOverrunThreshold;
  const gasOverrun = Math.max(0, billedGasRun - GAS_THRESHOLD);

  const electricalOverrun = Math.max(0, (data.runs.electricalRun || 0) - ELECTRICAL_THRESHOLD);
  const getOverrunMessage = () => 'Additional charges apply';

  const renderPriceImpact = (
    target: ElectricalPriceImpactTarget,
    controlLabel: string
  ) => {
    if (!getElectricalPriceImpact) return null;
    return (
      <PriceImpactPopover
        controlLabel={controlLabel}
        requestKey={`${priceImpactRequestKey}:${getElectricalPriceImpactTargetKey(target)}`}
        loadImpact={() => getElectricalPriceImpact(target)}
      />
    );
  };

  return (
    <div className="section-form">
      <div className="spec-block">
        <div className="spec-block-header">
          <h2 className="spec-block-title">Gas Run</h2>
          <ProposalNote categoryKey="electrical" subcategoryId="gasRun" overrides={noteOverrides} />
        </div>

        <div className="spec-grid spec-grid-3-fixed">
          <div className="spec-field">
            <label className="spec-label">Gas Run</label>
            <CompactInput
              value={gasRun}
              onChange={(e) => handleGasRunChange(parseFloat(e.target.value) || 0)}
              unit="LNFT"
              min="0"
              step="1"
              placeholder="0"
              priceImpact={
                gasRun > 0
                  ? renderPriceImpact({ kind: 'run', field: 'gasRun' }, 'Gas Run')
                  : null
              }
            />
            <small className="form-help">Meter to heater</small>
          </div>
        </div>

        {derivedWaterFeatureGasRun > 0 && (
          <div className="info-box" style={{ marginTop: '8px' }}>
            Fire-only and Water &amp; Fire Wok Pots add {derivedWaterFeatureGasRun} ft of gas run automatically from
            Water Features.
          </div>
        )}
        {gasOverrun > 0 && (
          <div className="info-box" style={{ marginTop: '8px', background: '#fff7ed', borderColor: '#fdba74', color: '#9a3412' }}>
            <strong>Gas Overrun:</strong> {gasOverrun} ft over {GAS_THRESHOLD} ft maximum across {billedGasRun} total
            billed ft. {getOverrunMessage()}
          </div>
        )}
      </div>

      <div className="spec-block">
        <div className="spec-block-header">
          <h2 className="spec-block-title">Electrical Runs</h2>
          <ProposalNote categoryKey="electrical" subcategoryId="electricalRuns" overrides={noteOverrides} />
        </div>

        <div className="spec-grid spec-grid-3">
          <div className="spec-field">
            <label className="spec-label">Main Electrical Run</label>
            <CompactInput
              value={data.runs.electricalRun || 0}
              onChange={(e) => handleRunChange('electricalRun', parseFloat(e.target.value) || 0)}
              unit="LNFT"
              min="0"
              step="0.1"
              placeholder="0"
              priceImpact={
                Number(data.runs.electricalRun || 0) > 0
                  ? renderPriceImpact(
                      { kind: 'run', field: 'electricalRun' },
                      'Main Electrical Run'
                    )
                  : null
              }
            />
            <small className="form-help">House panel to equipment pad</small>
          </div>

          <div className="spec-field">
            <label className="spec-label">Light Run</label>
            <CompactInput
              value={data.runs.lightRun || 0}
              onChange={(e) => handleRunChange('lightRun', parseFloat(e.target.value) || 0)}
              unit="LNFT"
              min="0"
              step="0.1"
              placeholder="0"
              priceImpact={
                Number(data.runs.lightRun || 0) > 0
                  ? renderPriceImpact({ kind: 'run', field: 'lightRun' }, 'Light Run')
                  : null
              }
            />
            <small className="form-help">All lights to equipment pad</small>
          </div>

          <div className="spec-field">
            <label className="spec-label">Heat Pump Electrical Run</label>
            <CompactInput
              value={data.runs.heatPumpElectricalRun || 0}
              onChange={(e) => handleRunChange('heatPumpElectricalRun', parseFloat(e.target.value) || 0)}
              unit="LNFT"
              min="0"
              step="1"
              placeholder="0"
              priceImpact={
                Number(data.runs.heatPumpElectricalRun || 0) > 0
                  ? renderPriceImpact(
                      { kind: 'run', field: 'heatPumpElectricalRun' },
                      'Heat Pump Electrical Run'
                    )
                  : null
              }
            />
            <small className="form-help">Only if using a heat pump </small>
          </div>
        </div>

        {electricalOverrun > 0 && (
          <div className="info-box" style={{ marginTop: '8px', background: '#fff7ed', borderColor: '#fdba74', color: '#9a3412' }}>
            <strong>Electrical Overrun:</strong> {electricalOverrun} ft over {ELECTRICAL_THRESHOLD}ft maximum. {getOverrunMessage()}
          </div>
        )}
        {hasSpa && (
          <div className="info-box" style={{ marginTop: '8px' }}>
            Spa electrical is included in base pricing; additional spa light wiring is handled in the Equipment section.
          </div>
        )}
      </div>

      <CustomOptionsSection
        data={data.customOptions || []}
        onChange={(customOptions) => onChange({ ...data, customOptions })}
        noteCategoryKey="electrical"
        noteOverrides={noteOverrides}
        renderPriceImpact={(index, option) =>
          getCustomOptionTotal(option) > 0
            ? renderPriceImpact(
                { kind: 'customOption', index },
                option.name?.trim() || `Electrical Custom Option ${index + 1}`
              )
            : null
        }
      />
    </div>
  );
}

export default ElectricalSectionNew;
