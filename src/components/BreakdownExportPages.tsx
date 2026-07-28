import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FranchiseLogo from './FranchiseLogo';
import { useFranchiseAppName } from '../hooks/useFranchiseAppName';
import { isCopingDeckingWarrantySectionTitle, resolveWarrantySections } from '../utils/warranty';
import { normalizeCostBreakdownForDisplay } from '../utils/costBreakdownDisplay';
import { hasIncludedDecking } from '../utils/decking';
import { resolveFeenstraMay2026CustomerBreakdown } from '../services/legacy/feenstraMay2026CustomerBreakdown';
import type { CostBreakdownSubcategory } from '../utils/costBreakdownSubcategories';
import { hasLineItemSubcategory } from '../utils/costBreakdownSubcategories';
import { isOffContractLineItem } from '../utils/offContractLineItems';
import { CostBreakdown, CostLineItem, PricingCalculations, Proposal, RetailAdjustment } from '../types/proposal-new';
import type { WarrantySection } from '../types/warranty';
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

interface CogsExportCategory {
  name: string;
  items: CostLineItem[];
  subcategories?: CostBreakdownSubcategory[];
  hideBaseItems?: boolean;
}

interface CogsExportProps {
  categories: CogsExportCategory[];
  proposal?: Partial<Proposal>;
  totalValue: number;
  totalLabel?: string;
}

interface ExportRow {
  label: string;
  value: number;
  items?: CostLineItem[];
}

const PX_PER_INCH = 96;
const COGS_PAGE_HEIGHT_IN = 10.2;
const COGS_PAGE_HEIGHT_PX = COGS_PAGE_HEIGHT_IN * PX_PER_INCH;
const COGS_PAGE_SAFETY_BUFFER_PX = 16;
const COGS_EXPORT_TABLE_COLUMN_WIDTHS = ['38%', '13%', '23%', '26%'];
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

const formatBreakdownDate = (value?: string | null): string => {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime())
    ? new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const categoryTotal = (items: CostLineItem[] = []): number =>
  items.reduce((sum, item) => sum + (isOffContractLineItem(item) ? 0 : (item.total ?? 0)), 0);

const isTaxLineItem = (item: CostLineItem): boolean =>
  (item.description || '').toLowerCase().includes('tax');

const renderQuantity = (item: CostLineItem): string => {
  if (isTaxLineItem(item)) return '';
  return (item.quantity ?? 0).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
};

const renderUnitPrice = (item: CostLineItem): string => {
  if (isTaxLineItem(item)) return '';
  return formatCurrency(item.unitPrice);
};

const renderTotal = (item: CostLineItem): string =>
  isOffContractLineItem(item) ? 'OFF CONTRACT' : formatCurrency(item.total);

const getCogsCategoryClassName = (categoryName: string): string => {
  const classMap: Record<string, string> = {
    'Plans & Engineering': 'pool-specs',
    'Excavation': 'excavation',
    'Plumbing': 'plumbing',
    'Electrical': 'electrical',
    'Tile': 'tile',
    'Coping/Decking': 'tile',
    'Drainage': 'drainage',
    'Water Features': 'water-features',
    'Equipment Ordered': 'equipment',
    'Equipment Set': 'equipment',
    'Interior Finish': 'interior',
    'Fiberglass Shell': 'pool-specs',
    'Fiberglass Install': 'pool-specs',
    'Custom Features': 'custom',
  };
  return classMap[categoryName] || '';
};

const getCogsCategoryIcon = (categoryName: string): JSX.Element => {
  const iconMap: Record<string, JSX.Element> = {
    'Plans & Engineering': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3h12c.6 0 1 .4 1 1v12c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
        <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    Layout: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    Permit: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 3h10c.6 0 1 .4 1 1v13c0 .6-.4 1-1 1H5c-.6 0-1-.4-1-1V4c0-.6.4-1 1-1z" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 7h6M7 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="10" cy="14" r="1.5" fill="currentColor"/>
      </svg>
    ),
    Excavation: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 15h14M5 15L7 8l3 3 3-3 2 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    Plumbing: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 10h4m4 0h4M10 4v12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    Gas: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 3v6m-3 3l3-3 3 3M6 13h8v3H6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    Steel: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    Electrical: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 3L6 11h5l-1 6 5-8h-5l1-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
    Shotcrete: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    Tile: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="11" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="3" y="11" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="11" y="11" width="6" height="6" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    'Coping/Decking': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 13h14M5 10h10M7 7h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    'Stone/Rockwork': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 14l3-5 4 2 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    Drainage: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 4v12M6 8l4-4 4 4m-8 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    'Water Features': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 3c2.5 3 4 5.2 4 7.3A4 4 0 1 1 6 10.3C6 8.2 7.5 6 10 3z" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    'Equipment Ordered': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="5" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M7 9h6M7 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    'Equipment Set': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="10" cy="10" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M10 6.5v7M6.5 10h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    Cleanup: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 6h8M7 6l1 10h4l1-10M8 6V4h4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    'Interior Finish': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 14c2-3 4-4.5 6-4.5S14 11 16 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 16h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    'Water Truck': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 12h10l2 2h2v2H3v-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <circle cx="7" cy="16" r="1.5" fill="currentColor"/>
        <circle cx="14" cy="16" r="1.5" fill="currentColor"/>
      </svg>
    ),
    'Fiberglass Shell': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 13c1.5-4 4-6 6-6s4.5 2 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M4 15h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    'Fiberglass Install': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M5 10h10M10 5v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    'Startup/Orientation': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 4a6 6 0 1 0 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M10 7v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    'Custom Features': (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 3l2.1 4.2L17 8l-3.5 3.4.8 4.8L10 14l-4.3 2.2.8-4.8L3 8l4.9-.8L10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      </svg>
    ),
  };

  return iconMap[categoryName] || (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  );
};

const getCogsCategoryKey = (category: CogsExportCategory, index: number): string =>
  category.name || `cogs-category-${index}`;

type CogsExportPage = {
  left: CogsExportCategory[];
  right: CogsExportCategory[];
};

type CogsPackedPage = CogsExportPage & {
  leftHeight: number;
  rightHeight: number;
};

const createEmptyCogsPage = (): CogsPackedPage => ({
  left: [],
  right: [],
  leftHeight: 0,
  rightHeight: 0,
});

const getCogsPageSignature = (pages: CogsExportPage[]): string =>
  pages
    .map((page) => {
      const left = page.left.map((category, index) => getCogsCategoryKey(category, index)).join('|');
      const right = page.right.map((category, index) => getCogsCategoryKey(category, index)).join('|');
      return `${left}::${right}`;
    })
    .join('||');

const packCogsCategories = (
  categories: CogsExportCategory[],
  cardHeights: Map<string, number>,
  availableHeight: number,
  rowGap: number
): CogsExportPage[] => {
  if (!categories.length) {
    return [{ left: [], right: [] }];
  }

  const pages: CogsExportPage[] = [];
  let current = createEmptyCogsPage();

  categories.forEach((category, index) => {
    const key = getCogsCategoryKey(category, index);
    const cardHeight = cardHeights.get(key) ?? 0;
    const pageHasContent = current.left.length > 0 || current.right.length > 0;
    const columnOrder: Array<'left' | 'right'> =
      current.leftHeight <= current.rightHeight ? ['left', 'right'] : ['right', 'left'];
    let placed = false;

    columnOrder.forEach((columnKey) => {
      if (placed) return;
      const currentHeight = columnKey === 'left' ? current.leftHeight : current.rightHeight;
      const nextHeight = currentHeight > 0 ? currentHeight + rowGap + cardHeight : cardHeight;
      const canOverflowSoloCard = !pageHasContent && cardHeight > availableHeight;
      if (!canOverflowSoloCard && nextHeight > availableHeight) {
        return;
      }

      if (columnKey === 'left') {
        current.left = [...current.left, category];
        current.leftHeight = nextHeight;
      } else {
        current.right = [...current.right, category];
        current.rightHeight = nextHeight;
      }
      placed = true;
    });

    if (placed) return;

    pages.push({ left: current.left, right: current.right });
    current = createEmptyCogsPage();
    current.left = [category];
    current.leftHeight = cardHeight;
  });

  if (current.left.length || current.right.length || !pages.length) {
    pages.push({ left: current.left, right: current.right });
  }

  return pages;
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

function BreakdownCogsExportCard({
  category,
  categoryKey,
}: {
  category: CogsExportCategory;
  categoryKey: string;
}) {
  const baseItems = category.subcategories?.length
    ? category.items.filter((item) => !hasLineItemSubcategory(item))
    : category.items;

  const renderExportColgroup = () => (
    <colgroup>
      {COGS_EXPORT_TABLE_COLUMN_WIDTHS.map((width, index) => (
        <col style={{ width }} key={`cogs-export-column-${index}`} />
      ))}
    </colgroup>
  );

  return (
    <div
      className={`cogs-category-card ${getCogsCategoryClassName(category.name)}`}
      data-cogs-card-key={categoryKey}
    >
      <div className="cogs-category-card-header">
        <div className="cogs-category-icon">
          {getCogsCategoryIcon(category.name)}
        </div>
        <div className="cogs-category-title-wrapper">
          <h3 className="cogs-category-title">{category.name}</h3>
          <div className="cogs-category-total">{formatCurrency(categoryTotal(category.items))}</div>
        </div>
      </div>

      {category.subcategories && category.subcategories.length > 0 ? (
        <div className="cogs-subcategories">
          {!category.hideBaseItems && baseItems.length > 0 && (
            <table className="cogs-category-table">
              {renderExportColgroup()}
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {baseItems.map((item, index) => (
                  <tr key={`${category.name}-base-${index}`}>
                    <td>{item.description}</td>
                    <td>{renderQuantity(item)}</td>
                    <td>{renderUnitPrice(item)}</td>
                    <td>{renderTotal(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {category.subcategories.map((subcategory) => (
            <div key={subcategory.name} className="cogs-subcategory">
              <div className="cogs-subcategory-header">
                <span className="cogs-subcategory-name">{subcategory.name}</span>
                <span className="cogs-subcategory-total">
                  {formatCurrency(categoryTotal(subcategory.items))}
                </span>
              </div>
              <table className="cogs-category-table">
                {renderExportColgroup()}
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {subcategory.items.map((item, index) => (
                    <tr key={`${category.name}-${subcategory.name}-${index}`}>
                      <td>{item.description}</td>
                      <td>{renderQuantity(item)}</td>
                      <td>{renderUnitPrice(item)}</td>
                      <td>{renderTotal(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
        <table className="cogs-category-table">
          {renderExportColgroup()}
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {category.items.map((item, index) => (
              <tr key={`${category.name}-${index}`}>
                <td>{item.description}</td>
                <td>{renderQuantity(item)}</td>
                <td>{renderUnitPrice(item)}</td>
                <td>{renderTotal(item)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BreakdownCogsExportSheet({
  categories,
  customerName,
  franchiseId,
  exportDate,
  showTotal,
  totalLabel,
  totalValue,
}: {
  categories: CogsExportPage;
  customerName: string;
  franchiseId?: string;
  exportDate: string;
  showTotal: boolean;
  totalLabel: string;
  totalValue: number;
}) {
  const hasCategories = categories.left.length > 0 || categories.right.length > 0;

  return (
    <div className="breakdown-export-cogs-sheet">
      <div className="cogs-header-info breakdown-export-cogs-header">
        <div className="cogs-header-content">
          <div>
            <p className="cogs-header-eyebrow">COGS Cost Breakdown</p>
            <h2 className="cogs-header-title">Estimated Cost of Goods Sold</h2>
            <div className="cogs-header-details">
              <div className="cogs-header-detail-item">
                <span className="cogs-header-detail-label">Customer:</span>
                <span className="cogs-header-detail-value">{customerName || 'N/A'}</span>
              </div>
              <div className="cogs-header-detail-item">
                <span className="cogs-header-detail-label">Date:</span>
                <span className="cogs-header-detail-value">{exportDate}</span>
              </div>
            </div>
          </div>
          <div className="cogs-header-logo">
            <FranchiseLogo alt="Franchise Logo" franchiseId={franchiseId} />
          </div>
        </div>
      </div>

      <div className="breakdown-export-cogs-columns">
        {hasCategories ? (
          [categories.left, categories.right].map((column, columnIndex) => (
            <div className="breakdown-export-cogs-column" key={`cogs-column-${columnIndex}`}>
              {column.map((category, index) => (
                <BreakdownCogsExportCard
                  category={category}
                  categoryKey={getCogsCategoryKey(category, index)}
                  key={`${columnIndex}-${getCogsCategoryKey(category, index)}`}
                />
              ))}
            </div>
          ))
        ) : (
          <div className="breakdown-export-cogs-empty">No cost breakdown available for this proposal.</div>
        )}
      </div>

      {showTotal && hasCategories && (
        <div className="cogs-footer breakdown-export-cogs-footer">
          <div className="cogs-footer-text">
            {totalLabel}: {formatCurrency(totalValue)}
          </div>
        </div>
      )}
    </div>
  );
}

export function BreakdownCogsExportPages({
  categories,
  proposal,
  totalValue,
  totalLabel = 'Total COGS',
}: CogsExportProps) {
  const customerName = (proposal?.customerInfo?.customerName || '').trim();
  const franchiseId = proposal?.franchiseId ?? undefined;
  const exportDate = useMemo(() => formatBreakdownDate(proposal?.lastModified), [proposal?.lastModified]);
  const measureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<CogsExportPage[]>(() => (categories.length ? [{ left: categories, right: [] }] : [{ left: [], right: [] }]));

  useEffect(() => {
    setPages(categories.length ? [{ left: categories, right: [] }] : [{ left: [], right: [] }]);
  }, [categories]);

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

          const sheet = measureRef.current.querySelector('.breakdown-export-cogs-sheet') as HTMLDivElement | null;
          const header = measureRef.current.querySelector('.breakdown-export-cogs-header') as HTMLElement | null;
          const footer = measureRef.current.querySelector('.breakdown-export-cogs-footer') as HTMLElement | null;
          const column = measureRef.current.querySelector('.breakdown-export-cogs-column') as HTMLElement | null;

          if (!sheet || !header || !footer || !column) {
            setPages(categories.length ? [{ left: categories, right: [] }] : [{ left: [], right: [] }]);
            return;
          }

          const sheetStyles = window.getComputedStyle(sheet);
          const headerStyles = window.getComputedStyle(header);
          const footerStyles = window.getComputedStyle(footer);
          const columnStyles = window.getComputedStyle(column);
          const paddingTop = parseFloat(sheetStyles.paddingTop) || 0;
          const paddingBottom = parseFloat(sheetStyles.paddingBottom) || 0;
          const headerMarginBottom = parseFloat(headerStyles.marginBottom) || 0;
          const footerMarginTop = parseFloat(footerStyles.marginTop) || 0;
          const rowGap =
            parseFloat(columnStyles.rowGap || '') ||
            parseFloat(columnStyles.gap || '') ||
            0;
          const availableHeight =
            COGS_PAGE_HEIGHT_PX -
            paddingTop -
            paddingBottom -
            header.getBoundingClientRect().height -
            headerMarginBottom -
            footer.getBoundingClientRect().height -
            footerMarginTop -
            COGS_PAGE_SAFETY_BUFFER_PX;

          if (!Number.isFinite(availableHeight) || availableHeight <= 0) {
            setPages(categories.length ? [{ left: categories, right: [] }] : [{ left: [], right: [] }]);
            return;
          }

          const cardHeights = new Map<string, number>();
          measureRef.current
            .querySelectorAll<HTMLElement>('[data-cogs-card-key]')
            .forEach((card) => {
              const key = card.dataset.cogsCardKey;
              if (!key) return;
              cardHeights.set(key, card.getBoundingClientRect().height);
            });

          const nextPages = packCogsCategories(categories, cardHeights, availableHeight, rowGap);
          const nextSignature = getCogsPageSignature(nextPages);
          setPages((previousPages) =>
            getCogsPageSignature(previousPages) === nextSignature ? previousPages : nextPages
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
        .querySelectorAll<HTMLElement>('.breakdown-export-cogs-sheet, .cogs-category-card')
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
  }, [categories, customerName, exportDate, franchiseId, totalLabel, totalValue]);

  return (
    <>
      <div className="breakdown-export-cogs-measure" aria-hidden="true">
        <div ref={measureRef}>
          <BreakdownCogsExportSheet
            categories={{ left: categories, right: [] }}
            customerName={customerName}
            franchiseId={franchiseId}
            exportDate={exportDate}
            showTotal
            totalLabel={totalLabel}
            totalValue={totalValue}
          />
        </div>
      </div>

      {pages.map((page, index) => (
        <div className="export-breakdown-page export-breakdown-page--cogs" key={`cogs-export-page-${index}`}>
          <BreakdownCogsExportSheet
            categories={page}
            customerName={customerName}
            franchiseId={franchiseId}
            exportDate={exportDate}
            showTotal={index === pages.length - 1}
            totalLabel={totalLabel}
            totalValue={totalValue}
          />
        </div>
      ))}
    </>
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
