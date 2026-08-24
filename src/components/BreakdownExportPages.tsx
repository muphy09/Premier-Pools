import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FranchiseLogo from './FranchiseLogo';
import { useFranchiseAppName } from '../hooks/useFranchiseAppName';
import { isCopingDeckingWarrantySectionTitle, resolveWarrantySections } from '../utils/warranty';
import { normalizeCostBreakdownForDisplay } from '../utils/costBreakdownDisplay';
import { hasIncludedDecking } from '../utils/decking';
import { resolveFeenstraMay2026CustomerBreakdown } from '../services/legacy/feenstraMay2026CustomerBreakdown';
import { CostBreakdown, CostLineItem, PricingCalculations, Proposal, RetailAdjustment } from '../types/proposal-new';
import type { WarrantySection } from '../types/warranty';
import { CogsReportDocument } from './CogsReport';
import './BreakdownExportPages.css';

interface CostExportProps {
  costBreakdown: CostBreakdown;
  customerName: string;
  proposal?: Partial<Proposal>;
  pricing?: PricingCalculations;
}

interface WarrantyExportProps {
  proposal?: Partial<Proposal>;
}

interface CogsExportProps {
  categories: import('./CogsReport').CogsReportCategory[];
  proposal?: Partial<Proposal>;
  totalValue: number;
  totalLabel?: string;
  overheadRate?: number;
}

interface ExportRow {
  label: string;
  value: number;
  items?: CostLineItem[];
}

const PX_PER_INCH = 96;
const WARRANTY_PAGE_HEIGHT_IN = 10.2;
const WARRANTY_PAGE_HEIGHT_PX = WARRANTY_PAGE_HEIGHT_IN * PX_PER_INCH;
const WARRANTY_PAGE_SAFETY_BUFFER_PX = 14;

const roundToTwo = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
const EMPTY_CUSTOM_FEATURES_ROW_THRESHOLD = 0.05;

const formatCurrency = (value: number): string =>
  `$${(Number.isFinite(value) ? value : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const hasSummaryRowContent = (row: Pick<ExportRow, 'value' | 'items'>): boolean =>
  roundToTwo(row.value) !== 0 || (row.items?.length ?? 0) > 0;

const shouldHideEmptyCustomFeaturesRow = (row: Pick<ExportRow, 'label' | 'value' | 'items'>): boolean =>
  row.label === 'Custom Features' &&
  !hasSummaryRowContent(row) &&
  Math.abs(roundToTwo(row.value)) <= EMPTY_CUSTOM_FEATURES_ROW_THRESHOLD;

const normalizedRetailAdjustments = (input?: RetailAdjustment[]): RetailAdjustment[] =>
  (Array.isArray(input) ? input : []).map((adjustment) => ({
    name: typeof adjustment?.name === 'string' ? adjustment.name : '',
    amount: Number.isFinite(Number(adjustment?.amount)) ? Number(adjustment.amount) : 0,
  }));

const getWarrantySectionKey = (section: WarrantySection, index: number): string =>
  section.id || `${section.title}-${index}`;

const getWarrantyPageSignature = (pages: WarrantySection[][]): string =>
  pages
    .map((page) =>
      page
        .map((section, index) => getWarrantySectionKey(section, index))
        .join('|')
    )
    .join('||');

const getRetailOverride = (item?: CostLineItem): number | null => {
  if (!item) return null;
  const override = (item.details as any)?.retailOverride;
  return Number.isFinite(override) ? Number(override) : null;
};

const toCostRows = (costBreakdown: CostBreakdown, proposal?: Partial<Proposal>): ExportRow[] => {
  const baseTotals = costBreakdown?.totals || ({} as CostBreakdown['totals']);
  const shouldUseCopingOnlyLabels = Boolean(proposal?.tileCopingDecking) && !hasIncludedDecking(proposal);
  const copingDeckingLaborLabel = shouldUseCopingOnlyLabels ? 'Coping Labor' : 'Coping/Decking Labor';
  const copingDeckingMaterialLabel = shouldUseCopingOnlyLabels ? 'Coping Material' : 'Coping/Decking Material';

  return [
    { label: 'Plans & Engineering', value: baseTotals.plansAndEngineering ?? 0, items: costBreakdown.plansAndEngineering || [] },
    { label: 'Layout', value: baseTotals.layout ?? 0, items: costBreakdown.layout || [] },
    { label: 'Permit', value: baseTotals.permit ?? 0, items: costBreakdown.permit || [] },
    { label: 'Excavation', value: baseTotals.excavation ?? 0, items: costBreakdown.excavation || [] },
    { label: 'Plumbing', value: baseTotals.plumbing ?? 0, items: costBreakdown.plumbing || [] },
    { label: 'Gas', value: baseTotals.gas ?? 0, items: costBreakdown.gas || [] },
    { label: 'Steel', value: baseTotals.steel ?? 0, items: costBreakdown.steel || [] },
    { label: 'Electrical', value: baseTotals.electrical ?? 0, items: costBreakdown.electrical || [] },
    { label: 'Shotcrete Labor', value: baseTotals.shotcreteLabor ?? 0, items: costBreakdown.shotcreteLabor || [] },
    { label: 'Shotcrete Material', value: baseTotals.shotcreteMaterial ?? 0, items: costBreakdown.shotcreteMaterial || [] },
    { label: 'Tile Labor', value: baseTotals.tileLabor ?? 0, items: costBreakdown.tileLabor || [] },
    { label: 'Tile Material', value: baseTotals.tileMaterial ?? 0, items: costBreakdown.tileMaterial || [] },
    { label: copingDeckingLaborLabel, value: baseTotals.copingDeckingLabor ?? 0, items: costBreakdown.copingDeckingLabor || [] },
    { label: copingDeckingMaterialLabel, value: baseTotals.copingDeckingMaterial ?? 0, items: costBreakdown.copingDeckingMaterial || [] },
    {
      label: 'Stone/Rockwork',
      value: (baseTotals.stoneRockworkLabor ?? 0) + (baseTotals.stoneRockworkMaterial ?? 0),
      items: [
        ...(costBreakdown.stoneRockworkLabor || []),
        ...(costBreakdown.stoneRockworkMaterial || []),
      ],
    },
    { label: 'Drainage', value: baseTotals.drainage ?? 0, items: costBreakdown.drainage || [] },
    { label: 'Equipment Ordered', value: baseTotals.equipmentOrdered ?? 0, items: costBreakdown.equipmentOrdered || [] },
    { label: 'Equipment Set', value: baseTotals.equipmentSet ?? 0, items: costBreakdown.equipmentSet || [] },
    { label: 'Water Features', value: baseTotals.waterFeatures ?? 0, items: costBreakdown.waterFeatures || [] },
    { label: 'Cleanup', value: baseTotals.cleanup ?? 0, items: costBreakdown.cleanup || [] },
    { label: 'Interior Finish', value: baseTotals.interiorFinish ?? 0, items: costBreakdown.interiorFinish || [] },
    { label: 'Water Truck', value: baseTotals.waterTruck ?? 0, items: costBreakdown.waterTruck || [] },
    { label: 'Fiberglass Shell', value: baseTotals.fiberglassShell ?? 0, items: costBreakdown.fiberglassShell || [] },
    { label: 'Fiberglass Install', value: baseTotals.fiberglassInstall ?? 0, items: costBreakdown.fiberglassInstall || [] },
    { label: 'Startup/Orientation', value: baseTotals.startupOrientation ?? 0, items: costBreakdown.startupOrientation || [] },
    { label: 'Custom Features', value: baseTotals.customFeatures ?? 0, items: costBreakdown.customFeatures || [] },
  ];
};

const allItems = (costBreakdown: CostBreakdown): CostLineItem[] => [
  ...(costBreakdown.plansAndEngineering || []),
  ...(costBreakdown.layout || []),
  ...(costBreakdown.permit || []),
  ...(costBreakdown.excavation || []),
  ...(costBreakdown.plumbing || []),
  ...(costBreakdown.gas || []),
  ...(costBreakdown.steel || []),
  ...(costBreakdown.electrical || []),
  ...(costBreakdown.shotcreteLabor || []),
  ...(costBreakdown.shotcreteMaterial || []),
  ...(costBreakdown.tileLabor || []),
  ...(costBreakdown.tileMaterial || []),
  ...(costBreakdown.copingDeckingLabor || []),
  ...(costBreakdown.copingDeckingMaterial || []),
  ...(costBreakdown.stoneRockworkLabor || []),
  ...(costBreakdown.stoneRockworkMaterial || []),
  ...(costBreakdown.drainage || []),
  ...(costBreakdown.waterFeatures || []),
  ...(costBreakdown.equipmentOrdered || []),
  ...(costBreakdown.equipmentSet || []),
  ...(costBreakdown.cleanup || []),
  ...(costBreakdown.interiorFinish || []),
  ...(costBreakdown.waterTruck || []),
  ...(costBreakdown.fiberglassShell || []),
  ...(costBreakdown.fiberglassInstall || []),
  ...(costBreakdown.startupOrientation || []),
  ...(costBreakdown.customFeatures || []),
];

export function BreakdownCostExportPage({ costBreakdown, customerName, proposal, pricing }: CostExportProps) {
  const displayCostBreakdown = useMemo(
    () => normalizeCostBreakdownForDisplay(costBreakdown, proposal),
    [costBreakdown, proposal]
  );
  const franchiseId = proposal?.franchiseId;
  const rows = useMemo(() => {
    const baseRows = toCostRows(displayCostBreakdown, proposal);
    const baseTotals = displayCostBreakdown?.totals || ({} as CostBreakdown['totals']);
    const costBasis =
      pricing?.totalCostsBeforeOverhead ??
      proposal?.pricing?.totalCostsBeforeOverhead ??
      baseTotals.grandTotal ??
      0;

    const adjustments = normalizedRetailAdjustments(proposal?.retailAdjustments).filter(
      (adjustment) => adjustment.name.trim().length > 0 || roundToTwo(adjustment.amount) !== 0
    );
    const adjustmentsTotal = adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
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

    const retailTarget = retailPrice - adjustmentsTotal - offContractTotal;
    const retailFactor = costBasis > 0 ? retailTarget / costBasis : 1;
    const overrideItems = allItems(displayCostBreakdown).filter((item) => getRetailOverride(item) !== null);
    const overrideCostBasis = overrideItems.reduce((sum, item) => sum + (item.total ?? 0), 0);
    const overrideRetailTotal = overrideItems.reduce((sum, item) => sum + (getRetailOverride(item) || 0), 0);
    const remainingCostBasis = costBasis - overrideCostBasis;
    const adjustedRetailFactor =
      remainingCostBasis > 0
        ? (retailTarget - overrideRetailTotal) / remainingCostBasis
        : retailFactor;
    const safeAdjustedRetailFactor = Number.isFinite(adjustedRetailFactor)
      ? adjustedRetailFactor
      : retailFactor;
    const roundingAdjustmentIndex = (() => {
      for (let index = baseRows.length - 1; index >= 0; index -= 1) {
        if (hasSummaryRowContent(baseRows[index])) {
          return index;
        }
      }
      return baseRows.length - 1;
    })();

    let runningRetailTotal = 0;
    let retailRows = baseRows.map((row, index) => {
      const isRoundingAdjustmentRow = index === roundingAdjustmentIndex;
      const overrideRetailTotalForRow = (row.items || []).reduce(
        (sum, item) => sum + (getRetailOverride(item) || 0),
        0
      );
      const overrideCostForRow = (row.items || []).reduce(
        (sum, item) => sum + (getRetailOverride(item) !== null ? (item.total ?? 0) : 0),
        0
      );
      const remainingCostForRow = row.value - overrideCostForRow;
      let retailValue = roundToTwo(overrideRetailTotalForRow + (remainingCostForRow * safeAdjustedRetailFactor));

      if (isRoundingAdjustmentRow) {
        const targetTotal = retailTarget || runningRetailTotal + retailValue;
        const adjustment = roundToTwo(targetTotal - (runningRetailTotal + retailValue));
        retailValue = roundToTwo(retailValue + adjustment);
      }

      runningRetailTotal += retailValue;
      return {
        label: row.label,
        value: retailValue,
        items: row.items,
      };
    });
    const feenstraCustomerBreakdown = resolveFeenstraMay2026CustomerBreakdown(
      proposal,
      pricing,
      baseRows.map((row) => ({ label: row.label, cost: row.value })),
      adjustmentsTotal
    );
    if (feenstraCustomerBreakdown) {
      offContractTotal = feenstraCustomerBreakdown.offContractTotal;
      retailPrice = feenstraCustomerBreakdown.retailPrice;
      retailRows = baseRows.map((row, index) => ({
        label: row.label,
        value: feenstraCustomerBreakdown.categoryValues[index] ?? 0,
        items: row.items,
      }));
      runningRetailTotal = feenstraCustomerBreakdown.categoryValues.reduce(
        (total, value) => total + value,
        0
      );
    }
    const visibleRetailRows = retailRows.filter((row) => !shouldHideEmptyCustomFeaturesRow(row));

    const adjustmentRows = adjustments.map((adjustment, index) => ({
      label: adjustment.name.trim() || `Line Item ${index + 1}`,
      value: adjustment.amount,
    }));
    const offContractRows =
      roundToTwo(offContractTotal) !== 0
        ? [{ label: 'Off Contract Items', value: offContractTotal }]
        : [];
    const combined = [...visibleRetailRows, ...offContractRows, ...adjustmentRows];
    const split = Math.ceil(combined.length / 2);

    return {
      left: combined.slice(0, split),
      right: combined.slice(split),
      displayRetailPrice: roundToTwo(retailPrice || (runningRetailTotal + adjustmentsTotal + offContractTotal)),
    };
  }, [displayCostBreakdown, pricing, proposal]);
  const maxColumnRows = Math.max(rows.left.length, rows.right.length);

  return (
    <div className="breakdown-export-cost-sheet">
      <header className="breakdown-export-cost-header">
        <div>
          <p className="breakdown-export-eyebrow">Job Cost Summary</p>
          <h2 className="breakdown-export-title">Proposal and Specifications</h2>
          <p className="breakdown-export-subtitle">
            Prepared for: <span>{customerName || 'N/A'}</span>
          </p>
        </div>
        <div className="breakdown-export-logo">
          <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseId} />
        </div>
      </header>

      <div className="breakdown-export-table-grid">
        {[rows.left, rows.right].map((column, index) => (
          <div className="breakdown-export-column" key={`cost-col-${index}`}>
            {Array.from({ length: maxColumnRows }).map((_, rowIndex) => {
              const row = column[rowIndex];
              return (
                <div
                  className={`breakdown-export-row${row ? '' : ' breakdown-export-row--empty'}`}
                  key={`${index}-${row?.label || `empty-${rowIndex}`}`}
                >
                  <span className="breakdown-export-row-label">{row ? `${row.label}:` : '\u00A0'}</span>
                  <span className="breakdown-export-row-value">{row ? formatCurrency(row.value) : '\u00A0'}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="breakdown-export-total">
        <span>RETAIL PRICE:</span>
        <span>{formatCurrency(rows.displayRetailPrice)}</span>
      </div>
    </div>
  );
}

export function BreakdownCogsExportPages({
  categories,
  proposal,
  totalValue,
  overheadRate = 0.01,
}: CogsExportProps) {
  return (
    <CogsReportDocument
      categories={categories}
      customerName={(proposal?.customerInfo?.customerName || '').trim()}
      franchiseId={proposal?.franchiseId ?? undefined}
      reportDate={proposal?.lastModified}
      totalValue={totalValue}
      overheadRate={overheadRate}
      mode="export"
    />
  );
}

function BreakdownWarrantyHeader({
  customerName,
  franchiseId,
}: {
  customerName: string;
  franchiseId?: string;
}) {
  return (
    <header className="breakdown-export-warranty-header">
      <div>
        <p className="breakdown-export-eyebrow">Warranty &amp; Inclusions Overview</p>
        <h2 className="breakdown-export-title">Warranty &amp; Inclusions</h2>
        <p className="breakdown-export-subtitle">
          Prepared for: <span>{customerName || 'N/A'}</span>
        </p>
      </div>
      <div className="breakdown-export-logo">
        <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseId} />
      </div>
    </header>
  );
}

function BreakdownWarrantySectionCard({
  section,
  displayName,
  sectionKey,
}: {
  section: WarrantySection;
  displayName: string;
  sectionKey: string;
}) {
  const suppressEmptyAdvantagePlaceholder = isCopingDeckingWarrantySectionTitle(section.title);

  return (
    <section className="breakdown-export-warranty-card" data-warranty-section-key={sectionKey}>
      <div className="breakdown-export-warranty-card-header">
        <h3>{section.title}</h3>
        <span>Warranty Advantage</span>
      </div>
      <div className="breakdown-export-warranty-card-body">
        <ul className="breakdown-export-feature-list">
          {section.featureItems.map((item, index) => (
            <li key={item.id || `${section.title}-${index}`}>
              <div className="breakdown-export-feature-label">{item.label}</div>
              {item.detail && <div className="breakdown-export-feature-detail">{item.detail}</div>}
            </li>
          ))}
        </ul>
        <div className="breakdown-export-advantage-list">
          {section.advantageItems.length > 0 ? (
            section.advantageItems.map((item, index) => (
              <div className="breakdown-export-advantage-chip" key={item.id || `${section.title}-adv-${index}`}>
                {item.text}
              </div>
            ))
          ) : suppressEmptyAdvantagePlaceholder ? null : (
            <div className="breakdown-export-advantage-chip muted">No {displayName} advantages listed.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function BreakdownWarrantySheet({
  customerName,
  franchiseId,
  displayName,
  sections,
}: {
  customerName: string;
  franchiseId?: string;
  displayName: string;
  sections: WarrantySection[];
}) {
  return (
    <div className="breakdown-export-warranty-sheet">
      <BreakdownWarrantyHeader customerName={customerName} franchiseId={franchiseId} />

      <div className="breakdown-export-warranty-list">
        {!sections.length && (
          <section className="breakdown-export-warranty-card">
            <div className="breakdown-export-warranty-card-body">
              <div className="breakdown-export-advantage-chip muted">No warranty categories configured.</div>
            </div>
          </section>
        )}
        {sections.map((section, index) => {
          const sectionKey = getWarrantySectionKey(section, index);
          return (
            <BreakdownWarrantySectionCard
              key={sectionKey}
              section={section}
              displayName={displayName}
              sectionKey={sectionKey}
            />
          );
        })}
      </div>
    </div>
  );
}

export function BreakdownWarrantyExportPages({ proposal }: WarrantyExportProps) {
  const franchiseId = proposal?.franchiseId ?? undefined;
  const customerName = (proposal?.customerInfo?.customerName || '').trim();
  const { displayName } = useFranchiseAppName(franchiseId);
  const sections = useMemo(
    () => resolveWarrantySections(proposal, displayName),
    [displayName, proposal]
  );
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<WarrantySection[][]>(() => (sections.length ? [sections] : [[]]));

  useEffect(() => {
    setPages(sections.length ? [sections] : [[]]);
  }, [sections]);

  useLayoutEffect(() => {
    const measureNode = measureRef.current;
    if (!measureNode) return;

    let frameId = 0;
    let followupFrameId = 0;
    let disposed = false;

    const updatePages = () => {
      if (disposed) return;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(followupFrameId);
      frameId = window.requestAnimationFrame(() => {
        followupFrameId = window.requestAnimationFrame(() => {
          if (disposed || !measureRef.current) return;

          const sheet = measureRef.current.querySelector('.breakdown-export-warranty-sheet') as HTMLDivElement | null;
          const header = measureRef.current.querySelector('.breakdown-export-warranty-header') as HTMLElement | null;
          const list = measureRef.current.querySelector('.breakdown-export-warranty-list') as HTMLElement | null;

          if (!sheet || !header || !list) {
            setPages(sections.length ? [sections] : [[]]);
            return;
          }

          const sheetStyles = window.getComputedStyle(sheet);
          const headerStyles = window.getComputedStyle(header);
          const listStyles = window.getComputedStyle(list);
          const paddingTop = parseFloat(sheetStyles.paddingTop) || 0;
          const paddingBottom = parseFloat(sheetStyles.paddingBottom) || 0;
          const headerMarginBottom = parseFloat(headerStyles.marginBottom) || 0;
          const cardGap =
            parseFloat(listStyles.rowGap || '') ||
            parseFloat(listStyles.gap || '') ||
            0;
          const headerHeight = header.getBoundingClientRect().height + headerMarginBottom;
          const availableHeight =
            WARRANTY_PAGE_HEIGHT_PX - paddingTop - paddingBottom - headerHeight - WARRANTY_PAGE_SAFETY_BUFFER_PX;

          if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
            setPages(sections.length ? [sections] : [[]]);
            return;
          }

          const cardHeights = new Map<string, number>();
          measureRef.current
            .querySelectorAll<HTMLElement>('[data-warranty-section-key]')
            .forEach((card) => {
              const key = card.dataset.warrantySectionKey;
              if (!key) return;
              cardHeights.set(key, card.getBoundingClientRect().height);
            });

          const nextPages: WarrantySection[][] = [];
          let currentPage: WarrantySection[] = [];
          let currentHeight = 0;

          sections.forEach((section, index) => {
            const sectionKey = getWarrantySectionKey(section, index);
            const cardHeight = cardHeights.get(sectionKey) ?? 0;

            if (!cardHeight) {
              currentPage.push(section);
              return;
            }

            const nextHeight = currentPage.length ? currentHeight + cardGap + cardHeight : cardHeight;
            if (currentPage.length && nextHeight > availableHeight) {
              nextPages.push(currentPage);
              currentPage = [section];
              currentHeight = cardHeight;
              return;
            }

            currentPage.push(section);
            currentHeight = nextHeight;
          });

          if (currentPage.length) {
            nextPages.push(currentPage);
          }

          const resolvedPages = nextPages.length ? nextPages : [[]];
          const nextSignature = getWarrantyPageSignature(resolvedPages);
          setPages((prevPages) =>
            getWarrantyPageSignature(prevPages) === nextSignature ? prevPages : resolvedPages
          );
        });
      });
    };

    updatePages();
    void document.fonts?.ready.then(updatePages);

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updatePages();
          });

    if (resizeObserver) {
      resizeObserver.observe(measureNode);
      measureNode
        .querySelectorAll<HTMLElement>('.breakdown-export-warranty-sheet, .breakdown-export-warranty-card')
        .forEach((node) => {
          resizeObserver.observe(node);
        });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(followupFrameId);
      resizeObserver?.disconnect();
    };
  }, [sections]);

  return (
    <>
      <div className="breakdown-export-warranty-measure" aria-hidden="true">
        <div ref={measureRef}>
          <BreakdownWarrantySheet
            customerName={customerName}
            franchiseId={franchiseId}
            displayName={displayName}
            sections={sections}
          />
        </div>
      </div>

      {pages.map((pageSections, index) => (
        <div className="export-breakdown-page export-breakdown-page--warranty" key={`warranty-export-page-${index}`}>
          <BreakdownWarrantySheet
            customerName={customerName}
            franchiseId={franchiseId}
            displayName={displayName}
            sections={pageSections}
          />
        </div>
      ))}
    </>
  );
}
