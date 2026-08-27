import { useEffect, useState, type ReactNode } from 'react';
import { Excavation, RBBLevel } from '../types/proposal-new';
import pricingData from '../services/pricingData';
import {
  getExcavationPriceImpactTargetKey,
  type ExcavationPriceImpactTarget,
  type PriceImpactResult,
} from '../services/priceImpact';
import { isBronzePricingTier } from '../services/pricingTiers';
import {
  formatMasonryFacingLabel,
  getMasonryFacingOptions,
  normalizeMasonryFacingId,
  type MasonryFacingOption,
} from '../utils/masonryFacing';
import {
  MAX_EXCAVATION_OPTION_QUANTITY,
  clampExcavationOptionQuantity,
  getExcavationOptionQuantity,
} from '../utils/excavationOptionQuantities';
import { getCustomOptionTotal } from '../utils/customOptions';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import CustomOptionsSection from './CustomOptionsSection';
import InlineOverageWarning from './InlineOverageWarning';
import PriceImpactPopover from './PriceImpactPopover';
import ProposalNote from './ProposalNote';
import './SectionStyles.css';

interface Props {
  data: Excavation;
  onChange: (data: Excavation) => void;
  pricingTierId?: string;
  isPpasEast?: boolean;
  noteOverrides?: ProposalNoteOverrides;
  priceImpactRequestKey?: string;
  getExcavationPriceImpact?: (
    target: ExcavationPriceImpactTarget
  ) => PriceImpactResult | Promise<PriceImpactResult>;
}

const defaultWall: RBBLevel = {
  height: 6,
  length: 0,
  facing: 'none',
  hasBacksideFacing: false,
  backsideFacing: 'none',
};
const wallHeights = [6, 12, 18, 24, 30, 36] as const;

const formatNumber = (value: number) => {
  const numeric = Number(value) || 0;
  return Number.isInteger(numeric)
    ? String(numeric)
    : numeric.toFixed(2).replace(/\.?0+$/, '');
};

const CompactInput = ({
  value,
  onChange,
  unit,
  min = '0',
  step = '1',
  priceImpact,
}: {
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: string;
  step?: string;
  priceImpact?: ReactNode;
}) => (
  <div className={`compact-input-wrapper${priceImpact ? ' has-price-impact' : ''}`}>
    <input
      type="number"
      className="compact-input"
      value={value === 0 ? '' : value}
      min={min}
      step={step}
      placeholder="0"
      onChange={(event) => onChange(parseFloat(event.target.value) || 0)}
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

const Toggle = ({
  label,
  checked,
  onChange,
  disabled = false,
  checkedText = 'Added',
  uncheckedText = 'Not added',
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  checkedText?: string;
  uncheckedText?: string;
}) => (
  <label className={`equipment-selection-toggle ${checked ? 'is-on' : 'is-off'}${disabled ? ' is-disabled' : ''}`}>
    <span className="equipment-selection-toggle__status">
      {checked ? checkedText : uncheckedText}
    </span>
    <input
      type="checkbox"
      role="switch"
      aria-label={`${label} selection`}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span className="equipment-selection-toggle__track" aria-hidden="true">
      <span className="equipment-selection-toggle__thumb" />
    </span>
  </label>
);

const CategoryControls = ({
  label,
  checked,
  onToggle,
  onAdd,
}: {
  label: string;
  checked: boolean;
  onToggle: (checked: boolean, anchor: HTMLElement | null) => void;
  onAdd?: (anchor: HTMLElement | null) => void;
}) => (
  <div className="equipment-selection-controls">
    {checked && onAdd && (
      <>
        <button
          type="button"
          className="action-btn secondary equipment-add-another-btn"
          onClick={(event) => onAdd(event.currentTarget.closest('.excavation-category-item'))}
        >
          Add Another
        </button>
        <span className="equipment-selection-divider" aria-hidden="true" />
      </>
    )}
    <div className="equipment-selection-toggle-anchor">
      <Toggle
        label={label}
        checked={checked}
        onChange={(next) =>
          onToggle(next, (document.activeElement as HTMLElement | null)?.closest('.excavation-category-item') || null)
        }
      />
    </div>
  </div>
);

const CategoryIcon = ({ kind }: { kind: 'wall' | 'columns' | 'retaining' | 'options' }) => (
  <span className="equipment-category-icon">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {kind === 'columns' ? (
        <><path d="M7 4h10M8 7h8M8 17h8M7 20h10" /><path d="M9 7v10M15 7v10" /></>
      ) : kind === 'options' ? (
        <><path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /><circle cx="10" cy="12" r="2" /></>
      ) : kind === 'retaining' ? (
        <><path d="M4 18h16M6 18V9h12v9M8 9V6h8v3" /><path d="M9 12h2M13 12h2M9 15h2M13 15h2" /></>
      ) : (
        <><path d="M4 17h16M5 17l3-9h8l3 9" /><path d="M8 8h8M9 12h6" /></>
      )}
    </svg>
  </span>
);

const facingOptionsWithCurrent = (
  options: MasonryFacingOption[],
  current?: string | null
) => {
  const normalized = normalizeMasonryFacingId(current);
  if (!normalized || normalized === 'none' || options.some((option) => option.id === normalized)) {
    return options;
  }
  return [...options, {
    id: normalized,
    name: formatMasonryFacingLabel(current, options),
    materialCost: 0,
    laborCost: 0,
  }];
};

function ExcavationSectionNew({
  data,
  onChange,
  pricingTierId,
  isPpasEast = false,
  noteOverrides,
  priceImpactRequestKey = '',
  getExcavationPriceImpact,
}: Props) {
  const [activeRBB, setActiveRBB] = useState<number | null>(null);
  const [activeExposed, setActiveExposed] = useState<number | null>(null);
  const [activeRetaining, setActiveRetaining] = useState<number | null>(null);
  const [columnsEditing, setColumnsEditing] = useState(false);

  const rbbFacings = getMasonryFacingOptions(pricingData.masonry, 'rbb');
  const backsideFacings = getMasonryFacingOptions(pricingData.masonry, 'backside');
  const retainingOptions = pricingData.masonry.retainingWalls.filter(
    (option: any) => option.name && option.name !== 'None' && option.name !== 'No Retaining Wall'
  );
  const defaultRetaining = retainingOptions[0]?.name || 'No Retaining Wall';
  const rbbLevels = data.rbbLevels || [];
  const exposedLevels = data.exposedPoolWallLevels || [];
  const hasLegacyRetainingWall =
    (data.retainingWallType && !['None', 'No Retaining Wall'].includes(data.retainingWallType)) ||
    (data.retainingWallLength || 0) > 0;
  const retainingWalls = data.retainingWalls?.length
    ? data.retainingWalls
    : hasLegacyRetainingWall
      ? [{ type: data.retainingWallType || defaultRetaining, length: data.retainingWallLength || 0 }]
      : [];
  const columnsActive = (data.columns.count || 0) > 0;
  const doubleCurtainActive = Boolean(data.hasDoubleCurtain ?? data.doubleCurtainLength > 0);
  const sitePrepActive = Boolean(data.hasAdditionalSitePrep ?? data.additionalSitePrepHours > 0);
  const isBronze = isBronzePricingTier(pricingTierId);
  const gravelUnavailable = isBronze && !isPpasEast;
  const gravelQty = getExcavationOptionQuantity(data.hasGravelInstall, data.gravelInstallQuantity);
  const dirtQty = getExcavationOptionQuantity(data.hasDirtHaul, data.dirtHaulQuantity);

  const change = (field: keyof Excavation, value: any) => onChange({ ...data, [field]: value });
  const renderImpact = (target: ExcavationPriceImpactTarget, label: string) =>
    getExcavationPriceImpact ? (
      <PriceImpactPopover
        controlLabel={label}
        requestKey={`${priceImpactRequestKey}:${getExcavationPriceImpactTargetKey(target)}`}
        loadImpact={() => getExcavationPriceImpact(target)}
      />
    ) : null;

  const closeEditors = () => {
    setActiveRBB(null);
    setActiveExposed(null);
    setActiveRetaining(null);
    setColumnsEditing(false);
  };

  const holdPosition = (anchor: HTMLElement | null, action: () => void) => {
    const top = anchor?.getBoundingClientRect().top;
    action();
    if (!anchor || top === undefined) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const delta = anchor.getBoundingClientRect().top - top;
      if (Math.abs(delta) < 1) return;
      let parent = anchor.parentElement;
      while (parent) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
          parent.scrollTop += delta;
          return;
        }
        parent = parent.parentElement;
      }
      window.scrollBy(0, delta);
    }));
  };

  const openEditor = (
    setter: (index: number | null) => void,
    index: number,
    anchor: HTMLElement | null
  ) => holdPosition(anchor, () => { closeEditors(); setter(index); });

  const setWalls = (field: 'rbbLevels' | 'exposedPoolWallLevels', levels: RBBLevel[]) => change(field, levels);
  const startWalls = (
    field: 'rbbLevels' | 'exposedPoolWallLevels',
    levels: RBBLevel[],
    setter: (index: number | null) => void,
    anchor: HTMLElement | null
  ) => holdPosition(anchor, () => {
    closeEditors();
    const next = levels.length ? levels : [{ ...defaultWall }];
    if (!levels.length) setWalls(field, next);
    setter(next.length - 1);
  });
  const addWall = (
    field: 'rbbLevels' | 'exposedPoolWallLevels',
    levels: RBBLevel[],
    setter: (index: number | null) => void,
    anchor: HTMLElement | null
  ) => holdPosition(anchor, () => {
    closeEditors();
    const next = [...levels, { ...defaultWall }];
    setWalls(field, next);
    setter(next.length - 1);
  });
  const updateWall = (
    field: 'rbbLevels' | 'exposedPoolWallLevels',
    levels: RBBLevel[],
    index: number,
    key: keyof RBBLevel,
    value: any
  ) => {
    const nextValue = key === 'facing' || key === 'backsideFacing'
      ? normalizeMasonryFacingId(String(value)) || 'none'
      : value;
    const next = [...levels];
    const updated = { ...next[index], [key]: nextValue };
    if (key === 'facing' && nextValue === 'none') {
      updated.hasBacksideFacing = false;
      updated.backsideFacing = 'none';
    }
    if (key === 'backsideFacing') updated.hasBacksideFacing = nextValue !== 'none';
    next[index] = updated;
    setWalls(field, next);
  };

  const setRetaining = (walls: { type: string; length: number }[]) => onChange({
    ...data,
    retainingWalls: walls,
    retainingWallType: walls[0]?.type || 'No Retaining Wall',
    retainingWallLength: walls[0]?.length || 0,
  });

  useEffect(() => { if (!rbbLevels.length) setActiveRBB(null); }, [rbbLevels.length]);
  useEffect(() => { if (!exposedLevels.length) setActiveExposed(null); }, [exposedLevels.length]);
  useEffect(() => { if (!retainingWalls.length) setActiveRetaining(null); }, [retainingWalls.length]);
  useEffect(() => { if (!columnsActive) setColumnsEditing(false); }, [columnsActive]);

  const updateQuantity = (
    selected: 'hasGravelInstall' | 'hasDirtHaul',
    quantity: 'gravelInstallQuantity' | 'dirtHaulQuantity',
    value: number
  ) => {
    const next = clampExcavationOptionQuantity(value);
    onChange({ ...data, [selected]: next > 0, [quantity]: next });
  };

  const cardHeader = (
    title: string,
    noteId: string,
    kind: 'wall' | 'columns' | 'retaining' | 'options',
    showDescription = true
  ) => (
    <div className="spec-block-header">
      <div className="equipment-category-title-row">
        <CategoryIcon kind={kind} />
        <div className="equipment-category-title-copy"><h2 className="spec-block-title">{title}</h2></div>
      </div>
      {showDescription && <ProposalNote categoryKey="excavation" subcategoryId={noteId} overrides={noteOverrides} />}
    </div>
  );

  const select = (
    value: string | number,
    onSelect: (value: string) => void,
    options: ReactNode,
    impact?: ReactNode,
    disabled = false
  ) => (
    <div className={`compact-input-wrapper${impact ? ' has-price-impact' : ''}`}>
      <select className="compact-input" value={value} disabled={disabled} onChange={(event) => onSelect(event.target.value)}>
        {options}
      </select>
      {impact && <span className="compact-input-endcap">{impact}</span>}
    </div>
  );

  const wallTitle = (label: string, level: RBBLevel, includeBackside = false) => {
    const parts = [`${formatNumber(level.height)}" ${label}`, `${formatNumber(level.length)} LNFT`];
    if (normalizeMasonryFacingId(level.facing) !== 'none') parts.push(formatMasonryFacingLabel(level.facing, rbbFacings));
    if (includeBackside && level.hasBacksideFacing) {
      parts.push(isPpasEast
        ? `Backside: ${formatMasonryFacingLabel(level.backsideFacing || level.facing, backsideFacings)}`
        : 'Backside Facing');
    }
    return parts.join(' | ');
  };

  const wallEditor = (
    field: 'rbbLevels' | 'exposedPoolWallLevels',
    levels: RBBLevel[],
    level: RBBLevel,
    index: number,
    target: ExcavationPriceImpactTarget,
    isRBB: boolean
  ) => {
    const impact = level.length > 0 ? renderImpact(target, isRBB ? 'Raised Bond Beam' : 'Exposed Pool Wall') : null;
    const backside = normalizeMasonryFacingId(level.backsideFacing) || (level.hasBacksideFacing ? normalizeMasonryFacingId(level.facing) || 'none' : 'none');
    return <>
      <div className={isRBB && isPpasEast ? 'spec-grid-4-fixed' : 'spec-grid-3-fixed'}>
        <div className="spec-field">
          <label className="spec-label">Height</label>
          {select(level.height, (value) => updateWall(field, levels, index, 'height', parseInt(value, 10)), wallHeights.map((height) => <option key={height} value={height}>{`${height}"`}</option>), impact)}
        </div>
        <div className="spec-field">
          <label className="spec-label">Length</label>
          <CompactInput value={level.length} unit="LNFT" onChange={(value) => updateWall(field, levels, index, 'length', value)} />
        </div>
        <div className="spec-field">
          <div className="spec-label-row excavation-facing-label-row">
            <label className="spec-label">Facing</label>
            {isRBB && !isPpasEast && <Toggle
              label="Backside Facing"
              checked={Boolean(level.hasBacksideFacing)}
              checkedText="Backside Facing"
              uncheckedText="Backside Facing"
              disabled={(normalizeMasonryFacingId(level.facing) || 'none') === 'none'}
              onChange={(checked) => updateWall(field, levels, index, 'hasBacksideFacing', checked)}
            />}
          </div>
          {select(normalizeMasonryFacingId(level.facing) || 'none', (value) => updateWall(field, levels, index, 'facing', value), <><option value="none">None</option>{facingOptionsWithCurrent(rbbFacings, level.facing).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</>)}
        </div>
        {isRBB && isPpasEast && <div className="spec-field">
          <label className="spec-label">Backside Facing</label>
          {select(backside, (value) => updateWall(field, levels, index, 'backsideFacing', value), <><option value="none">None</option>{facingOptionsWithCurrent(backsideFacings, backside).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</>, undefined, (normalizeMasonryFacingId(level.facing) || 'none') === 'none')}
        </div>}
      </div>
      <div className="action-row"><button
        type="button"
        className="action-btn"
        onClick={(event) => holdPosition(event.currentTarget.closest('.excavation-category-item'), () => {
          if (isRBB) setActiveRBB(null);
          else setActiveExposed(null);
        })}
      >Done</button></div>
    </>;
  };

  const stepper = (label: string, quantity: number, setQuantity: (value: number) => void) => (
    <span className="excavation-quantity-stepper excavation-inline-stepper">
      <button type="button" className="excavation-quantity-stepper__arrow" aria-label={`Decrease ${label} quantity`} disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5L5.5 8l4.5 4.5" /></svg></button>
      <span className="excavation-quantity-stepper__value">x{quantity}</span>
      <button type="button" className="excavation-quantity-stepper__arrow" aria-label={`Increase ${label} quantity`} disabled={quantity >= MAX_EXCAVATION_OPTION_QUANTITY} onClick={() => setQuantity(quantity + 1)}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" /></svg></button>
    </span>
  );

  const optionRow = ({
    label,
    checked,
    target,
    onToggle,
    disabled = false,
    extra,
    warning,
  }: {
    label: string;
    checked: boolean;
    target: ExcavationPriceImpactTarget;
    onToggle: (checked: boolean) => void;
    disabled?: boolean;
    extra?: ReactNode;
    warning?: ReactNode;
  }) => <div className={`excavation-option-row${disabled ? ' is-disabled' : ''}`}>
    <div className="excavation-option-copy">
      <div className="spec-label-row"><span className="excavation-option-title">{label}</span>{warning}</div>
    </div>
    <div className="excavation-option-actions">
      {checked && extra}
      {checked && !disabled && renderImpact(target, label)}
      <Toggle label={label} checked={checked} disabled={disabled} onChange={onToggle} />
    </div>
  </div>;

  return (
    <div className="section-form excavation-section-modern">
      <div className="water-feature-category-list excavation-category-list">
        <div className="water-feature-category-item excavation-category-item">
          <div className="spec-block">
            {cardHeader('Raised Bond Beam (RBB)', 'raisedBondBeam', 'wall')}
            <CategoryControls
              label="Raised Bond Beam"
              checked={rbbLevels.length > 0}
              onToggle={(checked, anchor) => checked
                ? startWalls('rbbLevels', rbbLevels, setActiveRBB, anchor)
                : setWalls('rbbLevels', [])}
              onAdd={(anchor) => addWall('rbbLevels', rbbLevels, setActiveRBB, anchor)}
            />
            {rbbLevels.map((level, index) => {
              const editing = activeRBB === index;
              const target: ExcavationPriceImpactTarget = { kind: 'rbbLevel', index };
              return <div key={`rbb-${index}`} className="spec-subcard">
                <div className="spec-subcard-header">
                  <div className="spec-subcard-title">{wallTitle('RBB', level, true)}</div>
                  <div className="spec-subcard-actions stacked-actions"><div className="stacked-primary-actions">
                    {!editing && level.length > 0 && renderImpact(target, 'Raised Bond Beam')}
                    {!editing && <button
                      type="button"
                      className="link-btn"
                      onClick={(event) => openEditor(setActiveRBB, index, event.currentTarget.closest('.excavation-category-item'))}
                    >Edit</button>}
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => {
                        setWalls('rbbLevels', rbbLevels.filter((_, itemIndex) => itemIndex !== index));
                        setActiveRBB(null);
                      }}
                    >Remove</button>
                  </div></div>
                </div>
                {editing && wallEditor('rbbLevels', rbbLevels, level, index, target, true)}
              </div>;
            })}
          </div>
        </div>

        <div className="water-feature-category-item excavation-category-item">
          <div className="spec-block">
            {cardHeader('Columns', 'columns', 'columns')}
            <CategoryControls
              label="Columns"
              checked={columnsActive}
              onToggle={(checked, anchor) => {
                if (!checked) {
                  change('columns', { ...data.columns, count: 0, width: 0, depth: 0, height: 0, facing: 'none' });
                  return;
                }
                holdPosition(anchor, () => {
                  closeEditors();
                  change('columns', { ...data.columns, count: Math.max(data.columns.count || 0, 1) });
                  setColumnsEditing(true);
                });
              }}
              onAdd={(anchor) => holdPosition(anchor, () => {
                closeEditors();
                change('columns', { ...data.columns, count: (data.columns.count || 0) + 1 });
                setColumnsEditing(true);
              })}
            />
            {columnsActive && <div className="spec-subcard">
              <div className="spec-subcard-header">
                <div className="spec-subcard-title">
                  {formatNumber(data.columns.count)} {data.columns.count === 1 ? 'Column' : 'Columns'}
                  {' | '}{formatNumber(data.columns.width)} FT W x {formatNumber(data.columns.depth)} FT D
                  {' | '}{formatNumber(data.columns.height)} FT H
                  {normalizeMasonryFacingId(data.columns.facing) !== 'none'
                    ? ` | ${formatMasonryFacingLabel(data.columns.facing, rbbFacings)}`
                    : ''}
                </div>
                <div className="spec-subcard-actions stacked-actions"><div className="stacked-primary-actions">
                  {!columnsEditing && normalizeMasonryFacingId(data.columns.facing) !== 'none' && renderImpact({ kind: 'columns' }, 'Columns')}
                  {!columnsEditing && <button
                    type="button"
                    className="link-btn"
                    onClick={(event) => holdPosition(event.currentTarget.closest('.excavation-category-item'), () => {
                      closeEditors();
                      setColumnsEditing(true);
                    })}
                  >Edit</button>}
                  <button
                    type="button"
                    className="link-btn danger"
                    onClick={() => change('columns', { ...data.columns, count: 0, width: 0, depth: 0, height: 0, facing: 'none' })}
                  >Remove</button>
                </div></div>
              </div>
              {columnsEditing && <>
                <div className="spec-grid-5-tight">
                  <div className="spec-field">
                    <label className="spec-label">Number of Columns</label>
                    <CompactInput
                      value={data.columns.count}
                      unit="qty"
                      onChange={(value) => change('columns', { ...data.columns, count: Math.floor(value) })}
                      priceImpact={normalizeMasonryFacingId(data.columns.facing) !== 'none'
                        ? renderImpact({ kind: 'columns' }, 'Columns')
                        : null}
                    />
                  </div>
                  {(['width', 'depth', 'height'] as const).map((field) => <div className="spec-field" key={field}>
                    <label className="spec-label">{field[0].toUpperCase() + field.slice(1)}</label>
                    <CompactInput
                      value={data.columns[field]}
                      unit="ft"
                      step="0.5"
                      onChange={(value) => change('columns', { ...data.columns, [field]: value })}
                    />
                  </div>)}
                  <div className="spec-field">
                    <label className="spec-label">Facing</label>
                    {select(
                      normalizeMasonryFacingId(data.columns.facing) || 'none',
                      (value) => change('columns', { ...data.columns, facing: normalizeMasonryFacingId(value) || 'none' }),
                      <><option value="none">None</option>{facingOptionsWithCurrent(rbbFacings, data.columns.facing).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</>
                    )}
                  </div>
                </div>
                <div className="action-row"><button
                  type="button"
                  className="action-btn"
                  onClick={(event) => holdPosition(event.currentTarget.closest('.excavation-category-item'), () => setColumnsEditing(false))}
                >Done</button></div>
              </>}
            </div>}
          </div>
        </div>

        <div className="water-feature-category-item excavation-category-item">
          <div className="spec-block">
            {cardHeader('Retaining Wall', 'retainingWall', 'retaining')}
            <CategoryControls
              label="Retaining Wall"
              checked={retainingWalls.length > 0}
              onToggle={(checked, anchor) => {
                if (!checked) {
                  setRetaining([]);
                  return;
                }
                holdPosition(anchor, () => {
                  closeEditors();
                  const next = retainingWalls.length
                    ? retainingWalls
                    : [{ type: defaultRetaining, length: 0 }];
                  if (!retainingWalls.length) setRetaining(next);
                  setActiveRetaining(next.length - 1);
                });
              }}
              onAdd={(anchor) => holdPosition(anchor, () => {
                closeEditors();
                const next = [...retainingWalls, { type: defaultRetaining, length: 0 }];
                setRetaining(next);
                setActiveRetaining(next.length - 1);
              })}
            />
            {retainingWalls.map((wall, index) => {
              const editing = activeRetaining === index;
              const target: ExcavationPriceImpactTarget = { kind: 'retainingWall', index };
              return <div key={`retaining-${index}`} className="spec-subcard">
                <div className="spec-subcard-header">
                  <div className="spec-subcard-title">
                    {wall.type || defaultRetaining}{wall.length > 0 ? ` | ${formatNumber(wall.length)} LNFT` : ''}
                  </div>
                  <div className="spec-subcard-actions stacked-actions"><div className="stacked-primary-actions">
                    {!editing && wall.length > 0 && renderImpact(target, 'Retaining Wall')}
                    {!editing && <button
                      type="button"
                      className="link-btn"
                      onClick={(event) => openEditor(setActiveRetaining, index, event.currentTarget.closest('.excavation-category-item'))}
                    >Edit</button>}
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => {
                        setRetaining(retainingWalls.filter((_, itemIndex) => itemIndex !== index));
                        setActiveRetaining(null);
                      }}
                    >Remove</button>
                  </div></div>
                </div>
                {editing && <>
                  <div className="spec-grid-2">
                    <div className="spec-field">
                      <label className="spec-label">Retaining Wall Type</label>
                      {select(
                        wall.type || defaultRetaining,
                        (value) => {
                          const next = [...retainingWalls];
                          next[index] = { ...wall, type: value };
                          setRetaining(next);
                        },
                        retainingOptions.map((option: any) => <option key={option.name} value={option.name}>{option.name}</option>),
                        wall.length > 0 ? renderImpact(target, 'Retaining Wall') : null
                      )}
                    </div>
                    <div className="spec-field">
                      <label className="spec-label">Retaining Wall Length</label>
                      <CompactInput value={wall.length || 0} unit="LNFT" onChange={(value) => {
                        const next = [...retainingWalls];
                        next[index] = { ...wall, length: value };
                        setRetaining(next);
                      }} />
                    </div>
                  </div>
                  <div className="action-row"><button
                    type="button"
                    className="action-btn"
                    onClick={(event) => holdPosition(event.currentTarget.closest('.excavation-category-item'), () => setActiveRetaining(null))}
                  >Done</button></div>
                </>}
              </div>;
            })}
          </div>
        </div>

        <div className="water-feature-category-item excavation-category-item">
          <div className="spec-block">
            {cardHeader('Exposed Pool Wall', 'exposedPoolWall', 'wall')}
            <CategoryControls
              label="Exposed Pool Wall"
              checked={exposedLevels.length > 0}
              onToggle={(checked, anchor) => checked
                ? startWalls('exposedPoolWallLevels', exposedLevels, setActiveExposed, anchor)
                : setWalls('exposedPoolWallLevels', [])}
              onAdd={(anchor) => addWall('exposedPoolWallLevels', exposedLevels, setActiveExposed, anchor)}
            />
            {exposedLevels.map((level, index) => {
              const editing = activeExposed === index;
              const target: ExcavationPriceImpactTarget = { kind: 'exposedPoolWallLevel', index };
              return <div key={`exposed-${index}`} className="spec-subcard">
                <div className="spec-subcard-header">
                  <div className="spec-subcard-title">{wallTitle('Exposed Pool Wall', level)}</div>
                  <div className="spec-subcard-actions stacked-actions"><div className="stacked-primary-actions">
                    {!editing && level.length > 0 && renderImpact(target, 'Exposed Pool Wall')}
                    {!editing && <button
                      type="button"
                      className="link-btn"
                      onClick={(event) => openEditor(setActiveExposed, index, event.currentTarget.closest('.excavation-category-item'))}
                    >Edit</button>}
                    <button
                      type="button"
                      className="link-btn danger"
                      onClick={() => {
                        setWalls('exposedPoolWallLevels', exposedLevels.filter((_, itemIndex) => itemIndex !== index));
                        setActiveExposed(null);
                      }}
                    >Remove</button>
                  </div></div>
                </div>
                {editing && wallEditor('exposedPoolWallLevels', exposedLevels, level, index, target, false)}
              </div>;
            })}
          </div>
        </div>

        <div className="water-feature-category-item excavation-category-item">
          <div className="spec-block excavation-additional-options-card">
            {cardHeader('Additional Options', 'additionalOptions', 'options', false)}
            <div className="excavation-option-list">
              {optionRow({
                label: 'Gravel Install',
                checked: Boolean(data.hasGravelInstall),
                disabled: gravelUnavailable,
                target: { kind: 'gravelInstall' },
                onToggle: (checked) => isPpasEast
                  ? updateQuantity('hasGravelInstall', 'gravelInstallQuantity', checked ? 1 : 0)
                  : change('hasGravelInstall', checked),
                extra: isPpasEast
                  ? stepper('Gravel Install', gravelQty, (value) => updateQuantity('hasGravelInstall', 'gravelInstallQuantity', value))
                  : undefined,
                warning: isPpasEast && isBronze ? <InlineOverageWarning
                  overage={Math.max(0, gravelQty - 1)}
                  maximum={1}
                  message={`${Math.max(0, gravelQty - 1)} install${gravelQty - 1 === 1 ? '' : 's'} over 1 included. Additional charges apply.`}
                /> : undefined,
              })}
              {optionRow({
                label: 'Dirt Haul',
                checked: Boolean(data.hasDirtHaul),
                target: { kind: 'dirtHaul' },
                onToggle: (checked) => isPpasEast
                  ? updateQuantity('hasDirtHaul', 'dirtHaulQuantity', checked ? 1 : 0)
                  : change('hasDirtHaul', checked),
                extra: isPpasEast
                  ? stepper('Dirt Haul', dirtQty, (value) => updateQuantity('hasDirtHaul', 'dirtHaulQuantity', value))
                  : undefined,
              })}
              {optionRow({
                label: 'Soil Sample / Engineer',
                checked: Boolean(data.needsSoilSampleEngineer),
                target: { kind: 'soilSampleEngineer' },
                onToggle: (checked) => change('needsSoilSampleEngineer', checked),
              })}
              {optionRow({
                label: 'Double Curtain',
                checked: doubleCurtainActive,
                target: { kind: 'doubleCurtain' },
                onToggle: (checked) => onChange({
                  ...data,
                  hasDoubleCurtain: checked,
                  doubleCurtainLength: checked ? data.doubleCurtainLength : 0,
                }),
                extra: doubleCurtainActive ? (
                  <div className="excavation-inline-option-input">
                    <CompactInput
                      value={data.doubleCurtainLength}
                      unit="LNFT"
                      onChange={(value) => change('doubleCurtainLength', value)}
                    />
                  </div>
                ) : undefined,
              })}
              {optionRow({
                label: 'Additional Site Prep',
                checked: sitePrepActive,
                target: { kind: 'additionalSitePrep' },
                onToggle: (checked) => onChange({
                  ...data,
                  hasAdditionalSitePrep: checked,
                  additionalSitePrepHours: checked ? data.additionalSitePrepHours : 0,
                }),
                extra: sitePrepActive ? (
                  <div className="excavation-inline-option-input">
                    <CompactInput
                      value={data.additionalSitePrepHours}
                      unit="hrs"
                      step="0.5"
                      onChange={(value) => change('additionalSitePrepHours', value)}
                    />
                  </div>
                ) : undefined,
              })}
              {isPpasEast && optionRow({
                label: 'Tight Access Job',
                checked: Boolean(data.hasTightAccessJob),
                target: { kind: 'tightAccessJob' },
                onToggle: (checked) => change('hasTightAccessJob', checked),
              })}
            </div>
          </div>
        </div>
      </div>
      <CustomOptionsSection
        data={data.customOptions || []}
        onChange={(customOptions) => change('customOptions', customOptions)}
        noteCategoryKey="excavation"
        noteOverrides={noteOverrides}
        compactToggle
        renderPriceImpact={(index, option) => getCustomOptionTotal(option) > 0
          ? renderImpact({ kind: 'customOption', index }, option.name?.trim() || `Excavation Custom Option ${index + 1}`)
          : null}
      />
    </div>
  );
}

export default ExcavationSectionNew;
