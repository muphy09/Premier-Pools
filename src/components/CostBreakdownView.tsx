import { useEffect, useMemo, useState } from 'react';
import { CostBreakdown, CostLineItem, PricingCalculations, Proposal, RetailAdjustment } from '../types/proposal-new';
import SubmergeAdvantageWarranty from './SubmergeAdvantageWarranty';
import FranchiseLogo from './FranchiseLogo';
import { normalizeCostBreakdownForDisplay } from '../utils/costBreakdownDisplay';
import { hasIncludedDecking } from '../utils/decking';
import { resolveFeenstraMay2026CustomerBreakdown } from '../services/legacy/feenstraMay2026CustomerBreakdown';
import './CostBreakdownView.css';

interface Props {
  costBreakdown: CostBreakdown;
  customerName: string;
  proposal?: Partial<Proposal>;
  pricing?: PricingCalculations;
  showWarranty?: boolean;
  showZoomControl?: boolean;
  initialZoomScale?: number;
  exportLayout?: boolean;
  allowRetailAdjustments?: boolean;
  onRetailAdjustmentsChange?: (adjustments: RetailAdjustment[]) => void;
  editableWarranty?: boolean;
  onWarrantySectionsChange?: (sections: Proposal['warrantySections']) => void;
}

const isPapDiscount = (item: CostLineItem): boolean =>
  item.description?.toLowerCase().includes('pap discount') ?? false;

const DEFAULT_RETAIL_ADJUSTMENTS: RetailAdjustment[] = [
  { name: '', amount: 0 },
  { name: '', amount: 0 },
];

const normalizeRetailAdjustments = (input?: RetailAdjustment[]): RetailAdjustment[] =>
  DEFAULT_RETAIL_ADJUSTMENTS.map((base, index) => {
    const source = Array.isArray(input) ? input[index] : undefined;
    return {
      name: typeof source?.name === 'string' ? source.name : base.name,
      amount: Number.isFinite(Number((source as any)?.amount)) ? Number((source as any).amount) : base.amount,
    };
  });

const isAdjustmentInputPending = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.';
};

const formatGrossMarginIndicator = (value?: number): string => {
  const safeValue = Number.isFinite(value) ? (value as number) : 0;
  const sign = safeValue < 0 ? '-' : '';
  const fixed = Math.abs(safeValue).toFixed(2);
  const [whole, decimal] = fixed.split('.');
  const paddedWhole = (whole || '0').padStart(2, '0');
  return `${sign}${paddedWhole}.${decimal}`;
};

const buildProposalIndicator = (value?: number): string => `Proposal #26${formatGrossMarginIndicator(value)}`;

function CostBreakdownView({
  costBreakdown,
  customerName,
  proposal,
  pricing,
  showWarranty = true,
  showZoomControl = true,
  initialZoomScale = showZoomControl ? 0.75 : 1,
  exportLayout = false,
  allowRetailAdjustments = false,
  onRetailAdjustmentsChange,
  editableWarranty = false,
  onWarrantySectionsChange,
}: Props) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const normalizedInitialZoomScale = Math.min(Math.max(initialZoomScale, 0.5), 1);
  const initialZoomLevel = (normalizedInitialZoomScale - 0.5) / 0.5;
  const [zoomLevel, setZoomLevel] = useState(showZoomControl ? initialZoomLevel : 1);
  const retailAdjustments = useMemo(
    () => normalizeRetailAdjustments(proposal?.retailAdjustments),
    [proposal?.retailAdjustments]
  );
  const shouldUseCopingOnlyLabels = Boolean(proposal?.tileCopingDecking) && !hasIncludedDecking(proposal);
  const copingDeckingLaborLabel = shouldUseCopingOnlyLabels ? 'Coping Labor' : 'Coping/Decking Labor';
  const copingDeckingMaterialLabel = shouldUseCopingOnlyLabels ? 'Coping Material' : 'Coping/Decking Material';
  const [adjustmentInputs, setAdjustmentInputs] = useState<string[]>(
    () => retailAdjustments.map((adj) => (adj.amount === 0 ? '' : String(adj.amount)))
  );
  const [focusedAdjustmentIndex, setFocusedAdjustmentIndex] = useState<number | null>(null);
  const displayCostBreakdown = useMemo(
    () => normalizeCostBreakdownForDisplay(costBreakdown, proposal),
    [costBreakdown, proposal]
  );

  useEffect(() => {
    setAdjustmentInputs((prev) =>
      retailAdjustments.map((adj, index) => {
        if (focusedAdjustmentIndex === index) {
          return prev[index] ?? (adj.amount === 0 ? '' : String(adj.amount));
        }
        return adj.amount === 0 ? '' : String(adj.amount);
      })
    );
  }, [retailAdjustments, focusedAdjustmentIndex]);

  const formatCurrency = (value: number): string =>
    `$${(Number.isFinite(value) ? value : 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const roundToTwo = (value: number): number =>
    Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  const EMPTY_CUSTOM_FEATURES_ROW_THRESHOLD = 0.05;
  const hasSummaryRowContent = (row: { cost: number; items?: CostLineItem[] }): boolean =>
    roundToTwo(row.cost) !== 0 || (row.items?.length ?? 0) > 0;
  const shouldHideEmptyCustomFeaturesRow = (row: {
    label: string;
    cost: number;
    items?: CostLineItem[];
    retail: number;
  }): boolean =>
    row.label === 'Custom Features' &&
    !hasSummaryRowContent(row) &&
    Math.abs(roundToTwo(row.retail)) <= EMPTY_CUSTOM_FEATURES_ROW_THRESHOLD;

  const baseTotals = displayCostBreakdown?.totals || ({} as CostBreakdown['totals']);
  const costBasis =
    pricing?.totalCostsBeforeOverhead ??
    proposal?.pricing?.totalCostsBeforeOverhead ??
    baseTotals.grandTotal ??
    0;
  const franchiseId = proposal?.franchiseId;
  const retailAdjustmentsTotal = retailAdjustments.reduce((sum, adj) => sum + (adj.amount || 0), 0);
  let offContractTotal =
    pricing?.offContractTotal ??
    proposal?.pricing?.offContractTotal ??
    0;

  let retailPrice =
    pricing?.retailPrice ??
    proposal?.pricing?.retailPrice ??
    proposal?.totalCost ??
    0;

  if (!retailPrice && costBasis) {
    retailPrice = costBasis;
  }
  const retailTargetForCategories = retailPrice - retailAdjustmentsTotal - offContractTotal;
  const safeRetailTarget = Number.isFinite(retailTargetForCategories) ? retailTargetForCategories : retailPrice;
  const retailFactor = costBasis > 0 ? safeRetailTarget / costBasis : 1;

  const getRetailOverride = (item?: CostLineItem): number | null => {
    if (!item) return null;
    const override = (item.details as any)?.retailOverride;
    return Number.isFinite(override) ? Number(override) : null;
  };

  const allItems: CostLineItem[] = [
    ...(displayCostBreakdown.plansAndEngineering || []),
    ...(displayCostBreakdown.layout || []),
    ...(displayCostBreakdown.permit || []),
    ...(displayCostBreakdown.excavation || []),
    ...(displayCostBreakdown.plumbing || []),
    ...(displayCostBreakdown.gas || []),
    ...(displayCostBreakdown.steel || []),
    ...(displayCostBreakdown.electrical || []),
    ...(displayCostBreakdown.shotcreteLabor || []),
    ...(displayCostBreakdown.shotcreteMaterial || []),
    ...(displayCostBreakdown.tileLabor || []),
    ...(displayCostBreakdown.tileMaterial || []),
    ...(displayCostBreakdown.copingDeckingLabor || []),
    ...(displayCostBreakdown.copingDeckingMaterial || []),
    ...(displayCostBreakdown.stoneRockworkLabor || []),
    ...(displayCostBreakdown.stoneRockworkMaterial || []),
    ...(displayCostBreakdown.drainage || []),
    ...(displayCostBreakdown.waterFeatures || []),
    ...(displayCostBreakdown.equipmentOrdered || []),
    ...(displayCostBreakdown.equipmentSet || []),
    ...(displayCostBreakdown.cleanup || []),
    ...(displayCostBreakdown.interiorFinish || []),
    ...(displayCostBreakdown.waterTruck || []),
    ...(displayCostBreakdown.fiberglassShell || []),
    ...(displayCostBreakdown.fiberglassInstall || []),
    ...(displayCostBreakdown.startupOrientation || []),
    ...(displayCostBreakdown.customFeatures || []),
  ];

  const overrideItems = allItems.filter((item) => getRetailOverride(item) !== null);
  const overrideCostBasis = overrideItems.reduce((sum, item) => sum + (item.total ?? 0), 0);
  const overrideRetailTotal = overrideItems.reduce((sum, item) => sum + (getRetailOverride(item) || 0), 0);
  const remainingCostBasis = costBasis - overrideCostBasis;
  const adjustedRetailFactor =
    remainingCostBasis > 0 ? (safeRetailTarget - overrideRetailTotal) / remainingCostBasis : retailFactor;
  const safeAdjustedRetailFactor = Number.isFinite(adjustedRetailFactor) ? adjustedRetailFactor : retailFactor;

  // Map cost totals into retail-valued rows that sum to the retail price.
  const categoryRows = [
    { label: 'Plans & Engineering', cost: baseTotals.plansAndEngineering ?? 0, items: displayCostBreakdown.plansAndEngineering || [] },
    { label: 'Layout', cost: baseTotals.layout ?? 0, items: displayCostBreakdown.layout || [] },
    { label: 'Permit', cost: baseTotals.permit ?? 0, items: displayCostBreakdown.permit || [] },
    { label: 'Excavation', cost: baseTotals.excavation ?? 0, items: displayCostBreakdown.excavation || [] },
    { label: 'Plumbing', cost: baseTotals.plumbing ?? 0, items: displayCostBreakdown.plumbing || [] },
    { label: 'Gas', cost: baseTotals.gas ?? 0, items: displayCostBreakdown.gas || [] },
    { label: 'Steel', cost: baseTotals.steel ?? 0, items: displayCostBreakdown.steel || [] },
    { label: 'Electrical', cost: baseTotals.electrical ?? 0, items: displayCostBreakdown.electrical || [] },
    { label: 'Shotcrete Labor', cost: baseTotals.shotcreteLabor ?? 0, items: displayCostBreakdown.shotcreteLabor || [] },
    { label: 'Shotcrete Material', cost: baseTotals.shotcreteMaterial ?? 0, items: displayCostBreakdown.shotcreteMaterial || [] },
    { label: 'Tile Labor', cost: baseTotals.tileLabor ?? 0, items: displayCostBreakdown.tileLabor || [] },
    { label: 'Tile Material', cost: baseTotals.tileMaterial ?? 0, items: displayCostBreakdown.tileMaterial || [] },
    { label: copingDeckingLaborLabel, cost: baseTotals.copingDeckingLabor ?? 0, items: displayCostBreakdown.copingDeckingLabor || [] },
    { label: copingDeckingMaterialLabel, cost: baseTotals.copingDeckingMaterial ?? 0, items: displayCostBreakdown.copingDeckingMaterial || [] },
    {
      label: 'Stone/Rockwork',
      cost: (baseTotals.stoneRockworkLabor ?? 0) + (baseTotals.stoneRockworkMaterial ?? 0),
      items: [
        ...(displayCostBreakdown.stoneRockworkLabor || []),
        ...(displayCostBreakdown.stoneRockworkMaterial || []),
      ],
    },
    { label: 'Drainage', cost: baseTotals.drainage ?? 0, items: displayCostBreakdown.drainage || [] },
    { label: 'Equipment Ordered', cost: baseTotals.equipmentOrdered ?? 0, items: displayCostBreakdown.equipmentOrdered || [] },
    { label: 'Equipment Set', cost: baseTotals.equipmentSet ?? 0, items: displayCostBreakdown.equipmentSet || [] },
    { label: 'Water Features', cost: baseTotals.waterFeatures ?? 0, items: displayCostBreakdown.waterFeatures || [] },
    { label: 'Cleanup', cost: baseTotals.cleanup ?? 0, items: displayCostBreakdown.cleanup || [] },
    { label: 'Interior Finish', cost: baseTotals.interiorFinish ?? 0, items: displayCostBreakdown.interiorFinish || [] },
    { label: 'Water Truck', cost: baseTotals.waterTruck ?? 0, items: displayCostBreakdown.waterTruck || [] },
    { label: 'Fiberglass Shell', cost: baseTotals.fiberglassShell ?? 0, items: displayCostBreakdown.fiberglassShell || [] },
    { label: 'Fiberglass Install', cost: baseTotals.fiberglassInstall ?? 0, items: displayCostBreakdown.fiberglassInstall || [] },
    { label: 'Startup/Orientation', cost: baseTotals.startupOrientation ?? 0, items: displayCostBreakdown.startupOrientation || [] },
    { label: 'Custom Features', cost: baseTotals.customFeatures ?? 0, items: displayCostBreakdown.customFeatures || [] },
  ];
  const roundingAdjustmentIndex = (() => {
    for (let index = categoryRows.length - 1; index >= 0; index -= 1) {
      if (hasSummaryRowContent(categoryRows[index])) {
        return index;
      }
    }
    return categoryRows.length - 1;
  })();

  let runningRetailTotal = 0;
  let retailRows = categoryRows.map((row, idx) => {
    const isRoundingAdjustmentRow = idx === roundingAdjustmentIndex;
    const overrideRetailTotalForRow = (row.items || []).reduce(
      (sum, item) => sum + (getRetailOverride(item) || 0),
      0
    );
    const overrideCostForRow = (row.items || []).reduce(
      (sum, item) => sum + (getRetailOverride(item) !== null ? (item.total ?? 0) : 0),
      0
    );
    const remainingCostForRow = row.cost - overrideCostForRow;
    let retailValue = roundToTwo(overrideRetailTotalForRow + (remainingCostForRow * safeAdjustedRetailFactor));

    if (isRoundingAdjustmentRow) {
      // Nudge the last meaningful row to absorb any rounding difference.
      const targetTotal = safeRetailTarget || runningRetailTotal + retailValue;
      const adjustment = roundToTwo(targetTotal - (runningRetailTotal + retailValue));
      retailValue = roundToTwo(retailValue + adjustment);
    }

    runningRetailTotal += retailValue;
    return { ...row, retail: retailValue };
  });
  const feenstraCustomerBreakdown = resolveFeenstraMay2026CustomerBreakdown(
    proposal,
    pricing,
    categoryRows,
    retailAdjustmentsTotal
  );
  if (feenstraCustomerBreakdown) {
    offContractTotal = feenstraCustomerBreakdown.offContractTotal;
    retailPrice = feenstraCustomerBreakdown.retailPrice;
    retailRows = categoryRows.map((row, index) => ({
      ...row,
      retail: feenstraCustomerBreakdown.categoryValues[index] ?? 0,
    }));
    runningRetailTotal = feenstraCustomerBreakdown.categoryValues.reduce(
      (total, value) => total + value,
      0
    );
  }
  const visibleRetailRows = retailRows.filter((row) => !shouldHideEmptyCustomFeaturesRow(row));

  const displayRetailPrice = roundToTwo(retailPrice || (runningRetailTotal + retailAdjustmentsTotal + offContractTotal));

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const canEditAdjustments = allowRetailAdjustments && typeof onRetailAdjustmentsChange === 'function';
  const grossProfitMargin = pricing?.grossProfitMargin ?? proposal?.pricing?.grossProfitMargin ?? 0;
  const proposalIndicator = buildProposalIndicator(grossProfitMargin);
  const exceedsFranchiseLimit =
    retailAdjustments.some((adj) => adj.amount < 0) &&
    Number.isFinite(grossProfitMargin) &&
    grossProfitMargin < 18;

  const handleAdjustmentNameChange = (index: number, value: string) => {
    if (!canEditAdjustments) return;
    const next = retailAdjustments.map((adj, idx) =>
      idx === index ? { ...adj, name: value } : adj
    );
    onRetailAdjustmentsChange?.(next);
  };

  const handleAdjustmentAmountChange = (index: number, value: string) => {
    setAdjustmentInputs((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });

    if (!canEditAdjustments) return;
    if (isAdjustmentInputPending(value)) {
      if (value.trim() === '') {
        const next = retailAdjustments.map((adj, idx) =>
          idx === index ? { ...adj, amount: 0 } : adj
        );
        onRetailAdjustmentsChange?.(next);
      }
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    const next = retailAdjustments.map((adj, idx) =>
      idx === index ? { ...adj, amount: parsed } : adj
    );
    onRetailAdjustmentsChange?.(next);
  };

  const handleAdjustmentAmountBlur = (index: number) => {
    setFocusedAdjustmentIndex(null);
    if (!canEditAdjustments) return;
    const raw = adjustmentInputs[index] ?? '';
    const normalized = isAdjustmentInputPending(raw) ? 0 : Number(raw);
    const safeValue = Number.isFinite(normalized) ? normalized : 0;
    const next = retailAdjustments.map((adj, idx) =>
      idx === index ? { ...adj, amount: safeValue } : adj
    );
    onRetailAdjustmentsChange?.(next);
    setAdjustmentInputs((prev) => {
      const copy = [...prev];
      copy[index] = safeValue === 0 ? '' : String(safeValue);
      return copy;
    });
  };

  const renderLineItems = (items: CostLineItem[] | undefined, categoryName: string) => {
    const safeItems = items || [];
    const displayItems = safeItems.filter(
      (item) =>
        !isPapDiscount(item) &&
        ((item.quantity ?? 0) > 0 || (item.total ?? 0) !== 0)
    );
    const isExpanded = expandedSections.has(categoryName);
    const total = safeItems.reduce((sum, item) => sum + (item.total ?? 0), 0);

    return (
      <div className="cost-category">
        <div
          className="category-header"
          onClick={() => toggleSection(categoryName)}
          style={{ cursor: 'pointer' }}
        >
          <span className="expand-icon">{isExpanded ? 'v' : '>'}</span>
          <span className="category-name">{categoryName}</span>
          <span className="category-total">
            ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>

        {isExpanded && displayItems.length > 0 && (
          <div className="line-items">
            <table className="line-items-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Unit Price</th>
                  <th>Quantity</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item, index) => (
                  <tr key={index}>
                    <td>{item.description}</td>
                    <td>${item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>{item.quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td>${item.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isExpanded && displayItems.length === 0 && (
          <div className="line-items empty">
            <div className="line-items-empty-state">No line items yet</div>
          </div>
        )}
      </div>
    );
  };

  const expandAll = () => {
    const allSections = new Set([
      'Plans & Engineering',
      'Layout',
      'Permit',
      'Excavation',
      'Plumbing',
      'Gas',
      'Steel',
      'Electrical',
      'Shotcrete Labor',
      'Shotcrete Material',
      'Tile Labor',
      'Tile Material',
      copingDeckingLaborLabel,
      copingDeckingMaterialLabel,
      'Stone/Rockwork',
      'Drainage',
      'Equipment Ordered',
      'Equipment Set',
      'Water Features',
      'Cleanup',
      'Interior Finish',
      'Water Truck',
      'Fiberglass Shell',
      'Fiberglass Install',
      'Startup/Orientation',
      'Custom Features',
    ]);
    setExpandedSections(allSections);
  };

  const collapseAll = () => {
    setExpandedSections(new Set());
  };

  // Keep unused helpers referenced so TS doesn't prune them (reserved for future interactive view)
  void renderLineItems;
  void expandAll;
  void collapseAll;

  const scaleValue = showZoomControl ? 0.5 + (zoomLevel * 0.5) : normalizedInitialZoomScale;
  const scaleStyle = {
    transform: `scale(${scaleValue})`,
    transformOrigin: 'top center',
  };
  const exportSummaryRows = [
    ...visibleRetailRows.map((row) => ({ label: `${row.label}:`, value: formatCurrency(row.retail) })),
    ...(roundToTwo(offContractTotal) !== 0
      ? [{ label: 'Off Contract Items:', value: formatCurrency(offContractTotal) }]
      : []),
    ...retailAdjustments.map((adjustment, index) => {
      const labelFallback = `Line Item ${index + 1}`;
      const displayName = adjustment.name?.trim() || labelFallback;
      return {
        label: `${displayName}:`,
        value: formatCurrency(adjustment.amount),
      };
    }),
  ];
  const exportSummarySplit = Math.ceil(exportSummaryRows.length / 2);
  const exportSummaryColumns = [
    exportSummaryRows.slice(0, exportSummarySplit),
    exportSummaryRows.slice(exportSummarySplit),
  ];

  return (
    <div className="cost-breakdown-wrapper">
      <div className="stacked-sheets" style={scaleStyle}>
        <div className={`cost-breakdown-container${exportLayout ? ' export-layout' : ''}`}>
          <div className="breakdown-header">
            <div>
              <p className="breakdown-eyebrow">Job Cost Summary</p>
              <h2 className="breakdown-title">Proposal and Specifications</h2>
              <p className="breakdown-subtitle">
                Prepared for: <span className="breakdown-customer">{customerName}</span>
              </p>
            </div>
          <div className="breakdown-logo">
            <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseId} />
          </div>
          </div>

        <div className={`breakdown-summary${exportLayout ? ' export-layout-summary' : ''}`}>
          {exportLayout ? (
            <div className="export-summary-columns">
              {exportSummaryColumns.map((column, columnIndex) => (
                <table className="export-summary-table" key={`export-summary-col-${columnIndex}`}>
                  <tbody>
                    {column.map((row) => (
                      <tr key={`${columnIndex}-${row.label}`}>
                        <td className="export-summary-label">{row.label}</td>
                        <td className="export-summary-value">{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          ) : (
            <div className="summary-grid">
              {visibleRetailRows.map((row) => (
                <div className="summary-row" key={row.label}>
                  <span>{row.label}:</span>
                  <span>{formatCurrency(row.retail)}</span>
                </div>
              ))}
              {roundToTwo(offContractTotal) !== 0 && (
                <div className="summary-row">
                  <span>Off Contract Items:</span>
                  <span>{formatCurrency(offContractTotal)}</span>
                </div>
              )}
              {retailAdjustments.map((adjustment, index) => {
                const showWarning = canEditAdjustments && exceedsFranchiseLimit && adjustment.amount < 0;
                const labelFallback = `Line Item ${index + 1}`;
                const displayName = adjustment.name?.trim() || labelFallback;
                const amountValue = adjustmentInputs[index] ?? '';
                return (
                  <div className="summary-adjustment" key={`retail-adjustment-${index}`}>
                    <div className="summary-row adjustment-row">
                      <div className="adjustment-name">
                        {canEditAdjustments ? (
                          <input
                            type="text"
                            value={adjustment.name}
                            onChange={(e) => handleAdjustmentNameChange(index, e.target.value)}
                            placeholder={labelFallback}
                            className="adjustment-input adjustment-name-input"
                          />
                        ) : (
                          <span>{displayName}</span>
                        )}
                      </div>
                      <div className="adjustment-cost">
                        {canEditAdjustments ? (
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            value={amountValue}
                            onFocus={() => setFocusedAdjustmentIndex(index)}
                            onBlur={() => handleAdjustmentAmountBlur(index)}
                            onChange={(e) => handleAdjustmentAmountChange(index, e.target.value)}
                            placeholder="0.00"
                            className={`adjustment-input adjustment-cost-input ${showWarning ? 'is-warning' : ''}`}
                          />
                        ) : (
                          <span>{formatCurrency(adjustment.amount)}</span>
                        )}
                      </div>
                    </div>
                    {showWarning && (
                      <div className="adjustment-warning-text">Exceeds Franchise Limit</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cost Summary Section */}
          <div className="cost-summary-section">
            <div className="summary-row subtotal-row">
              <span>RETAIL PRICE:</span>
              <span>{formatCurrency(displayRetailPrice)}</span>
            </div>
            {!exportLayout && (
              <div className="breakdown-profit-indicator-row">
                <span className="proposal-gp-indicator">{proposalIndicator}</span>
              </div>
            )}
          </div>
        </div>
        </div>

        {showWarranty && proposal && (
          <div className="warranty-shell">
            <SubmergeAdvantageWarranty
              proposal={proposal}
              editable={editableWarranty}
              onWarrantySectionsChange={onWarrantySectionsChange}
            />
          </div>
        )}
      </div>

      {showZoomControl && (
        <div className="zoom-control-container">
          <label className="zoom-label">
            <span className="zoom-icon">Zoom</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              className="zoom-slider"
            />
            <span className="zoom-percentage">{Math.round(scaleValue * 100)}%</span>
          </label>
        </div>
      )}
    </div>
  );
}

export default CostBreakdownView;
