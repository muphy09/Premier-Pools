// ============================================================================
// ENHANCED PROPOSAL TYPES - Matching Excel Functionality
// ============================================================================

import type { WarrantySection } from './warranty';

// Customer Information
export interface CustomerInfo {
  customerName: string;
  city: string;
  state?: 'NC' | 'SC';
  address?: string;
  phone?: string;
  email?: string;
  county?: 'MECK' | 'NC' | string;
}

// ============================================================================
// POOL SPECIFICATIONS
// ============================================================================

export type PoolType = 'gunite' | 'fiberglass';
export type PoolShape = 'geometric' | 'freeform';
export type FiberglassSize = 'small' | 'medium' | 'large';
export type SpaType = 'none' | 'gunite' | 'fiberglass';
export type SpaShape = 'round' | 'square';
export type FiberglassCraneOption = 'no-crane' | 'crane-small' | 'crane-medium' | 'crane-large';
export type MasonryFacing = string;

export interface PoolSpecs {
  // Pool Type
  poolType: PoolType;
  poolShape: PoolShape;

  // Fiberglass specific
  fiberglassSize?: FiberglassSize;
  fiberglassModelName?: string;
  fiberglassFinishUpgradeName?: string;
  fiberglassTanningLedgeName?: string;
  needsFiberglassCrane?: boolean;
  fiberglassModelPrice?: number;
  fiberglassPerimeter?: number;
  fiberglassCraneOption?: FiberglassCraneOption;

  // Shotcrete pool dimensions
  perimeter: number; // LNFT
  surfaceArea: number; // SQFT
  shallowDepth: number; // FT
  endDepth: number; // FT
  maxWidth: number; // FT
  maxLength: number; // FT

  // Features
  totalStepsAndBench: number; // LNFT
  hasTanningShelf: boolean;

  // Spa
  spaType: SpaType;
  spaLength: number;
  spaWidth: number;
  spaShape: SpaShape;
  spaPerimeter: number; // Auto-calculated
  spaFiberglassModelName?: string;
  needsFiberglassSpaCrane?: boolean;
  // Legacy fallback fields retained for compatibility with older saved data.
  spaFiberglassModelPrice?: number;
  isRaisedSpa: boolean; // +18"
  raisedSpaFacing: MasonryFacing;
  hasSpillover: boolean;

  // Decking
  deckingArea: number; // SQFT

  // Travel
  travelDistance: number; // MILES
  poolToStreetDistance: number; // 0, 1 (251-300ft), 2 (300-350ft)

  // Options
  hasSiltFence: boolean;
  hasAutomaticCover: boolean;
  automaticCoverManufacturerCost?: number;
  waterfallCount?: number;

  // Calculated
  approximateGallons: number; // Auto-calculated
}

// ============================================================================
// EXCAVATION
// ============================================================================

export interface RBBLevel {
  height: 6 | 12 | 18 | 24 | 30 | 36;
  length: number; // LNFT
  facing: MasonryFacing;
  hasBacksideFacing?: boolean;
  backsideFacing?: MasonryFacing;
}

export interface ColumnSpec {
  count: number;
  width: number; // FT
  depth: number; // FT
  height: number; // FT
  facing: MasonryFacing;
}

export interface RetainingWallSelection {
  type: string;
  length: number; // LNFT
}

export interface Excavation {
  // RBB (Raised Bond Beam)
  rbbLevels: RBBLevel[];
  totalRBBSqft: number; // Auto-calculated
  exposedPoolWallLevels: RBBLevel[];

  // Columns
  columns: ColumnSpec;

  // Additional work
  additionalSitePrepHours: number;
  hasAdditionalSitePrep?: boolean;
  hasTightAccessJob?: boolean;
  hasGravelInstall: boolean;
  gravelInstallQuantity?: number;
  hasDirtHaul: boolean;
  dirtHaulQuantity?: number;
  additionalBench: number; // Auto-calculated from steps > 20

  // Double curtain
  doubleCurtainLength: number; // LNFT
  hasDoubleCurtain?: boolean;

  // Soil/Engineering
  needsSoilSampleEngineer: boolean;

  // Retaining walls
  retainingWalls?: RetainingWallSelection[];
  retainingWallType?: string;
  retainingWallLength?: number; // LNFT

  // Custom options
  customOptions?: CustomOption[];

  // Calculated costs
  cost: number;
}

// ============================================================================
// PLUMBING
// ============================================================================

export interface PlumbingRuns {
  // Core runs
  skimmerRun: number; // Total all skimmers (LNFT)
  additionalSkimmers: number; // (1) is included
  mainDrainRun: number; // Main drain to EQ (LNFT)
  cleanerRun: number; // Pool center to EQ (LNFT)
  autoFillRun: number; // Hose bibb to AWL (LNFT)
  autoFillElectricRun: number; // Electric/conduit run for powered auto-fill systems (LNFT)

  // Water features
  waterFeature1Run: number; // LNFT
  waterFeature2Run: number; // LNFT
  waterFeature3Run: number; // LNFT
  waterFeature4Run: number; // LNFT

  // In-floor cleaning
  infloorValveToEQ: number; // LNFT
  infloorValveToPool: number; // LNFT

  // Gas and Spa
  gasRun: number; // Meter to heater (LNFT)
  spaRun: number; // Spa to EQ (LNFT)

  // Electrical (shared run lengths injected from electrical section)
  electricalRun?: number; // House panel to EQ (LNFT)
  lightRun?: number; // Lights to EQ (LNFT)
}

export interface Plumbing {
  runs: PlumbingRuns;
  customOptions?: CustomOption[];
  cost: number; // Auto-calculated
}

// ============================================================================
// ELECTRICAL
// ============================================================================

export interface ElectricalRuns {
  electricalRun: number; // House panel to EQ (LNFT)
  lightRun: number; // All lights to EQ (LNFT)
  heatPumpElectricalRun: number; // Total run (LNFT)
}

export interface Electrical {
  runs: ElectricalRuns;
  customOptions?: CustomOption[];
  cost: number; // Auto-calculated
}

// ============================================================================
// TILE, COPING, DECKING
// ============================================================================

export type TileLevel = 0 | 1 | 2 | 3;
export type CopingType = string;
export type DeckingType = string;
export type CopingSize = '12x12' | '12x24' | '16x16';

export interface AdditionalDeckingSelection {
  deckingType: string;
  area: number; // SQFT
  isOffContract?: boolean;
}

export interface TileCopingDecking {
  // Tile
  tileLevel: TileLevel;
  tileOptionId?: string;
  additionalTileLength: number; // LNFT for spillway or infinity edge
  hasTrimTileOnSteps: boolean; // Shotcrete pools only

  // Coping
  copingType: CopingType;
  copingSize: CopingSize;
  copingLength: number; // Auto-calculated from perimeter

  // Decking
  deckingType: DeckingType;
  deckingArea: number; // SQFT
  additionalDeckingSelections?: AdditionalDeckingSelection[];
  additionalDeckingType?: string;
  additionalDeckingArea?: number; // SQFT
  concreteStepsLength: number; // LNFT
  isDeckingOffContract?: boolean;
  isDeckingWasteRemoved?: boolean;
  isAdditionalDeckingOffContract?: boolean;
  isAdditionalDeckingWasteRemoved?: boolean;
  deckingOffContractCost?: number;

  // Specialty details
  bullnoseLnft?: number; // Regular bullnose (single)
  doubleBullnoseLnft?: number; // Double bullnose travertine (treated same rate as bullnose)
  spillwayLnft?: number;
  rockworkPanelLedgeSqft?: number;
  rockworkPanelLedgeMaterialSqft?: number; // Allow explicit material overage entry
  rockworkStackedStoneSqft?: number;
  rockworkTileSqft?: number;

  // Options
  hasRoughGrading: boolean;

  // Custom options
  customOptions?: CustomOption[];

  // Calculated
  cost: number;
}

// ============================================================================
// DRAINAGE
// ============================================================================

export interface Drainage {
  downspoutTotalLF: number;
  deckDrainTotalLF: number;
  frenchDrainTotalLF: number;
  boxDrainTotalLF: number;
  customOptions?: CustomOption[];
  cost: number; // Auto-calculated
}

// ============================================================================
// EQUIPMENT
// ============================================================================

export interface PumpSelection {
  name: string;
  model?: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
  autoAddedForSpa?: boolean;
  autoAddedReason?: 'spa' | 'waterFeature' | 'fiberglass';
}

export interface FilterSelection {
  name: string;
  sqft?: number;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
}

export interface CleanerSelection {
  name: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
}

export interface HeaterSelection {
  name: string;
  btu?: number;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
  autoAddedForSpa?: boolean;
  autoAddedReason?: 'spa';
}

export interface AutomationSelection {
  name: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
  addCost3?: number;
  includesSaltCell?: boolean;
  zones: number; // Additional zones beyond base
}

export interface LightSelection {
  type: 'pool' | 'spa';
  name: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
}

export interface SaltSystemSelection {
  name: string;
  model?: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
  excludedFromSaltCell?: boolean;
  includedSaltCellPlaceholder?: boolean;
}

export interface AutoFillSystemSelection {
  name: string;
  model?: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
  percentIncrease?: number;
  requiresElectricRun?: boolean;
}

export interface EquipmentAccessorySelection {
  name: string;
  price?: number;
  basePrice?: number;
  addCost1?: number;
  addCost2?: number;
}

export type EquipmentPackageMode = 'fixed' | 'custom';

export interface EquipmentPackageOption {
  id: string;
  name: string;
  mode: EquipmentPackageMode;
  enabled?: boolean;
  description?: string;
  notes?: string;
  basePrice?: number;
  includeCheckValve?: boolean;
  supportsSpa?: boolean;
  allowAdditionalPumps?: boolean;
  allowHeaterUpgrade?: boolean;
  allowCleanerUpgrade?: boolean;
  allowAutoFillUpgrade?: boolean;
  allowPoolLightUpgrade?: boolean;
  allowSpaLightUpgrade?: boolean;
  allowWaterFeatureUpgrade?: boolean;
  allowSanitationAccessoryUpgrade?: boolean;
  includedWaterFeaturesBeforeExtraPump?: number;
  includedPumpName?: string;
  includedPumpQuantity?: number;
  includedFilterName?: string;
  includedFilterQuantity?: number;
  includedCleanerName?: string;
  includedCleanerQuantity?: number;
  includedHeaterName?: string;
  includedHeaterQuantity?: number;
  includedAutomationName?: string;
  includedAutomationQuantity?: number;
  includedAutomationZones?: number;
  includedSaltSystemName?: string;
  includedSaltSystemQuantity?: number;
  includedAutoFillSystemName?: string;
  includedAutoFillSystemQuantity?: number;
  includedPoolLightName?: string;
  includedPoolLightQuantity?: number;
  includedSpaLightName?: string;
  includedSpaLightQuantity?: number;
  includedSanitationAccessoryName?: string;
  includedSanitationAccessoryQuantity?: number;
  defaultCleanerName?: string;
  defaultCleanerQuantity?: number;
  defaultPoolLightName?: string;
  defaultPoolLightQuantity?: number;
  defaultAutoFillSystemName?: string;
  defaultAutoFillSystemQuantity?: number;
  defaultSanitationAccessoryName?: string;
  defaultSanitationAccessoryQuantity?: number;
}

export interface Equipment {
  // Main equipment
  pump: PumpSelection;
  pumpQuantity?: number;
  additionalPumps?: PumpSelection[];
  auxiliaryPump?: PumpSelection; // Deprecated: use auxiliaryPumps
  auxiliaryPumps?: PumpSelection[]; // Blower selections (single-select in current UI)
  filter: FilterSelection;
  filterQuantity?: number;
  additionalFilters?: FilterSelection[];
  cleaner: CleanerSelection;
  cleanerQuantity?: number; // Excel NEW POOL B119 qty (0 to exclude cleaner)
  heater: HeaterSelection;
  heaterQuantity?: number;
  additionalHeaters?: HeaterSelection[];
  heaterChiller?: HeaterSelection;
  heaterChillerQuantity?: number;

  // Lights
  poolLights?: LightSelection[];
  spaLights?: LightSelection[];
  includePoolLights?: boolean;
  applyCustomPackageDefaultPoolLights?: boolean;
  includeSpaLights?: boolean;
  numberOfLights: number; // Legacy: additional pool lights beyond the first
  hasSpaLight: boolean; // Legacy: spa light included

  // Automation
  automation: AutomationSelection;
  automationQuantity?: number;

  // Salt system
  saltSystem?: SaltSystemSelection;
  saltSystemQuantity?: number;
  additionalSaltSystem?: SaltSystemSelection;

  // Auto-fill system
  autoFillSystem?: AutoFillSystemSelection;
  autoFillSystemQuantity?: number;

  // Sanitation accessories
  sanitationAccessory?: EquipmentAccessorySelection;
  sanitationAccessoryQuantity?: number;

  // Accessories
  hasBlanketReel: boolean;
  hasSolarBlanket: boolean;
  hasAutoFill: boolean;
  hasHandrail: boolean;
  hasStartupChemicals: boolean;

  // Package pricing
  packageSelectionId?: string;
  packageSelectionTouched?: boolean;

  // Custom options
  customOptions?: CustomOption[];

  // Calculated
  totalCost: number;
  hasBeenEdited?: boolean;
}

// ============================================================================
// WATER FEATURES
// ============================================================================

export interface WaterFeatureSelection {
  featureId: string;
  quantity: number;
  includeValveActuator?: boolean;
}

export interface WaterFeatures {
  selections: WaterFeatureSelection[];

  // Custom options
  customOptions?: CustomOption[];

  // Calculated
  totalCost: number;
}

// ============================================================================
// CUSTOM OPTIONS
// ============================================================================

export interface CustomOption {
  name: string;
  description: string;
  laborCost: number;
  materialCost: number;
  totalCost: number;
  isOffContract?: boolean;
}

// ============================================================================
// CUSTOM FEATURES
// ============================================================================

export interface GroupedCustomFeatureSubcategoryConfig {
  id?: string;
  groupName?: string;
  name: string;
  addonLabel?: string;
  addonUnitPrice?: number;
}

export interface GroupedCustomFeatureOption {
  id: string;
  name: string;
  subcategory?: string;
  additionalOptionCategory?: string;
  description: string;
  pricingMode?: GroupedCustomFeaturePricingMode;
  totalPrice: number;
  pricePerSqft?: number;
}

export type GroupedCustomFeaturePricingMode = 'total' | 'sqft';

export type CustomFeatureSource = 'manual' | 'grouped';

export interface CustomFeature {
  name: string;
  description: string;
  laborCost: number;
  materialCost: number;
  totalCost: number;
  isOffContract?: boolean;
  source?: CustomFeatureSource;
  groupedOptionId?: string;
  groupedSubcategory?: string;
  groupedAdditionalOptionCategory?: string;
  groupedAddonOptionId?: string;
  groupedAddonLabel?: string;
  groupedAddonUnitPrice?: number;
  groupedAddonQuantity?: number;
  groupedPricingMode?: GroupedCustomFeaturePricingMode;
  groupedPricePerSqft?: number;
  groupedSqft?: number;
}

export interface CustomFeatures {
  features: CustomFeature[];
  totalCost: number;
}

// ============================================================================
// MASONRY
// ============================================================================

export interface Masonry {
  // From excavation column data
  columnCost: number;

  // RBB facing costs
  rbbFacingCost: number;

  // Raised spa facing cost
  raisedSpaFacingCost: number;

  // Calculated
  totalCost: number;
}

// ============================================================================
// INTERIOR FINISH
// ============================================================================

export type InteriorFinishType = string;

export interface InteriorFinish {
  finishType: InteriorFinishType;
  color: string;
  surfaceArea: number; // Auto-calculated from pool specs
  hasSpa: boolean;
  hasWaterproofing?: boolean; // Microglass/waterproofing toggle (defaults to included)
  customOptions?: CustomOption[];
  cost: number; // Auto-calculated
}

// ============================================================================
// DETAILED COST BREAKDOWN
// ============================================================================

export interface CostLineItem {
  category: string;
  description: string;
  unitPrice: number;
  quantity: number;
  total: number;
  notes?: string;
  details?: Record<string, number | string | boolean>;
}

export interface CostBreakdown {
  plansAndEngineering: CostLineItem[];
  layout: CostLineItem[];
  permit: CostLineItem[];
  excavation: CostLineItem[];
  plumbing: CostLineItem[];
  gas: CostLineItem[];
  steel: CostLineItem[];
  electrical: CostLineItem[];
  shotcreteLabor: CostLineItem[];
  shotcreteMaterial: CostLineItem[];
  tileLabor: CostLineItem[];
  tileMaterial: CostLineItem[];
  copingDeckingLabor: CostLineItem[];
  copingDeckingMaterial: CostLineItem[];
  stoneRockworkLabor: CostLineItem[];
  stoneRockworkMaterial: CostLineItem[];
  drainage: CostLineItem[];
  equipmentOrdered: CostLineItem[];
  equipmentSet: CostLineItem[];
  waterFeatures: CostLineItem[];
  cleanup: CostLineItem[];
  interiorFinish: CostLineItem[];
  waterTruck: CostLineItem[];
  fiberglassShell: CostLineItem[];
  fiberglassInstall: CostLineItem[];
  startupOrientation: CostLineItem[]; // NEW
  customFeatures: CostLineItem[]; // NEW

  // Totals by category
  totals: {
    plansAndEngineering: number;
    layout: number;
    permit: number;
    excavation: number;
    plumbing: number;
    gas: number;
    steel: number;
    electrical: number;
    shotcreteLabor: number;
    shotcreteMaterial: number;
    tileLabor: number;
    tileMaterial: number;
    copingDeckingLabor: number;
    copingDeckingMaterial: number;
    stoneRockworkLabor: number;
    stoneRockworkMaterial: number;
    drainage: number;
    equipmentOrdered: number;
    equipmentSet: number;
    waterFeatures: number;
    cleanup: number;
    interiorFinish: number;
    waterTruck: number;
    fiberglassShell: number;
    fiberglassInstall: number;
    customFeatures: number; // NEW - custom features total
    startupOrientation: number; // NEW - startup/orientation total
    grandTotal: number;
  };
}

// ============================================================================
// PAP DISCOUNT CONFIGURATION
// ============================================================================

export interface PAPDiscounts {
  excavation: number; // percentage (e.g., 0.10 for 10%)
  plumbing: number;
  steel: number;
  electrical: number;
  shotcrete: number;
  tileCopingLabor: number;
  tileCopingMaterial: number;
  equipment: number;
  interiorFinish: number;
  startup: number;
  fiberglassShell: number;
}

// Manual retail adjustments applied by designers
export interface ManualAdjustments {
  positive1: number;
  positive2: number;
  negative1: number;
  negative2: number;
}

export interface RetailAdjustment {
  name: string;
  amount: number;
}

// ============================================================================
// PRICING & PROFIT CALCULATIONS
// ============================================================================

export interface PricingCalculations {
  // Cost calculations
  totalCostsBeforeOverhead: number; // Sum of all cost sections
  overheadMultiplier: number; // Default 1.01 (1% overhead)
  totalCOGS: number; // totalCostsBeforeOverhead × overheadMultiplier
  offContractTotal: number; // Retail-only custom options excluded from COGS

  // Retail price calculation
  targetMargin: number; // Default 0.70 (70% - meaning 30% profit)
  baseRetailPrice: number; // CEILING(totalCOGS / targetMargin, 10)
  g3UpgradeCost: number; // Legacy retail add-on slot; fiberglass overhaul keeps this at $0
  discountAmount: number; // Manual discount (negative number)
  retailPrice: number; // baseRetailPrice + g3UpgradeCost + discountAmount

  // Commissions & Fees (calculated from retailPrice)
  digCommissionRate: number; // Default 0.0275 (2.75%)
  digCommission: number; // retailPrice × digCommissionRate
  adminFeeRate: number; // Default 0.029 (2.9%)
  adminFee: number; // retailPrice x adminFeeRate
  closeoutCommissionRate: number; // Default 0.0275 (2.75%)
  closeoutCommission: number; // retailPrice x closeoutCommissionRate

  // Final profit
  grossProfit: number; // retailPrice - totalCOGS - digCommission - adminFee - closeoutCommission
  grossProfitMargin: number; // grossProfit / retailPrice (as percentage)

  // Designer adjustments applied to retail price
  manualAdjustmentsTotal?: number;
  retailAdjustmentsTotal?: number;
}

export type ProposalWorkflowStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'signed'
  | 'needs_approval'
  | 'changes_requested'
  | 'completed';

export type ProposalActorRole = 'master' | 'owner' | 'admin' | 'bookkeeper' | 'designer';

export type ProposalWorkflowReasonCode =
  | 'margin_below_threshold'
  | 'discount_above_allowance'
  | 'always_require_approval'
  | 'manual_review';

export interface ProposalWorkflowReason {
  code: ProposalWorkflowReasonCode;
  label: string;
  detail?: string;
}

export interface ProposalWorkflowActor {
  userId?: string;
  name?: string | null;
  email?: string | null;
  role?: ProposalActorRole;
}

export type ProposalWorkflowEventType =
  | 'submitted'
  | 'approved'
  | 'signed'
  | 'changes_requested'
  | 'completed'
  | 'note';

export interface ProposalWorkflowEvent {
  id: string;
  type: ProposalWorkflowEventType;
  createdAt: string;
  actor?: ProposalWorkflowActor;
  message?: string;
  versionId?: string;
  fromStatus?: ProposalWorkflowStatus | null;
  toStatus?: ProposalWorkflowStatus | null;
  readByUserIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProposalWorkflowState {
  status: ProposalWorkflowStatus;
  reviewVersionId?: string | null;
  submittedVersionId?: string | null;
  approvedVersionId?: string | null;
  approvedVersionIds?: string[];
  approvalNotRequired?: boolean;
  submittedAt?: string | null;
  submittedBy?: ProposalWorkflowActor | null;
  manualReviewRequested?: boolean;
  manualReviewMessage?: string | null;
  needsApproval?: boolean;
  approvalReasons?: ProposalWorkflowReason[];
  approved?: boolean;
  approvedAt?: string | null;
  approvedBy?: ProposalWorkflowActor | null;
  signedVersionId?: string | null;
  signedAddendumVersionIds?: string[];
  signedAt?: string | null;
  signedBy?: ProposalWorkflowActor | null;
  completedAt?: string | null;
  completedBy?: ProposalWorkflowActor | null;
  history?: ProposalWorkflowEvent[];
}

export type PricingRevisionReviewDecision = 'pending' | 'declined' | 'upgraded' | 'not_affected';

export interface PricingRevisionReviewState {
  pricingModelId?: string | null;
  baselineRevisionId?: string | null;
  baselineRevisionNumber?: number | null;
  latestRevisionId: string;
  latestRevisionNumber?: number | null;
  decision: PricingRevisionReviewDecision;
  detectedAt: string;
  decidedAt?: string | null;
  decidedBy?: ProposalWorkflowActor | null;
  underlyingStatus?: ProposalWorkflowStatus | null;
}

export interface ContractRevisionReviewState {
  latestRevisionId: string;
  latestRevisionNumber?: number | null;
  decision: 'pending' | 'declined' | 'upgraded';
  detectedAt: string;
  decidedAt?: string | null;
  decidedBy?: ProposalWorkflowActor | null;
}

// ============================================================================
// COMPLETE PROPOSAL
// ============================================================================

export interface Proposal {
  id?: number;
  proposalNumber: string;
  createdDate: string;
  lastModified: string;
  status: ProposalWorkflowStatus;
  /**
   * Versioning metadata
   */
  versionId?: string;
  versionName?: string;
  versionCreationMode?: 'scratch' | 'copy';
  activeVersionId?: string;
  versions?: Proposal[];
  isOriginalVersion?: boolean;
  franchiseId?: string;
  designerAuthUserId?: string;
  designerName?: string;
  designerRole?: ProposalActorRole;
  designerCode?: string;
  pricingModelId?: string;
  pricingModelName?: string;
  pricingModelFranchiseId?: string;
  pricingModelIsDefault?: boolean;
  pricingModelRevisionId?: string;
  pricingModelRevisionNumber?: number;
  pricingRevisionReview?: PricingRevisionReviewState | null;
  pricingTierId?: string;
  pricingTierName?: string;
  syncStatus?: 'synced' | 'pending' | 'error';
  syncMessage?: string;
  versionLocked?: boolean;
  versionLockedAt?: string | null;
  versionSubmittedAt?: string | null;
  versionSubmittedBy?: ProposalWorkflowActor | null;
  workflow?: ProposalWorkflowState;

  // Main sections
  customerInfo: CustomerInfo;
  poolSpecs: PoolSpecs;
  excavation: Excavation;
  plumbing: Plumbing;
  electrical: Electrical;
  tileCopingDecking: TileCopingDecking;
  drainage: Drainage;
  equipment: Equipment;
  waterFeatures: WaterFeatures;
  customFeatures: CustomFeatures;
  masonry: Masonry;
  interiorFinish: InteriorFinish;

  // Detailed breakdown (like COST - NEW sheet)
  costBreakdown: CostBreakdown;

  // PAP Discount Configuration
  papDiscounts?: PAPDiscounts;

  // Designer retail adjustments
  manualAdjustments?: ManualAdjustments;
  retailAdjustments?: RetailAdjustment[];

  // Pricing & Profit Calculations (NEW - matching Excel)
  pricing: PricingCalculations;

  // Legacy fields (for backward compatibility)
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalCost: number;

  notes?: string;

  // Designer overrides for contract cells (cell address -> value)
  contractOverrides?: Record<string, string | number | null>;
  contractTemplateId?: string;
  contractTemplateRevisionId?: string;
  contractTemplateRevisionNumber?: number;
  contractRevisionReview?: ContractRevisionReviewState | null;
  contractTemplateRevision?: string;
  warrantySections?: WarrantySection[] | null;
}
