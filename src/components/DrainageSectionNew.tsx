import type { ReactNode } from 'react';
import {
  getDrainagePriceImpactTargetKey,
  type DrainagePriceImpactRunField,
  type DrainagePriceImpactTarget,
  type PriceImpactResult,
} from '../services/priceImpact';
import pricingData from '../services/pricingData';
import { Drainage } from '../types/proposal-new';
import { getCustomOptionTotal } from '../utils/customOptions';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import CustomOptionsSection from './CustomOptionsSection';
import InlineOverageWarning from './InlineOverageWarning';
import PriceImpactPopover from './PriceImpactPopover';
import ProposalNote from './ProposalNote';
import './SectionStyles.css';

interface Props {
  data: Drainage;
  onChange: (data: Drainage) => void;
  noteOverrides?: ProposalNoteOverrides;
  priceImpactRequestKey?: string;
  getDrainagePriceImpact?: (
    target: DrainagePriceImpactTarget
  ) => PriceImpactResult | Promise<PriceImpactResult>;
}

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

function DrainageSectionNew({
  data,
  onChange,
  noteOverrides,
  priceImpactRequestKey = '',
  getDrainagePriceImpact,
}: Props) {
  const drainageIncludedFt = Math.max(Number(pricingData.misc.drainage.includedFt) || 0, 0);

  const handleChange = (field: keyof Drainage, value: number) => {
    onChange({ ...data, [field]: value });
  };

  const renderPriceImpact = (
    target: DrainagePriceImpactTarget,
    controlLabel: string
  ) => {
    if (!getDrainagePriceImpact) return null;
    return (
      <PriceImpactPopover
        controlLabel={controlLabel}
        requestKey={`${priceImpactRequestKey}:${getDrainagePriceImpactTargetKey(target)}`}
        loadImpact={() => getDrainagePriceImpact(target)}
      />
    );
  };

  const renderDrainageInput = (
    label: string,
    field: DrainagePriceImpactRunField,
    helper: string
  ) => {
    const value = Math.max(Number(data[field]) || 0, 0);
    const overage = Math.max(0, value - drainageIncludedFt);
    return (
      <div className="spec-field">
        <div className="spec-label-row">
          <label className="spec-label">{label}</label>
          <InlineOverageWarning overage={overage} maximum={drainageIncludedFt} />
        </div>
        <CompactInput
          value={value}
          onChange={(event) => handleChange(field, parseFloat(event.target.value) || 0)}
          unit="LNFT"
          min="0"
          step="1"
          priceImpact={
            value > 0
              ? renderPriceImpact({ kind: 'run', field }, label)
              : null
          }
        />
        <small className="form-help">{helper}</small>
      </div>
    );
  };

  return (
    <div className="section-form">
      <div className="spec-block">
        <div className="spec-block-header">
          <h2 className="spec-block-title">Core Drainage</h2>
          <ProposalNote categoryKey="drainage" subcategoryId="coreDrainage" overrides={noteOverrides} />
        </div>

        <div className="spec-grid spec-grid-2">
          {renderDrainageInput('Downspout Drain', 'downspoutTotalLF', 'Total from all downspouts')}
          {renderDrainageInput('Deck Drain', 'deckDrainTotalLF', 'Deck drainage system')}
          {renderDrainageInput('French Drain', 'frenchDrainTotalLF', 'Perforated pipe with gravel')}
          {renderDrainageInput('Box Drain', 'boxDrainTotalLF', 'Surface water collection')}
        </div>
      </div>

      <CustomOptionsSection
        data={data.customOptions || []}
        onChange={(customOptions) => onChange({ ...data, customOptions })}
        noteCategoryKey="drainage"
        noteOverrides={noteOverrides}
        compactToggle
        renderPriceImpact={(index, option) =>
          getCustomOptionTotal(option) > 0
            ? renderPriceImpact(
                { kind: 'customOption', index },
                option.name?.trim() || `Drainage Custom Option ${index + 1}`
              )
            : null
        }
      />
    </div>
  );
}

export default DrainageSectionNew;
