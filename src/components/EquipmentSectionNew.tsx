import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Equipment,
  EquipmentPackageOption,
  FilterSelection,
  HeaterSelection,
  PumpSelection,
  LightSelection,
  PlumbingRuns,
  SaltSystemSelection,
} from '../types/proposal-new';
import pricingData from '../services/pricingData';
import { getEquipmentItemCost } from '../utils/equipmentCost';
import { getDefaultCleanerOption, getDefaultCleanerQuantity, getNoCleanerOption, isNoCleanerSelection } from '../utils/cleanerDefaults';
import { normalizeEquipmentLighting } from '../utils/lighting';
import { getRetiredEquipmentFlags } from '../utils/retiredEquipment';
import {
  automationIncludesSaltCell,
  buildIncludedSaltCellOption,
  isExcludedFromSaltCell,
  isIncludedSaltCellOptionName,
  isIncludedSaltCellSelection,
  isNoSaltSystemName,
  isRealSaltSystemSelection,
} from '../utils/saltCellCompatibility';
import {
  getEnabledEquipmentPackageOptions,
  getEffectivePrimarySanitationSystemName,
  getSelectedEquipmentPackage,
  isCustomEquipmentPackage,
  isFixedEquipmentPackage,
  packageAllowsAdditionalPumps,
  packageSupportsSpa,
} from '../utils/equipmentPackages';
import { getAdditionalPumpSelections, getBasePumpQuantity } from '../utils/pumpSelections';
import { getNoPumpSelection } from '../utils/pumpDefaults';
import { type ProposalNoteOverrides } from '../utils/proposalNotes';
import { TooltipAnchor } from './AppTooltip';
import CustomOptionsSection from './CustomOptionsSection';
import ProposalNote from './ProposalNote';
import RetiredEquipmentIndicator from './RetiredEquipmentIndicator';
import PriceImpactPopover from './PriceImpactPopover';
import type {
  EquipmentPriceImpactTarget,
  PriceImpactResult,
} from '../services/priceImpact';
import './SectionStyles.css';

const EQUIPMENT_COLUMN_GAP = 12;

const BalancedEquipmentColumns = ({ children }: { children: ReactNode }) => {
  const items = Children.toArray(children);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const frameRef = useRef<number | null>(null);
  const pinnedColumnsRef = useRef(new Map<number, number>());
  const frozenAssignmentsRef = useRef<number[] | null>(null);
  const [positions, setPositions] = useState<Array<{ column: number; top: number }>>(() =>
    items.map((_, index) => ({ column: index % 2, top: 0 }))
  );
  const [containerHeight, setContainerHeight] = useState(0);

  const rebalance = useCallback(() => {
    const heights = items.map((_, index) => itemRefs.current[index]?.getBoundingClientRect().height ?? 0);
    if (heights.some((height) => height <= 0)) return;

    let assignments = frozenAssignmentsRef.current?.slice();
    if (!assignments || assignments.length !== heights.length) {
      assignments = new Array<number>(heights.length);
      const balancedHeights = [0, 0];
      [...heights.keys()]
        .sort((left, right) => heights[right] - heights[left] || left - right)
        .forEach((index) => {
          const column = balancedHeights[0] <= balancedHeights[1] ? 0 : 1;
          assignments![index] = column;
          balancedHeights[column] += heights[index] + EQUIPMENT_COLUMN_GAP;
        });
    }

    const columnHeights = [0, 0];
    const nextPositions = heights.map((height, index) => {
      const column = assignments[index];
      const top = columnHeights[column];
      columnHeights[column] += height + EQUIPMENT_COLUMN_GAP;
      return { column, top };
    });
    const nextContainerHeight = Math.max(...columnHeights) - EQUIPMENT_COLUMN_GAP;

    setPositions((current) => {
      const unchanged =
        current.length === nextPositions.length &&
        current.every(
          (position, index) =>
            position.column === nextPositions[index].column &&
            Math.abs(position.top - nextPositions[index].top) < 0.5
        );
      return unchanged ? current : nextPositions;
    });
    setContainerHeight((current) =>
      Math.abs(current - nextContainerHeight) < 0.5 ? current : nextContainerHeight
    );
  }, [items.length]);

  const scheduleRebalance = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      rebalance();
    });
  }, [rebalance]);

  useLayoutEffect(() => {
    rebalance();
    const observer = new ResizeObserver(scheduleRebalance);
    itemRefs.current.slice(0, items.length).forEach((item) => {
      if (item) observer.observe(item);
    });
    window.addEventListener('resize', scheduleRebalance);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', scheduleRebalance);
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    };
  }, [items.length, rebalance, scheduleRebalance]);

  const pinCurrentLayout = (index: number, currentColumn: number) => {
    if (!frozenAssignmentsRef.current) {
      frozenAssignmentsRef.current = items.map((_, itemIndex) => {
        const renderedColumn = Number(itemRefs.current[itemIndex]?.dataset.column);
        return renderedColumn === 1 ? 1 : 0;
      });
    }
    frozenAssignmentsRef.current[index] = currentColumn;
    pinnedColumnsRef.current.set(index, currentColumn);
  };

  const releasePinnedLayout = (index: number) => {
    pinnedColumnsRef.current.delete(index);
  };

  const preserveViewportPosition = (item: HTMLElement, top: number) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const delta = item.getBoundingClientRect().top - top;
        if (Math.abs(delta) < 1) return;

        let scrollParent: HTMLElement | null = item.parentElement;
        while (scrollParent) {
          const overflowY = window.getComputedStyle(scrollParent).overflowY;
          if (/(auto|scroll)/.test(overflowY) && scrollParent.scrollHeight > scrollParent.clientHeight) {
            scrollParent.scrollTop += delta;
            return;
          }
          scrollParent = scrollParent.parentElement;
        }
        window.scrollBy(0, delta);
      });
    });
  };

  const closeEditorsOutside = (activeIndex: number) => {
    itemRefs.current.forEach((item, index) => {
      if (!item || index === activeIndex) return;
      Array.from(item.querySelectorAll<HTMLButtonElement>('button.action-btn'))
        .filter((candidate) => candidate.textContent?.trim() === 'Done')
        .forEach((doneButton) => doneButton.click());
    });
  };

  const handleInteractionCapture = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const columnItem = target.closest<HTMLElement>('.equipment-category-column-item');
    const index = Number(columnItem?.dataset.equipmentIndex);
    if (!columnItem || !Number.isInteger(index)) return;

    const renderedColumn = Number(columnItem.dataset.column);
    const currentColumn = positions[index]?.column ?? (renderedColumn === 1 ? 1 : 0);
    const topLevelToggleAnchor = target.closest<HTMLElement>('.equipment-selection-toggle-anchor');
    const specBlock = columnItem.querySelector<HTMLElement>(':scope > .spec-block');
    const topLevelControls = topLevelToggleAnchor?.closest<HTMLElement>('.equipment-selection-controls');
    const isTopLevelToggle =
      target.matches('input[role="switch"]') && topLevelControls?.parentElement === specBlock;
    const button = target.closest<HTMLButtonElement>('button');
    const actionLabel = button?.textContent?.trim();

    if (isTopLevelToggle) {
      const toggle = target as HTMLInputElement;
      if (!toggle.checked) {
        releasePinnedLayout(index);
      } else {
        const anchorTop = columnItem.getBoundingClientRect().top;
        closeEditorsOutside(index);
        pinCurrentLayout(index, currentColumn);
        preserveViewportPosition(columnItem, anchorTop);
        window.requestAnimationFrame(() => {
          const openedEditor = Array.from(
            itemRefs.current[index]?.querySelectorAll<HTMLButtonElement>('button.action-btn') ?? []
          ).some((candidate) => candidate.textContent?.trim() === 'Done');
          if (!openedEditor) releasePinnedLayout(index);
          scheduleRebalance();
        });
      }
      scheduleRebalance();
      return;
    }

    if (actionLabel === 'Edit' || actionLabel === 'Add Another') {
      const anchorTop = columnItem.getBoundingClientRect().top;
      closeEditorsOutside(index);
      pinCurrentLayout(index, currentColumn);
      preserveViewportPosition(columnItem, anchorTop);
      scheduleRebalance();
      return;
    }

    if (actionLabel === 'Done') {
      window.requestAnimationFrame(() => {
        const stillEditing = Array.from(
          itemRefs.current[index]?.querySelectorAll<HTMLButtonElement>('button.action-btn') ?? []
        ).some((candidate) => candidate.textContent?.trim() === 'Done');
        if (stillEditing) {
          pinCurrentLayout(index, currentColumn);
        } else {
          releasePinnedLayout(index);
        }
        scheduleRebalance();
      });
    }
  };

  return (
    <div
      className="equipment-category-columns"
      style={{ height: `${containerHeight}px` }}
      onClick={handleInteractionCapture}
    >
      {items.map((item, index) => {
        const position = positions[index] ?? { column: index % 2, top: 0 };
        return (
          <div
            key={`equipment-category-${index}`}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            className="equipment-category-column-item"
            data-column={position.column}
            data-equipment-index={index}
            style={{
              left: position.column === 0 ? 0 : 'calc(50% + 6px)',
              top: `${position.top}px`,
            }}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
};

interface Props {
  data: Equipment;
  onChange: (data: Equipment) => void;
  onSelectPackage: (packageId: string) => void;
  plumbingRuns: PlumbingRuns;
  onChangePlumbingRuns: (runs: Partial<PlumbingRuns>) => void;
  hasSpa: boolean;
  hasPool: boolean;
  isPpasEast?: boolean;
  noteOverrides?: ProposalNoteOverrides;
  priceImpactRequestKey?: string;
  getEquipmentPriceImpact?: (
    target: EquipmentPriceImpactTarget
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
}: {
  type?: string;
  value: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  unit?: string;
  min?: string;
  step?: string;
  readOnly?: boolean;
  placeholder?: string;
}) => {
  const displayValue = type === 'number' && value === 0 && !readOnly ? '' : value;
  const finalPlaceholder = placeholder ?? (type === 'number' ? '0' : undefined);

  return (
    <div className="compact-input-wrapper">
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
      {unit && <span className="compact-input-unit">{unit}</span>}
    </div>
  );
};

const LabelWithRetired = ({ text, showRetired }: { text: string; showRetired?: boolean }) => (
  <div className="spec-label-row">
    <label className="spec-label">{text}</label>
    {showRetired && <RetiredEquipmentIndicator />}
  </div>
);

const PackageOptionIcon = ({ isCustom }: { isCustom: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {isCustom ? (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
        <circle cx="10" cy="12" r="2" />
      </>
    ) : (
      <>
        <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
        <path d="M4 7.5v9L12 21l8-4.5v-9M12 12v9" />
      </>
    )}
  </svg>
);

const SelectedPackageIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m6.5 12.5 3.5 3.5 7.5-8" />
  </svg>
);

const PackageContentsIcon = ({ label }: { label: string }) => {
  const category = label.toLowerCase();
  let glyph: JSX.Element;

  if (category.includes('pump')) {
    glyph = (
      <>
        <path d="M4 9h9v9H4zM13 12h4l2 2v4h-6M7 9V6h4v3M7 13h3M7 16h3" />
        <circle cx="17" cy="18" r="2" />
      </>
    );
  } else if (category.includes('filter')) {
    glyph = (
      <>
        <ellipse cx="12" cy="6" rx="5" ry="2.5" />
        <path d="M7 6v11c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V6M7 16.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5M10 3.5V2M14 3.5V2" />
      </>
    );
  } else if (category.includes('cleaner')) {
    glyph = (
      <>
        <path d="M5 16.5h11.5a2.5 2.5 0 0 0 0-5H8.5A3.5 3.5 0 0 0 5 15v1.5ZM17 11.5l2-4M19 7.5l2-1" />
        <circle cx="8" cy="17" r="2" />
        <circle cx="16" cy="17" r="2" />
      </>
    );
  } else if (category.includes('automation')) {
    glyph = (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 9h8M8 13h3M14 13h2M8 17h5" />
        <circle cx="16.5" cy="17" r="1" />
      </>
    );
  } else if (category.includes('additional sanitation') || category.includes('additional option')) {
    glyph = (
      <>
        <path d="M9 3h6M10 3v5l-4.2 7.2A3.8 3.8 0 0 0 9.1 21h5.8a3.8 3.8 0 0 0 3.3-5.8L14 8V3" />
        <path d="M7.5 15h7M18 7v6M15 10h6" />
      </>
    );
  } else if (category.includes('sanitation')) {
    glyph = (
      <>
        <path d="M12 3 19 6v5c0 4.7-2.8 8-7 10-4.2-2-7-5.3-7-10V6l7-3Z" />
        <path d="m12 7 .7 2.1L15 10l-2.3.8L12 13l-.7-2.2L9 10l2.3-.9L12 7Z" />
      </>
    );
  } else if (category.includes('light')) {
    glyph = (
      <>
        <path d="M8 14a6 6 0 1 1 8 0l-1.5 2H9.5L8 14ZM10 19h4M10.5 22h3" />
      </>
    );
  } else if (category.includes('heater')) {
    glyph = (
      <>
        <path d="M12 3c2 3 4.5 5.5 4.5 9.5A4.5 4.5 0 0 1 12 17a4.5 4.5 0 0 1-4.5-4.5c0-2.5 1.3-4.3 3-6.2.1 2.4.8 3.7 2 4.7.8-2.5.5-5.2-.5-8Z" />
        <path d="M7 21h10" />
      </>
    );
  } else if (category.includes('blower')) {
    glyph = (
      <>
        <circle cx="12" cy="12" r="2" />
        <path d="M12 10c-1-4 1.2-6 4-5 2.2.8 2 3.5.2 5.2M14 12c4-1 6 1.2 5 4-1 2.2-3.6 2-5.2.2M12 14c1 4-1.2 6-4 5-2.2-1-2-3.6-.2-5.2M10 12c-4 1-6-1.2-5-4 1-2.2 3.6-2 5.2-.2" />
      </>
    );
  } else if (category.includes('auto-fill')) {
    glyph = (
      <>
        <path d="M4 8h10M7 8V5h6v3M14 8v4h4" />
        <path d="M18 12v3M15.5 18.5a2.5 2.5 0 0 0 5 0c0-1.7-2.5-4.5-2.5-4.5s-2.5 2.8-2.5 4.5Z" />
      </>
    );
  } else if (category.includes('custom')) {
    glyph = (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
        <circle cx="10" cy="12" r="2" />
      </>
    );
  } else {
    glyph = (
      <>
        <path d="M5 7h14v12H5zM8 4h8v3M8 11h8M8 15h5" />
      </>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {glyph}
    </svg>
  );
};

const EquipmentCategoryTitle = ({ label, children }: { label: string; children?: ReactNode }) => (
  <div className="equipment-category-title-row">
    <span className="equipment-category-icon">
      <PackageContentsIcon label={label} />
    </span>
    <div className="equipment-category-title-copy">
      <h2 className="spec-block-title">{label}</h2>
      {children}
    </div>
  </div>
);

const AdditionalItemRemoveAction = ({
  label,
  onRemove,
  disabled = false,
  disabledReason,
}: {
  label: string;
  onRemove: () => void;
  disabled?: boolean;
  disabledReason?: string;
}) => (
  <TooltipAnchor as="div" className="equipment-item-toggle-anchor" tooltip={disabled ? disabledReason : undefined}>
    <button
      type="button"
      className="link-btn danger"
      aria-label={`Remove ${label}`}
      disabled={disabled}
      onClick={onRemove}
    >
      Remove
    </button>
  </TooltipAnchor>
);

const WATER_FEATURE_PUMP_LOCKED_MESSAGE = 'Cannot be modified - Required with chosen Water Features';

function EquipmentSectionNew({
  data,
  onChange,
  onSelectPackage,
  plumbingRuns,
  onChangePlumbingRuns,
  hasSpa,
  hasPool,
  isPpasEast = false,
  noteOverrides,
  priceImpactRequestKey = '',
  getEquipmentPriceImpact,
}: Props) {
  const autoFillSelectionRequiresElectric = (selection?: { name?: string; requiresElectricRun?: boolean }) => {
    const selectionName = selection?.name?.trim() || '';
    const normalizedName = selectionName.toLowerCase();
    const catalogMatch = selectionName
      ? pricingData.equipment.autoFillSystem.find((system) => system.name === selectionName)
      : undefined;
    return Boolean(selection?.requiresElectricRun || catalogMatch?.requiresElectricRun || normalizedName.includes('electric'));
  };

  const defaults = useMemo(() => {
    const byCost = <T,>(list: T[]) =>
      list.find((item: any) => getEquipmentItemCost(item) === 0) || list[0];
    const pump = getNoPumpSelection();
    const filter = byCost(pricingData.equipment.filters);
    const cleaner = getDefaultCleanerOption(pricingData.equipment.cleaners) || byCost(pricingData.equipment.cleaners);
    const noCleaner = getNoCleanerOption(pricingData.equipment.cleaners) || byCost(pricingData.equipment.cleaners);
    const heater = byCost(pricingData.equipment.heaters);
    const heaterChillerCatalog = ((pricingData as any).equipment?.heaterChillers || []) as any[];
    const heaterChiller = byCost(heaterChillerCatalog) || {
      name: 'No Heater Chiller (Select heater chiller)',
      basePrice: 0,
      addCost1: 0,
      addCost2: 0,
    };
    const automation = byCost(pricingData.equipment.automation);
    const autoFillSystem = byCost(pricingData.equipment.autoFillSystem);
    return { pump, filter, cleaner, noCleaner, heater, heaterChiller, automation, autoFillSystem };
  }, []);

  const selectableDefaults = useMemo(() => ({
    pump: pricingData.equipment.pumps.find(p => !p.name.toLowerCase().includes('no pump')) || pricingData.equipment.pumps[0],
    filter: pricingData.equipment.filters.find(f => !f.name.toLowerCase().includes('no filter')) || pricingData.equipment.filters[0],
    cleaner:
      getDefaultCleanerOption(pricingData.equipment.cleaners) ||
      pricingData.equipment.cleaners.find(cleaner => !isNoCleanerSelection(cleaner.name)) ||
      pricingData.equipment.cleaners[0],
    heater: pricingData.equipment.heaters.find(h => !h.name.toLowerCase().includes('no heater')) || pricingData.equipment.heaters[0],
    heaterChiller:
      (((pricingData as any).equipment?.heaterChillers || []) as any[]).find(
        (item) => !String(item?.name || '').toLowerCase().includes('no heater chiller')
      ) || ((pricingData as any).equipment?.heaterChillers || [])[0],
    automation: pricingData.equipment.automation.find(a => !a.name.toLowerCase().includes('no automation')) || pricingData.equipment.automation[0],
    saltSystem: pricingData.equipment.saltSystem.find(s => !isNoSaltSystemName(s.name)) || pricingData.equipment.saltSystem[0],
    autoFillSystem: pricingData.equipment.autoFillSystem.find(s => !s.name.toLowerCase().includes('no auto')) || pricingData.equipment.autoFillSystem[0],
  }), []);

  const hasRealSelection = (name: string | undefined, placeholder: string) =>
    !!(name && !name.toLowerCase().includes(placeholder));

  const pumpOverhead = pricingData.equipment.pumpOverheadMultiplier ?? 1;
  const costOf = (item: any, applyPumpOverhead?: boolean) =>
    getEquipmentItemCost(item, applyPumpOverhead ? pumpOverhead : 1);
  const hasHeaterSelection = hasRealSelection(data?.heater?.name, 'no heater');
  const isSpaAutoAddedHeater = (heater?: Equipment['heater']) =>
    Boolean(heater?.autoAddedForSpa || heater?.autoAddedReason === 'spa');
  const isAutomaticallyAddedItem = (item?: { autoAddedForSpa?: boolean; autoAddedReason?: string }) =>
    Boolean(item?.autoAddedForSpa || item?.autoAddedReason);
  const noneOptionValue = 'none';
  const formatOptionLabel = (label: string, _amount?: number) => label;
  const isAuxPumpPlaceholder = (name: string) => {
    const lowered = name.toLowerCase();
    return lowered.includes('no pump') || lowered.includes('no aux') || lowered.includes('no auxiliary') || lowered.includes('no blower');
  };
  const getDefaultAuxiliaryPump = () =>
    auxiliaryPumpCatalog.find((pump: any) => pump.defaultAuxiliaryPump) ||
    auxiliaryPumpCatalog.find((pump: any) => !isAuxPumpPlaceholder(pump.name)) ||
    auxiliaryPumpCatalog[0];

  const pumpOptions = pricingData.equipment.pumps.filter(pump => !pump.name.toLowerCase().includes('no pump'));
  const auxiliaryPumpCatalog =
    (pricingData as any).equipment?.auxiliaryPumps?.length
      ? (pricingData as any).equipment.auxiliaryPumps
      : pricingData.equipment.pumps;
  const auxiliaryPumpOptions = auxiliaryPumpCatalog.filter((pump: any) =>
    !isAuxPumpPlaceholder(pump.name)
  );
  const filterOptions = pricingData.equipment.filters.filter(filter => !filter.name.toLowerCase().includes('no filter'));
  const cleanerOptions = pricingData.equipment.cleaners.filter(cleaner => !cleaner.name.toLowerCase().includes('no cleaner'));
  const heaterOptions = pricingData.equipment.heaters.filter(heater => !heater.name.toLowerCase().includes('no heater'));
  const heaterChillerCatalog = ((pricingData as any).equipment?.heaterChillers || []) as any[];
  const heaterChillerOptions = heaterChillerCatalog.filter(
    (item: any) => !String(item?.name || '').toLowerCase().includes('no heater chiller')
  );
  const automationOptions = pricingData.equipment.automation.filter(auto => !auto.name.toLowerCase().includes('no automation'));
  const saltCatalog = pricingData.equipment.saltSystem.filter(system => !isNoSaltSystemName(system.name));
  const autoFillOptions = pricingData.equipment.autoFillSystem.filter(system => !system.name.toLowerCase().includes('no auto'));
  const sanitationAccessoryCatalog = ((pricingData as any).equipment?.sanitationAccessories || []) as any[];
  const sanitationAccessoryOptions = sanitationAccessoryCatalog.filter(
    (accessory: any) => !accessory.name.toLowerCase().includes('no sanitation')
  );

  const normalizeOptionName = (value?: string | null) => String(value || '').trim().toLowerCase();
  const findActiveOptionByName = <T extends { name?: string | null }>(
    options: T[],
    name?: string | null
  ): T | undefined => {
    const target = normalizeOptionName(name);
    if (!target) return undefined;
    return options.find((option) => normalizeOptionName(option?.name) === target);
  };
  const getActiveOrDefaultOption = <T extends { name?: string | null }>(
    options: T[],
    name?: string | null,
    fallback?: T
  ): T | undefined => findActiveOptionByName(options, name) || fallback || options[0];

  const buildAutoFillSelection = (system: any) => ({
    name: system?.name || '',
    model: (system as any)?.model,
    basePrice: (system as any)?.basePrice,
    addCost1: (system as any)?.addCost1,
    addCost2: (system as any)?.addCost2,
    price: costOf(system),
    percentIncrease: (system as any)?.percentIncrease,
    requiresElectricRun: (system as any)?.requiresElectricRun,
  });
  const buildSaltSystemSelection = (system: any): SaltSystemSelection => ({
    name: system?.name || '',
    model: (system as any)?.model,
    basePrice: (system as any)?.basePrice,
    addCost1: (system as any)?.addCost1,
    addCost2: (system as any)?.addCost2,
    price: costOf(system),
    excludedFromSaltCell: (system as any)?.excludedFromSaltCell,
    includedSaltCellPlaceholder: false,
  });
  const buildAdditionalSanitationSelection = (option: any): SaltSystemSelection => ({
    name: option?.name || '',
    model: (option as any)?.model,
    basePrice: (option as any)?.basePrice,
    addCost1: (option as any)?.addCost1,
    addCost2: (option as any)?.addCost2,
    price: costOf(option),
    excludedFromSaltCell: true,
    includedSaltCellPlaceholder: false,
  });

  const hasPumpSelection = hasRealSelection(data?.pump?.name, 'no pump');
  const normalizedAdditionalPumps = getAdditionalPumpSelections(data);
  const normalizedBasePumpQuantity = Math.max(getBasePumpQuantity(data), 0);
  const normalizedAuxiliaryPumps =
    Array.isArray(data?.auxiliaryPumps) && data.auxiliaryPumps.length > 0
      ? data.auxiliaryPumps.filter(Boolean).slice(0, 1)
      : data?.auxiliaryPump
      ? [data.auxiliaryPump]
      : [];

  const baseSafeData: Equipment = {
    pump: data?.pump || {
      name: defaults.pump.name,
      model: (defaults.pump as any).model,
      basePrice: (defaults.pump as any).basePrice,
      addCost1: (defaults.pump as any).addCost1,
      addCost2: (defaults.pump as any).addCost2,
      price: costOf(defaults.pump, true),
    },
    pumpQuantity: normalizedBasePumpQuantity || Math.max(data?.pumpQuantity ?? (hasPumpSelection ? 1 : 0), 0),
    additionalPumps: normalizedAdditionalPumps,
    auxiliaryPumps: normalizedAuxiliaryPumps,
    auxiliaryPump: data?.auxiliaryPump ?? normalizedAuxiliaryPumps[0],
    filter: data?.filter || {
      name: defaults.filter.name,
      sqft: (defaults.filter as any).sqft,
      basePrice: (defaults.filter as any).basePrice,
      addCost1: (defaults.filter as any).addCost1,
      addCost2: (defaults.filter as any).addCost2,
      price: costOf(defaults.filter),
    },
    filterQuantity: data?.filterQuantity ?? 0,
    additionalFilters: Array.isArray(data?.additionalFilters) ? data.additionalFilters.filter(Boolean) : [],
    cleaner: data?.cleaner || {
      name: defaults.noCleaner.name,
      basePrice: (defaults.noCleaner as any).basePrice,
      addCost1: (defaults.noCleaner as any).addCost1,
      addCost2: (defaults.noCleaner as any).addCost2,
      price: costOf(defaults.noCleaner),
    },
    cleanerQuantity: data?.cleanerQuantity ?? getDefaultCleanerQuantity(data?.cleaner),
    heater: data?.heater || {
      name: defaults.heater.name,
      btu: (defaults.heater as any).btu,
      basePrice: (defaults.heater as any).basePrice,
      addCost1: (defaults.heater as any).addCost1,
      addCost2: (defaults.heater as any).addCost2,
      price: costOf(defaults.heater),
    },
    heaterQuantity: hasHeaterSelection ? Math.max(data?.heaterQuantity ?? 1, 1) : 0,
    additionalHeaters: Array.isArray(data?.additionalHeaters) ? data.additionalHeaters.filter(Boolean) : [],
    heaterChiller: data?.heaterChiller,
    heaterChillerQuantity:
      hasRealSelection(data?.heaterChiller?.name, 'no heater chiller')
        ? Math.max(data?.heaterChillerQuantity ?? 1, 1)
        : 0,
    includePoolLights: data?.includePoolLights,
    applyCustomPackageDefaultPoolLights: data?.applyCustomPackageDefaultPoolLights,
    includeSpaLights: data?.includeSpaLights,
    poolLights: data?.poolLights,
    spaLights: data?.spaLights,
    numberOfLights: data?.numberOfLights ?? 0,
    hasSpaLight: data?.hasSpaLight ?? false,
    automation: data?.automation || {
      name: defaults.automation.name,
      basePrice: (defaults.automation as any).basePrice,
      addCost1: (defaults.automation as any).addCost1,
      addCost2: (defaults.automation as any).addCost2,
      addCost3: (defaults.automation as any).addCost3,
      includesSaltCell: (defaults.automation as any).includesSaltCell,
      price: costOf(defaults.automation),
      zones: data?.automation?.zones ?? 0,
    },
    automationQuantity: data?.automationQuantity ?? 0,
    saltSystem: data?.saltSystem,
    saltSystemQuantity:
      data?.saltSystemQuantity ?? (isRealSaltSystemSelection(data?.saltSystem) ? 1 : 0),
    additionalSaltSystem: data?.additionalSaltSystem,
    autoFillSystem:
      data?.autoFillSystem ??
      (data?.hasAutoFill
        ? buildAutoFillSelection(selectableDefaults.autoFillSystem || defaults.autoFillSystem)
        : undefined),
    autoFillSystemQuantity: data?.autoFillSystemQuantity ?? (data?.hasAutoFill ? 1 : 0),
    sanitationAccessory: data?.sanitationAccessory,
    sanitationAccessoryQuantity: data?.sanitationAccessoryQuantity ?? 0,
    hasBlanketReel: data?.hasBlanketReel ?? false,
    hasSolarBlanket: data?.hasSolarBlanket ?? false,
    hasAutoFill: data?.hasAutoFill ?? false,
    hasHandrail: data?.hasHandrail ?? false,
    hasStartupChemicals: data?.hasStartupChemicals ?? false,
    packageSelectionId: data?.packageSelectionId,
    packageSelectionTouched: data?.packageSelectionTouched,
    customOptions: data?.customOptions ?? [],
    totalCost: data?.totalCost ?? 0,
    hasBeenEdited: data?.hasBeenEdited ?? false,
  };

  const safeData = normalizeEquipmentLighting(baseSafeData, { hasPool, hasSpa });
  const retiredFlags = getRetiredEquipmentFlags(safeData);
  const packageOptions = getEnabledEquipmentPackageOptions();
  const selectedPackage = getSelectedEquipmentPackage(safeData);
  const isFixedPackage = isFixedEquipmentPackage(selectedPackage);
  const packageIncludesPump = isFixedPackage && Math.max(selectedPackage?.includedPumpQuantity ?? 0, 0) > 0;
  const packageIncludesFilter = isFixedPackage && Math.max(selectedPackage?.includedFilterQuantity ?? 0, 0) > 0;
  const packageIncludesCleaner = isFixedPackage && Math.max(selectedPackage?.includedCleanerQuantity ?? 0, 0) > 0;
  const packageIncludesHeater = isFixedPackage && Math.max(selectedPackage?.includedHeaterQuantity ?? 0, 0) > 0;
  const packageIncludesPoolLights = isFixedPackage && Math.max(selectedPackage?.includedPoolLightQuantity ?? 0, 0) > 0;
  const packageIncludesSpaLights = isFixedPackage && Math.max(selectedPackage?.includedSpaLightQuantity ?? 0, 0) > 0;
  const packageIncludesAutomation = isFixedPackage && Math.max(selectedPackage?.includedAutomationQuantity ?? 0, 0) > 0;
  const packageIncludesSalt = isFixedPackage && Math.max(selectedPackage?.includedSaltSystemQuantity ?? 0, 0) > 0;
  const packageIncludesAutoFill = isFixedPackage && Math.max(selectedPackage?.includedAutoFillSystemQuantity ?? 0, 0) > 0;
  const packageIncludesSanitationAccessory =
    isFixedPackage && Math.max(selectedPackage?.includedSanitationAccessoryQuantity ?? 0, 0) > 0;
  const packageLocksSanitationSystem = isFixedPackage;
  const packageHasNoSanitationSystem = packageLocksSanitationSystem && !packageIncludesSalt;
  const packageAllowsPumpChanges = !isFixedPackage || packageAllowsAdditionalPumps(selectedPackage);
  const packageAllowsHeaterChanges = !isFixedPackage || Boolean(selectedPackage?.allowHeaterUpgrade);
  const packageAllowsCleanerChanges = !isFixedPackage || Boolean(selectedPackage?.allowCleanerUpgrade);
  const packageAllowsPoolLightChanges = !isFixedPackage || Boolean(selectedPackage?.allowPoolLightUpgrade);
  const packageAllowsSpaLightChanges = !isFixedPackage || Boolean(selectedPackage?.allowSpaLightUpgrade);
  const packageAllowsAutoFillChanges = !isFixedPackage || Boolean(selectedPackage?.allowAutoFillUpgrade);
  const packageAllowsSanitationAccessoryChanges =
    !isFixedPackage || Boolean(selectedPackage?.allowSanitationAccessoryUpgrade);
  const selectedPackageName = selectedPackage?.name || 'this package';
  const sanitationAccessoryQuantity = Math.max(
    safeData.sanitationAccessoryQuantity ?? (safeData.sanitationAccessory?.name ? 1 : 0),
    0
  );
  const editableSanitationAccessorySelected =
    !isFixedPackage &&
    sanitationAccessoryQuantity > 0 &&
    !!safeData.sanitationAccessory?.name &&
    !safeData.sanitationAccessory.name.toLowerCase().includes('no sanitation');
  const packageButtonDisabledMessage = 'This equipment package is not possible with a Spa';
  const packageDimensionsRequiredMessage = 'Define dimensions in Pool Specs first';
  const packageSelectionRequiredMessage = 'An equipment package must be chosen first';
  const packageLockedCategoryMessage = `${selectedPackageName} includes this selection. Change the package to modify it.`;
  const heaterRequiredBySpa = hasSpa;
  const heaterNoDisabledReason = heaterRequiredBySpa
    ? 'A heater is required when a spa is selected.'
    : packageIncludesHeater
      ? packageLockedCategoryMessage
      : undefined;
  const heaterAutoAddedBySpa = isSpaAutoAddedHeater(safeData.heater);
  const addSpaLightDisabledReason =
    isFixedPackage && !packageAllowsSpaLightChanges
      ? 'This equipment package does not allow spa light upgrades.'
      : undefined;
  const cleanerDisabledByPackage = isFixedPackage && !packageIncludesCleaner && !packageAllowsCleanerChanges;
  const heaterDisabledByPackage = isFixedPackage && !packageIncludesHeater && !packageAllowsHeaterChanges;
  const automationDisabledByPackage = isFixedPackage && !packageIncludesAutomation;
  const autoFillDisabledByPackage = isFixedPackage && !packageIncludesAutoFill && !packageAllowsAutoFillChanges;
  const additionalSanitationDisabledByPackage =
    isFixedPackage && !packageIncludesSanitationAccessory && !packageAllowsSanitationAccessoryChanges;

  const renderRetiredOption = (name?: string) =>
    name ? (
      <option key={`retired-${name}`} value={name}>
        Removed - Please Select Another
      </option>
    ) : null;

  const [includePump, setIncludePump] = useState<boolean>(() => hasRealSelection(data?.pump?.name, 'no pump'));
  const [includeFilter, setIncludeFilter] = useState<boolean>(() => hasRealSelection(data?.filter?.name, 'no filter'));
  const [includeCleaner, setIncludeCleaner] = useState<boolean>(() => hasRealSelection(data?.cleaner?.name, 'no cleaner'));
  const [includeHeater, setIncludeHeater] = useState<boolean>(() => hasHeaterSelection);
  const [includeHeaterChiller, setIncludeHeaterChiller] = useState<boolean>(() =>
    hasRealSelection(data?.heaterChiller?.name, 'no heater chiller')
  );
  const [includePoolLights, setIncludePoolLights] = useState<boolean>(() => (safeData.poolLights?.length ?? 0) > 0);
  const [includeSpaLights, setIncludeSpaLights] = useState<boolean>(() => (safeData.spaLights?.length ?? 0) > 0);
  const [includeAutomation, setIncludeAutomation] = useState<boolean>(() =>
    hasRealSelection(data?.automation?.name, 'no automation') ||
    (data?.automationQuantity ?? 0) > 0 ||
    (data?.automation?.zones ?? 0) > 0
  );
  const [includeSalt, setIncludeSalt] = useState<boolean>(() => hasRealSelection(safeData.saltSystem?.name, 'no salt'));
  const [includeAutoFill, setIncludeAutoFill] = useState<boolean>(() =>
    hasRealSelection(safeData.autoFillSystem?.name, 'no auto')
  );
  const [pumpEditing, setPumpEditing] = useState(false);
  const [filterEditing, setFilterEditing] = useState(false);
  const [cleanerEditing, setCleanerEditing] = useState(false);
  const [heaterEditing, setHeaterEditing] = useState(false);
  const [heaterChillerEditing, setHeaterChillerEditing] = useState(false);
  const [automationEditing, setAutomationEditing] = useState(false);
  const [sanitationEditing, setSanitationEditing] = useState(false);
  const [additionalSanitationEditing, setAdditionalSanitationEditing] = useState(false);
  const [autoFillEditing, setAutoFillEditing] = useState(false);
  const [activeAdditionalPumpIndex, setActiveAdditionalPumpIndex] = useState<number | null>(null);
  const [activeAdditionalFilterIndex, setActiveAdditionalFilterIndex] = useState<number | null>(null);
  const [activeAdditionalHeaterIndex, setActiveAdditionalHeaterIndex] = useState<number | null>(null);
  const [activeAuxiliaryPumpIndex, setActiveAuxiliaryPumpIndex] = useState<number | null>(null);
  const [activePoolLightIndex, setActivePoolLightIndex] = useState<number | null>(null);
  const [activeSpaLightIndex, setActiveSpaLightIndex] = useState<number | null>(null);

  useEffect(() => {
    setIncludePump(hasRealSelection(safeData.pump?.name, 'no pump') && (safeData.pumpQuantity ?? 0) > 0);
    setIncludeFilter(hasRealSelection(safeData.filter?.name, 'no filter') && (safeData.filterQuantity ?? 0) > 0);
    setIncludeCleaner(hasRealSelection(safeData.cleaner?.name, 'no cleaner') && (safeData.cleanerQuantity ?? 0) > 0);
    setIncludeHeater(hasRealSelection(safeData.heater?.name, 'no heater') && (safeData.heaterQuantity ?? 0) > 0);
    setIncludeHeaterChiller(
      hasRealSelection(safeData.heaterChiller?.name, 'no heater chiller') &&
        (safeData.heaterChillerQuantity ?? 0) > 0
    );
    setIncludePoolLights((safeData.poolLights?.length ?? 0) > 0);
    setIncludeSpaLights((safeData.spaLights?.length ?? 0) > 0);
    setIncludeAutomation(
      (hasRealSelection(safeData.automation?.name, 'no automation') && (safeData.automationQuantity ?? 0) > 0) ||
        (safeData.automation?.zones ?? 0) > 0
    );
    setIncludeSalt(
      isRealSaltSystemSelection(safeData.saltSystem) ||
        isIncludedSaltCellSelection(safeData.saltSystem)
    );
    setIncludeAutoFill(
      hasRealSelection(safeData.autoFillSystem?.name, 'no auto') && (safeData.autoFillSystemQuantity ?? 0) > 0
    );
  }, [
    safeData.packageSelectionId,
    safeData.pump?.name,
    safeData.pumpQuantity,
    safeData.additionalPumps,
    safeData.filter?.name,
    safeData.filterQuantity,
    safeData.cleaner?.name,
    safeData.cleanerQuantity,
    safeData.heater?.name,
    safeData.heaterQuantity,
    safeData.additionalHeaters,
    safeData.heaterChiller?.name,
    safeData.heaterChillerQuantity,
    safeData.additionalFilters,
    safeData.poolLights,
    safeData.spaLights,
    safeData.automation?.name,
    safeData.automation?.zones,
    safeData.automationQuantity,
    safeData.saltSystem?.name,
    safeData.saltSystem?.includedSaltCellPlaceholder,
    safeData.autoFillSystem?.name,
    safeData.autoFillSystemQuantity,
  ]);
  const additionalPumps = safeData.additionalPumps || [];
  const additionalFilters = safeData.additionalFilters || [];
  const additionalHeaters = safeData.additionalHeaters || [];
  const auxiliaryPumps = safeData.auxiliaryPumps || [];
  const blowerRequiredBySpa = auxiliaryPumps.some(
    (pump) => pump.autoAddedForSpa || pump.autoAddedReason === 'spa'
  );
  const maxAuxiliaryPumps = 1;
  const pumpQuantity = Math.max(safeData.pumpQuantity ?? (includePump ? 1 : 0), 0);
  const includedPumpQuantity = packageIncludesPump ? Math.max(selectedPackage?.includedPumpQuantity ?? 0, 0) : 0;
  const primaryPumpSummaryQuantity = hasRealSelection(safeData.pump?.name, 'no pump') && pumpQuantity > 0 ? pumpQuantity : 0;
  const showPrimaryPumpControls = includePump || packageIncludesPump;
  const cleanerQuantity = Math.max(safeData.cleanerQuantity ?? (includeCleaner ? 1 : 0), 0);
  const filterQuantity = Math.max(safeData.filterQuantity ?? (includeFilter ? 1 : 0), 0);
  const heaterQuantity = Math.max(safeData.heaterQuantity ?? (includeHeater ? 1 : 0), 0);
  const heaterChillerQuantity = Math.max(
    safeData.heaterChillerQuantity ?? (includeHeaterChiller ? 1 : 0),
    0
  );
  const supportsMultipleHeatersAndFilters =
    Boolean(selectedPackage && isCustomEquipmentPackage(selectedPackage));
  const automationQuantity = Math.max(safeData.automationQuantity ?? (includeAutomation ? 1 : 0), 0);
  const saltSystemQuantity = Math.max(
    safeData.saltSystemQuantity ?? (isRealSaltSystemSelection(safeData.saltSystem) ? 1 : 0),
    0
  );
  const autoFillSystemQuantity = Math.max(
    safeData.autoFillSystemQuantity ?? (includeAutoFill ? 1 : 0),
    0
  );
  const selectedAutoFillForRun =
    safeData.autoFillSystem?.name
      ? safeData.autoFillSystem
      : selectedPackage?.includedAutoFillSystemName
      ? { name: selectedPackage.includedAutoFillSystemName }
      : undefined;
  const autoFillRequiresElectric =
    (includeAutoFill || packageIncludesAutoFill) && autoFillSelectionRequiresElectric(selectedAutoFillForRun);
  const automationHasIncludedSaltCell =
    includeAutomation &&
    hasRealSelection(safeData.automation?.name, 'no automation') &&
    automationIncludesSaltCell(safeData.automation);
  const sanitationRequiredByAutomation =
    !packageHasNoSanitationSystem &&
    includeAutomation &&
    hasRealSelection(safeData.automation?.name, 'no automation');
  const primarySaltOptions = saltCatalog.filter(system => !isExcludedFromSaltCell(system));
  const additionalSaltOptions = saltCatalog.filter(system => isExcludedFromSaltCell(system));
  const additionalSanitationOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...additionalSaltOptions, ...sanitationAccessoryOptions].filter((option: any) => {
      const key = option?.name?.trim()?.toLowerCase?.();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [additionalSaltOptions, sanitationAccessoryOptions]);
  const visibleSaltOptions = automationHasIncludedSaltCell
    ? [buildIncludedSaltCellOption(), ...primarySaltOptions]
    : primarySaltOptions;
  const showSaltQuantity = includeSalt && isRealSaltSystemSelection(safeData.saltSystem);
  const additionalSanitationOptionSelectedName =
    safeData.additionalSaltSystem?.name ||
    (editableSanitationAccessorySelected ? safeData.sanitationAccessory?.name || '' : '');
  const poolLights = safeData.poolLights || [];
  const spaLights = safeData.spaLights || [];
  const summarizeQuantity = (name: string, quantity: number) =>
    quantity > 1 ? `${quantity} x ${name}` : name;
  const packageSummaryRows = useMemo(() => {
    const rows: Array<{ id: string; label: string; value: string }> = [];
    const additionalCounts = new Map<string, number>();
    const pushRow = (id: string, label: string, value?: string) => {
      if (!value) return;
      rows.push({ id, label, value });
    };
    const pushAdditionalRow = (id: string, category: string, value?: string) => {
      if (!value) return;
      const nextNumber = (additionalCounts.get(category) || 0) + 1;
      additionalCounts.set(category, nextNumber);
      pushRow(id, `Additional ${category} ${nextNumber}`, value);
    };
    const pushSelectionRows = (idPrefix: string, category: string, value: string | undefined, quantity: number) => {
      if (!value) return;
      const count = Math.max(Math.floor(quantity), 0);
      Array.from({ length: count }, (_, index) => {
        if (index === 0) {
          pushRow(`${idPrefix}-${index}`, category, value);
          return;
        }
        pushAdditionalRow(`${idPrefix}-${index}`, category, value);
      });
    };
    const effectiveSaltName = getEffectivePrimarySanitationSystemName(safeData);
    const effectiveSaltQuantity = packageIncludesSalt
      ? Math.max(selectedPackage?.includedSaltSystemQuantity ?? saltSystemQuantity, 0)
      : saltSystemQuantity;

    if (
      primaryPumpSummaryQuantity > 0 &&
      hasRealSelection(safeData.pump?.name, 'no pump')
    ) {
      pushSelectionRows('pump-primary', 'Pump', safeData.pump?.name || 'Pump', primaryPumpSummaryQuantity);
    }

    additionalPumps.forEach((pump, index) => {
      if (hasRealSelection(pump?.name, 'no pump')) {
        pushAdditionalRow(`pump-additional-${index}`, 'Pump', pump?.name);
      }
    });

    auxiliaryPumps.forEach((pump, index) => {
      if (pump?.name && !isAuxPumpPlaceholder(pump.name)) {
        if (index === 0) {
          pushRow(`blower-${index}`, 'Blower', pump.name);
        } else {
          pushAdditionalRow(`blower-${index}`, 'Blower', pump.name);
        }
      }
    });

    if ((packageIncludesFilter || includeFilter) && hasRealSelection(safeData.filter?.name, 'no filter') && filterQuantity > 0) {
      pushSelectionRows('filter-primary', 'Filter', safeData.filter?.name || 'Filter', filterQuantity);
    }
    if (supportsMultipleHeatersAndFilters) {
      additionalFilters.forEach((filter, index) => {
        pushAdditionalRow(`filter-additional-${index}`, 'Filter', filter?.name);
      });
    }

    if ((packageIncludesCleaner || includeCleaner) && hasRealSelection(safeData.cleaner?.name, 'no cleaner') && cleanerQuantity > 0) {
      pushSelectionRows('cleaner', 'Cleaner', safeData.cleaner?.name || 'Cleaner', cleanerQuantity);
    }

    if ((packageIncludesHeater || includeHeater) && hasRealSelection(safeData.heater?.name, 'no heater') && heaterQuantity > 0) {
      pushSelectionRows('heater-primary', 'Heater', safeData.heater?.name || 'Heater', heaterQuantity);
    }
    if (supportsMultipleHeatersAndFilters) {
      additionalHeaters.forEach((heater, index) => {
        pushAdditionalRow(`heater-additional-${index}`, 'Heater', heater?.name);
      });
    }
    if (
      supportsMultipleHeatersAndFilters &&
      hasRealSelection(safeData.heaterChiller?.name, 'no heater chiller') &&
      heaterChillerQuantity > 0
    ) {
      pushSelectionRows(
        'heater-chiller',
        'Heater Chiller',
        safeData.heaterChiller?.name || 'Heater Chiller',
        heaterChillerQuantity
      );
    }

    if (
      (packageIncludesAutomation || includeAutomation) &&
      hasRealSelection(safeData.automation?.name, 'no automation') &&
      automationQuantity > 0
    ) {
      pushSelectionRows(
        'automation',
        'Automation',
        safeData.automation?.name || 'Automation',
        automationQuantity
      );
    }

    if (
      isIncludedSaltCellSelection(safeData.saltSystem) ||
      isIncludedSaltCellOptionName(effectiveSaltName)
    ) {
      pushRow('sanitation-included', 'Sanitation', effectiveSaltName || 'Included Salt Cell');
    } else if (
      (packageIncludesSalt || includeSalt) &&
      effectiveSaltName &&
      !isNoSaltSystemName(effectiveSaltName) &&
      !isIncludedSaltCellOptionName(effectiveSaltName) &&
      effectiveSaltQuantity > 0
    ) {
      pushSelectionRows(
        'sanitation',
        'Sanitation',
        effectiveSaltName || 'Sanitation System',
        effectiveSaltQuantity
      );
    }

    const additionalSanitationSummaryName =
      safeData.additionalSaltSystem?.name ||
      (editableSanitationAccessorySelected ? safeData.sanitationAccessory?.name : undefined);
    if (additionalSanitationSummaryName) {
      pushAdditionalRow('sanitation-additional', 'Sanitation Option', additionalSanitationSummaryName);
    } else if (packageIncludesSanitationAccessory && !!safeData.sanitationAccessory?.name && sanitationAccessoryQuantity > 0) {
      Array.from({ length: Math.max(Math.floor(sanitationAccessoryQuantity), 0) }, (_, index) => {
        pushAdditionalRow(`sanitation-accessory-${index}`, 'Sanitation Option', safeData.sanitationAccessory?.name);
      });
    }

    if (poolLights.length > 0) {
      poolLights.forEach((light, index) => {
        if (index === 0) {
          pushRow(`pool-light-${index}`, 'Pool Light', light?.name);
        } else {
          pushAdditionalRow(`pool-light-${index}`, 'Pool Light', light?.name);
        }
      });
    } else if (
      packageIncludesPoolLights &&
      selectedPackage?.includedPoolLightName &&
      Math.max(selectedPackage?.includedPoolLightQuantity ?? 0, 0) > 0
    ) {
      pushSelectionRows(
        'pool-light-included',
        'Pool Light',
        selectedPackage.includedPoolLightName,
        Math.max(selectedPackage.includedPoolLightQuantity ?? 0, 0)
      );
    } else if (
      hasPool &&
      !isFixedPackage &&
      safeData.applyCustomPackageDefaultPoolLights !== false &&
      selectedPackage?.defaultPoolLightName &&
      Math.max(selectedPackage?.defaultPoolLightQuantity ?? 0, 0) > 0
    ) {
      pushSelectionRows(
        'pool-light-default',
        'Pool Light',
        selectedPackage.defaultPoolLightName,
        Math.max(selectedPackage.defaultPoolLightQuantity ?? 0, 0)
      );
    }

    if (spaLights.length > 0) {
      spaLights.forEach((light, index) => {
        if (index === 0) {
          pushRow(`spa-light-${index}`, 'Spa Light', light?.name);
        } else {
          pushAdditionalRow(`spa-light-${index}`, 'Spa Light', light?.name);
        }
      });
    } else if (
      packageIncludesSpaLights &&
      selectedPackage?.includedSpaLightName &&
      Math.max(selectedPackage?.includedSpaLightQuantity ?? 0, 0) > 0
    ) {
      pushSelectionRows(
        'spa-light-included',
        'Spa Light',
        selectedPackage.includedSpaLightName,
        Math.max(selectedPackage.includedSpaLightQuantity ?? 0, 0)
      );
    }

    if (
      (packageIncludesAutoFill || includeAutoFill) &&
      hasRealSelection(safeData.autoFillSystem?.name, 'no auto') &&
      autoFillSystemQuantity > 0
    ) {
      pushSelectionRows(
        'auto-fill',
        'Auto-Fill',
        safeData.autoFillSystem?.name || 'Auto-Fill System',
        autoFillSystemQuantity
      );
    }

    return rows;
  }, [
    additionalPumps,
    additionalFilters,
    additionalHeaters,
    auxiliaryPumps,
    autoFillSystemQuantity,
    automationQuantity,
    cleanerQuantity,
    filterQuantity,
    heaterQuantity,
    heaterChillerQuantity,
    includeAutoFill,
    includeAutomation,
    includeCleaner,
    includeFilter,
    includeHeater,
    includeHeaterChiller,
    includePump,
    includeSalt,
    editableSanitationAccessorySelected,
    packageIncludesAutoFill,
    packageIncludesAutomation,
    packageIncludesCleaner,
    packageIncludesFilter,
    packageIncludesHeater,
    packageIncludesPoolLights,
    packageIncludesPump,
    packageIncludesSalt,
    packageIncludesSanitationAccessory,
    packageIncludesSpaLights,
    poolLights,
    primaryPumpSummaryQuantity,
    safeData.additionalSaltSystem?.name,
    safeData.autoFillSystem?.name,
    safeData.automation?.name,
    safeData.cleaner?.name,
    safeData.filter?.name,
    safeData.applyCustomPackageDefaultPoolLights,
    safeData.heater?.name,
    safeData.heaterChiller?.name,
    safeData.pump?.name,
    safeData.saltSystem,
    safeData.sanitationAccessory?.name,
    selectedPackage?.defaultPoolLightName,
    selectedPackage?.defaultPoolLightQuantity,
    selectedPackage?.includedPoolLightName,
    selectedPackage?.includedPoolLightQuantity,
    selectedPackage?.includedSanitationAccessoryName,
    selectedPackage?.includedSanitationAccessoryQuantity,
    selectedPackage?.includedSpaLightName,
    selectedPackage?.includedSpaLightQuantity,
    sanitationAccessoryQuantity,
    saltSystemQuantity,
    spaLights,
    supportsMultipleHeatersAndFilters,
  ]);

  const updateData = (updates: Partial<Equipment>) => {
    onChange({ ...safeData, ...updates, hasBeenEdited: true });
  };

  const handleRunChange = (field: keyof PlumbingRuns, value: number) => {
    onChangePlumbingRuns({ [field]: value });
  };

  const setAuxiliaryPumps = (pumps: PumpSelection[]) => {
    updateData({ auxiliaryPumps: pumps, auxiliaryPump: pumps[0] });
  };

  const setAdditionalPumps = (pumps: PumpSelection[]) => {
    updateData({
      pumpQuantity: Math.max(getBasePumpQuantity(safeData), 0),
      additionalPumps: pumps,
    });
  };

  const setAdditionalFilters = (filters: FilterSelection[]) => {
    updateData({ additionalFilters: filters });
  };

  const setAdditionalHeaters = (heaters: HeaterSelection[]) => {
    updateData({ additionalHeaters: heaters });
  };

  const poolLightOptions = pricingData.equipment.lights.poolLights || [];
  const spaLightOptions = pricingData.equipment.lights.spaLights || [];

  const getPackageButtonDescription = (option: EquipmentPackageOption) => option.description?.trim() || '';

  const getDefaultLightOption = (type: 'pool' | 'spa') => {
    const list = type === 'pool' ? poolLightOptions : spaLightOptions;
    return list.find(light => (light as any)?.defaultLightChoice) || list[0];
  };

  const findConfiguredLightOption = (name: string | undefined, type: 'pool' | 'spa') => {
    const list = type === 'pool' ? poolLightOptions : spaLightOptions;
    const normalizedName = (name || '').trim().toLowerCase();
    if (!normalizedName) return undefined;
    return list.find((option) => option.name.trim().toLowerCase() === normalizedName);
  };

  const buildLightSelection = (option: any, type: 'pool' | 'spa'): LightSelection => ({
    type,
    name: option?.name || '',
    basePrice: (option as any)?.basePrice ?? 0,
    addCost1: (option as any)?.addCost1 ?? 0,
    addCost2: (option as any)?.addCost2 ?? 0,
    price: (option as any)?.price,
  });

  const customPackageDefaultPoolLightQuantity =
    hasPool &&
    selectedPackage &&
    isCustomEquipmentPackage(selectedPackage) &&
    safeData.applyCustomPackageDefaultPoolLights !== false
      ? Math.max(selectedPackage.defaultPoolLightQuantity ?? 0, 0)
      : 0;
  const customPackageDefaultPoolLightOption =
    customPackageDefaultPoolLightQuantity > 0
      ? (
          selectedPackage?.defaultPoolLightName
            ? findConfiguredLightOption(selectedPackage.defaultPoolLightName, 'pool')
            : undefined
        ) || getDefaultLightOption('pool')
      : null;
  const customPackageDefaultPoolLightName =
    selectedPackage?.defaultPoolLightName ||
    customPackageDefaultPoolLightOption?.name ||
    '';
  const effectivePoolLights =
    poolLights.length > 0
      ? poolLights
      : customPackageDefaultPoolLightQuantity > 0 && customPackageDefaultPoolLightName
      ? Array.from({ length: customPackageDefaultPoolLightQuantity }, () =>
          buildLightSelection(
            customPackageDefaultPoolLightOption || { name: customPackageDefaultPoolLightName },
            'pool'
          )
        )
      : [];
  const hasEffectivePoolLights = effectivePoolLights.length > 0;
  const includedPoolLightCount = packageIncludesPoolLights
    ? Math.max(selectedPackage?.includedPoolLightQuantity ?? 0, 0)
    : 0;
  const autoSeededPoolLightCount =
    !packageIncludesPoolLights &&
    selectedPackage &&
    isCustomEquipmentPackage(selectedPackage) &&
    safeData.applyCustomPackageDefaultPoolLights !== false
      ? Math.max(selectedPackage.defaultPoolLightQuantity ?? 0, 0)
      : 0;
  const isPoolLightMissingFromCatalog = (name?: string) =>
    Boolean(name) && !poolLightOptions.some((option) => option.name === name);
  const addPoolLightDisabledReason =
    poolLightOptions.length === 0
      ? 'No pool light options are configured in the active pricing model.'
      : isFixedPackage && !packageAllowsPoolLightChanges
        ? 'This equipment package does not allow additional pool lights.'
        : undefined;
  const packageRequiredReason = selectedPackage ? undefined : packageSelectionRequiredMessage;
  const getFirstDisabledReason = (...reasons: Array<string | undefined>) => reasons.find(Boolean);
  const pumpAddDisabledReason = packageRequiredReason;
  const auxiliaryPumpAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    !packageAllowsPumpChanges ? 'This equipment package does not allow blower upgrades.' : undefined,
    auxiliaryPumps.length >= maxAuxiliaryPumps ? 'Maximum blowers reached.' : undefined
  );
  const filterAddDisabledReason = packageRequiredReason;
  const cleanerAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    cleanerDisabledByPackage ? 'This equipment package does not allow cleaner upgrades.' : undefined
  );
  const heaterAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    heaterDisabledByPackage ? 'This equipment package does not allow heater upgrades.' : undefined
  );
  const heaterChillerAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    !supportsMultipleHeatersAndFilters
      ? 'Heater Chillers are available in the PPAS East Custom equipment package.'
      : undefined,
    heaterChillerOptions.length === 0
      ? 'No Heater Chiller models are configured in the active pricing model.'
      : undefined
  );
  const poolLightTopLevelDisabledReason = getFirstDisabledReason(packageRequiredReason, addPoolLightDisabledReason);
  const spaLightTopLevelDisabledReason = getFirstDisabledReason(packageRequiredReason, addSpaLightDisabledReason);
  const automationAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    automationDisabledByPackage ? 'This equipment package does not allow automation changes.' : undefined
  );
  const sanitationAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    packageLocksSanitationSystem ? 'This equipment package does not allow sanitation system changes.' : undefined
  );
  const autoFillAddDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    autoFillDisabledByPackage ? 'This equipment package does not allow auto-fill upgrades.' : undefined
  );

  useEffect(() => {
    if (additionalPumps.length === 0) {
      setActiveAdditionalPumpIndex(null);
      return;
    }
    if (activeAdditionalPumpIndex !== null && activeAdditionalPumpIndex >= additionalPumps.length) {
      setActiveAdditionalPumpIndex(additionalPumps.length - 1);
    }
  }, [activeAdditionalPumpIndex, additionalPumps.length]);

  useEffect(() => {
    if (auxiliaryPumps.length === 0) {
      setActiveAuxiliaryPumpIndex(null);
      return;
    }
    if (activeAuxiliaryPumpIndex !== null && activeAuxiliaryPumpIndex >= auxiliaryPumps.length) {
      setActiveAuxiliaryPumpIndex(auxiliaryPumps.length - 1);
    }
  }, [activeAuxiliaryPumpIndex, auxiliaryPumps.length]);

  useEffect(() => {
    if (effectivePoolLights.length === 0) {
      setActivePoolLightIndex(null);
      return;
    }
    if (activePoolLightIndex !== null && activePoolLightIndex >= effectivePoolLights.length) {
      setActivePoolLightIndex(effectivePoolLights.length - 1);
    }
  }, [activePoolLightIndex, effectivePoolLights.length]);

  useEffect(() => {
    if (spaLights.length === 0) {
      setActiveSpaLightIndex(null);
      return;
    }
    if (activeSpaLightIndex !== null && activeSpaLightIndex >= spaLights.length) {
      setActiveSpaLightIndex(spaLights.length - 1);
    }
  }, [activeSpaLightIndex, spaLights.length]);

  const commitLighting = (
    nextPoolLights: LightSelection[],
    nextSpaLights: LightSelection[],
    nextIncludePool: boolean,
    nextIncludeSpa: boolean,
    overrides?: Partial<Equipment>,
  ) => {
    updateData({
      includePoolLights: nextIncludePool,
      includeSpaLights: nextIncludeSpa && hasSpa,
      poolLights: nextIncludePool ? nextPoolLights : [],
      spaLights: nextIncludeSpa && hasSpa ? nextSpaLights : [],
      numberOfLights: nextIncludePool ? Math.max(nextPoolLights.length - 1, 0) : 0,
      hasSpaLight: nextIncludeSpa && hasSpa && nextSpaLights.length > 0,
      ...(overrides || {}),
    });
  };

  const findLightOption = (name: string, type: 'pool' | 'spa') => {
    const list = type === 'pool' ? poolLightOptions : spaLightOptions;
    return list.find(light => light.name === name) || getDefaultLightOption(type);
  };

  const togglePump = (val: boolean) => {
    if (val) {
      const selectedPump = getActiveOrDefaultOption(
        pumpOptions,
        safeData.pump?.name,
        selectableDefaults.pump
      );
      if (!selectedPump) {
        setIncludePump(false);
        return;
      }
      setIncludePump(true);
      updateData({
        pump: {
          name: selectedPump?.name || defaults.pump.name,
          model: (selectedPump as any)?.model || (defaults.pump as any).model,
          basePrice: (selectedPump as any)?.basePrice ?? (defaults.pump as any).basePrice,
          addCost1: (selectedPump as any)?.addCost1 ?? (defaults.pump as any).addCost1,
          addCost2: (selectedPump as any)?.addCost2 ?? (defaults.pump as any).addCost2,
          price: costOf(selectedPump || defaults.pump, true),
        },
        pumpQuantity: packageIncludesPump ? includedPumpQuantity : 1,
        additionalPumps: safeData.additionalPumps || [],
        auxiliaryPumps: auxiliaryPumps,
        auxiliaryPump: auxiliaryPumps[0],
      });
    } else {
      setIncludePump(false);
      updateData({
        pump: {
          name: defaults.pump.name,
          model: (defaults.pump as any).model,
          basePrice: (defaults.pump as any).basePrice,
          addCost1: (defaults.pump as any).addCost1,
          addCost2: (defaults.pump as any).addCost2,
          price: costOf(defaults.pump, true),
        },
        pumpQuantity: 0,
        additionalPumps: [],
        auxiliaryPumps,
        auxiliaryPump: auxiliaryPumps[0],
      });
    }
  };

  const toggleFilter = (val: boolean) => {
    if (val) {
      const selectedFilter = getActiveOrDefaultOption(
        filterOptions,
        safeData.filter?.name,
        selectableDefaults.filter
      );
      if (!selectedFilter) {
        setIncludeFilter(false);
        return;
      }
      setIncludeFilter(true);
      updateData({
        filter: {
          name: selectedFilter?.name || defaults.filter.name,
          sqft: (selectedFilter as any)?.sqft ?? (defaults.filter as any).sqft,
          basePrice: (selectedFilter as any)?.basePrice ?? (defaults.filter as any).basePrice,
          addCost1: (selectedFilter as any)?.addCost1 ?? (defaults.filter as any).addCost1,
          addCost2: (selectedFilter as any)?.addCost2 ?? (defaults.filter as any).addCost2,
          price: costOf(selectedFilter || defaults.filter),
        },
        filterQuantity: Math.max(safeData.filterQuantity ?? 1, 1),
      });
    } else {
      setIncludeFilter(false);
      updateData({
        filter: {
          name: defaults.filter.name,
          sqft: (defaults.filter as any).sqft,
          basePrice: (defaults.filter as any).basePrice,
          addCost1: (defaults.filter as any).addCost1,
          addCost2: (defaults.filter as any).addCost2,
          price: costOf(defaults.filter),
        },
        filterQuantity: 0,
        additionalFilters: [],
      });
    }
  };

  const toggleCleaner = (val: boolean) => {
    if (val) {
      const selected = getActiveOrDefaultOption(
        cleanerOptions,
        safeData.cleaner?.name,
        selectableDefaults.cleaner
      );
      if (!selected) {
        setIncludeCleaner(false);
        return;
      }
      setIncludeCleaner(true);
      const baseQty = 1;
      updateData({
        cleaner: {
          name: selected.name,
          basePrice: (selected as any).basePrice,
          addCost1: (selected as any).addCost1,
          addCost2: (selected as any).addCost2,
          price: costOf(selected),
        },
        cleanerQuantity: Math.max(safeData.cleanerQuantity ?? baseQty, baseQty),
      });
    } else {
      setIncludeCleaner(false);
      updateData({
        cleaner: {
          name: defaults.noCleaner.name,
          basePrice: (defaults.noCleaner as any).basePrice,
          addCost1: (defaults.noCleaner as any).addCost1,
          addCost2: (defaults.noCleaner as any).addCost2,
          price: costOf(defaults.noCleaner),
        },
        cleanerQuantity: 0,
      });
      handleRunChange('cleanerRun', 0);
    }
  };

  const toggleHeater = (val: boolean) => {
    if (val) {
      const selected = getActiveOrDefaultOption(
        heaterOptions,
        safeData.heater?.name,
        selectableDefaults.heater
      );
      if (!selected) {
        setIncludeHeater(false);
        return;
      }
      setIncludeHeater(true);
      updateData({
        heater: {
          name: selected?.name || defaults.heater.name,
          btu: (selected as any)?.btu ?? (defaults.heater as any).btu,
          basePrice: (selected as any)?.basePrice ?? (defaults.heater as any).basePrice,
          addCost1: (selected as any)?.addCost1 ?? (defaults.heater as any).addCost1,
          addCost2: (selected as any)?.addCost2 ?? (defaults.heater as any).addCost2,
          price: costOf(selected || defaults.heater),
          autoAddedForSpa: false,
          autoAddedReason: undefined,
        },
        heaterQuantity: Math.max(safeData.heaterQuantity ?? 1, 1),
      });
    } else {
      setIncludeHeater(false);
      updateData({
        heater: {
          name: defaults.heater.name,
          btu: (defaults.heater as any).btu,
          basePrice: (defaults.heater as any).basePrice,
          addCost1: (defaults.heater as any).addCost1,
          addCost2: (defaults.heater as any).addCost2,
          price: costOf(defaults.heater),
          autoAddedForSpa: false,
          autoAddedReason: undefined,
        },
        heaterQuantity: 0,
        additionalHeaters: [],
      });
    }
  };

  const toggleHeaterChiller = (val: boolean) => {
    if (!isPpasEast) return;
    if (val) {
      const selected = getActiveOrDefaultOption(
        heaterChillerOptions,
        safeData.heaterChiller?.name,
        selectableDefaults.heaterChiller
      );
      if (!selected) {
        setIncludeHeaterChiller(false);
        return;
      }
      setIncludeHeaterChiller(true);
      updateData({
        heaterChiller: {
          name: selected.name,
          btu: (selected as any).btu,
          basePrice: (selected as any).basePrice,
          addCost1: (selected as any).addCost1,
          addCost2: (selected as any).addCost2,
          price: costOf(selected),
        },
        heaterChillerQuantity: Math.max(safeData.heaterChillerQuantity ?? 1, 1),
      });
    } else {
      setIncludeHeaterChiller(false);
      updateData({ heaterChiller: undefined, heaterChillerQuantity: 0 });
    }
  };

  useEffect(() => {
    if (!hasPool && (includePoolLights || poolLights.length > 0)) {
      setIncludePoolLights(false);
      commitLighting([], spaLights, false, includeSpaLights);
    }
  }, [hasPool, includePoolLights, poolLights.length, spaLights, includeSpaLights]);

  useEffect(() => {
    if (!hasPool) return;
    if (!selectedPackage || !isCustomEquipmentPackage(selectedPackage)) return;
    if (safeData.applyCustomPackageDefaultPoolLights === false) return;
    if ((poolLights.length ?? 0) > 0) return;

    const configuredQuantity = Math.max(selectedPackage.defaultPoolLightQuantity ?? 0, 0);
    if (configuredQuantity <= 0) return;

    const configuredOption =
      (selectedPackage.defaultPoolLightName
        ? findConfiguredLightOption(selectedPackage.defaultPoolLightName, 'pool')
        : undefined) || getDefaultLightOption('pool');
    if (!configuredOption && !selectedPackage.defaultPoolLightName) return;

    const nextPoolLights = Array.from({ length: configuredQuantity }, () =>
      buildLightSelection(configuredOption || { name: selectedPackage.defaultPoolLightName }, 'pool')
    );
    setIncludePoolLights(true);
    commitLighting(nextPoolLights, spaLights, true, includeSpaLights, {
      applyCustomPackageDefaultPoolLights: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasPool,
    selectedPackage?.id,
    selectedPackage?.defaultPoolLightName,
    selectedPackage?.defaultPoolLightQuantity,
    safeData.applyCustomPackageDefaultPoolLights,
    poolLights.length,
    poolLightOptions.length,
  ]);

  useEffect(() => {
    if (!hasSpa && (includeSpaLights || spaLights.length > 0)) {
      setIncludeSpaLights(false);
      commitLighting(effectivePoolLights, [], includePoolLights || hasEffectivePoolLights, false);
    }
  }, [hasSpa, includeSpaLights, spaLights.length, effectivePoolLights.length, includePoolLights, hasEffectivePoolLights]);

  useEffect(() => {
    if (packageHasNoSanitationSystem) {
      if (includeSalt) {
        setIncludeSalt(false);
      }
      if (
        safeData.saltSystem ||
        safeData.additionalSaltSystem ||
        safeData.sanitationAccessory ||
        (safeData.saltSystemQuantity ?? 0) > 0
      ) {
        updateData({
          saltSystem: undefined,
          saltSystemQuantity: 0,
          additionalSaltSystem: undefined,
          sanitationAccessory: undefined,
          sanitationAccessoryQuantity: 0,
        });
      }
      return;
    }

    const automationSelected =
      includeAutomation && hasRealSelection(safeData.automation?.name, 'no automation');
    const currentSaltIsIncluded = isIncludedSaltCellSelection(safeData.saltSystem);
    const currentSaltIsPrimary =
      isRealSaltSystemSelection(safeData.saltSystem) && !isExcludedFromSaltCell(safeData.saltSystem);

    if (!automationSelected) {
      if (currentSaltIsIncluded) {
        setIncludeSalt(false);
        updateData({
          saltSystem: undefined,
          saltSystemQuantity: 0,
          additionalSaltSystem: undefined,
          sanitationAccessory: undefined,
          sanitationAccessoryQuantity: 0,
        });
        return;
      }
      if (safeData.saltSystem?.name && !currentSaltIsPrimary) {
        const fallbackSaltSystem = primarySaltOptions[0] || selectableDefaults.saltSystem;
        if (fallbackSaltSystem) {
          updateData({
            saltSystem: buildSaltSystemSelection(fallbackSaltSystem),
            saltSystemQuantity: Math.max(safeData.saltSystemQuantity ?? 1, 1),
          });
        }
        return;
      }
      if (currentSaltIsPrimary && !includeSalt) {
        setIncludeSalt(true);
      }
      return;
    }

    if (automationHasIncludedSaltCell) {
      if (!includeSalt) {
        setIncludeSalt(true);
      }
      if (currentSaltIsPrimary) {
        if ((safeData.saltSystemQuantity ?? 0) !== Math.max(safeData.saltSystemQuantity ?? 1, 1)) {
          updateData({ saltSystemQuantity: Math.max(safeData.saltSystemQuantity ?? 1, 1) });
        }
        return;
      }
      if (
        !currentSaltIsIncluded ||
        !safeData.saltSystem?.includedSaltCellPlaceholder ||
        (safeData.saltSystemQuantity ?? 0) !== 0
      ) {
        updateData({ saltSystem: buildIncludedSaltCellOption(), saltSystemQuantity: 0 });
      }
      return;
    }

    if (!includeSalt) {
      setIncludeSalt(true);
    }

    if (!currentSaltIsPrimary) {
      const fallbackSaltSystem = primarySaltOptions[0] || selectableDefaults.saltSystem;
      if (fallbackSaltSystem) {
        updateData({
          saltSystem: buildSaltSystemSelection(fallbackSaltSystem),
          saltSystemQuantity: Math.max(safeData.saltSystemQuantity ?? 1, 1),
        });
      }
      return;
    }

    if ((safeData.saltSystemQuantity ?? 0) < 1) {
      updateData({ saltSystemQuantity: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    packageHasNoSanitationSystem,
    includeAutomation,
    automationHasIncludedSaltCell,
    includeSalt,
    safeData.automation?.name,
    safeData.saltSystem?.name,
    safeData.saltSystem?.excludedFromSaltCell,
    safeData.saltSystem?.includedSaltCellPlaceholder,
    safeData.saltSystemQuantity,
  ]);

  useEffect(() => {
    if (isFixedPackage || packageIncludesSanitationAccessory || !editableSanitationAccessorySelected) {
      return;
    }

    const legacyName = safeData.sanitationAccessory?.name;
    if (!legacyName) return;

    const legacyOption =
      additionalSanitationOptions.find((option: any) => option.name === legacyName) ||
      sanitationAccessoryCatalog.find((option: any) => option.name === legacyName);
    if (!legacyOption) return;

    onChange({
      ...safeData,
      additionalSaltSystem:
        safeData.additionalSaltSystem?.name === legacyName
          ? safeData.additionalSaltSystem
          : buildAdditionalSanitationSelection(legacyOption),
      sanitationAccessory: undefined,
      sanitationAccessoryQuantity: 0,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isFixedPackage,
    packageIncludesSanitationAccessory,
    editableSanitationAccessorySelected,
    safeData.sanitationAccessory?.name,
    safeData.additionalSaltSystem?.name,
    additionalSanitationOptions,
    sanitationAccessoryCatalog,
  ]);

  const handlePoolLightSelect = (name: string) => {
    if (name === noneOptionValue) {
      setIncludePoolLights(false);
      commitLighting([], spaLights, false, includeSpaLights, {
        applyCustomPackageDefaultPoolLights: false,
      });
      return;
    }
    const option = findLightOption(name, 'pool');
    if (!option) return;
    const nextPoolLights = effectivePoolLights.length > 0 ? [...effectivePoolLights] : [];
    const primary = buildLightSelection(option, 'pool');
    if (nextPoolLights.length > 0) {
      nextPoolLights[0] = primary;
    } else {
      nextPoolLights.push(primary);
    }
    setIncludePoolLights(true);
    commitLighting(nextPoolLights, spaLights, true, includeSpaLights, {
      applyCustomPackageDefaultPoolLights: true,
    });
  };

  const handleSpaLightSelect = (name: string) => {
    if (name === noneOptionValue) {
      setIncludeSpaLights(false);
      commitLighting(effectivePoolLights, [], includePoolLights || hasEffectivePoolLights, false);
      return;
    }
    if (!hasSpa) return;
    const option = findLightOption(name, 'spa');
    if (!option) return;
    const nextSpaLights = spaLights.length > 0 ? [...spaLights] : [];
    const primary = buildLightSelection(option, 'spa');
    if (nextSpaLights.length > 0) {
      nextSpaLights[0] = primary;
    } else {
      nextSpaLights.push(primary);
    }
    setIncludeSpaLights(true);
    commitLighting(effectivePoolLights, nextSpaLights, includePoolLights || hasEffectivePoolLights, true);
  };

  const addPoolLight = () => {
    const defaultLight = getDefaultLightOption('pool');
    if (!defaultLight) return;
    const nextPoolLights = [...effectivePoolLights, buildLightSelection(defaultLight, 'pool')];
    commitLighting(nextPoolLights, spaLights, true, includeSpaLights, {
      applyCustomPackageDefaultPoolLights: true,
    });
  };

  const removePoolLight = (index: number) => {
    const next = effectivePoolLights.filter((_, i) => i !== index);
    if (next.length === 0) {
      setIncludePoolLights(false);
      commitLighting([], spaLights, false, includeSpaLights, {
        applyCustomPackageDefaultPoolLights: false,
      });
      return;
    }
    commitLighting(next, spaLights, true, includeSpaLights, {
      applyCustomPackageDefaultPoolLights: true,
    });
  };

  const handlePoolLightChange = (index: number, name: string) => {
    const option = findLightOption(name, 'pool');
    if (!option) return;
    const next = [...effectivePoolLights];
    next[index] = buildLightSelection(option, 'pool');
    commitLighting(next, spaLights, true, includeSpaLights, {
      applyCustomPackageDefaultPoolLights: true,
    });
  };

  const addSpaLight = () => {
    const defaultLight = getDefaultLightOption('spa');
    if (!defaultLight || !hasSpa) return;
    const nextSpaLights = [...spaLights, buildLightSelection(defaultLight, 'spa')];
    commitLighting(effectivePoolLights, nextSpaLights, includePoolLights || hasEffectivePoolLights, true);
  };

  const removeSpaLight = (index: number) => {
    const next = spaLights.filter((_, i) => i !== index);
    if (next.length === 0) {
      setIncludeSpaLights(false);
      commitLighting(effectivePoolLights, [], includePoolLights || hasEffectivePoolLights, false);
      return;
    }
    commitLighting(effectivePoolLights, next, includePoolLights || hasEffectivePoolLights, true);
  };

  const handleSpaLightChange = (index: number, name: string) => {
    const option = findLightOption(name, 'spa');
    if (!option) return;
    const next = [...spaLights];
    next[index] = buildLightSelection(option, 'spa');
    commitLighting(effectivePoolLights, next, includePoolLights || hasEffectivePoolLights, true);
  };

  const toggleAutomation = (val: boolean) => {
    if (val) {
      const selected = getActiveOrDefaultOption(
        automationOptions,
        safeData.automation?.name,
        selectableDefaults.automation
      );
      if (!selected) {
        setIncludeAutomation(false);
        return;
      }
      setIncludeAutomation(true);
      updateData({
        automation: {
          name: selected?.name || defaults.automation.name,
          basePrice: (selected as any)?.basePrice ?? (defaults.automation as any).basePrice,
          addCost1: (selected as any)?.addCost1 ?? (defaults.automation as any).addCost1,
          addCost2: (selected as any)?.addCost2 ?? (defaults.automation as any).addCost2,
          addCost3: (selected as any)?.addCost3 ?? (defaults.automation as any).addCost3,
          includesSaltCell:
            (selected as any)?.includesSaltCell ?? (defaults.automation as any).includesSaltCell,
          price: costOf(selected || defaults.automation),
          zones: safeData.automation?.zones ?? 0,
        },
        automationQuantity: Math.max(safeData.automationQuantity ?? 1, 1),
      });
    } else {
      setIncludeAutomation(false);
      updateData({
        automation: {
          name: defaults.automation.name,
          basePrice: (defaults.automation as any).basePrice,
          addCost1: (defaults.automation as any).addCost1,
          addCost2: (defaults.automation as any).addCost2,
          addCost3: (defaults.automation as any).addCost3,
          includesSaltCell: (defaults.automation as any).includesSaltCell,
          price: costOf(defaults.automation),
          zones: 0,
        },
        automationQuantity: 0,
      });
    }
  };

  const toggleSalt = (val: boolean) => {
    if (val) {
      if (automationHasIncludedSaltCell) {
        setIncludeSalt(true);
        updateData({ saltSystem: buildIncludedSaltCellOption(), saltSystemQuantity: 0 });
        return;
      }

      const selectedSystem =
        getActiveOrDefaultOption(
          primarySaltOptions,
          isRealSaltSystemSelection(safeData.saltSystem) && !isExcludedFromSaltCell(safeData.saltSystem)
            ? safeData.saltSystem?.name
            : undefined,
          selectableDefaults.saltSystem
        );
      if (!selectedSystem) {
        setIncludeSalt(false);
        return;
      }

      setIncludeSalt(true);
      updateData({
        saltSystem: buildSaltSystemSelection(selectedSystem),
        saltSystemQuantity: Math.max(safeData.saltSystemQuantity ?? 1, 1),
      });
      return;
    }

    setIncludeSalt(false);
    updateData({
      saltSystem: undefined,
      saltSystemQuantity: 0,
      additionalSaltSystem: undefined,
      sanitationAccessory: undefined,
      sanitationAccessoryQuantity: 0,
    });
  };

  const toggleAutoFill = (val: boolean) => {
    if (val) {
      const selectedSystem = getActiveOrDefaultOption(
        autoFillOptions,
        safeData.autoFillSystem?.name,
        selectableDefaults.autoFillSystem || defaults.autoFillSystem
      );
      if (!selectedSystem) {
        setIncludeAutoFill(false);
        return;
      }

      setIncludeAutoFill(true);
      updateData({
        autoFillSystem: buildAutoFillSelection(selectedSystem),
        autoFillSystemQuantity: Math.max(safeData.autoFillSystemQuantity ?? 1, 1),
        hasAutoFill: false,
      });
      return;
    }

    setIncludeAutoFill(false);
    updateData({ autoFillSystem: undefined, autoFillSystemQuantity: 0, hasAutoFill: false });
    handleRunChange('autoFillRun', 0);
    handleRunChange('autoFillElectricRun', 0);
  };

  const handlePumpSelect = (name: string) => {
    if (name === noneOptionValue) {
      togglePump(false);
      return;
    }
    setIncludePump(true);
    handlePumpChange(name);
  };

  const handleFilterSelect = (name: string) => {
    if (name === noneOptionValue) {
      toggleFilter(false);
      return;
    }
    setIncludeFilter(true);
    handleFilterChange(name);
  };

  const handleCleanerSelect = (name: string) => {
    if (name === noneOptionValue) {
      toggleCleaner(false);
      return;
    }
    setIncludeCleaner(true);
    handleCleanerChange(name);
  };

  const handleHeaterSelect = (name: string) => {
    if (name === noneOptionValue) {
      if (heaterRequiredBySpa) return;
      toggleHeater(false);
      return;
    }
    setIncludeHeater(true);
    handleHeaterChange(name);
  };

  const handleAutomationSelect = (name: string) => {
    if (name === noneOptionValue) {
      toggleAutomation(false);
      return;
    }
    setIncludeAutomation(true);
    handleAutomationChange(name);
  };

  const handleSaltSelect = (name: string) => {
    if (name === noneOptionValue) {
      toggleSalt(false);
      return;
    }
    setIncludeSalt(true);
    handleSaltSystemChange(name);
  };

  const handleAutoFillSelect = (name: string) => {
    if (name === noneOptionValue) {
      toggleAutoFill(false);
      return;
    }
    setIncludeAutoFill(true);
    handleAutoFillSystemChange(name);
  };

  const handlePumpChange = (name: string) => {
    const pump = pricingData.equipment.pumps.find(p => p.name === name);
    if (pump) {
      updateData({
        pump: {
          name: pump.name,
          model: (pump as any).model,
          basePrice: (pump as any).basePrice,
          addCost1: (pump as any).addCost1,
          addCost2: (pump as any).addCost2,
          price: costOf(pump, true),
        },
        pumpQuantity: packageIncludesPump ? includedPumpQuantity : 1,
      });
    }
  };

  const handleAdditionalPumpChange = (index: number, name: string | number) => {
    const pump = pricingData.equipment.pumps.find((p) => p.name === name);
    if (!pump) return;
    const next = [...additionalPumps];
    next[index] = {
      name: pump.name,
      model: (pump as any).model,
      basePrice: (pump as any)?.basePrice,
      addCost1: (pump as any)?.addCost1,
      addCost2: (pump as any)?.addCost2,
      price: costOf(pump, true),
    };
    setAdditionalPumps(next);
  };

  const handleAdditionalFilterChange = (index: number, name: string | number) => {
    const filter = pricingData.equipment.filters.find((item) => item.name === name);
    if (!filter) return;
    const next = [...additionalFilters];
    next[index] = {
      name: filter.name,
      sqft: (filter as any).sqft,
      basePrice: (filter as any).basePrice,
      addCost1: (filter as any).addCost1,
      addCost2: (filter as any).addCost2,
      price: costOf(filter),
    };
    setAdditionalFilters(next);
  };

  const handleAdditionalHeaterChange = (index: number, name: string | number) => {
    const heater = pricingData.equipment.heaters.find((item) => item.name === name);
    if (!heater) return;
    const next = [...additionalHeaters];
    next[index] = {
      name: heater.name,
      btu: (heater as any).btu,
      basePrice: (heater as any).basePrice,
      addCost1: (heater as any).addCost1,
      addCost2: (heater as any).addCost2,
      price: costOf(heater),
      autoAddedForSpa: false,
      autoAddedReason: undefined,
    };
    setAdditionalHeaters(next);
  };

  const handleAuxiliaryPumpChange = (index: number, name: string | number) => {
    const pump = auxiliaryPumpCatalog.find((p: any) => p.name === name);
    if (!pump) return;
    const next = [...auxiliaryPumps];
    const existing = next[index];
    next[index] = {
      name: pump.name,
      model: (pump as any).model,
      basePrice: (pump as any).basePrice,
      addCost1: (pump as any).addCost1,
      addCost2: (pump as any).addCost2,
      price: costOf(pump, true),
      autoAddedForSpa: existing?.autoAddedForSpa,
      autoAddedReason: existing?.autoAddedReason,
    };
    setAuxiliaryPumps(next);
  };

  const addAuxiliaryPump = () => {
    if (!packageAllowsPumpChanges || auxiliaryPumps.length >= maxAuxiliaryPumps) return;
    const defaultPump = getDefaultAuxiliaryPump() || selectableDefaults.pump;
    setAuxiliaryPumps([
      ...auxiliaryPumps,
      {
        name: defaultPump.name,
        model: (defaultPump as any).model,
        basePrice: (defaultPump as any).basePrice,
        addCost1: (defaultPump as any).addCost1,
        addCost2: (defaultPump as any).addCost2,
        price: costOf(defaultPump, true),
        autoAddedForSpa: false,
        autoAddedReason: undefined,
      },
    ]);
  };

  const addAdditionalPump = () => {
    if (!packageAllowsPumpChanges) return;
    const selectedPump = getActiveOrDefaultOption(
      pumpOptions,
      hasRealSelection(safeData.pump?.name, 'no pump') ? safeData.pump?.name : undefined,
      selectableDefaults.pump
    );
    if (!selectedPump) return;

    setAdditionalPumps([
      ...additionalPumps,
      {
        name: selectedPump.name,
        model: (selectedPump as any).model,
        basePrice: (selectedPump as any).basePrice,
        addCost1: (selectedPump as any).addCost1,
        addCost2: (selectedPump as any).addCost2,
        price: costOf(selectedPump, true),
      },
    ]);
    setActiveAdditionalPumpIndex(additionalPumps.length);
  };

  const addAdditionalFilter = () => {
    if (!supportsMultipleHeatersAndFilters) return;
    const selectedFilter = getActiveOrDefaultOption(
      filterOptions,
      hasRealSelection(safeData.filter?.name, 'no filter') ? safeData.filter?.name : undefined,
      selectableDefaults.filter
    );
    if (!selectedFilter) return;
    setAdditionalFilters([
      ...additionalFilters,
      {
        name: selectedFilter.name,
        sqft: (selectedFilter as any).sqft,
        basePrice: (selectedFilter as any).basePrice,
        addCost1: (selectedFilter as any).addCost1,
        addCost2: (selectedFilter as any).addCost2,
        price: costOf(selectedFilter),
      },
    ]);
    setActiveAdditionalFilterIndex(additionalFilters.length);
  };

  const addAdditionalHeater = () => {
    if (!supportsMultipleHeatersAndFilters) return;
    const selectedHeater = getActiveOrDefaultOption(
      heaterOptions,
      hasRealSelection(safeData.heater?.name, 'no heater') ? safeData.heater?.name : undefined,
      selectableDefaults.heater
    );
    if (!selectedHeater) return;
    setAdditionalHeaters([
      ...additionalHeaters,
      {
        name: selectedHeater.name,
        btu: (selectedHeater as any).btu,
        basePrice: (selectedHeater as any).basePrice,
        addCost1: (selectedHeater as any).addCost1,
        addCost2: (selectedHeater as any).addCost2,
        price: costOf(selectedHeater),
        autoAddedForSpa: false,
        autoAddedReason: undefined,
      },
    ]);
    setActiveAdditionalHeaterIndex(additionalHeaters.length);
  };

  const removeAdditionalPump = (index: number) => {
    const next = additionalPumps.filter((_, i) => i !== index);
    setAdditionalPumps(next);
  };

  const removeAdditionalFilter = (index: number) => {
    setAdditionalFilters(additionalFilters.filter((_, itemIndex) => itemIndex !== index));
    setActiveAdditionalFilterIndex(null);
  };

  const removeAdditionalHeater = (index: number) => {
    setAdditionalHeaters(additionalHeaters.filter((_, itemIndex) => itemIndex !== index));
    setActiveAdditionalHeaterIndex(null);
  };

  const handleFilterChange = (name: string) => {
    const filter = pricingData.equipment.filters.find(f => f.name === name);
    if (filter) {
      updateData({
        filter: {
          name: filter.name,
          sqft: (filter as any).sqft,
          basePrice: (filter as any).basePrice,
          addCost1: (filter as any).addCost1,
          addCost2: (filter as any).addCost2,
          price: costOf(filter),
        },
        filterQuantity: Math.max(safeData.filterQuantity ?? 1, 1),
      });
    }
  };

  const handleCleanerChange = (name: string) => {
    const cleaner = pricingData.equipment.cleaners.find(c => c.name === name);
    if (cleaner) {
      const nextQuantity = safeData.cleanerQuantity && safeData.cleanerQuantity > 0 ? safeData.cleanerQuantity : 1;
      updateData({
        cleaner: {
          name: cleaner.name,
          basePrice: (cleaner as any).basePrice,
          addCost1: (cleaner as any).addCost1,
          addCost2: (cleaner as any).addCost2,
          price: costOf(cleaner),
        },
        cleanerQuantity: nextQuantity,
      });
    }
  };

  const handleHeaterChange = (name: string) => {
    const heater = pricingData.equipment.heaters.find(h => h.name === name);
    if (heater) {
      updateData({
        heater: {
          name: heater.name,
          btu: (heater as any).btu,
          basePrice: (heater as any).basePrice,
          addCost1: (heater as any).addCost1,
          addCost2: (heater as any).addCost2,
          price: costOf(heater),
          autoAddedForSpa: false,
          autoAddedReason: undefined,
        },
        heaterQuantity: Math.max(safeData.heaterQuantity ?? 1, 1),
      });
    }
  };

  const handleHeaterChillerChange = (name: string) => {
    const heaterChiller = heaterChillerCatalog.find((item: any) => item.name === name);
    if (!heaterChiller) return;
    updateData({
      heaterChiller: {
        name: heaterChiller.name,
        btu: (heaterChiller as any).btu,
        basePrice: (heaterChiller as any).basePrice,
        addCost1: (heaterChiller as any).addCost1,
        addCost2: (heaterChiller as any).addCost2,
        price: costOf(heaterChiller),
      },
      heaterChillerQuantity: Math.max(safeData.heaterChillerQuantity ?? 1, 1),
    });
  };

  const handleAutomationChange = (name: string) => {
    const automation = pricingData.equipment.automation.find(a => a.name === name);
    if (automation) {
      updateData({
        automation: {
          name: automation.name,
          basePrice: (automation as any).basePrice,
          addCost1: (automation as any).addCost1,
          addCost2: (automation as any).addCost2,
          addCost3: (automation as any).addCost3,
          includesSaltCell: (automation as any).includesSaltCell,
          price: costOf(automation),
          zones: safeData.automation.zones,
        },
        automationQuantity: Math.max(safeData.automationQuantity ?? 1, 1),
      });
    }
  };

  const handleSaltSystemChange = (name?: string) => {
    if (!name) {
      updateData({
        saltSystem: undefined,
        saltSystemQuantity: 0,
        additionalSaltSystem: undefined,
        sanitationAccessory: undefined,
        sanitationAccessoryQuantity: 0,
      });
      return;
    }
    if (isIncludedSaltCellOptionName(name)) {
      updateData({ saltSystem: buildIncludedSaltCellOption(), saltSystemQuantity: 0 });
      return;
    }
    const system = pricingData.equipment.saltSystem.find(s => s.name === name);
    if (!system) {
      updateData({ saltSystem: undefined, saltSystemQuantity: 0 });
      return;
    }
    const nextQuantity = Math.max(safeData.saltSystemQuantity ?? 1, 1);
    updateData({
      saltSystem: buildSaltSystemSelection(system),
      saltSystemQuantity: nextQuantity,
    });
  };

  const handleAdditionalSanitationOptionChange = (name?: string) => {
    if (!name || name === noneOptionValue) {
      updateData({
        additionalSaltSystem: undefined,
        sanitationAccessory: undefined,
        sanitationAccessoryQuantity: 0,
      });
      return;
    }
    const option = additionalSanitationOptions.find((entry: any) => entry.name === name);
    if (!option) {
      updateData({
        additionalSaltSystem: undefined,
        sanitationAccessory: undefined,
        sanitationAccessoryQuantity: 0,
      });
      return;
    }
    updateData({
      additionalSaltSystem: buildAdditionalSanitationSelection(option),
      sanitationAccessory: undefined,
      sanitationAccessoryQuantity: 0,
    });
  };

  const handleAutoFillSystemChange = (name?: string) => {
    if (!name) {
      updateData({ autoFillSystem: undefined, autoFillSystemQuantity: 0, hasAutoFill: false });
      handleRunChange('autoFillRun', 0);
      handleRunChange('autoFillElectricRun', 0);
      return;
    }
    const system = pricingData.equipment.autoFillSystem.find(s => s.name === name);
    if (!system) {
      updateData({ autoFillSystem: undefined, autoFillSystemQuantity: 0, hasAutoFill: false });
      handleRunChange('autoFillRun', 0);
      handleRunChange('autoFillElectricRun', 0);
      return;
    }
    const nextQuantity = Math.max(safeData.autoFillSystemQuantity ?? 1, 1);
    updateData({
      autoFillSystem: buildAutoFillSelection(system),
      autoFillSystemQuantity: nextQuantity,
      hasAutoFill: false,
    });
  };

  const hasPumpBlockSelection = showPrimaryPumpControls;
  const hasAuxiliaryPumpSelection = auxiliaryPumps.length > 0;
  const hasFilterSelection = packageIncludesFilter || includeFilter;
  const hasCleanerSelection = packageIncludesCleaner || includeCleaner;
  const hasHeaterSelectionState = packageIncludesHeater || includeHeater;
  const hasHeaterChillerSelection = supportsMultipleHeatersAndFilters && includeHeaterChiller;
  const hasPoolLightSelection = includePoolLights || packageIncludesPoolLights || effectivePoolLights.length > 0;
  const hasSpaLightSelectionState = includeSpaLights || packageIncludesSpaLights || spaLights.length > 0;
  const hasAutomationSelection = packageIncludesAutomation || includeAutomation;
  const hasSanitationSelection = packageIncludesSalt || includeSalt;
  const hasAutoFillSelection = packageIncludesAutoFill || includeAutoFill;
  const hasAdditionalSanitationContext = hasSanitationSelection || packageIncludesSanitationAccessory;
  const selectedAdditionalSanitationName = packageIncludesSanitationAccessory
    ? safeData.sanitationAccessory?.name || selectedPackage?.includedSanitationAccessoryName || ''
    : additionalSanitationOptionSelectedName;
  const hasAdditionalSanitationSelection = Boolean(selectedAdditionalSanitationName);
  const additionalSanitationSelectionMissingFromCatalog =
    Boolean(selectedAdditionalSanitationName) &&
    !additionalSanitationOptions.some((option: any) => option.name === selectedAdditionalSanitationName);
  const additionalSanitationOptionDisabledReason = getFirstDisabledReason(
    packageRequiredReason,
    !hasAdditionalSanitationContext ? 'A sanitation system must be chosen first.' : undefined,
    packageIncludesSanitationAccessory ? packageLockedCategoryMessage : undefined,
    additionalSanitationDisabledByPackage ? 'This equipment package does not allow additional sanitation upgrades.' : undefined
  );

  const renderToggleButtons = ({
    hasSelection,
    addLabel,
    onNo,
    onAdd,
    onAddAnother,
    noDisabledReason,
    addDisabledReason,
  }: {
    hasSelection: boolean;
    noLabel: string;
    addLabel: string;
    onNo: () => void;
    onAdd: () => void;
    onAddAnother?: () => void;
    noDisabledReason?: string;
    addDisabledReason?: string;
  }) => {
    const disableNo = hasSelection && Boolean(noDisabledReason);
    const disableAdd = !hasSelection
      ? Boolean(addDisabledReason)
      : addDisabledReason === packageRequiredReason;
    const isDisabled = hasSelection ? disableNo : disableAdd;
    const disabledReason = hasSelection ? noDisabledReason : addDisabledReason;
    const categoryLabel = addLabel.replace(/^(add|choose)\s+/i, '');

    return (
      <div className="equipment-selection-controls">
        {hasSelection && onAddAnother && (
          <>
            <button
              type="button"
              className="action-btn secondary equipment-add-another-btn"
              onClick={onAddAnother}
            >
              Add Another
            </button>
            <span className="equipment-selection-divider" aria-hidden="true" />
          </>
        )}
        <TooltipAnchor
          as="div"
          className="equipment-selection-toggle-anchor"
          tooltip={isDisabled ? disabledReason : undefined}
        >
          <label className={`equipment-selection-toggle ${hasSelection ? 'is-on' : 'is-off'} ${isDisabled ? 'is-disabled' : ''}`}>
            <span className="equipment-selection-toggle__status">
              {hasSelection ? 'Added' : 'Not added'}
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label={`${categoryLabel} selection`}
              checked={hasSelection}
              disabled={isDisabled}
              onChange={(event) => {
                if (event.target.checked) {
                  onAdd();
                  return;
                }
                onNo();
              }}
            />
            <span className="equipment-selection-toggle__track" aria-hidden="true">
              <span className="equipment-selection-toggle__thumb" />
            </span>
          </label>
        </TooltipAnchor>
      </div>
    );
  };

  const primaryPumpCardTitle = summarizeQuantity(
    safeData.pump?.name || selectedPackage?.includedPumpName || 'Pump',
    packageIncludesPump ? Math.max(selectedPackage?.includedPumpQuantity ?? pumpQuantity, 0) : pumpQuantity
  );
  const filterCardTitle = summarizeQuantity(
    safeData.filter?.name || selectedPackage?.includedFilterName || 'Filter',
    packageIncludesFilter ? Math.max(selectedPackage?.includedFilterQuantity ?? filterQuantity, 0) : filterQuantity
  );
  const cleanerCardTitle = summarizeQuantity(
    safeData.cleaner?.name || selectedPackage?.includedCleanerName || 'Cleaner',
    packageIncludesCleaner ? Math.max(selectedPackage?.includedCleanerQuantity ?? cleanerQuantity, 0) : cleanerQuantity
  );
  const heaterCardTitle = summarizeQuantity(
    safeData.heater?.name || selectedPackage?.includedHeaterName || 'Heater',
    packageIncludesHeater ? Math.max(selectedPackage?.includedHeaterQuantity ?? heaterQuantity, 0) : heaterQuantity
  );
  const heaterChillerCardTitle = summarizeQuantity(
    safeData.heaterChiller?.name || 'Heater Chiller',
    heaterChillerQuantity
  );
  const automationCardTitle = summarizeQuantity(
    safeData.automation?.name || selectedPackage?.includedAutomationName || 'Automation',
    packageIncludesAutomation ? Math.max(selectedPackage?.includedAutomationQuantity ?? automationQuantity, 0) : automationQuantity
  );
  const sanitationCardTitle =
    (packageIncludesSalt
      ? getEffectivePrimarySanitationSystemName(safeData) || selectedPackage?.includedSaltSystemName
      : safeData.saltSystem?.name) || 'Sanitation System';
  const autoFillCardTitle = summarizeQuantity(
    safeData.autoFillSystem?.name || selectedPackage?.includedAutoFillSystemName || 'Auto-Fill System',
    packageIncludesAutoFill ? Math.max(selectedPackage?.includedAutoFillSystemQuantity ?? autoFillSystemQuantity, 0) : autoFillSystemQuantity
  );

  const openPumpFlow = () => {
    if (!hasPumpBlockSelection) {
      togglePump(true);
    }
    setPumpEditing(true);
  };

  const clearPumpFlow = () => {
    if (packageIncludesPump) return;
    togglePump(false);
    setPumpEditing(false);
  };

  const openAuxiliaryPumpFlow = () => {
    if (!hasAuxiliaryPumpSelection) {
      addAuxiliaryPump();
      setActiveAuxiliaryPumpIndex(auxiliaryPumps.length);
      return;
    }
    setActiveAuxiliaryPumpIndex(auxiliaryPumps.length - 1);
  };

  const clearAuxiliaryPumpFlow = () => {
    if (blowerRequiredBySpa) return;
    setAuxiliaryPumps([]);
    setActiveAuxiliaryPumpIndex(null);
  };

  const openFilterFlow = () => {
    if (!hasFilterSelection) {
      toggleFilter(true);
    }
    setFilterEditing(true);
  };

  const clearFilterFlow = () => {
    if (packageIncludesFilter) return;
    toggleFilter(false);
    setFilterEditing(false);
  };

  const openCleanerFlow = () => {
    if (!hasCleanerSelection) {
      toggleCleaner(true);
    }
    setCleanerEditing(true);
  };

  const clearCleanerFlow = () => {
    if (packageIncludesCleaner) return;
    toggleCleaner(false);
    setCleanerEditing(false);
  };

  const openHeaterFlow = () => {
    if (!hasHeaterSelectionState) {
      toggleHeater(true);
    }
    setHeaterEditing(true);
  };

  const clearHeaterFlow = () => {
    if (packageIncludesHeater || heaterRequiredBySpa) return;
    toggleHeater(false);
    setHeaterEditing(false);
  };

  const openHeaterChillerFlow = () => {
    if (!hasHeaterChillerSelection) {
      toggleHeaterChiller(true);
    }
    setHeaterChillerEditing(true);
  };

  const clearHeaterChillerFlow = () => {
    toggleHeaterChiller(false);
    setHeaterChillerEditing(false);
  };

  const openPoolLightFlow = () => {
    if (!hasPoolLightSelection) {
      addPoolLight();
      setActivePoolLightIndex(0);
      return;
    }
    setActivePoolLightIndex(Math.max(effectivePoolLights.length - 1, 0));
  };

  const clearPoolLightFlow = () => {
    if (packageIncludesPoolLights) return;
    setIncludePoolLights(false);
    commitLighting([], spaLights, false, includeSpaLights, {
      applyCustomPackageDefaultPoolLights: false,
    });
    setActivePoolLightIndex(null);
  };

  const openSpaLightFlow = () => {
    if (!hasSpaLightSelectionState) {
      addSpaLight();
      setActiveSpaLightIndex(0);
      return;
    }
    setActiveSpaLightIndex(Math.max(spaLights.length - 1, 0));
  };

  const clearSpaLightFlow = () => {
    if (packageIncludesSpaLights) return;
    setIncludeSpaLights(false);
    commitLighting(effectivePoolLights, [], includePoolLights || hasEffectivePoolLights, false);
    setActiveSpaLightIndex(null);
  };

  const openAutomationFlow = () => {
    if (!hasAutomationSelection) {
      toggleAutomation(true);
    }
    setAutomationEditing(true);
  };

  const clearAutomationFlow = () => {
    if (packageIncludesAutomation) return;
    toggleAutomation(false);
    setAutomationEditing(false);
  };

  const openSanitationFlow = () => {
    if (!hasSanitationSelection) {
      toggleSalt(true);
    }
    setSanitationEditing(true);
  };

  const clearSanitationFlow = () => {
    if (packageLocksSanitationSystem || sanitationRequiredByAutomation) return;
    toggleSalt(false);
    setSanitationEditing(false);
  };

  const openAdditionalSanitationFlow = () => {
    if (!hasAdditionalSanitationSelection && additionalSanitationOptions[0]) {
      handleAdditionalSanitationOptionChange(additionalSanitationOptions[0].name);
    }
    setAdditionalSanitationEditing(true);
  };

  const clearAdditionalSanitationFlow = () => {
    if (packageIncludesSanitationAccessory) return;
    handleAdditionalSanitationOptionChange(noneOptionValue);
    setAdditionalSanitationEditing(false);
  };

  const openAutoFillFlow = () => {
    if (!hasAutoFillSelection) {
      toggleAutoFill(true);
    }
    setAutoFillEditing(true);
  };

  const clearAutoFillFlow = () => {
    if (packageIncludesAutoFill) return;
    toggleAutoFill(false);
    setAutoFillEditing(false);
  };

  const renderReadOnlySelection = (label: string, value: string, note?: string, showRetired?: boolean) => (
    <div className="spec-field">
      {showRetired ? <LabelWithRetired text={label} showRetired={showRetired} /> : <label className="spec-label">{label}</label>}
      <CompactInput type="text" value={value} readOnly />
      {note && <small className="form-help">{note}</small>}
    </div>
  );

  const renderReadOnlyQuantity = (label: string, value: number, note?: string) => (
    <div className="spec-field" style={{ maxWidth: '220px' }}>
      <label className="spec-label">{label}</label>
      <CompactInput value={value} unit="ea" readOnly />
      {note && <small className="form-help">{note}</small>}
    </div>
  );

  const renderPriceImpact = (
    target: EquipmentPriceImpactTarget,
    controlLabel: string
  ) => {
    if (!getEquipmentPriceImpact) return null;
    const targetKey = `${target.kind}${'index' in target ? `:${target.index}` : ''}`;
    return (
      <PriceImpactPopover
        controlLabel={controlLabel}
        requestKey={`${priceImpactRequestKey}:${targetKey}`}
        loadImpact={() => getEquipmentPriceImpact(target)}
      />
    );
  };

  return (
    <div className="section-form equipment-category-grid">
      <div className="spec-block package-options-block">
        <div className="spec-block-header">
          <div className="package-options-heading">
            <h2 className="spec-block-title">Package Options</h2>
            <p className="package-options-subtitle">Choose the equipment package that best fits this project.</p>
          </div>
          <ProposalNote categoryKey="equipment" subcategoryId="packageOptions" overrides={noteOverrides} />
        </div>
        <div className="equipment-package-options">
          {packageOptions.map((option) => {
            const isSelected = selectedPackage?.id === option.id;
            const disabledForMissingDimensions = !hasPool;
            const disabledForSpa = hasSpa && !packageSupportsSpa(option);
            const isDisabled = disabledForMissingDimensions || disabledForSpa;
            const buttonTitle = disabledForMissingDimensions
              ? packageDimensionsRequiredMessage
              : disabledForSpa
                ? packageButtonDisabledMessage
                : undefined;
            const isCustom = isCustomEquipmentPackage(option);
            const packageStatusLabel = isSelected
              ? 'Selected'
              : disabledForMissingDimensions
                ? 'Pool Specs required'
                : disabledForSpa
                  ? 'Spa blocked'
                  : isCustom
                    ? 'Customize'
                    : 'Select';
            const packageStatusClass = isSelected ? 'selected' : isDisabled ? 'disabled' : 'available';
            const packageDescription = getPackageButtonDescription(option);
            return (
              <TooltipAnchor
                key={option.id}
                as="div"
                tooltip={buttonTitle}
                className={`package-option-anchor package-option-anchor--${isCustom ? 'custom' : 'fixed'}`}
              >
                <button
                  type="button"
                  className={`equipment-package-button ${isSelected ? 'active' : ''} ${isDisabled ? 'disabled' : ''}`}
                  aria-disabled={isDisabled}
                  aria-pressed={isSelected}
                  onClick={() => {
                    if (isDisabled) return;
                    if (option.id !== selectedPackage?.id) {
                      onSelectPackage(option.id);
                    }
                  }}
                >
                  <span className="equipment-package-button__top-row">
                    <span className="equipment-package-button__icon">
                      <PackageOptionIcon isCustom={isCustom} />
                    </span>
                    {isSelected && (
                      <span className="equipment-package-button__selected-mark">
                        <SelectedPackageIcon />
                      </span>
                    )}
                  </span>
                  <span className="equipment-package-button__title">{option.name}</span>
                  {packageDescription && (
                    <span className="equipment-package-button__description">{packageDescription}</span>
                  )}
                  <span className={`equipment-package-button__action ${packageStatusClass}`}>
                    {isSelected && <SelectedPackageIcon />}
                    {packageStatusLabel}
                  </span>
                </button>
              </TooltipAnchor>
            );
          })}
        </div>
        {selectedPackage && packageSummaryRows.length > 0 && (
          <div className="package-summary">
            <div className="package-summary-header">
              <span className="package-summary-header__icon">
                <PackageOptionIcon isCustom={false} />
              </span>
              <strong>What's included</strong>
              <span className="package-summary-header__divider" aria-hidden="true" />
              <span className="package-summary-count">
                {packageSummaryRows.length} {packageSummaryRows.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            <div className="package-summary-grid">
              {packageSummaryRows.map((row) => (
                <div key={row.id} className="package-summary-item" data-summary-category={row.label}>
                  <span className="package-summary-item__icon">
                    <PackageContentsIcon label={row.label} />
                  </span>
                  <span className="package-summary-item__copy">
                    <span className="package-summary-label">{row.label}</span>
                    <span className="package-summary-value">{row.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <BalancedEquipmentColumns>
      {/* Pump */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Pump" />
          <ProposalNote categoryKey="equipment" subcategoryId="pump" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasPumpBlockSelection,
          noLabel: 'No Pump',
          addLabel: 'Add Pump',
          onNo: clearPumpFlow,
          onAdd: openPumpFlow,
          onAddAnother: packageAllowsPumpChanges && showPrimaryPumpControls
            ? addAdditionalPump
            : undefined,
          noDisabledReason: packageIncludesPump ? packageLockedCategoryMessage : undefined,
          addDisabledReason: pumpAddDisabledReason,
        })}

        {hasPumpBlockSelection ? (
          <>
            <div className="spec-subcard">
              <div className="spec-subcard-header">
                <div>
                  <div className="spec-subcard-title">{primaryPumpCardTitle}</div>
                </div>
                <div className="spec-subcard-actions stacked-actions">
                  <div className="stacked-primary-actions">
                    {renderPriceImpact({ kind: 'mainPump' }, 'Main Pump')}
                    {!pumpEditing && (
                      <button type="button" className="link-btn" onClick={() => setPumpEditing(true)}>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {pumpEditing && (
                <>
                  <div className="spec-grid spec-grid-2">
                    {packageIncludesPump
                      ? renderReadOnlySelection(
                          'Pump',
                          safeData.pump?.name || selectedPackage?.includedPumpName || 'Included',
                          packageLockedCategoryMessage
                        )
                      : (
                        <div className="spec-field">
                          <LabelWithRetired text="Pump" showRetired={retiredFlags.pump} />
                          <select
                            className="compact-input equipment-select"
                            value={includePump ? safeData.pump.name : noneOptionValue}
                            onChange={(e) => handlePumpSelect(e.target.value)}
                          >
                            <option value={noneOptionValue}>None</option>
                            {retiredFlags.pump && renderRetiredOption(safeData.pump.name)}
                            {pumpOptions.map((pump) => (
                              <option key={pump.name} value={pump.name}>
                                {formatOptionLabel(pump.name, costOf(pump, true))}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                    {packageIncludesPump
                      ? renderReadOnlyQuantity(
                          'Pump Quantity',
                          Math.max(selectedPackage?.includedPumpQuantity ?? pumpQuantity, 0)
                        )
                      : includePump && renderReadOnlyQuantity('Pump Quantity', pumpQuantity)}
                  </div>

                  <div className="action-row">
                    <button type="button" className="action-btn" onClick={() => setPumpEditing(false)}>
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>

            {additionalPumps.map((pump, idx) => {
              const isEditing = activeAdditionalPumpIndex === idx;
              const title = `${pump?.name || selectableDefaults.pump?.name || 'Additional Pump'} - Additional`;
              const isRequiredByWaterFeatures = pump?.autoAddedReason === 'waterFeature';
              return (
                <div key={`additional-pump-card-${idx}`} className="spec-subcard">
                  <div className="spec-subcard-header">
                    <div>
                      <div className="spec-subcard-title">{title}</div>
                      {!isEditing && isRequiredByWaterFeatures && (
                        <div className="spec-subcard-subtitle">Added Automatically</div>
                      )}
                    </div>
                    <div className="spec-subcard-actions stacked-actions">
                      <div className="stacked-primary-actions">
                        {renderPriceImpact(
                          { kind: 'additionalPump', index: idx },
                          `Additional Pump ${idx + 1}`
                        )}
                        {!isEditing && !isRequiredByWaterFeatures && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setActiveAdditionalPumpIndex(idx)}
                          >
                            Edit
                          </button>
                        )}
                        <AdditionalItemRemoveAction
                          label={`Additional Pump ${idx + 1}`}
                          disabled={isRequiredByWaterFeatures}
                          disabledReason={WATER_FEATURE_PUMP_LOCKED_MESSAGE}
                          onRemove={() => removeAdditionalPump(idx)}
                        />
                      </div>
                    </div>
                  </div>

                  {isEditing && !isRequiredByWaterFeatures && (
                    <>
                      <div className="spec-grid spec-grid-2">
                        <div className="spec-field">
                          <LabelWithRetired
                            text={`Additional Pump ${idx + 1}`}
                            showRetired={retiredFlags.additionalPumps[idx]}
                          />
                          <select
                            className="compact-input equipment-select"
                            value={pump?.name || selectableDefaults.pump?.name || ''}
                            onChange={(e) => handleAdditionalPumpChange(idx, e.target.value)}
                          >
                            {retiredFlags.additionalPumps[idx] && renderRetiredOption(pump?.name)}
                            {pumpOptions.map((option) => (
                              <option key={option.name} value={option.name}>
                                {formatOptionLabel(option.name, costOf(option, true))}
                              </option>
                            ))}
                          </select>
                        </div>
                        {renderReadOnlyQuantity('Additional Pump Quantity', 1)}
                      </div>

                      <div className="action-row">
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => setActiveAdditionalPumpIndex(null)}
                        >
                          Done
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}

          </>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Pump
          </div>
        )}
      </div>

      {/* Blower */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Blowers" />
          <ProposalNote categoryKey="equipment" subcategoryId="blowers" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasAuxiliaryPumpSelection,
          noLabel: 'No Blower',
          addLabel: 'Add Blower',
          onNo: clearAuxiliaryPumpFlow,
          onAdd: openAuxiliaryPumpFlow,
          onAddAnother: !auxiliaryPumpAddDisabledReason
            ? () => {
                addAuxiliaryPump();
                setActiveAuxiliaryPumpIndex(auxiliaryPumps.length);
              }
            : undefined,
          noDisabledReason: blowerRequiredBySpa ? 'Blower is required for Spa' : undefined,
          addDisabledReason: auxiliaryPumpAddDisabledReason,
        })}

        {hasAuxiliaryPumpSelection ? (
          <>
            {auxiliaryPumps.map((pump, idx) => {
              const isEditing = activeAuxiliaryPumpIndex === idx;
              const title = pump?.name || getDefaultAuxiliaryPump()?.name || 'Blower';
              const isAutomaticallyAdded = isAutomaticallyAddedItem(pump);

              return (
                <div key={`auxiliary-pump-${idx}`} className="spec-subcard">
                  <div className="spec-subcard-header">
                    <div>
                      <div className="spec-subcard-title">{title}</div>
                      {!isEditing && isAutomaticallyAdded && (
                        <div className="spec-subcard-subtitle">Added Automatically</div>
                      )}
                    </div>
                    <div className="spec-subcard-actions stacked-actions">
                      <div className="stacked-primary-actions">
                        {renderPriceImpact(
                          { kind: 'blower', index: idx },
                          `Blower ${idx + 1}`
                        )}
                        {!isEditing && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setActiveAuxiliaryPumpIndex(idx)}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isEditing && (
                    <>
                      <div className="spec-grid spec-grid-2">
                        <div className="spec-field">
                          <LabelWithRetired
                            text="Blower"
                            showRetired={retiredFlags.auxiliaryPumps[idx]}
                          />
                          <select
                            className="compact-input equipment-select"
                            value={pump?.name || getDefaultAuxiliaryPump()?.name || ''}
                            onChange={(e) => handleAuxiliaryPumpChange(idx, e.target.value)}
                          >
                            {retiredFlags.auxiliaryPumps[idx] &&
                              renderRetiredOption(pump?.name || getDefaultAuxiliaryPump()?.name)}
                            {auxiliaryPumpOptions.map((option: any) => (
                              <option key={option.name} value={option.name}>
                                {formatOptionLabel(option.name, costOf(option, true))}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="action-row">
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => setActiveAuxiliaryPumpIndex(null)}
                        >
                          Done
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Blower
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Filter" />
          <ProposalNote categoryKey="equipment" subcategoryId="filter" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasFilterSelection,
          noLabel: 'No Filter',
          addLabel: 'Add Filter',
          onNo: clearFilterFlow,
          onAdd: openFilterFlow,
          onAddAnother: supportsMultipleHeatersAndFilters ? addAdditionalFilter : undefined,
          noDisabledReason: packageIncludesFilter ? packageLockedCategoryMessage : undefined,
          addDisabledReason: filterAddDisabledReason,
        })}

        {hasFilterSelection ? (
          <>
          <div className="spec-subcard">
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{filterCardTitle}</div>
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact({ kind: 'mainFilter' }, 'Main Filter')}
                  {!filterEditing && (
                    <button type="button" className="link-btn" onClick={() => setFilterEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {filterEditing && (
              <>
                <div className="spec-grid spec-grid-2">
                  {packageIncludesFilter
                    ? renderReadOnlySelection(
                        'Filter',
                        safeData.filter?.name || selectedPackage?.includedFilterName || 'Included',
                        packageLockedCategoryMessage
                      )
                    : (
                      <div className="spec-field">
                        <LabelWithRetired text="Filter" showRetired={retiredFlags.filter} />
                        <select
                          className="compact-input equipment-select"
                          value={includeFilter ? safeData.filter.name : noneOptionValue}
                          onChange={(e) => handleFilterSelect(e.target.value)}
                        >
                          <option value={noneOptionValue}>None</option>
                          {retiredFlags.filter && renderRetiredOption(safeData.filter.name)}
                          {filterOptions.map((filter) => (
                            <option key={filter.name} value={filter.name}>
                              {formatOptionLabel(`${filter.name} (${filter.sqft} sqft)`, costOf(filter))}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {packageIncludesFilter
                    ? renderReadOnlyQuantity(
                        'Filter Quantity',
                        Math.max(selectedPackage?.includedFilterQuantity ?? filterQuantity, 0)
                      )
                    : includeFilter && (
                      <div className="spec-field" style={{ maxWidth: '220px' }}>
                        <label className="spec-label">Filter Quantity</label>
                        <CompactInput
                          value={filterQuantity}
                          onChange={(e) =>
                            updateData({ filterQuantity: Math.max(0, parseInt(e.target.value) || 0) })
                          }
                          unit="ea"
                          min="0"
                          step="1"
                          placeholder="1"
                        />
                      </div>
                    )}
                </div>

                <div className="action-row">
                  <button type="button" className="action-btn" onClick={() => setFilterEditing(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
          {supportsMultipleHeatersAndFilters && additionalFilters.map((filter, index) => {
            const isEditing = activeAdditionalFilterIndex === index;
            return (
              <div key={`additional-filter-${index}`} className="spec-subcard">
                <div className="spec-subcard-header">
                  <div>
                    <div className="spec-subcard-title">{filter.name} - Additional</div>
                  </div>
                  <div className="spec-subcard-actions stacked-actions">
                    <div className="stacked-primary-actions">
                      {renderPriceImpact(
                        { kind: 'additionalFilter', index },
                        `Additional Filter ${index + 1}`
                      )}
                      {!isEditing && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setActiveAdditionalFilterIndex(index)}
                        >
                          Edit
                        </button>
                      )}
                      <AdditionalItemRemoveAction
                        label={`Additional Filter ${index + 1}`}
                        onRemove={() => removeAdditionalFilter(index)}
                      />
                    </div>
                  </div>
                </div>
                {isEditing && (
                  <>
                    <div className="spec-grid spec-grid-2">
                      <div className="spec-field">
                        <LabelWithRetired
                          text="Additional Filter"
                          showRetired={retiredFlags.additionalFilters[index]}
                        />
                        <select
                          className="compact-input equipment-select"
                          value={filter.name}
                          onChange={(event) => handleAdditionalFilterChange(index, event.target.value)}
                        >
                          {retiredFlags.additionalFilters[index] && renderRetiredOption(filter.name)}
                          {filterOptions.map((option) => (
                            <option key={option.name} value={option.name}>
                              {formatOptionLabel(`${option.name} (${option.sqft} sqft)`, costOf(option))}
                            </option>
                          ))}
                        </select>
                      </div>
                      {renderReadOnlyQuantity('Additional Filter Quantity', 1)}
                    </div>
                    <div className="action-row">
                      <button type="button" className="action-btn" onClick={() => setActiveAdditionalFilterIndex(null)}>
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          </>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Filter
          </div>
        )}
      </div>

      {/* Cleaner */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Cleaner" />
          <ProposalNote categoryKey="equipment" subcategoryId="cleaner" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasCleanerSelection,
          noLabel: 'No Cleaner',
          addLabel: 'Add Cleaner',
          onNo: clearCleanerFlow,
          onAdd: openCleanerFlow,
          noDisabledReason: packageIncludesCleaner ? packageLockedCategoryMessage : undefined,
          addDisabledReason: cleanerAddDisabledReason,
        })}

        {hasCleanerSelection ? (
          <div className="spec-subcard">
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{cleanerCardTitle}</div>
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact({ kind: 'cleaner' }, 'Cleaner')}
                  {!cleanerEditing && (
                    <button type="button" className="link-btn" onClick={() => setCleanerEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {cleanerEditing && (
              <>
                <div className="spec-grid-3-split">
                  {packageIncludesCleaner
                    ? renderReadOnlySelection(
                        'Cleaner',
                        safeData.cleaner?.name || selectedPackage?.includedCleanerName || 'Included',
                        packageLockedCategoryMessage
                      )
                    : (
                      <div className="spec-field">
                        <LabelWithRetired text="Cleaner" showRetired={retiredFlags.cleaner} />
                        <select
                          className="compact-input equipment-select"
                          value={includeCleaner ? safeData.cleaner.name : noneOptionValue}
                          onChange={(e) => handleCleanerSelect(e.target.value)}
                        >
                          <option value={noneOptionValue}>None</option>
                          {retiredFlags.cleaner && renderRetiredOption(safeData.cleaner.name)}
                          {cleanerOptions.map((cleaner) => (
                            <option key={cleaner.name} value={cleaner.name}>
                              {formatOptionLabel(cleaner.name, costOf(cleaner))}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {(includeCleaner || packageIncludesCleaner) && (
                    <div className="spec-field">
                      <label className="spec-label">Cleaner Quantity</label>
                      <CompactInput
                        value={
                          packageIncludesCleaner
                            ? Math.max(selectedPackage?.includedCleanerQuantity ?? cleanerQuantity, 0)
                            : cleanerQuantity
                        }
                        onChange={(e) =>
                          updateData({ cleanerQuantity: Math.max(0, parseInt(e.target.value) || 0) })
                        }
                        unit="ea"
                        min="0"
                        step="1"
                        placeholder="1"
                        readOnly={packageIncludesCleaner}
                      />
                    </div>
                  )}

                  {(includeCleaner || packageIncludesCleaner) && (
                    <div className="spec-field">
                      <label className="spec-label">Cleaner Run</label>
                      <CompactInput
                        value={plumbingRuns.cleanerRun ?? 0}
                        onChange={(e) => handleRunChange('cleanerRun', parseFloat(e.target.value) || 0)}
                        unit="LNFT"
                        min="0"
                        step="1"
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>

                <div className="action-row">
                  <button type="button" className="action-btn" onClick={() => setCleanerEditing(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Cleaner
          </div>
        )}
      </div>

      {/* Heating */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Heater" />
          <ProposalNote categoryKey="equipment" subcategoryId="heater" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasHeaterSelectionState,
          noLabel: 'No Heater',
          addLabel: 'Add Heater',
          onNo: clearHeaterFlow,
          onAdd: openHeaterFlow,
          onAddAnother: supportsMultipleHeatersAndFilters ? addAdditionalHeater : undefined,
          noDisabledReason: heaterNoDisabledReason,
          addDisabledReason: heaterAddDisabledReason,
        })}

        {hasHeaterSelectionState ? (
          <>
          <div className="spec-subcard">
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{heaterCardTitle}</div>
                {!heaterEditing && heaterAutoAddedBySpa && (
                  <div className="spec-subcard-subtitle">Added Automatically</div>
                )}
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact({ kind: 'mainHeater' }, 'Main Heater')}
                  {!heaterEditing && (
                    <button type="button" className="link-btn" onClick={() => setHeaterEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {heaterEditing && (
              <>
                <div className="spec-grid spec-grid-2">
                  {packageIncludesHeater
                    ? renderReadOnlySelection(
                        'Heater Model',
                        safeData.heater?.name || selectedPackage?.includedHeaterName || 'Included',
                        packageLockedCategoryMessage
                      )
                    : (
                      <div className="spec-field">
                        <LabelWithRetired text="Heater Model" showRetired={retiredFlags.heater} />
                        <select
                          className="compact-input equipment-select"
                          value={includeHeater ? safeData.heater.name : noneOptionValue}
                          onChange={(e) => handleHeaterSelect(e.target.value)}
                        >
                          <option value={noneOptionValue} disabled={heaterRequiredBySpa}>
                            None
                          </option>
                          {retiredFlags.heater && renderRetiredOption(safeData.heater.name)}
                          {heaterOptions.map((heater) => (
                            <option key={heater.name} value={heater.name}>
                              {formatOptionLabel(heater.name, costOf(heater))}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {packageIncludesHeater
                    ? renderReadOnlyQuantity(
                        'Heater Quantity',
                        Math.max(selectedPackage?.includedHeaterQuantity ?? heaterQuantity, 0)
                      )
                    : includeHeater && (
                      <div className="spec-field" style={{ maxWidth: '220px' }}>
                        <label className="spec-label">Heater Quantity</label>
                        <CompactInput
                          value={heaterQuantity}
                          onChange={(e) =>
                            updateData({
                              heaterQuantity: Math.max(heaterRequiredBySpa ? 1 : 0, parseInt(e.target.value) || 0),
                            })
                          }
                          unit="ea"
                          min={heaterRequiredBySpa ? '1' : '0'}
                          step="1"
                          placeholder="1"
                        />
                      </div>
                    )}
                </div>

                <div className="action-row">
                  <button type="button" className="action-btn" onClick={() => setHeaterEditing(false)}>
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
          {supportsMultipleHeatersAndFilters && additionalHeaters.map((heater, index) => {
            const isEditing = activeAdditionalHeaterIndex === index;
            return (
              <div key={`additional-heater-${index}`} className="spec-subcard">
                <div className="spec-subcard-header">
                  <div>
                    <div className="spec-subcard-title">{heater.name} - Additional</div>
                  </div>
                  <div className="spec-subcard-actions stacked-actions">
                    <div className="stacked-primary-actions">
                      {renderPriceImpact(
                        { kind: 'additionalHeater', index },
                        `Additional Heater ${index + 1}`
                      )}
                      {!isEditing && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setActiveAdditionalHeaterIndex(index)}
                        >
                          Edit
                        </button>
                      )}
                      <AdditionalItemRemoveAction
                        label={`Additional Heater ${index + 1}`}
                        onRemove={() => removeAdditionalHeater(index)}
                      />
                    </div>
                  </div>
                </div>
                {isEditing && (
                  <>
                    <div className="spec-grid spec-grid-2">
                      <div className="spec-field">
                        <LabelWithRetired
                          text="Additional Heater"
                          showRetired={retiredFlags.additionalHeaters[index]}
                        />
                        <select
                          className="compact-input equipment-select"
                          value={heater.name}
                          onChange={(event) => handleAdditionalHeaterChange(index, event.target.value)}
                        >
                          {retiredFlags.additionalHeaters[index] && renderRetiredOption(heater.name)}
                          {heaterOptions.map((option) => (
                            <option key={option.name} value={option.name}>
                              {formatOptionLabel(option.name, costOf(option))}
                            </option>
                          ))}
                        </select>
                      </div>
                      {renderReadOnlyQuantity('Additional Heater Quantity', 1)}
                    </div>
                    <div className="action-row">
                      <button type="button" className="action-btn" onClick={() => setActiveAdditionalHeaterIndex(null)}>
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
          </>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Heater
          </div>
        )}
      </div>

      {/* Heater Chiller - visible for PPAS East, editable in the Custom package */}
      {isPpasEast && (
        <div className="spec-block">
          <div className="spec-block-header">
            <EquipmentCategoryTitle label="Heater Chiller" />
            <ProposalNote categoryKey="equipment" subcategoryId="heaterChiller" overrides={noteOverrides} />
          </div>
          {renderToggleButtons({
            hasSelection: hasHeaterChillerSelection,
            noLabel: 'No Heater Chiller',
            addLabel: 'Add Heater Chiller',
            onNo: clearHeaterChillerFlow,
            onAdd: openHeaterChillerFlow,
            addDisabledReason: heaterChillerAddDisabledReason,
          })}

          {hasHeaterChillerSelection ? (
            <div className="spec-subcard">
              <div className="spec-subcard-header">
                <div>
                  <div className="spec-subcard-title">{heaterChillerCardTitle}</div>
                </div>
                <div className="spec-subcard-actions stacked-actions">
                  <div className="stacked-primary-actions">
                    {renderPriceImpact({ kind: 'heaterChiller' }, 'Heater Chiller')}
                    {!heaterChillerEditing && (
                      <button type="button" className="link-btn" onClick={() => setHeaterChillerEditing(true)}>
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {heaterChillerEditing && (
                <>
                  <div className="spec-grid spec-grid-2">
                    <div className="spec-field">
                      <LabelWithRetired
                        text="Heater Chiller Model"
                        showRetired={retiredFlags.heaterChiller}
                      />
                      <select
                        className="compact-input equipment-select"
                        value={safeData.heaterChiller?.name || noneOptionValue}
                        onChange={(event) => handleHeaterChillerChange(event.target.value)}
                      >
                        {retiredFlags.heaterChiller &&
                          safeData.heaterChiller?.name &&
                          renderRetiredOption(safeData.heaterChiller.name)}
                        {heaterChillerOptions.map((option) => (
                          <option key={option.name} value={option.name}>
                            {formatOptionLabel(option.name, costOf(option))}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="spec-field" style={{ maxWidth: '220px' }}>
                      <label className="spec-label">Heater Chiller Quantity</label>
                      <CompactInput
                        value={heaterChillerQuantity}
                        onChange={(event) =>
                          updateData({ heaterChillerQuantity: Math.max(1, parseInt(event.target.value) || 1) })
                        }
                        unit="ea"
                        min="1"
                        step="1"
                        placeholder="1"
                      />
                    </div>
                  </div>
                  <div className="action-row">
                    <button type="button" className="action-btn" onClick={() => setHeaterChillerEditing(false)}>
                      Done
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="empty-message" style={{ marginTop: '10px' }}>
              No Heater Chiller
            </div>
          )}
        </div>
      )}

      {/* Pool Lights */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Pool Lights" />
          <ProposalNote categoryKey="equipment" subcategoryId="poolLights" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasPoolLightSelection,
          noLabel: 'No Pool Light',
          addLabel: 'Add Pool Light',
          onNo: clearPoolLightFlow,
          onAdd: openPoolLightFlow,
          onAddAnother: !poolLightTopLevelDisabledReason
            ? () => {
                addPoolLight();
                setActivePoolLightIndex(effectivePoolLights.length);
              }
            : undefined,
          noDisabledReason: packageIncludesPoolLights ? packageLockedCategoryMessage : undefined,
          addDisabledReason: poolLightTopLevelDisabledReason,
        })}

        {hasPoolLightSelection ? (
          <>
            {effectivePoolLights.map((light, index) => {
              const isEditing = activePoolLightIndex === index;
              const isAddedAutomatically = index < autoSeededPoolLightCount;
              const isAdditionalLight =
                index > 0 && !(packageIncludesPoolLights && index < includedPoolLightCount);
              const label =
                index < includedPoolLightCount
                  ? `Pool Light ${index + 1} (Included in Package)`
                  : index < autoSeededPoolLightCount
                  ? `Pool Light ${index + 1} (Added Automatically)`
                  : isFixedPackage && packageIncludesPoolLights && index === includedPoolLightCount
                  ? `Pool Light ${index + 1} (Upgrade)`
                  : index === 0
                  ? 'Pool Light 1'
                  : `Additional Pool Light ${index}`;

              return (
                <div key={`pool-light-card-${index}`} className="spec-subcard">
                  <div className="spec-subcard-header">
                    <div>
                      <div className="spec-subcard-title">
                        {light?.name || 'Pool Light'}{isAdditionalLight ? ' - Additional' : ''}
                      </div>
                      {!isEditing && isAddedAutomatically && (
                        <div className="spec-subcard-subtitle">Added Automatically</div>
                      )}
                    </div>
                    <div className="spec-subcard-actions stacked-actions">
                      <div className="stacked-primary-actions">
                          {renderPriceImpact(
                            { kind: 'poolLight', index },
                            index === 0 ? 'Pool Light 1' : `Additional Pool Light ${index}`
                          )}
                        {!isEditing && (
                          <button
                            type="button"
                            className="link-btn"
                            onClick={() => setActivePoolLightIndex(index)}
                          >
                            Edit
                          </button>
                        )}
                        {isAdditionalLight && (
                          <AdditionalItemRemoveAction
                            label={`Additional Pool Light ${index}`}
                            onRemove={() => removePoolLight(index)}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {isEditing && (
                    <>
                      <div className="spec-grid spec-grid-2">
                        {packageIncludesPoolLights && index === 0
                          ? renderReadOnlySelection(label, light?.name || selectedPackage?.includedPoolLightName || 'Included', packageLockedCategoryMessage)
                          : (
                            <div className="spec-field">
                              <LabelWithRetired text={label} showRetired={retiredFlags.poolLights[index]} />
                              <select
                                className="compact-input equipment-select"
                                value={light?.name || noneOptionValue}
                                onChange={(e) =>
                                  index === 0
                                    ? handlePoolLightSelect(e.target.value)
                                    : handlePoolLightChange(index, e.target.value)
                                }
                              >
                                {index === 0 && <option value={noneOptionValue}>None</option>}
                                {(retiredFlags.poolLights[index] || isPoolLightMissingFromCatalog(light?.name)) &&
                                  renderRetiredOption(light?.name)}
                                {poolLightOptions.map((option) => (
                                  <option key={option.name} value={option.name}>
                                    {formatOptionLabel(option.name, costOf(option))}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                      </div>

                      <div className="action-row">
                        <button
                          type="button"
                          className="action-btn"
                          onClick={() => setActivePoolLightIndex(null)}
                        >
                          Done
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Pool Lights
          </div>
        )}
      </div>

      {/* Spa Lights */}
      {hasSpa && (
        <div className="spec-block">
          <div className="spec-block-header">
            <EquipmentCategoryTitle label="Spa Lights" />
            <ProposalNote categoryKey="equipment" subcategoryId="spaLights" overrides={noteOverrides} />
          </div>
          {renderToggleButtons({
            hasSelection: hasSpaLightSelectionState,
            noLabel: 'No Spa Light',
            addLabel: 'Add Spa Light',
            onNo: clearSpaLightFlow,
            onAdd: openSpaLightFlow,
            onAddAnother: !spaLightTopLevelDisabledReason
              ? () => {
                  addSpaLight();
                  setActiveSpaLightIndex(spaLights.length);
                }
              : undefined,
            noDisabledReason: packageIncludesSpaLights ? packageLockedCategoryMessage : undefined,
            addDisabledReason: spaLightTopLevelDisabledReason,
          })}

          {hasSpaLightSelectionState ? (
            <>
              {spaLights.map((light, index) => {
                const isEditing = activeSpaLightIndex === index;
                const isAddedAutomatically = index === 0 && !packageIncludesSpaLights;
                const isAdditionalLight =
                  index > 0 &&
                  !(packageIncludesSpaLights && index < Math.max(selectedPackage?.includedSpaLightQuantity ?? 0, 0));
                const label =
                  index === 0
                    ? packageIncludesSpaLights
                      ? 'Spa Light (Included in Package)'
                      : 'Spa Light (Added Automatically)'
                    : `Additional Spa Light ${index}`;

                return (
                  <div key={`spa-light-card-${index}`} className="spec-subcard">
                    <div className="spec-subcard-header">
                      <div>
                        <div className="spec-subcard-title">
                          {light?.name || 'Spa Light'}{isAdditionalLight ? ' - Additional' : ''}
                        </div>
                        {!isEditing && isAddedAutomatically && (
                          <div className="spec-subcard-subtitle">Added Automatically</div>
                        )}
                      </div>
                      <div className="spec-subcard-actions stacked-actions">
                        <div className="stacked-primary-actions">
                          {renderPriceImpact(
                            { kind: 'spaLight', index },
                            index === 0 ? 'Spa Light 1' : `Additional Spa Light ${index}`
                          )}
                          {!isEditing && (
                            <button
                              type="button"
                              className="link-btn"
                              onClick={() => setActiveSpaLightIndex(index)}
                            >
                              Edit
                            </button>
                          )}
                          {isAdditionalLight && (
                            <AdditionalItemRemoveAction
                              label={`Additional Spa Light ${index}`}
                              onRemove={() => removeSpaLight(index)}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <>
                        <div className="spec-grid spec-grid-2">
                          {packageIncludesSpaLights && index === 0
                            ? renderReadOnlySelection(
                                label,
                                light?.name || selectedPackage?.includedSpaLightName || 'Included',
                                packageLockedCategoryMessage
                              )
                            : (
                              <div className="spec-field">
                                <LabelWithRetired text={label} showRetired={retiredFlags.spaLights[index]} />
                                <select
                                  className="compact-input equipment-select"
                                  value={light?.name || noneOptionValue}
                                  onChange={(e) =>
                                    index === 0
                                      ? handleSpaLightSelect(e.target.value)
                                      : handleSpaLightChange(index, e.target.value)
                                  }
                                >
                                  {index === 0 && <option value={noneOptionValue}>None</option>}
                                  {retiredFlags.spaLights[index] && renderRetiredOption(light?.name)}
                                  {spaLightOptions.map((option) => (
                                    <option key={option.name} value={option.name}>
                                      {formatOptionLabel(option.name, costOf(option))}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                        </div>

                        <div className="action-row">
                          <button
                            type="button"
                            className="action-btn"
                            onClick={() => setActiveSpaLightIndex(null)}
                          >
                            Done
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="empty-message" style={{ marginTop: '10px' }}>
              No Spa Lights
            </div>
          )}
        </div>
      )}

      {/* Automation */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Automation" />
          <ProposalNote categoryKey="equipment" subcategoryId="automation" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasAutomationSelection,
          noLabel: 'No Automation',
          addLabel: 'Add Automation',
          onNo: clearAutomationFlow,
          onAdd: openAutomationFlow,
          noDisabledReason: packageIncludesAutomation ? packageLockedCategoryMessage : undefined,
          addDisabledReason: automationAddDisabledReason,
        })}

        {hasAutomationSelection ? (
          <div className="spec-subcard">
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{automationCardTitle}</div>
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact({ kind: 'automation' }, 'Automation System')}
                  {!automationEditing && (
                    <button type="button" className="link-btn" onClick={() => setAutomationEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {automationEditing && (
              <>
                <div className="spec-grid spec-grid-2">
                  {packageIncludesAutomation
                    ? renderReadOnlySelection(
                        'Automation System',
                        safeData.automation?.name || selectedPackage?.includedAutomationName || 'Included',
                        packageLockedCategoryMessage
                      )
                    : (
                      <div className="spec-field">
                        <LabelWithRetired text="Automation System" showRetired={retiredFlags.automation} />
                        <select
                          className="compact-input equipment-select"
                          value={includeAutomation ? safeData.automation.name : noneOptionValue}
                          onChange={(e) => handleAutomationSelect(e.target.value)}
                        >
                          <option value={noneOptionValue}>None</option>
                          {retiredFlags.automation && renderRetiredOption(safeData.automation.name)}
                          {automationOptions.map((option) => (
                            <option key={option.name} value={option.name}>
                              {formatOptionLabel(option.name, costOf(option))}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {packageIncludesAutomation
                    ? renderReadOnlyQuantity(
                        'Automation System Quantity',
                        Math.max(selectedPackage?.includedAutomationQuantity ?? automationQuantity, 0)
                      )
                    : includeAutomation && (
                      <div className="spec-field" style={{ maxWidth: '220px' }}>
                        <label className="spec-label">Automation System Quantity</label>
                        <CompactInput
                          value={automationQuantity}
                          onChange={(e) =>
                            updateData({ automationQuantity: Math.max(0, parseInt(e.target.value) || 0) })
                          }
                          unit="ea"
                          min="0"
                          step="1"
                          placeholder="1"
                        />
                      </div>
                    )}
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setAutomationEditing(false)}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Automation
          </div>
        )}
      </div>

      {/* Sanitation System (formerly Salt) */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Sanitation System" />
          <ProposalNote categoryKey="equipment" subcategoryId="sanitationSystem" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasSanitationSelection,
          noLabel: 'No Sanitation System',
          addLabel: 'Add Sanitation System',
          onNo: clearSanitationFlow,
          onAdd: openSanitationFlow,
          noDisabledReason: sanitationRequiredByAutomation
            ? 'Required for Automation'
            : packageIncludesSalt
              ? packageLockedCategoryMessage
              : undefined,
          addDisabledReason: sanitationAddDisabledReason,
        })}

        {hasSanitationSelection ? (
          <div className="spec-subcard">
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{sanitationCardTitle}</div>
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact({ kind: 'sanitation' }, 'Sanitation System')}
                  {!sanitationEditing && (
                    <button type="button" className="link-btn" onClick={() => setSanitationEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {sanitationEditing && (
              <>
                <div className="spec-grid spec-grid-2">
                  {packageLocksSanitationSystem
                    ? renderReadOnlySelection(
                        'Sanitation System',
                        packageIncludesSalt
                          ? getEffectivePrimarySanitationSystemName(safeData) || 'Included'
                          : 'None',
                        packageIncludesSalt ? packageLockedCategoryMessage : undefined
                      )
                    : (
                      <div className="spec-field">
                        <LabelWithRetired text="Sanitation System" showRetired={retiredFlags.saltSystem} />
                        <select
                          className="compact-input equipment-select"
                          value={includeSalt ? safeData.saltSystem?.name || noneOptionValue : noneOptionValue}
                          onChange={(e) => handleSaltSelect(e.target.value)}
                        >
                          {!includeAutomation && <option value={noneOptionValue}>None</option>}
                          {retiredFlags.saltSystem && renderRetiredOption(safeData.saltSystem?.name)}
                          {visibleSaltOptions.map((system) => (
                            <option key={system.name} value={system.name}>
                              {formatOptionLabel(system.name, costOf(system))}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {packageIncludesSalt
                    ? renderReadOnlyQuantity(
                        'Sanitation System Quantity',
                        Math.max(selectedPackage?.includedSaltSystemQuantity ?? saltSystemQuantity, 0)
                      )
                    : showSaltQuantity && (
                      <div className="spec-field" style={{ maxWidth: '220px' }}>
                        <label className="spec-label">Sanitation System Quantity</label>
                        <CompactInput
                          value={saltSystemQuantity}
                          onChange={(e) =>
                            updateData({ saltSystemQuantity: Math.max(1, parseInt(e.target.value) || 1) })
                          }
                          unit="ea"
                          min="1"
                          step="1"
                          placeholder="1"
                        />
                      </div>
                    )}
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setSanitationEditing(false)}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Sanitation System
          </div>
        )}
      </div>

      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Additional Sanitation Options">
            {selectedAdditionalSanitationName &&
              renderPriceImpact(
                { kind: 'additionalSanitation' },
                'Additional Sanitation Option'
              )}
          </EquipmentCategoryTitle>
          <ProposalNote categoryKey="equipment" subcategoryId="additionalSanitationOptions" overrides={noteOverrides} />
        </div>

        {additionalSanitationOptions.length > 0 || packageIncludesSanitationAccessory || hasAdditionalSanitationSelection ? (
          <>
            {renderToggleButtons({
              hasSelection: hasAdditionalSanitationSelection,
              noLabel: 'No Additional Sanitation Option',
              addLabel: 'Add Additional Sanitation Option',
              onNo: clearAdditionalSanitationFlow,
              onAdd: openAdditionalSanitationFlow,
              noDisabledReason: packageIncludesSanitationAccessory ? packageLockedCategoryMessage : undefined,
              addDisabledReason: additionalSanitationOptionDisabledReason,
            })}

            {hasAdditionalSanitationSelection && (
              <div className="spec-subcard">
                <div className="spec-subcard-header">
                  <div>
                    <div className="spec-subcard-title">{selectedAdditionalSanitationName}</div>
                  </div>
                  <div className="spec-subcard-actions stacked-actions">
                    <div className="stacked-primary-actions">
                      {!additionalSanitationEditing && !packageIncludesSanitationAccessory && (
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setAdditionalSanitationEditing(true)}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {additionalSanitationEditing && (
                  <>
                    <div className="spec-grid spec-grid-2">
                      {packageIncludesSanitationAccessory
                        ? renderReadOnlySelection(
                            'Included Additional Option',
                            selectedAdditionalSanitationName || 'Included',
                            packageLockedCategoryMessage,
                            retiredFlags.sanitationAccessory
                          )
                        : (
                          <div className="spec-field">
                            <label className="spec-label">Additional Sanitation Option</label>
                            <select
                              className="compact-input equipment-select"
                              value={selectedAdditionalSanitationName || noneOptionValue}
                              onChange={(event) => handleAdditionalSanitationOptionChange(event.target.value)}
                            >
                              {additionalSanitationSelectionMissingFromCatalog && (
                                <option value={selectedAdditionalSanitationName}>{selectedAdditionalSanitationName} (retired)</option>
                              )}
                              {additionalSanitationOptions.map((option: any) => (
                                <option key={option.name} value={option.name}>
                                  {formatOptionLabel(option.name, costOf(option))}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                    </div>
                    <div className="action-row">
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => setAdditionalSanitationEditing(false)}
                      >
                        Done
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No additional sanitation options pricing configured.
          </div>
        )}

        {additionalSanitationSelectionMissingFromCatalog && (
          <div className="info-box" style={{ marginTop: '8px', background: '#fff7ed', borderColor: '#fdba74', color: '#9a3412' }}>
            The previously selected additional sanitation option is no longer in the active pricing model. Choose another option.
          </div>
        )}

      </div>

      {/* Auto-fill */}
      <div className="spec-block">
        <div className="spec-block-header">
          <EquipmentCategoryTitle label="Auto-fill" />
          <ProposalNote categoryKey="equipment" subcategoryId="autoFill" overrides={noteOverrides} />
        </div>
        {renderToggleButtons({
          hasSelection: hasAutoFillSelection,
          noLabel: 'No Auto-fill',
          addLabel: 'Add Auto-fill',
          onNo: clearAutoFillFlow,
          onAdd: openAutoFillFlow,
          noDisabledReason: packageIncludesAutoFill ? packageLockedCategoryMessage : undefined,
          addDisabledReason: autoFillAddDisabledReason,
        })}

        {hasAutoFillSelection ? (
          <div className="spec-subcard">
            <div className="spec-subcard-header">
              <div>
                <div className="spec-subcard-title">{autoFillCardTitle}</div>
              </div>
              <div className="spec-subcard-actions stacked-actions">
                <div className="stacked-primary-actions">
                  {renderPriceImpact({ kind: 'autoFill' }, 'Auto-fill System')}
                  {!autoFillEditing && (
                    <button type="button" className="link-btn" onClick={() => setAutoFillEditing(true)}>
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>

            {autoFillEditing && (
              <>
                <div className={`spec-grid-3-split auto-fill-grid ${autoFillRequiresElectric ? 'auto-fill-grid-electric' : ''}`}>
                  {packageIncludesAutoFill
                    ? renderReadOnlySelection(
                        'Auto-Fill System',
                        safeData.autoFillSystem?.name || selectedPackage?.includedAutoFillSystemName || 'Included',
                        packageLockedCategoryMessage
                      )
                    : (
                      <div className="spec-field">
                        <LabelWithRetired text="Auto-Fill System" showRetired={retiredFlags.autoFillSystem} />
                        <select
                          className="compact-input equipment-select"
                          value={includeAutoFill ? safeData.autoFillSystem?.name || noneOptionValue : noneOptionValue}
                          onChange={(e) => handleAutoFillSelect(e.target.value)}
                        >
                          <option value={noneOptionValue}>None</option>
                          {retiredFlags.autoFillSystem &&
                            renderRetiredOption(safeData.autoFillSystem?.name)}
                          {autoFillOptions.map((system) => (
                            <option key={system.name} value={system.name}>
                              {formatOptionLabel(system.name, costOf(system))}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                  {(includeAutoFill || packageIncludesAutoFill) && (
                    <div className="spec-field">
                      <label className="spec-label">Auto-Fill System Quantity</label>
                      <CompactInput
                        value={autoFillSystemQuantity}
                        onChange={(e) =>
                          updateData({ autoFillSystemQuantity: Math.max(0, parseInt(e.target.value) || 0) })
                        }
                        unit="ea"
                        min="0"
                        step="1"
                        placeholder="1"
                        readOnly={packageIncludesAutoFill}
                      />
                    </div>
                  )}

                  {(includeAutoFill || packageIncludesAutoFill) && (
                    <div className="spec-field">
                      <label className="spec-label">{autoFillRequiresElectric ? 'Plumbing Run' : 'Auto-Fill Run'}</label>
                      <CompactInput
                        value={plumbingRuns.autoFillRun ?? 0}
                        onChange={(e) => handleRunChange('autoFillRun', parseFloat(e.target.value) || 0)}
                        unit="LNFT"
                        min="0"
                        step="1"
                        placeholder="0"
                      />
                    </div>
                  )}

                  {(includeAutoFill || packageIncludesAutoFill) && autoFillRequiresElectric && (
                    <div className="spec-field">
                      <label className="spec-label">Conduit Run</label>
                      <CompactInput
                        value={plumbingRuns.autoFillElectricRun ?? 0}
                        onChange={(e) => handleRunChange('autoFillElectricRun', parseFloat(e.target.value) || 0)}
                        unit="LNFT"
                        min="0"
                        step="1"
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>

                <div className="action-row">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setAutoFillEditing(false)}
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="empty-message" style={{ marginTop: '10px' }}>
            No Auto-fill
          </div>
        )}
      </div>

      <CustomOptionsSection
        data={safeData.customOptions || []}
        onChange={(customOptions) => updateData({ customOptions })}
        noteCategoryKey="equipment"
        noteOverrides={noteOverrides}
        compactToggle
        renderPriceImpact={(index, option) =>
          renderPriceImpact(
            { kind: 'customOption', index },
            option.name?.trim() || `Equipment Custom Option ${index + 1}`
          )
        }
      />
      </BalancedEquipmentColumns>
    </div>
  );
}

export default EquipmentSectionNew;
