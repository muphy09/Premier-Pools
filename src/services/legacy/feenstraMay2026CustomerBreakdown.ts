import type { PricingCalculations, Proposal } from '../../types/proposal-new';
import { shouldUseFeenstraMay2026Pricing } from './feenstraMay2026Profile';

export interface FeenstraCustomerBreakdownRow {
  label: string;
  cost: number;
}

export interface FeenstraCustomerBreakdownResolution {
  categoryValues: number[];
  offContractTotal: number;
  retailPrice: number;
}

interface SignedCategoryBaseline {
  cogs: number;
  retail: number;
}

// The signed customer sheet was generated from the April 30 "Version 2smaller"
// state, while the May 11 COGS report used the later 434 sqft / 88 ft
// construction state. Keep the two signed baselines separate, then price only
// later category deltas with the historical 1% overhead / 70% margin math.
const HISTORICAL_RETAIL_FACTOR = 1.01 / 0.7;
const MAY_11_ENGINE_OFF_CONTRACT_TOTAL = 21344.2375;
const SIGNED_CUSTOMER_OFF_CONTRACT_TOTAL = 22358;
const SIGNED_CUSTOMER_RETAIL_PRICE = 96258;

const SIGNED_CATEGORY_BASELINES: Record<string, SignedCategoryBaseline> = {
  'Plans & Engineering': { cogs: 420, retail: 606 },
  Layout: { cogs: 550, retail: 793.57 },
  Permit: { cogs: 925, retail: 1334.64 },
  Excavation: { cogs: 7491.1, retail: 10304.4 },
  Plumbing: { cogs: 6218.73, retail: 8921.53 },
  Gas: { cogs: 1500, retail: 2164.29 },
  Steel: { cogs: 3795, retail: 4104.93 },
  Electrical: { cogs: 2385, retail: 3441.22 },
  'Shotcrete Labor': { cogs: 3150, retail: 4155.43 },
  'Shotcrete Material': { cogs: 9765.11, retail: 12915.16 },
  'Tile Labor': { cogs: 880, retail: 1183.14 },
  'Tile Material': { cogs: 662.2, retail: 890.32 },
  'Coping Labor': { cogs: 1164, retail: 1575.6 },
  'Coping Material': { cogs: 1522, retail: 2060.19 },
  'Stone/Rockwork': { cogs: 0, retail: 0 },
  Drainage: { cogs: 775, retail: 1118.22 },
  'Equipment Ordered': { cogs: 4696.9, retail: 6776.97 },
  'Equipment Set': { cogs: 750, retail: 1082.14 },
  'Water Features': { cogs: 301.14, retail: 434.5 },
  Cleanup: { cogs: 1535, retail: 2209.38 },
  'Interior Finish': { cogs: 6808, retail: 9688.8 },
  'Water Truck': { cogs: 1470, retail: 2121 },
  'Fiberglass Shell': { cogs: 0, retail: 0 },
  'Fiberglass Install': { cogs: 0, retail: 0 },
  'Startup/Orientation': { cogs: 1399, retail: 2018.57 },
  'Custom Features': { cogs: -1400, retail: 0 },
};

const canonicalLabel = (label: string): string => {
  if (label === 'Coping/Decking Labor') return 'Coping Labor';
  if (label === 'Coping/Decking Material') return 'Coping Material';
  return label;
};

const roundToTwo = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

export function resolveFeenstraMay2026CustomerBreakdown(
  proposal: Partial<Proposal> | undefined,
  pricing: PricingCalculations | undefined,
  rows: FeenstraCustomerBreakdownRow[],
  retailAdjustmentsTotal: number
): FeenstraCustomerBreakdownResolution | null {
  if (!proposal || !shouldUseFeenstraMay2026Pricing(proposal)) {
    return null;
  }

  const currentOffContractTotal =
    pricing?.offContractTotal ??
    proposal.pricing?.offContractTotal ??
    MAY_11_ENGINE_OFF_CONTRACT_TOTAL;
  const offContractTotal = roundToTwo(
    SIGNED_CUSTOMER_OFF_CONTRACT_TOTAL +
      (currentOffContractTotal - MAY_11_ENGINE_OFF_CONTRACT_TOTAL)
  );
  const retailPrice = roundToTwo(
    pricing?.retailPrice ??
      proposal.pricing?.retailPrice ??
      proposal.totalCost ??
      SIGNED_CUSTOMER_RETAIL_PRICE
  );

  const categoryValues = rows.map((row) => {
    const baseline = SIGNED_CATEGORY_BASELINES[canonicalLabel(row.label)];
    if (!baseline) {
      return roundToTwo(row.cost * HISTORICAL_RETAIL_FACTOR);
    }
    if (canonicalLabel(row.label) === 'Custom Features') {
      return 0;
    }
    return roundToTwo(
      baseline.retail +
        (roundToTwo(Number(row.cost) || 0) - baseline.cogs) * HISTORICAL_RETAIL_FACTOR
    );
  });

  const categoryTarget = roundToTwo(
    retailPrice - retailAdjustmentsTotal - offContractTotal
  );
  const categoryTotal = roundToTwo(
    categoryValues.reduce((total, value) => total + value, 0)
  );
  const correction = roundToTwo(categoryTarget - categoryTotal);
  const correctionIndex = rows.findIndex(
    (row) => canonicalLabel(row.label) === 'Startup/Orientation'
  );
  const fallbackIndex = rows.length - 1;
  const targetIndex = correctionIndex >= 0 ? correctionIndex : fallbackIndex;
  if (targetIndex >= 0 && correction !== 0) {
    categoryValues[targetIndex] = roundToTwo(categoryValues[targetIndex] + correction);
  }

  return {
    categoryValues,
    offContractTotal,
    retailPrice,
  };
}
