// ============================================================================
// MASTER PRICING ENGINE - Complete Integration
// ============================================================================

import { Proposal, CostBreakdown, CostLineItem, PAPDiscounts, CustomOption } from '../types/proposal-new';
import pricingData from './pricingData';
import { getPricingTaxRate } from './taxRate';
import { CalculationModules } from './pricingEngineComplete';
import { isBronzePricingTier } from './pricingTiers';
import { flattenWaterFeatures } from '../utils/waterFeatureCost';
import { CUSTOM_OPTIONS_SUBCATEGORY } from '../utils/costBreakdownSubcategories';
import { isPpasEastProposal } from '../utils/franchiseScope';
import { getSelectedEquipmentPackage, isFixedEquipmentPackage } from '../utils/equipmentPackages';
import {
  DEFAULT_CLOSEOUT_COMMISSION_RATE,
  DEFAULT_DIG_COMMISSION_RATE,
} from './userCommissionRates';
import {
  getCustomOptionTotal,
  getOffContractTotal,
  hasCustomOptionContent,
  isOffContractCustomOption,
  normalizeCustomOption,
} from '../utils/customOptions';
import {
  getCustomFeatureTotal,
  getGroupedCustomFeatureAddonLabel,
  getGroupedCustomFeatureAddonQuantity,
  getGroupedCustomFeatureAddonUnitPrice,
  getGroupedCustomFeatureBaseTotal,
  getGroupedCustomFeaturePricePerSqft,
  getGroupedCustomFeaturePricingMode,
  getGroupedCustomFeatureSqft,
  hasCustomFeatureContent,
  isOffContractCustomFeature,
  normalizeCustomFeatures,
} from '../utils/customFeatures';
import { isOffContractLineItem } from '../utils/offContractLineItems';
import { normalizePapDiscounts } from '../utils/papDiscounts';
import { calculateFeenstraMay2026Proposal } from './legacy/feenstraMay2026Engine.generated.js';
import { shouldUseFeenstraMay2026Pricing } from './legacy/feenstraMay2026Profile';
import feenstraMay2026Pricing from './legacy/feenstraMay2026Pricing.generated.json';

const hasPoolDefinition = (poolSpecs: any): boolean => {
  if (!poolSpecs) return false;
  const hasGuniteDimensions =
    (poolSpecs.surfaceArea ?? 0) > 0 ||
    (poolSpecs.perimeter ?? 0) > 0 ||
    ((poolSpecs.maxLength ?? 0) > 0 && (poolSpecs.maxWidth ?? 0) > 0);
  const hasFiberglassSelection =
    poolSpecs.poolType === 'fiberglass' && (!!poolSpecs.fiberglassSize || !!poolSpecs.fiberglassModelName);
  const hasSpaDefinition =
    ((poolSpecs.spaLength ?? 0) > 0 && (poolSpecs.spaWidth ?? 0) > 0) ||
    (poolSpecs.spaPerimeter ?? 0) > 0;
  return hasGuniteDimensions || hasFiberglassSelection || hasSpaDefinition;
};

// Import calculation classes from pricingEngine.ts
import {
  ExcavationCalculations,
  PlumbingCalculations,
  ElectricalCalculations,
  SteelCalculations,
  ShotcreteCalculations,
} from './pricingEngine';

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

function rebuildEquipmentTax(equipmentItems: CostLineItem[]): CostLineItem[] {
  const taxRate = getPricingTaxRate(pricingData);
  const withoutTax = equipmentItems.filter((item) => !item.description.toLowerCase().includes('tax'));
  const subtotal = withoutTax.reduce((sum, item) => sum + (item.total ?? 0), 0);
  if (subtotal > 0 && taxRate > 0) {
    const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
    return [
      ...withoutTax,
      {
        category: 'Equipment',
        description: 'Equipment Tax',
        unitPrice: taxRate,
        quantity: subtotal,
        total: taxAmount,
      },
    ];
  }
  return withoutTax;
}

const buildCustomOptionItems = (options: CustomOption[] | undefined, category: string): CostLineItem[] => {
  if (!options || options.length === 0) return [];
  return options
    .filter((option) => hasCustomOptionContent(option) && !isOffContractCustomOption(option))
    .map((option, index) => {
      const normalized = normalizeCustomOption(option);
      const total = getCustomOptionTotal(normalized);
      const description = normalized.name?.trim() || `Custom Option #${index + 1}`;
      return {
        category,
        description,
        unitPrice: total,
        quantity: 1,
        total,
        notes: normalized.description,
        details: { subcategory: CUSTOM_OPTIONS_SUBCATEGORY },
      };
    });
};

const buildCustomFeatureItems = (
  customFeatures: Proposal['customFeatures'] | undefined
): CostLineItem[] => {
  if (!customFeatures) return [];

  return normalizeCustomFeatures(customFeatures).features
    .filter((feature) => hasCustomFeatureContent(feature) && !isOffContractCustomFeature(feature))
    .flatMap((feature, index) => {
      const description = feature.name?.trim() || `Custom Feature #${index + 1}`;
      const baseTotal = getGroupedCustomFeatureBaseTotal(feature);
      const pricingMode = getGroupedCustomFeaturePricingMode(feature);
      const baseQuantity = pricingMode === 'sqft' ? getGroupedCustomFeatureSqft(feature) : 1;
      const baseUnitPrice = pricingMode === 'sqft' ? getGroupedCustomFeaturePricePerSqft(feature) : baseTotal;
      const addonLabel = getGroupedCustomFeatureAddonLabel(feature);
      const addonUnitPrice = getGroupedCustomFeatureAddonUnitPrice(feature);
      const addonQuantity = getGroupedCustomFeatureAddonQuantity(feature);
      const items: CostLineItem[] = [];

      if (baseTotal !== 0) {
        items.push({
          category: 'Custom Features',
          description,
          unitPrice: baseUnitPrice,
          quantity: baseQuantity,
          total: baseTotal,
          notes: feature.description,
        });
      }

      if (addonLabel && addonUnitPrice !== 0 && addonQuantity !== 0) {
        items.push({
          category: 'Custom Features',
          description: `${description} - ${addonLabel}`,
          unitPrice: addonUnitPrice,
          quantity: addonQuantity,
          total: Math.round(addonUnitPrice * addonQuantity * 100) / 100,
          notes: feature.description,
        });
      }

      if (items.length === 0) {
        items.push({
          category: 'Custom Features',
          description,
          unitPrice: getCustomFeatureTotal(feature),
          quantity: 1,
          total: getCustomFeatureTotal(feature),
          notes: feature.description,
        });
      }

      return items;
    });
};

export class MasterPricingEngine {
  /**
   * Main entry point - calculates complete proposal with full cost breakdown
   */
  static calculateCompleteProposal(proposal: Partial<Proposal>, papDiscounts?: PAPDiscounts): {
    costBreakdown: CostBreakdown;
    pricing: import('../types/proposal-new').PricingCalculations;
    subtotal: number;
    taxRate: number;
    taxAmount: number;
    totalCost: number;
  } {
    if (shouldUseFeenstraMay2026Pricing(proposal)) {
      return calculateFeenstraMay2026Proposal(
        proposal,
        papDiscounts,
        feenstraMay2026Pricing as unknown as typeof pricingData
      );
    }

    const tileCopingDecking = proposal.tileCopingDecking!;
    const derivedWaterfallCount = (tileCopingDecking?.doubleBullnoseLnft ?? 0) > 0 ? 1 : 0;
    const explicitWaterfalls = proposal.poolSpecs?.waterfallCount ?? 0;
    const waterfallCount = explicitWaterfalls > 0 ? explicitWaterfalls : derivedWaterfallCount;
    const poolSpecs = {
      ...proposal.poolSpecs!,
      waterfallCount,
    };
    const excavation = proposal.excavation!;
    const normalizedExcavation = {
      ...excavation,
      totalRBBSqft: ExcavationCalculations.calculateTotalRBBSqft(excavation),
    };
    const plumbing = proposal.plumbing!;
    const electrical = proposal.electrical!;
    const drainage = proposal.drainage!;
    const isPpasEast = isPpasEastProposal(proposal);
    const rawEquipment = proposal.equipment!;
    const equipment = isPpasEast
      ? rawEquipment
      : {
          ...rawEquipment,
          heaterChiller: undefined,
          heaterChillerQuantity: 0,
        };
    const waterFeatures = proposal.waterFeatures ?? { selections: [], totalCost: 0, customOptions: [] };
    const selectedEquipmentPackage = getSelectedEquipmentPackage(equipment);
    const customFeatures = normalizeCustomFeatures(proposal.customFeatures);
    const interiorFinish = proposal.interiorFinish!;
    const isFiberglass = CalculationModules.Pool.isFiberglassPool(poolSpecs);
    const appliedPapDiscounts: PAPDiscounts = normalizePapDiscounts(papDiscounts ?? pricingData.papDiscountRates);

    // Calculate all sections
    const plansItems = this.calculatePlansEngineering(poolSpecs, excavation, waterFeatures);
    const layoutItems = this.calculateLayout(poolSpecs);
    const permitItems = this.calculatePermit(poolSpecs);
    let excavationItems = ExcavationCalculations.calculateExcavationCost(poolSpecs, normalizedExcavation, {
      bronzeIncludesGravel: isPpasEast,
      allowTightAccessJob: isPpasEast,
      allowExcavationOptionMultipliers: isPpasEast,
    });
    const plumbingWithElectrical = {
      ...plumbing,
      runs: {
        ...plumbing.runs,
        electricalRun: electrical?.runs?.electricalRun ?? 0,
        lightRun: electrical?.runs?.lightRun ?? 0,
      },
    };
    let plumbingItems = PlumbingCalculations.calculatePlumbingCost(
      poolSpecs,
      plumbingWithElectrical,
      equipment,
      normalizedExcavation,
      waterFeatures
    );
    const gasItems = ElectricalCalculations.calculateGasCost(plumbing, waterFeatures);
    let steelItems = SteelCalculations.calculateSteelCost(poolSpecs, excavation);
    let electricalItems = ElectricalCalculations.calculateElectricalCost(poolSpecs, electrical, equipment, plumbing);
    excavationItems = excavationItems.concat(buildCustomOptionItems(excavation.customOptions, 'Excavation'));
    plumbingItems = plumbingItems.concat(buildCustomOptionItems(plumbing.customOptions, 'Plumbing'));
    electricalItems = electricalItems.concat(buildCustomOptionItems(electrical.customOptions, 'Electrical'));
    const shotcrete = ShotcreteCalculations.calculateShotcreteCost(poolSpecs, excavation, tileCopingDecking);
    const tileCoping = CalculationModules.TileCopingDecking.calculateCosts(poolSpecs, tileCopingDecking);
    const tileCustomOptionsItems = buildCustomOptionItems(tileCopingDecking.customOptions, 'Tile');
    const tileLaborOnly = tileCoping.labor.filter(i => i.category.toLowerCase().includes('tile')).concat(tileCustomOptionsItems);
    const tileMaterialOnly = tileCoping.material.filter(i => i.category.toLowerCase().includes('tile'));
    const drainageItemsBase = CalculationModules.Drainage.calculateDrainageCost(drainage);
    const drainageItems = drainageItemsBase.concat(buildCustomOptionItems(drainage.customOptions, 'Drainage'));
    let equipmentItems = CalculationModules.Equipment.calculateEquipmentCost(equipment, poolSpecs);
    const equipmentSetItems = CalculationModules.Equipment.calculateEquipmentSetCost(equipment, poolSpecs);
    const equipmentSetItemsWithCustomOptions =
      equipmentSetItems.concat(buildCustomOptionItems(equipment.customOptions, 'Equipment Set'));
    const waterFeaturesItems = CalculationModules.WaterFeatures.calculateWaterFeaturesCost(waterFeatures);
    const waterFeaturesCustomOptions = buildCustomOptionItems(waterFeatures.customOptions, 'Water Features');
    const waterFeaturesAsEquipment = waterFeaturesItems.map((item) => ({
      ...item,
      category: 'Equipment',
      description:
        selectedEquipmentPackage && isFixedEquipmentPackage(selectedEquipmentPackage)
          ? item.description.toLowerCase().includes('(upgrade)')
            ? item.description
            : `${item.description} (upgrade)`
          : item.description,
    }));
    equipmentItems = rebuildEquipmentTax([...equipmentItems, ...waterFeaturesAsEquipment]);
    const interiorForPricing = isPpasEast
      ? { ...interiorFinish, hasWaterproofing: false }
      : interiorFinish;
    const interior = CalculationModules.InteriorFinish.calculateInteriorFinishCost(
      poolSpecs,
      interiorForPricing,
      equipment
    );
    const interiorFinishItems = [...interior.labor, ...interior.material]
      .concat(buildCustomOptionItems(interiorFinish.customOptions, 'Interior Finish'));
    const cleanupItems = CalculationModules.Cleanup.calculateCleanupCost(poolSpecs, normalizedExcavation, tileCopingDecking);
    const fiberglassItems = CalculationModules.Fiberglass.calculateFiberglassCost(
      poolSpecs,
      appliedPapDiscounts?.fiberglassShell ?? 0
    );
    const fiberglassInstallItems = CalculationModules.Fiberglass.calculateFiberglassInstallCost(poolSpecs);
    const masonryCalc = CalculationModules.Masonry.calculateMasonryCost(poolSpecs, normalizedExcavation, {
      allowDistinctRbbBacksideFacing: isPpasEast,
    });
    const rockworkLabor = masonryCalc.labor.concat(tileCoping.labor.filter(i => i.category.includes('Rockwork')));
    const rockworkMaterial = masonryCalc.material.concat(tileCoping.material.filter(i => i.category.includes('Rockwork')));
    const masonryMaterialSubtotal = masonryCalc.material.reduce((sum, i) => sum + i.total, 0);
    if (masonryMaterialSubtotal > 0) {
      const taxRate = getPricingTaxRate(pricingData);
      rockworkMaterial.push({
        category: 'Stone & Rockwork Material',
        description: 'Stone & Rockwork Material Tax (Masonry)',
        unitPrice: taxRate,
        quantity: masonryMaterialSubtotal,
        total: masonryMaterialSubtotal * taxRate,
      });
    }

    // Startup & Orientation
    let startupItems = this.calculateStartupOrientation(poolSpecs, equipment);

    // Apply PAP Discounts if provided
    if (appliedPapDiscounts) {
      // Excavation (NOT for fiberglass)
      if (!isFiberglass && appliedPapDiscounts.excavation > 0) {
        const subtotal = excavationItems.reduce((sum, item) => sum + item.total, 0);
        excavationItems.push({
          category: 'Excavation',
          description: 'PAP Discount',
          unitPrice: -(subtotal * appliedPapDiscounts.excavation),
          quantity: 1,
          total: -(subtotal * appliedPapDiscounts.excavation),
        });
      }

      // Plumbing
      if (appliedPapDiscounts.plumbing > 0) {
        const subtotal = plumbingItems.reduce((sum, item) => sum + item.total, 0);
        plumbingItems.push({
          category: 'Plumbing',
          description: 'PAP Discount',
          unitPrice: -(subtotal * appliedPapDiscounts.plumbing),
          quantity: 1,
          total: -(subtotal * appliedPapDiscounts.plumbing),
        });
      }
      const fiberglassPlumbingMultiplier = Number((pricingData as any)?.plumbing?.fiberglassMultiplier ?? 1);
      if (isFiberglass && fiberglassPlumbingMultiplier >= 0 && fiberglassPlumbingMultiplier !== 1) {
        const subtotal = plumbingItems.reduce((sum, item) => sum + item.total, 0);
        const adjustment = roundCurrency(subtotal * (fiberglassPlumbingMultiplier - 1));
        if (adjustment !== 0) {
          plumbingItems.push({
            category: 'Plumbing',
            description: `Fiberglass Plumbing Multiplier (${Math.round(fiberglassPlumbingMultiplier * 100)}%)`,
            unitPrice: adjustment,
            quantity: 1,
            total: adjustment,
          });
        }
      }

      // Steel
      if (appliedPapDiscounts.steel > 0) {
        const subtotal = steelItems.reduce((sum, item) => sum + item.total, 0);
        steelItems.push({
          category: 'Steel',
          description: 'PAP Discount',
          unitPrice: -(subtotal * appliedPapDiscounts.steel),
          quantity: 1,
          total: -(subtotal * appliedPapDiscounts.steel),
        });
      }

      // Electrical
      if (appliedPapDiscounts.electrical > 0) {
        const subtotal = electricalItems.reduce((sum, item) => sum + item.total, 0);
        electricalItems.push({
          category: 'Electrical',
          description: 'PAP Discount',
          unitPrice: -(subtotal * appliedPapDiscounts.electrical),
          quantity: 1,
          total: -(subtotal * appliedPapDiscounts.electrical),
        });
      }

      // Shotcrete (combined labor + material)
      if (appliedPapDiscounts.shotcrete > 0) {
        const laborSubtotal = shotcrete.labor.reduce((sum, i) => sum + i.total, 0);
        const materialSubtotal = shotcrete.material.reduce((sum, i) => sum + i.total, 0);
        const combinedSubtotal = laborSubtotal + materialSubtotal;
        shotcrete.labor.push({
          category: 'Shotcrete Labor',
          description: 'PAP Discount',
          unitPrice: -(combinedSubtotal * appliedPapDiscounts.shotcrete),
          quantity: 1,
          total: -(combinedSubtotal * appliedPapDiscounts.shotcrete),
        });
      }

      // Tile/Coping Labor
      if (appliedPapDiscounts.tileCopingLabor > 0) {
        const laborSubtotal = tileCoping.labor.reduce(
          (sum, item) => sum + (isOffContractLineItem(item) ? 0 : item.total),
          0
        );
        tileCoping.labor.push({
          category: 'Tile & Coping Labor',
          description: 'PAP Discount',
          unitPrice: -(laborSubtotal * appliedPapDiscounts.tileCopingLabor),
          quantity: 1,
          total: -(laborSubtotal * appliedPapDiscounts.tileCopingLabor),
        });
      }

      // Tile/Coping Material (ONLY on flagstone)
      if (appliedPapDiscounts.tileCopingMaterial > 0) {
        let flagstoneMaterialTotal = 0;
        tileCoping.material.forEach((item) => {
          if (item.description.toLowerCase().includes('flagstone') ||
              (tileCopingDecking.copingType === 'flagstone' && item.category === 'Coping Material')) {
            flagstoneMaterialTotal += item.total;
          }
        });
        if (flagstoneMaterialTotal > 0) {
          tileCoping.material.push({
            category: 'Tile & Coping Material',
            description: 'PAP Discount',
            unitPrice: -(flagstoneMaterialTotal * appliedPapDiscounts.tileCopingMaterial),
            quantity: 1,
            total: -(flagstoneMaterialTotal * appliedPapDiscounts.tileCopingMaterial),
          });
        }
      }

      // Equipment
      if (appliedPapDiscounts.equipment > 0) {
        const subtotalBeforeTax = equipmentItems
          .filter(item => !item.description.includes('Tax'))
          .reduce((sum, i) => sum + i.total, 0);
        if (subtotalBeforeTax > 0) {
          const discountAmount = subtotalBeforeTax * appliedPapDiscounts.equipment;
          // Insert before tax
          const taxIndex = equipmentItems.findIndex(item => item.description.includes('Tax'));
          const discountItem: CostLineItem = {
            category: 'Equipment',
            description: 'PAP Discount',
            unitPrice: -discountAmount,
            quantity: 1,
            total: -discountAmount,
          };
          if (taxIndex >= 0) {
            equipmentItems.splice(taxIndex, 0, discountItem);
            const taxRate = getPricingTaxRate(pricingData);
            const taxableBase = subtotalBeforeTax - discountAmount;
            equipmentItems[taxIndex + 1] = {
              ...equipmentItems[taxIndex + 1],
              unitPrice: taxRate,
              quantity: taxableBase,
              total: taxableBase * taxRate,
            };
          } else {
            equipmentItems.push(discountItem);
            const taxRate = getPricingTaxRate(pricingData);
            equipmentItems.push({
              category: 'Equipment',
              description: 'Equipment Tax',
              unitPrice: taxRate,
              quantity: subtotalBeforeTax - discountAmount,
              total: (subtotalBeforeTax - discountAmount) * taxRate,
            });
          }
        }
      }

      // Interior Finish
      if (appliedPapDiscounts.interiorFinish > 0) {
        const laborSubtotal = interior.labor.reduce((sum, item) => sum + item.total, 0);
        interior.labor.push({
          category: 'Interior Finish',
          description: 'PAP Discount',
          unitPrice: -(laborSubtotal * appliedPapDiscounts.interiorFinish),
          quantity: 1,
          total: -(laborSubtotal * appliedPapDiscounts.interiorFinish),
        });
      }

      // Startup
      if (appliedPapDiscounts.startup > 0) {
        const subtotal = startupItems.reduce((sum, item) => sum + item.total, 0);
        startupItems.push({
          category: 'Start-Up / Orientation',
          description: 'PAP Discount',
          unitPrice: -(subtotal * appliedPapDiscounts.startup),
          quantity: 1,
          total: -(subtotal * appliedPapDiscounts.startup),
        });
      }
    }

    // Custom Features (convert to line items)
    const customFeaturesItems: CostLineItem[] = buildCustomFeatureItems(customFeatures);
    const automaticCoverCost = poolSpecs.hasAutomaticCover
      ? Number(poolSpecs.automaticCoverManufacturerCost) || 0
      : 0;
    const automaticCoverRetail = automaticCoverCost > 0
      ? Math.round(automaticCoverCost * 1.7 * 100) / 100
      : 0;
    const offContractTotal = getOffContractTotal(proposal, [
      ...tileCoping.labor,
      ...tileCoping.material,
    ]);
    if (automaticCoverCost > 0) {
      customFeaturesItems.push({
        category: 'Custom Features',
        description: 'Automatic Cover',
        unitPrice: automaticCoverCost,
        quantity: 1,
        total: automaticCoverCost,
        details: {
          manufacturerCost: automaticCoverCost,
          retailOverride: automaticCoverRetail,
        },
      });
    }
    const customFeaturesAdjustmentTotal = customFeaturesItems.reduce(
      (sum, item) => (item.total < 0 ? sum + item.total : sum),
      0
    );

    // Calculate totals
    const totals = {
      plansAndEngineering: this.sumItems(plansItems),
      layout: this.sumItems(layoutItems),
      permit: this.sumItems(permitItems),
      excavation: this.sumItems(excavationItems),
      plumbing: this.sumItems(plumbingItems),
      gas: this.sumItems(gasItems),
      steel: this.sumItems(steelItems),
      electrical: this.sumItems(electricalItems),
      shotcreteLabor: this.sumItems(shotcrete.labor),
      shotcreteMaterial: this.sumItems(shotcrete.material),
      tileLabor: this.sumItems(tileLaborOnly),
      tileMaterial: this.sumItems(tileMaterialOnly),
      copingDeckingLabor: this.sumItems(tileCoping.labor.filter(i => i.category.includes('Coping') || i.category.includes('Decking'))),
      copingDeckingMaterial: this.sumItems(tileCoping.material.filter(i => i.category.includes('Coping') || i.category.includes('Decking') || i.category.includes('Tax'))),
      stoneRockworkLabor: this.sumItems(rockworkLabor),
      stoneRockworkMaterial: this.sumItems(rockworkMaterial),
      drainage: this.sumItems(drainageItems),
      equipmentOrdered: this.sumItems(equipmentItems),
      equipmentSet: this.sumItems(equipmentSetItemsWithCustomOptions),
      waterFeatures: this.sumItems(waterFeaturesCustomOptions),
      cleanup: this.sumItems(cleanupItems),
      interiorFinish: this.sumItems(interiorFinishItems),
      waterTruck: this.sumItems(interior.waterTruck),
      fiberglassShell: this.sumItems(fiberglassItems),
      fiberglassInstall: this.sumItems(fiberglassInstallItems),
      startupOrientation: this.sumItems(startupItems),
      customFeatures: this.sumItems(customFeaturesItems),
      grandTotal: 0,
    };

    // Calculate grand total
    totals.grandTotal = Object.values(totals).reduce((sum, val) => sum + val, 0);

    const costBreakdown: CostBreakdown = {
      plansAndEngineering: plansItems,
      layout: layoutItems,
      permit: permitItems,
      excavation: excavationItems,
      plumbing: plumbingItems,
      gas: gasItems,
      steel: steelItems,
      electrical: electricalItems,
      shotcreteLabor: shotcrete.labor,
      shotcreteMaterial: shotcrete.material,
      tileLabor: tileLaborOnly,
      tileMaterial: tileMaterialOnly,
      copingDeckingLabor: tileCoping.labor.filter(i => i.category.includes('Coping') || i.category.includes('Decking')),
      copingDeckingMaterial: tileCoping.material.filter(i => i.category.includes('Coping') || i.category.includes('Decking') || i.category.includes('Tax')),
      stoneRockworkLabor: rockworkLabor,
      stoneRockworkMaterial: rockworkMaterial,
      drainage: drainageItems,
      equipmentOrdered: equipmentItems,
      equipmentSet: equipmentSetItemsWithCustomOptions,
      waterFeatures: waterFeaturesCustomOptions,
      cleanup: cleanupItems,
      interiorFinish: interiorFinishItems,
      waterTruck: interior.waterTruck,
      fiberglassShell: fiberglassItems,
      fiberglassInstall: fiberglassInstallItems,
      startupOrientation: startupItems,
      customFeatures: customFeaturesItems,
      totals,
    };

    // ============================================================================
    // PRICING CALCULATIONS (Matching Excel)
    // ============================================================================

    // Get configuration values (these should come from proposal or defaults)
    const overheadMultiplier = proposal.pricing?.overheadMultiplier ?? 1.01; // 1% overhead
    const targetMargin =
      (pricingData as any).pricingDefaults?.targetMargin ??
      proposal.pricing?.targetMargin ??
      0.7; // Excel target margin (COGS ~70% of retail)
    const discountAmount = proposal.pricing?.discountAmount ?? 0; // Manual discount
    const digCommissionRate = proposal.pricing?.digCommissionRate ?? DEFAULT_DIG_COMMISSION_RATE;
    const adminFeeRate = proposal.pricing?.adminFeeRate ?? 0.029; // 2.9%
    const closeoutCommissionRate =
      proposal.pricing?.closeoutCommissionRate ?? DEFAULT_CLOSEOUT_COMMISSION_RATE;
    const manualAdjustments = proposal.manualAdjustments || (pricingData as any).manualAdjustments || {
      positive1: 0,
      positive2: 0,
      negative1: 0,
      negative2: 0,
    };
    const retailAdjustments = proposal.retailAdjustments || [];
    const retailAdjustmentsTotal = retailAdjustments.reduce(
      (sum, adjustment) => sum + (Number(adjustment?.amount) || 0),
      0
    );
    const manualAdjustmentsTotal =
      (manualAdjustments.positive1 ?? 0) +
      (manualAdjustments.positive2 ?? 0) -
      (manualAdjustments.negative1 ?? 0) -
      (manualAdjustments.negative2 ?? 0);
    const autoCoverRetailAdjustment =
      automaticCoverCost > 0 && targetMargin > 0
        ? Math.round((automaticCoverRetail - (automaticCoverCost / targetMargin)) * 100) / 100
        : 0;
    const designerAdjustmentsTotal =
      manualAdjustmentsTotal +
      customFeaturesAdjustmentTotal +
      autoCoverRetailAdjustment +
      retailAdjustmentsTotal +
      offContractTotal;

    // Excel adds a baked-in $1,250 kicker to retail (not shown separately in the UI)
    const g3UpgradeCost = 0;

    // Step 1: Total costs before overhead
    // Negative custom features are retail-only adjustments (do not reduce COGS).
    const totalCostsBeforeOverhead = totals.grandTotal - customFeaturesAdjustmentTotal;

    // Step 2: Apply overhead multiplier
    const totalCOGS = totalCostsBeforeOverhead * overheadMultiplier;

    // Step 3: Calculate base retail price using a single target margin (matches COST - NEW!C181)
    const baseRetailPrice = Math.ceil((totalCOGS / targetMargin) / 10) * 10;

    // Step 4: Add G3 upgrade and discount
    const retailPrice = baseRetailPrice + g3UpgradeCost + discountAmount + designerAdjustmentsTotal;
    const retailPriceExcludingOffContract = Math.max(0, retailPrice - offContractTotal);

    // Step 5: Calculate commissions and fees
    const digCommission = retailPriceExcludingOffContract * digCommissionRate;
    const adminFee = retailPriceExcludingOffContract * adminFeeRate;
    const closeoutCommission = retailPriceExcludingOffContract * closeoutCommissionRate;

    // Step 6: Calculate gross profit
    const grossProfit = retailPriceExcludingOffContract - totalCOGS - digCommission - adminFee - closeoutCommission;
    const grossProfitMargin =
      retailPriceExcludingOffContract > 0 ? (grossProfit / retailPriceExcludingOffContract) * 100 : 0;

    const pricing: import('../types/proposal-new').PricingCalculations = {
      totalCostsBeforeOverhead,
      overheadMultiplier,
      totalCOGS,
      offContractTotal,
      targetMargin,
      baseRetailPrice,
      g3UpgradeCost,
      discountAmount,
      retailPrice,
      digCommissionRate,
      digCommission,
      adminFeeRate,
      adminFee,
      closeoutCommissionRate,
      closeoutCommission,
      grossProfit,
      grossProfitMargin,
      manualAdjustmentsTotal: designerAdjustmentsTotal,
      retailAdjustmentsTotal,
    };

    return {
      costBreakdown,
      pricing,
      subtotal: totals.grandTotal,
      taxRate: getPricingTaxRate(pricingData),
      taxAmount: 0,
      totalCost: retailPrice, // Return retail price, not just costs
    };
  }

  private static calculatePlansEngineering(poolSpecs: any, excavation: any, waterFeatures: any): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.plans;
    const catalog = flattenWaterFeatures(pricingData.waterFeatures);
    const featureLookup = new Map(catalog.map((entry) => [entry.id, entry]));

    if (!hasPoolDefinition(poolSpecs)) {
      return items;
    }

    items.push({
      category: 'Plans & Engineering',
      description: 'Pool Only',
      unitPrice: prices.poolOnly,
      quantity: 1,
      total: prices.poolOnly,
    });

    if (CalculationModules.Pool.hasSpa(poolSpecs)) {
      items.push({
        category: 'Plans & Engineering',
        description: 'Spa',
        unitPrice: prices.spa,
        quantity: 1,
        total: prices.spa,
      });
    }

    // Waterfall cost from water features or explicit count
    const explicitWaterfalls =
      (poolSpecs as any).waterfallCount ?? (waterFeatures as any)?.waterfallCount ?? 0;
    const waterfallCount =
      explicitWaterfalls > 0
        ? explicitWaterfalls
        : (waterFeatures?.selections || [])
            .filter((sel: any) => {
              const feature =
                featureLookup.get(sel.featureId) || catalog.find((f: any) => f.name === sel.featureId);
              return feature?.name?.toLowerCase().includes('waterfall');
            })
            .reduce((sum: number, sel: any) => sum + (sel.quantity || 0), 0);

    if (waterfallCount > 0) {
      items.push({
        category: 'Plans & Engineering',
        description: 'Waterfall',
        unitPrice: prices.waterfall,
        quantity: waterfallCount,
        total: prices.waterfall * waterfallCount,
      });
    }

    // Water features (non-waterfall) counted directly from selections
    const waterFeatureCount = (waterFeatures?.selections || []).reduce((sum: number, sel: any) => {
      const feature =
        featureLookup.get(sel.featureId) || catalog.find((f: any) => f.name === sel.featureId);
      const isWaterfall =
        feature?.name?.toLowerCase().includes('waterfall') ||
        feature?.category?.toLowerCase().includes('waterfall');
      if (isWaterfall) return sum;
      return sum + (sel?.quantity ?? 0);
    }, 0);

    if (waterFeatureCount > 0) {
      items.push({
        category: 'Plans & Engineering',
        description: 'Water Features',
        unitPrice: prices.waterFeature,
        quantity: waterFeatureCount,
        total: prices.waterFeature * waterFeatureCount,
      });
    }

    if (excavation?.needsSoilSampleEngineer) {
      items.push({
        category: 'Plans & Engineering',
        description: 'Soil Sample / Engineer',
        unitPrice: prices.soilSampleEngineer,
        quantity: 1,
        total: prices.soilSampleEngineer,
      });
    }

    return items;
  }

  private static calculateLayout(poolSpecs: any): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.misc.layout;

    if (!hasPoolDefinition(poolSpecs)) {
      return items;
    }

    items.push({
      category: 'Layout',
      description: 'Pool Only',
      unitPrice: prices.poolOnly,
      quantity: 1,
      total: prices.poolOnly,
    });

    if (CalculationModules.Pool.hasSpa(poolSpecs)) {
      items.push({
        category: 'Layout',
        description: 'Spa',
        unitPrice: prices.spa,
        quantity: 1,
        total: prices.spa,
      });
    }

    if (poolSpecs.hasSiltFence) {
      items.push({
        category: 'Layout',
        description: 'Silt Fencing',
        unitPrice: prices.siltFencing,
        quantity: 1,
        total: prices.siltFencing,
      });
    }

    return items;
  }

  private static calculatePermit(poolSpecs: any): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.misc.permit;

    if (!hasPoolDefinition(poolSpecs)) {
      return items;
    }

    items.push({
      category: 'Permit',
      description: 'Pool Only',
      unitPrice: prices.poolOnly,
      quantity: 1,
      total: prices.poolOnly,
    });

    if (CalculationModules.Pool.hasSpa(poolSpecs)) {
      items.push({
        category: 'Permit',
        description: 'Spa',
        unitPrice: prices.spa,
        quantity: 1,
        total: prices.spa,
      });
    }

    items.push({
      category: 'Permit',
      description: 'Permit Runner',
      unitPrice: prices.permitRunner,
      quantity: 1,
      total: prices.permitRunner,
    });

    return items;
  }

  private static calculateStartupOrientation(poolSpecs: any, equipment: any): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.misc.startup;

    if (!hasPoolDefinition(poolSpecs)) {
      return items;
    }

    // Base startup & 30-day service
    items.push({
      category: 'Start-Up / Orientation',
      description: 'Start-Up & 30 Days',
      unitPrice: prices.base,
      quantity: 1,
      total: prices.base,
    });

    const warrantyCost = isBronzePricingTier((pricingData as any).pricingTierId)
      ? 0
      : prices.fiveYearWarranty ?? prices.premium ?? 0;
    if (warrantyCost > 0) {
      items.push({
        category: 'Start-Up / Orientation',
        description: '5 Year Warranty',
        unitPrice: warrantyCost,
        quantity: 1,
        total: warrantyCost,
      });
    }

    // Add automation fee if automation is present (mirrors MISC!Add Automation tied to NEW POOL!B131)
    const automationQty = Math.max(equipment?.automationQuantity ?? 0, 0);
    const hasAutomation = automationQty > 0 && !!equipment?.automation;
    if (hasAutomation) {
      items.push({
        category: 'Start-Up / Orientation',
        description: 'Add Automation',
        unitPrice: prices.automationAdd,
        quantity: 1,
        total: prices.automationAdd,
      });
    }

    return items;
  }

  private static sumItems(items: CostLineItem[]): number {
    return items.reduce((sum, item) => sum + (isOffContractLineItem(item) ? 0 : item.total), 0);
  }

  /**
   * Auto-calculate pool specifications based on dimensions
   */
  static autoCalculatePoolSpecs(poolSpecs: any): any {
    const computedSurfaceArea =
      (poolSpecs.surfaceArea && poolSpecs.surfaceArea > 0)
        ? poolSpecs.surfaceArea
        : CalculationModules.Pool.calculateSurfaceAreaFromDimensions(poolSpecs);
    const computedPerimeter =
      (poolSpecs.perimeter && poolSpecs.perimeter > 0)
        ? poolSpecs.perimeter
        : (poolSpecs.maxLength && poolSpecs.maxWidth ? Math.ceil((poolSpecs.maxLength + poolSpecs.maxWidth) * 2) : 0);
    return {
      ...poolSpecs,
      surfaceArea: computedSurfaceArea,
      perimeter: computedPerimeter,
      approximateGallons: CalculationModules.Pool.calculateGallons(poolSpecs),
      spaPerimeter: CalculationModules.Pool.calculateSpaPerimeter(poolSpecs),
    };
  }

  /**
   * Auto-calculate excavation totals
   */
  static autoCalculateExcavation(excavation: any, poolSpecs: any): any {
    return {
      ...excavation,
      totalRBBSqft: ExcavationCalculations.calculateTotalRBBSqft(excavation),
      additionalBench: CalculationModules.Pool.calculateAdditionalBench(poolSpecs),
    };
  }
}

export default MasterPricingEngine;
