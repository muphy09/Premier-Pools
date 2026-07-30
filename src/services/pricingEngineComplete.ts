// ============================================================================
// COMPLETE PRICING ENGINE - Full Excel Formula Implementation
// ============================================================================

import { PoolSpecs, Excavation, TileCopingDecking, Drainage, Equipment, WaterFeatures, InteriorFinish, CostLineItem } from '../types/proposal-new';
import pricingData from './pricingData';
import { getPricingTaxRate } from './taxRate';
import { isBronzePricingTier } from './pricingTiers';
import { getEquipmentItemCost } from '../utils/equipmentCost';
import { getLightCounts, normalizeEquipmentLighting } from '../utils/lighting';
import {
  getPackageTotal,
  getSelectedEquipmentPackage,
  isCustomEquipmentPackage,
  isFixedEquipmentPackage,
} from '../utils/equipmentPackages';
import { getAdditionalPumpSelections, getBasePumpQuantity } from '../utils/pumpSelections';
import {
  formatMasonryFacingLabel,
  getMasonryFacingOptions,
  getMasonryFacingRate,
  normalizeMasonryFacingId,
} from '../utils/masonryFacing';
import {
  getAdditionalDeckingOption,
  getAdditionalDeckingSelections,
  getDeckingTypeFullLabel,
  getResolvedPrimaryDeckingArea,
} from '../utils/decking';
import {
  getBullnoseSpillwayOptionById,
  getCopingOptionById,
  getDeckingOptionById,
  getTileOptionById,
  getTileSelectionId,
  getTrimTileOptionById,
  getTrimTileSelectionId,
  isLegacyTrimTileSelection,
} from '../utils/tileCopingCatalogs';
import {
  annotateOffContractLineItem,
  isOffContractEligibleLineItem,
  OFF_CONTRACT_GROUP_DECKING,
} from '../utils/offContractLineItems';
import {
  fiberglassSpaOptionSupportsSpillover,
  findFiberglassNamedOption,
  findFiberglassPoolModel,
  getFiberglassSpaSpilloverSelectedPrice,
} from '../utils/fiberglass';
import { flattenWaterFeatures, getWaterFeatureCogs } from '../utils/waterFeatureCost';

const hasPoolDefinition = (poolSpecs: PoolSpecs): boolean => {
  const hasGuniteDimensions =
    poolSpecs.surfaceArea > 0 ||
    poolSpecs.perimeter > 0 ||
    (poolSpecs.maxLength > 0 && poolSpecs.maxWidth > 0);
  const hasFiberglassSelection =
    poolSpecs.poolType === 'fiberglass' && (!!poolSpecs.fiberglassSize || !!poolSpecs.fiberglassModelName);
  return hasGuniteDimensions || hasFiberglassSelection;
};

/**
 * Excel-style CEILING that guards against floating point noise (e.g., 440.00000000000006 -> 440 instead of 450).
 */
const ceilToStep = (value: number, step: number): number => {
  if (step === 0) return value;
  const adjusted = Math.ceil(value / step - 1e-9) * step;
  return adjusted === 0 ? 0 : adjusted;
};

const roundCurrency = (value: number): number => Math.round(value * 100) / 100;

const getFiberglassModelDiscountRate = (discountPercent?: number): number => {
  const parsed = Number(discountPercent);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, 100) / 100;
};

const getDiscountedFiberglassShellPrice = (shellPrice?: number, discountPercent?: number): number => {
  const baseShellPrice = Number(shellPrice);
  if (!Number.isFinite(baseShellPrice) || baseShellPrice <= 0) {
    return 0;
  }
  const discountRate = getFiberglassModelDiscountRate(discountPercent);
  return roundCurrency(baseShellPrice * (1 - discountRate));
};

type DeckingSource = 'primary' | 'additional';

const getDeckingSource = (item?: CostLineItem | null): DeckingSource =>
  String(item?.details?.deckingSource || 'primary') === 'additional' ? 'additional' : 'primary';

const getDeckingSelectionKey = (item?: CostLineItem | null): string =>
  String(item?.details?.deckingSelectionKey || '').trim();

// ============================================================================
// HELPER CALCULATIONS
// ============================================================================

export class PoolCalculations {
  static calculateGallons(poolSpecs: PoolSpecs): number {
    const avgDepth = (poolSpecs.shallowDepth + poolSpecs.endDepth) / 2;
    const baseGallons = poolSpecs.surfaceArea * avgDepth * 7.6;
    const tanningShelfDeduction = poolSpecs.hasTanningShelf ? 850 : 0;
    const gallons = ceilToStep(baseGallons, 10) - tanningShelfDeduction;
    return Math.max(0, gallons);
  }

  static calculateSpaPerimeter(poolSpecs: PoolSpecs): number {
    if (poolSpecs.spaType === 'none' || poolSpecs.spaType === 'fiberglass') return 0;

    if (poolSpecs.spaShape === 'round') {
      return Math.ceil(poolSpecs.spaLength * 3.14);
    } else {
      return Math.ceil(poolSpecs.spaLength * 2 + poolSpecs.spaWidth * 2);
    }
  }

  static calculateAdditionalBench(poolSpecs: PoolSpecs): number {
    return poolSpecs.totalStepsAndBench > 20 ? poolSpecs.totalStepsAndBench - 20 : 0;
  }

  static isFiberglassPool(poolSpecs: PoolSpecs): boolean {
    return poolSpecs.poolType === 'fiberglass';
  }

  static hasSpa(poolSpecs: PoolSpecs): boolean {
    return poolSpecs.spaType !== 'none';
  }

  static calculateSurfaceAreaFromDimensions(poolSpecs: PoolSpecs): number {
    // For rectangular pools: length * width
    // For other shapes, this could be more complex
    return poolSpecs.maxLength * poolSpecs.maxWidth;
  }
}

// ============================================================================
// TILE, COPING, DECKING CALCULATIONS
// ============================================================================

export class TileCopingDeckingCalculations {
  static calculateCosts(
    poolSpecs: PoolSpecs,
    tileCopingDecking: TileCopingDecking
  ): { labor: CostLineItem[]; material: CostLineItem[] } {
    const laborItems: CostLineItem[] = [];
    const materialItems: CostLineItem[] = [];
    const prices = pricingData.tileCoping;
    const tileSelectionId = getTileSelectionId(tileCopingDecking);
    const tileOption = getTileOptionById(prices, tileSelectionId);
    const trimTileSelectionId = getTrimTileSelectionId(tileCopingDecking);
    const trimTileOption = getTrimTileOptionById(prices, trimTileSelectionId);
    const legacyTrimTileSelection = isLegacyTrimTileSelection(tileCopingDecking);
    const copingOption = getCopingOptionById(prices, tileCopingDecking.copingType);
    const deckingOption = getDeckingOptionById(prices, tileCopingDecking.deckingType);
    const bullnoseOption = getBullnoseSpillwayOptionById(prices, 'bullnose');
    const spillwayOption = getBullnoseSpillwayOptionById(prices, 'spillway');
    const isFiberglass = PoolCalculations.isFiberglassPool(poolSpecs);
    const primaryDeckingSelectionLabel = deckingOption?.name || getDeckingTypeFullLabel(tileCopingDecking.deckingType);
    const isPrimaryDeckingOffContract = Boolean(tileCopingDecking.isDeckingOffContract);
    const additionalDeckingSelections = getAdditionalDeckingSelections(tileCopingDecking).map((selection, index) => {
      const additionalDeckingOption = getAdditionalDeckingOption(selection.deckingType);
      const selectionLabel = additionalDeckingOption?.label ||
        (selection.deckingType ? getDeckingTypeFullLabel(selection.deckingType) : '');
      const area = Math.max(0, selection.area ?? 0);
      const wasteMultiplier =
        selection.deckingType === 'concrete' || additionalDeckingOption?.wasteNotIncluded ? 1 : 1.05;

      return {
        key: `additional-${index}`,
        deckingType: selection.deckingType,
        option: additionalDeckingOption,
        selectionLabel,
        area,
        quantity: area * wasteMultiplier,
        isOffContract: Boolean(selection.isOffContract),
        wasteNotIncluded: Boolean(additionalDeckingOption?.wasteNotIncluded),
      };
    });
    const tagDeckingItem = (
      item: CostLineItem,
      options: {
        source: DeckingSource;
        selectionKey: string;
        selectionLabel: string;
        applied: boolean;
      }
    ): CostLineItem =>
      annotateOffContractLineItem(item, {
        group: OFF_CONTRACT_GROUP_DECKING,
        selectionLabel: options.selectionLabel,
        applied: options.applied,
        details: {
          deckingSource: options.source,
          deckingSelectionKey: options.selectionKey,
        },
      });
    const tagPrimaryDeckingItem = (item: CostLineItem): CostLineItem =>
      tagDeckingItem(item, {
        source: 'primary',
        selectionKey: 'primary',
        selectionLabel: primaryDeckingSelectionLabel,
        applied: isPrimaryDeckingOffContract,
      });
    const tagAdditionalDeckingItem = (
      item: CostLineItem,
      selection: (typeof additionalDeckingSelections)[number]
    ): CostLineItem =>
      tagDeckingItem(item, {
        source: 'additional',
        selectionKey: selection.key,
        selectionLabel: selection.selectionLabel,
        applied: selection.isOffContract,
      });
    const formatAdditionalDeckingLabel = (selectionLabel: string, suffix: string) =>
      `Additional Decking - ${selectionLabel}${suffix ? ` - ${suffix}` : ''}`;
    const perimeterWithExtras = poolSpecs.perimeter + tileCopingDecking.additionalTileLength;
    const spaPerimeter = poolSpecs.spaPerimeter || PoolCalculations.calculateSpaPerimeter(poolSpecs);
    const copingLnft =
      tileCopingDecking.copingLength ||
      Math.ceil(poolSpecs.perimeter * 1.1 + spaPerimeter * 2.15);
    const isConcreteDeck = deckingOption?.id === 'concrete';
    const hasTile = !isFiberglass && Boolean(tileOption);
    const standardDeckingWasteMultiplier = isConcreteDeck ? 1 : 1.05;
    const concreteBandAreaRaw = isConcreteDeck ? poolSpecs.perimeter * 4 : 0;
    const concreteBaseQty = isConcreteDeck && concreteBandAreaRaw > 0 ? ceilToStep(concreteBandAreaRaw, 10) : 0;
    const primaryDeckingArea = getResolvedPrimaryDeckingArea(tileCopingDecking, poolSpecs.deckingArea);
    // Excel (TILE COPING!J35/J42) lets the addl qty go negative when the 4' band exceeds the entered deck area.
    // Mirror that CEILING behavior instead of clamping to zero so we remove overcounted sqft.
    const concreteAddlQtyRaw = isConcreteDeck ? primaryDeckingArea - concreteBandAreaRaw : 0;
    const concreteAddlQty =
      isConcreteDeck ? ceilToStep(concreteAddlQtyRaw, 10) : 0;
    const deckingArea = isConcreteDeck
      ? concreteBaseQty + concreteAddlQty
      : primaryDeckingArea * standardDeckingWasteMultiplier;

    // TILE LABOR
    if (hasTile && tileOption) {
      laborItems.push({
        category: 'Tile Labor',
        description: `${tileOption.name} Tile Labor`,
        unitPrice: tileOption.laborRate,
        quantity: perimeterWithExtras,
        total: tileOption.laborRate * perimeterWithExtras,
      });

      // Spa tile labor
      if (spaPerimeter > 0) {
        laborItems.push({
          category: 'Tile Labor',
          description: `${tileOption.name} Tile Labor - Spa`,
          unitPrice: tileOption.laborRate,
          quantity: spaPerimeter,
          total: tileOption.laborRate * spaPerimeter,
        });
      }

      // Step trim tile
      if (trimTileOption && poolSpecs.totalStepsAndBench > 0) {
        const trimTileQty = spaPerimeter + poolSpecs.totalStepsAndBench;
        laborItems.push({
          category: 'Tile Labor',
          description: legacyTrimTileSelection ? 'Step Trim Tile' : `${trimTileOption.name} Labor`,
          unitPrice: trimTileOption.laborRate,
          quantity: trimTileQty,
          total: trimTileOption.laborRate * trimTileQty,
        });
      }
    }

    // TILE MATERIAL
    if (hasTile && tileOption) {
      materialItems.push({
        category: 'Tile Material',
        description: `${tileOption.name} Tile`,
        unitPrice: tileOption.materialRate,
        quantity: perimeterWithExtras,
        total: tileOption.materialRate * perimeterWithExtras,
      });
      if (spaPerimeter > 0) {
        materialItems.push({
          category: 'Tile Material',
          description: `${tileOption.name} Tile - Spa`,
          unitPrice: tileOption.materialRate,
          quantity: spaPerimeter,
          total: tileOption.materialRate * spaPerimeter,
        });
      }
    }

    if (hasTile && trimTileOption && poolSpecs.totalStepsAndBench > 0) {
      const trimTileQty = spaPerimeter + poolSpecs.totalStepsAndBench;
      materialItems.push({
        category: 'Tile Material',
        description: legacyTrimTileSelection
          ? 'Step Trim Tile Material'
          : `${trimTileOption.name} Material`,
        unitPrice: trimTileOption.materialRate,
        quantity: trimTileQty,
        total: trimTileOption.materialRate * trimTileQty,
      });
    }

    // COPING LABOR & MATERIAL
    if (copingOption?.laborRate) {
      laborItems.push({
        category: 'Coping Labor',
        description: `${copingOption.name} Coping`,
        unitPrice: copingOption.laborRate,
        quantity: copingLnft,
        total: copingOption.laborRate * copingLnft,
      });
    }

    if (copingOption?.materialRate) {
      const copingMaterialQty = copingOption.id === 'flagstone'
        ? copingLnft * prices.flagstoneQuantityMultiplier
        : copingLnft;
      materialItems.push({
        category: 'Coping Material',
        description: `${copingOption.name} Coping Material`,
        unitPrice: copingOption.materialRate,
        quantity: copingMaterialQty,
        total: copingOption.materialRate * copingMaterialQty,
      });
    }

    // DECKING LABOR
    const deckingLaborRate = deckingOption?.laborRate ?? 0;
    if (isConcreteDeck && deckingOption) {
      // Excel only charges concrete deck labor when concrete coping (cantilever) is selected, per perimeter
      if (tileCopingDecking.copingType === 'concrete' && deckingLaborRate > 0) {
        laborItems.push(tagPrimaryDeckingItem({
          category: 'Decking Labor',
          description: `${deckingOption.name} Decking - Cantilever`,
          unitPrice: deckingLaborRate,
          quantity: poolSpecs.perimeter,
          total: deckingLaborRate * poolSpecs.perimeter,
        }));
      }
    } else if (deckingOption && deckingLaborRate > 0) {
      laborItems.push(tagPrimaryDeckingItem({
        category: 'Decking Labor',
        description: `${deckingOption.name} Decking Labor`,
        unitPrice: deckingLaborRate,
        quantity: deckingArea,
        total: deckingLaborRate * deckingArea,
      }));
    }

    // Concrete steps
    if (tileCopingDecking.concreteStepsLength > 0) {
      const concreteStepsLaborItem: CostLineItem = {
        category: 'Decking Labor',
        description: 'Concrete Steps',
        unitPrice: prices.decking.labor.concreteSteps,
        quantity: tileCopingDecking.concreteStepsLength,
        total: prices.decking.labor.concreteSteps * tileCopingDecking.concreteStepsLength,
      };
      laborItems.push(isConcreteDeck ? tagPrimaryDeckingItem(concreteStepsLaborItem) : concreteStepsLaborItem);
    }

    // DECKING MATERIAL
    const deckingMaterialRate = deckingOption?.materialRate ?? 0;
    if (isConcreteDeck && deckingOption && deckingMaterialRate > 0) {
      if (concreteBaseQty > 0) {
        materialItems.push(tagPrimaryDeckingItem({
          category: 'Decking Material',
          description: `${deckingOption.name} Decking - Base`,
          unitPrice: deckingMaterialRate,
          quantity: concreteBaseQty,
          total: deckingMaterialRate * concreteBaseQty,
        }));
      }
      if (concreteAddlQty !== 0) {
        materialItems.push(tagPrimaryDeckingItem({
          category: 'Decking Material',
          description: `${deckingOption.name} Decking - Addl`,
          unitPrice: deckingMaterialRate,
          quantity: concreteAddlQty,
          total: deckingMaterialRate * concreteAddlQty,
        }));
      }
    } else if (deckingOption && deckingMaterialRate > 0) {
      materialItems.push(tagPrimaryDeckingItem({
        category: 'Decking Material',
        description: `${deckingOption.name} Decking Material`,
        unitPrice: deckingMaterialRate,
        quantity: deckingArea,
        total: deckingMaterialRate * deckingArea,
      }));
    }

    additionalDeckingSelections.forEach((selection) => {
      if (!selection.option || !selection.selectionLabel || selection.area <= 0) {
        return;
      }

      if (selection.option.laborRate > 0) {
        laborItems.push(tagAdditionalDeckingItem({
          category: 'Decking Labor',
          description: formatAdditionalDeckingLabel(selection.selectionLabel, 'Labor'),
          unitPrice: selection.option.laborRate,
          quantity: selection.quantity,
          total: selection.option.laborRate * selection.quantity,
        }, selection));
      }

      if (selection.option.materialRate > 0) {
        materialItems.push(tagAdditionalDeckingItem({
          category: 'Decking Material',
          description: formatAdditionalDeckingLabel(selection.selectionLabel, 'Material'),
          unitPrice: selection.option.materialRate,
          quantity: selection.quantity,
          total: selection.option.materialRate * selection.quantity,
        }, selection));
      }
    });

    // Concrete steps material
    if (tileCopingDecking.concreteStepsLength > 0) {
      const concreteStepsMaterialItem: CostLineItem = {
        category: 'Decking Material',
        description: 'Concrete Steps Material',
        unitPrice: prices.decking.material.concreteSteps,
        quantity: tileCopingDecking.concreteStepsLength,
        total: prices.decking.material.concreteSteps * tileCopingDecking.concreteStepsLength,
      };
      materialItems.push(isConcreteDeck ? tagPrimaryDeckingItem(concreteStepsMaterialItem) : concreteStepsMaterialItem);
    }

    // Bullnose (single + double bullnose share the same Excel rate/lines)
    const bullnoseLnft = (tileCopingDecking.bullnoseLnft ?? 0) + (tileCopingDecking.doubleBullnoseLnft ?? 0);
    if (bullnoseLnft > 0) {
      laborItems.push({
        category: 'Stone & Rockwork Labor',
        description: 'Bullnose',
        unitPrice: bullnoseOption?.laborRate ?? 0,
        quantity: bullnoseLnft,
        total: (bullnoseOption?.laborRate ?? 0) * bullnoseLnft,
      });
      materialItems.push({
        category: 'Stone & Rockwork Material',
        description: 'Bullnose Material',
        unitPrice: bullnoseOption?.materialRate ?? 0,
        quantity: bullnoseLnft,
        total: (bullnoseOption?.materialRate ?? 0) * bullnoseLnft,
      });
    }

    // Spillway (labor/material)
    if (tileCopingDecking.spillwayLnft && tileCopingDecking.spillwayLnft > 0) {
      laborItems.push({
        category: 'Coping Labor',
        description: 'Spillway Labor',
        unitPrice: spillwayOption?.laborRate ?? 0,
        quantity: 1,
        total: spillwayOption?.laborRate ?? 0,
      });
      materialItems.push({
        category: 'Coping Material',
        description: 'Spillway Material',
        unitPrice: spillwayOption?.materialRate ?? 0,
        quantity: 1,
        total: spillwayOption?.materialRate ?? 0,
      });
    }

    const copingSize = tileCopingDecking.copingSize ?? '12x12';
    const copingSizeAdjustments: Record<
      string,
      {
        label: string;
        laborRate?: number;
        materialRate?: number;
        showLaborLine?: boolean;
        showMaterialLine?: boolean;
      }
    > = {
      '16x16': { label: '16x16 coping', materialRate: 0.33, showMaterialLine: true },
      '12x24': { label: '12x24', laborRate: 0, materialRate: 0, showLaborLine: true, showMaterialLine: true },
    };
    const copingSizeAdjustment = copingSizeAdjustments[copingSize];
    if (copingSizeAdjustment) {
      const laborSubtotal = laborItems
        .filter(item => item.category === 'Coping Labor')
        .reduce((sum, item) => sum + item.total, 0);
      const materialSubtotal = materialItems
        .filter(item => item.category === 'Coping Material')
        .reduce((sum, item) => sum + item.total, 0);
      const laborIncrease = roundCurrency(laborSubtotal * (copingSizeAdjustment.laborRate ?? 0));
      const materialIncrease = roundCurrency(materialSubtotal * (copingSizeAdjustment.materialRate ?? 0));
      if (copingSizeAdjustment.showLaborLine && (laborIncrease > 0 || copingSizeAdjustment.laborRate === 0)) {
        laborItems.push({
          category: 'Coping Labor',
          description: copingSizeAdjustment.label,
          unitPrice: laborIncrease,
          quantity: 1,
          total: laborIncrease,
        });
      }
      if (copingSizeAdjustment.showMaterialLine && (materialIncrease > 0 || copingSizeAdjustment.materialRate === 0)) {
        materialItems.push({
          category: 'Coping Material',
          description: copingSizeAdjustment.label,
          unitPrice: materialIncrease,
          quantity: 1,
          total: materialIncrease,
        });
      }
    }

    // Stone / Rockwork (panel ledge / stacked stone / tile)
    const rockworkEntries: Array<{
      key: keyof typeof prices.decking.rockworkLabor;
      laborSqft?: number;
      materialSqft?: number;
      materialMultiplier?: number;
      label: string;
    }> = [
      {
        key: 'panelLedge',
        laborSqft: tileCopingDecking.rockworkPanelLedgeSqft,
        materialSqft: tileCopingDecking.rockworkPanelLedgeMaterialSqft,
        materialMultiplier: pricingData.tileCoping.rockworkMaterialWaste?.panelLedge ?? 1.15,
        label: 'Panel Ledge Rockwork'
      },
      { key: 'stackedStone', laborSqft: tileCopingDecking.rockworkStackedStoneSqft, materialSqft: tileCopingDecking.rockworkStackedStoneSqft, label: 'Stacked Stone Rockwork' },
      { key: 'tile', laborSqft: tileCopingDecking.rockworkTileSqft, materialSqft: tileCopingDecking.rockworkTileSqft, label: 'Tile Rockwork' },
    ];
    rockworkEntries.forEach((entry) => {
      const laborQty = entry.laborSqft ?? 0;
      const baseMaterialQty = entry.materialSqft ?? entry.laborSqft ?? 0;
      const materialQty = baseMaterialQty > 0
        ? (entry.materialSqft !== undefined
          ? baseMaterialQty
          : Math.round(baseMaterialQty * (entry.materialMultiplier ?? 1) * 100) / 100)
        : 0;
      if (!laborQty && !materialQty) return;
      const laborRate = prices.decking.rockworkLabor[entry.key] ?? 0;
      const materialRate = prices.decking.material.rockwork[entry.key] ?? 0;
      if (laborQty > 0) {
        laborItems.push({
          category: 'Stone & Rockwork Labor',
          description: entry.label,
          unitPrice: laborRate,
          quantity: laborQty,
          total: laborRate * laborQty,
        });
      }
      if (materialQty > 0) {
        materialItems.push({
          category: 'Stone & Rockwork Material',
          description: entry.label,
          unitPrice: materialRate,
          quantity: materialQty,
          total: materialRate * materialQty,
        });
      }
    });

    // Concrete pump (if any concrete work)
    if (tileCopingDecking.deckingType === 'concrete' || tileCopingDecking.concreteStepsLength > 0) {
      const concretePumpItem: CostLineItem = {
        category: 'Decking Labor',
        description: 'Concrete Pump',
        unitPrice: 600,
        quantity: 1,
        total: 600,
      };
      laborItems.push(isConcreteDeck ? tagPrimaryDeckingItem(concretePumpItem) : concretePumpItem);
    }

    // Concrete band for fiberglass pools
    if (PoolCalculations.isFiberglassPool(poolSpecs) && tileCopingDecking.deckingType !== 'none') {
      materialItems.push(tagPrimaryDeckingItem({
        category: 'Decking Material',
        description: 'Concrete Band for Fiberglass',
        unitPrice: getDeckingOptionById(prices, 'concrete')?.materialRate ?? 0,
        quantity: poolSpecs.perimeter * 1.25,
        total: (getDeckingOptionById(prices, 'concrete')?.materialRate ?? 0) * poolSpecs.perimeter * 1.25,
      }));
    }

    // Material tax (split between tile, coping/decking, and rockwork materials)
    const tileMaterialSubtotal = materialItems
      .filter(i => i.category.toLowerCase().includes('tile material'))
      .reduce((sum, i) => sum + i.total, 0);
    const sumDeckingMaterialSubtotal = (source: DeckingSource) =>
      materialItems
        .filter((item) => isOffContractEligibleLineItem(item, OFF_CONTRACT_GROUP_DECKING))
        .filter((item) => getDeckingSource(item) === source)
        .reduce((sum, item) => sum + item.total, 0);
    const primaryDeckingMaterialSubtotal = sumDeckingMaterialSubtotal('primary');
    const additionalDeckingMaterialSubtotals = materialItems
      .filter((item) => isOffContractEligibleLineItem(item, OFF_CONTRACT_GROUP_DECKING))
      .filter((item) => getDeckingSource(item) === 'additional')
      .reduce((groups, item) => {
        const key = getDeckingSelectionKey(item);
        if (!key) return groups;
        groups.set(key, (groups.get(key) || 0) + item.total);
        return groups;
      }, new Map<string, number>());
    const additionalDeckingMaterialSubtotal = Array.from(additionalDeckingMaterialSubtotals.values()).reduce(
      (sum, total) => sum + total,
      0
    );
    const deckingMaterialSubtotal = primaryDeckingMaterialSubtotal + additionalDeckingMaterialSubtotal;
    const rockworkMaterialSubtotal = materialItems
      .filter(i => {
        const cat = i.category.toLowerCase();
        return cat.includes('rockwork material') || cat.includes('masonry material');
      })
      .reduce((sum, i) => sum + i.total, 0);
    const totalMaterialSubtotal = materialItems.reduce((sum, i) => sum + i.total, 0);
    const copingMaterialSubtotal = Math.max(
      0,
      totalMaterialSubtotal - tileMaterialSubtotal - rockworkMaterialSubtotal - deckingMaterialSubtotal
    );

    const taxRate = getPricingTaxRate(pricingData);

    if (tileMaterialSubtotal > 0 && taxRate > 0) {
      materialItems.push({
        category: 'Tile Material',
        description: 'Tile Materials Tax',
        unitPrice: taxRate,
        quantity: tileMaterialSubtotal,
        total: tileMaterialSubtotal * taxRate,
      });
    }

    if (copingMaterialSubtotal > 0 && taxRate > 0) {
      materialItems.push({
        category: 'Coping Material',
        description: 'Coping Material Tax',
        unitPrice: taxRate,
        quantity: copingMaterialSubtotal,
        total: copingMaterialSubtotal * taxRate,
      });
    }

    if (primaryDeckingMaterialSubtotal > 0 && taxRate > 0) {
      materialItems.push(tagPrimaryDeckingItem({
        category: 'Decking Material',
        description: 'Decking Material Tax',
        unitPrice: taxRate,
        quantity: primaryDeckingMaterialSubtotal,
        total: primaryDeckingMaterialSubtotal * taxRate,
      }));
    }

    additionalDeckingMaterialSubtotals.forEach((subtotal, key) => {
      const selection = additionalDeckingSelections.find((entry) => entry.key === key);
      if (!selection || subtotal <= 0 || taxRate <= 0 || !selection.selectionLabel) {
        return;
      }

      materialItems.push(tagAdditionalDeckingItem({
        category: 'Decking Material',
        description: formatAdditionalDeckingLabel(selection.selectionLabel, 'Material Tax'),
        unitPrice: taxRate,
        quantity: subtotal,
        total: subtotal * taxRate,
      }, selection));
    });

    if (rockworkMaterialSubtotal > 0 && taxRate > 0) {
      materialItems.push({
        category: 'Stone & Rockwork Material',
        description: 'Stone & Rockwork Material Tax',
        unitPrice: taxRate,
        quantity: rockworkMaterialSubtotal,
        total: rockworkMaterialSubtotal * taxRate,
      });
    }

    if (poolSpecs.poolShape === 'freeform') {
      const getDeckingCategoryTotal = (source: DeckingSource, selectionKey?: string) =>
        [
          ...laborItems.filter(
            (item) =>
              item.category === 'Decking Labor' &&
              getDeckingSource(item) === source &&
              (!selectionKey || getDeckingSelectionKey(item) === selectionKey)
          ),
          ...materialItems.filter(
            (item) =>
              item.category === 'Decking Material' &&
              getDeckingSource(item) === source &&
              (!selectionKey || getDeckingSelectionKey(item) === selectionKey)
          ),
        ].reduce((sum, item) => sum + item.total, 0);

      const primaryDeckingCategoryTotal = getDeckingCategoryTotal('primary', 'primary');
      if (primaryDeckingCategoryTotal > 0 && !isConcreteDeck) {
        materialItems.push(tagPrimaryDeckingItem({
          category: 'Decking Material',
          description: 'Freeform Decking Waste',
          unitPrice: 0.05,
          quantity: primaryDeckingCategoryTotal,
          total: roundCurrency(primaryDeckingCategoryTotal * 0.05),
        }));
      }

      additionalDeckingSelections.forEach((selection) => {
        if (selection.deckingType === 'concrete' || selection.wasteNotIncluded || !selection.selectionLabel) {
          return;
        }

        const additionalDeckingCategoryTotal = getDeckingCategoryTotal('additional', selection.key);
        if (additionalDeckingCategoryTotal <= 0) {
          return;
        }

        materialItems.push(tagAdditionalDeckingItem({
          category: 'Decking Material',
          description: formatAdditionalDeckingLabel(selection.selectionLabel, 'Freeform Waste'),
          unitPrice: 0.05,
          quantity: additionalDeckingCategoryTotal,
          total: roundCurrency(additionalDeckingCategoryTotal * 0.05),
        }, selection));
      });
    }

    return { labor: laborItems, material: materialItems };
  }
}

// ============================================================================
// DRAINAGE CALCULATIONS
// ============================================================================

export class DrainageCalculations {
  static calculateDrainageCost(drainage: Drainage): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.misc.drainage;

    const calculateLine = (label: string, length: number) => {
      if (length <= 0) return;
      const over = Math.max(0, length - prices.includedFt);
      const total = prices.baseCost + over * prices.perFtOver;
      items.push({
        category: 'Drainage',
        description: label,
        unitPrice: prices.baseCost,
        quantity: 1,
        total,
      });
    };

    calculateLine('Downspout Drain', drainage.downspoutTotalLF);
    calculateLine('Deck Drain', drainage.deckDrainTotalLF);
    calculateLine('French Drain', drainage.frenchDrainTotalLF);
    calculateLine('Box Drain', drainage.boxDrainTotalLF);

    return items;
  }
}

// ============================================================================
// EQUIPMENT CALCULATIONS
// ============================================================================

export class EquipmentCalculations {
  private static getValidHeaterQuantity(equipment: Equipment): number {
    const heaterQty = Math.max(equipment.heaterQuantity ?? 0, 0);
    const heaterName = equipment.heater?.name?.toLowerCase() || '';
    return heaterQty > 0 && heaterName && !heaterName.includes('no heater') ? heaterQty : 0;
  }

  private static getPumpQuantity(equipment: Equipment): number {
    return getBasePumpQuantity(equipment);
  }

  private static getAdditionalFilters(equipment: Equipment): NonNullable<Equipment['additionalFilters']> {
    return (Array.isArray(equipment.additionalFilters) ? equipment.additionalFilters : []).filter(
      (filter) => Boolean(filter?.name) && !filter.name.toLowerCase().includes('no filter')
    );
  }

  private static getAdditionalHeaters(equipment: Equipment): NonNullable<Equipment['additionalHeaters']> {
    return (Array.isArray(equipment.additionalHeaters) ? equipment.additionalHeaters : []).filter(
      (heater) => Boolean(heater?.name) && !heater.name.toLowerCase().includes('no heater')
    );
  }

  private static getValidHeaterChillerQuantity(equipment: Equipment): number {
    const quantity = Math.max(equipment.heaterChillerQuantity ?? 0, 0);
    const name = equipment.heaterChiller?.name?.toLowerCase() || '';
    return quantity > 0 && name && !name.includes('no heater chiller') ? quantity : 0;
  }

  private static getSanitationAccessoryQuantity(equipment: Equipment): number {
    const name = equipment.sanitationAccessory?.name?.toLowerCase() || '';
    if (!name || name.includes('no sanitation')) return 0;
    const qty = Math.max(equipment.sanitationAccessoryQuantity ?? 0, 0);
    return qty > 0 ? qty : 1;
  }

  private static hasEquipmentSelection(equipment: Equipment): boolean {
    const selectedPackage = getSelectedEquipmentPackage(equipment);
    if (selectedPackage && isFixedEquipmentPackage(selectedPackage)) {
      return true;
    }
    if (selectedPackage && isCustomEquipmentPackage(selectedPackage) && selectedPackage.includeCheckValve !== false) {
      return true;
    }

    const pumpOverhead = pricingData.equipment.pumpOverheadMultiplier ?? 1;
    const pumpQty = this.getPumpQuantity(equipment);
    const additionalPrimaryPumps = getAdditionalPumpSelections(equipment);
    const additionalFilters = this.getAdditionalFilters(equipment);
    const additionalHeaters = this.getAdditionalHeaters(equipment);
    const heaterChillerQty = this.getValidHeaterChillerQuantity(equipment);
    const additionalPrimaryPrices = additionalPrimaryPumps.map((pump) => getEquipmentItemCost(pump as any, pumpOverhead));
    const auxiliaryPrices = (equipment.auxiliaryPumps && equipment.auxiliaryPumps.length > 0
      ? equipment.auxiliaryPumps
      : equipment.auxiliaryPump
        ? [equipment.auxiliaryPump]
        : []
    ).map(p => getEquipmentItemCost(p as any, pumpOverhead));
      const filterQty = Math.max(equipment.filterQuantity ?? 0, 0);
      const heaterQty = this.getValidHeaterQuantity(equipment);
      const automationQty = Math.max(equipment.automationQuantity ?? 0, 0);
      const cleanerQty = Math.max(equipment.cleanerQuantity ?? 0, 0);
      const saltQty = Math.max(equipment.saltSystemQuantity ?? (equipment.saltSystem ? 1 : 0), 0);
      const additionalSaltCost = getEquipmentItemCost(equipment.additionalSaltSystem as any, 1);
      const autoFillQty = Math.max(
        equipment.autoFillSystemQuantity ?? (equipment.autoFillSystem ? 1 : 0),
        0
      );
    const autoFillName = equipment.autoFillSystem?.name?.toLowerCase() || '';
    const hasAutoFillSystem = autoFillQty > 0 && autoFillName && !autoFillName.includes('no auto');
    const sanitationAccessoryQty = this.getSanitationAccessoryQuantity(equipment);
    const sanitationAccessoryCost = getEquipmentItemCost(equipment.sanitationAccessory as any, 1);
    const lightCounts = getLightCounts(equipment);

    const pricedSelections = [
      pumpQty > 0 ? getEquipmentItemCost(equipment.pump as any, pumpOverhead) * pumpQty : 0,
      ...additionalPrimaryPrices,
      ...auxiliaryPrices,
      filterQty > 0 ? getEquipmentItemCost(equipment.filter as any, 1) : 0,
      ...additionalFilters.map((filter) => getEquipmentItemCost(filter as any, 1)),
      cleanerQty > 0 ? getEquipmentItemCost(equipment.cleaner as any, 1) : 0,
      heaterQty > 0 ? getEquipmentItemCost(equipment.heater as any, 1) : 0,
      ...additionalHeaters.map((heater) => getEquipmentItemCost(heater as any, 1)),
      heaterChillerQty > 0 ? getEquipmentItemCost(equipment.heaterChiller as any, 1) : 0,
      automationQty > 0 ? getEquipmentItemCost(equipment.automation as any, 1) : 0,
      saltQty > 0 ? getEquipmentItemCost(equipment.saltSystem as any, 1) : 0,
      additionalSaltCost,
      hasAutoFillSystem ? getEquipmentItemCost(equipment.autoFillSystem as any, 1) : 0,
      sanitationAccessoryQty > 0 ? sanitationAccessoryCost : 0,
    ];

    const accessoriesSelected =
      equipment.hasBlanketReel ||
      equipment.hasSolarBlanket ||
      equipment.hasAutoFill ||
      equipment.hasHandrail ||
      equipment.hasStartupChemicals;

    return pricedSelections.some(price => (price ?? 0) > 0) ||
      filterQty > 0 ||
      additionalFilters.length > 0 ||
      heaterQty > 0 ||
      additionalHeaters.length > 0 ||
      heaterChillerQty > 0 ||
      automationQty > 0 ||
      cleanerQty > 0 ||
      saltQty > 0 ||
      hasAutoFillSystem ||
      sanitationAccessoryQty > 0 ||
      (equipment.automation?.zones ?? 0) > 0 ||
      lightCounts.total > 0 ||
      accessoriesSelected;
  }

  static calculateEquipmentCost(equipment: Equipment, poolSpecs: PoolSpecs): CostLineItem[] {
    const hasSpa = PoolCalculations.hasSpa(poolSpecs);
    const hasPool = hasPoolDefinition(poolSpecs);
    const normalizedEquipment = normalizeEquipmentLighting(equipment, { hasPool, hasSpa, poolSpecs });
    const items: CostLineItem[] = [];
    const prices = pricingData.equipment;
    const pumpOverhead = pricingData.equipment.pumpOverheadMultiplier ?? 1;
    const selectedPackage = getSelectedEquipmentPackage(normalizedEquipment);
    const pumpQty = this.getPumpQuantity(normalizedEquipment);
    const additionalPrimaryPumps = getAdditionalPumpSelections(normalizedEquipment);
    const additionalFilters = this.getAdditionalFilters(normalizedEquipment);
    const additionalHeaters = this.getAdditionalHeaters(normalizedEquipment);
    const heaterChillerQty = this.getValidHeaterChillerQuantity(normalizedEquipment);
    const auxiliaryPumps =
      normalizedEquipment.auxiliaryPumps && normalizedEquipment.auxiliaryPumps.length > 0
        ? normalizedEquipment.auxiliaryPumps
        : normalizedEquipment.auxiliaryPump
          ? [normalizedEquipment.auxiliaryPump]
          : [];
    const filterQty = Math.max(normalizedEquipment.filterQuantity ?? 0, 0);
    const heaterQty = this.getValidHeaterQuantity(normalizedEquipment);
    const automationQty = Math.max(normalizedEquipment.automationQuantity ?? 0, 0);
    const cleanerQty = Math.max(normalizedEquipment.cleanerQuantity ?? 0, 0);
    const saltQty = Math.max(
      normalizedEquipment.saltSystemQuantity ?? (normalizedEquipment.saltSystem ? 1 : 0),
      0
    );
    const autoFillQty = Math.max(
      normalizedEquipment.autoFillSystemQuantity ?? (normalizedEquipment.autoFillSystem ? 1 : 0),
      0
    );
    const sanitationAccessoryQty = this.getSanitationAccessoryQuantity(normalizedEquipment);
    const pumpCost = getEquipmentItemCost(normalizedEquipment.pump as any, pumpOverhead);
    const filterCost = getEquipmentItemCost(normalizedEquipment.filter as any, 1);
    const cleanerCost = getEquipmentItemCost(normalizedEquipment.cleaner as any, 1);
    const heaterCost = heaterQty > 0 ? getEquipmentItemCost(normalizedEquipment.heater as any, 1) : 0;
    const heaterChillerCost =
      heaterChillerQty > 0 ? getEquipmentItemCost(normalizedEquipment.heaterChiller as any, 1) : 0;
    const automationCost = getEquipmentItemCost(normalizedEquipment.automation as any, 1);
    const saltCost = getEquipmentItemCost(normalizedEquipment.saltSystem as any, 1);
    const additionalSaltCost = getEquipmentItemCost(normalizedEquipment.additionalSaltSystem as any, 1);
    const autoFillCost = getEquipmentItemCost(normalizedEquipment.autoFillSystem as any, 1);
    const sanitationAccessoryCost = getEquipmentItemCost(normalizedEquipment.sanitationAccessory as any, 1);
    const autoFillName = normalizedEquipment.autoFillSystem?.name || '';
    const hasAutoFillSystem =
      autoFillQty > 0 && autoFillName && !autoFillName.toLowerCase().includes('no auto');
    const poolLights = normalizedEquipment.poolLights || [];
    const spaLights = normalizedEquipment.spaLights || [];

    if (!this.hasEquipmentSelection(normalizedEquipment)) {
      return items;
    }

    const pushItem = (description: string, unitPrice: number, quantity: number, total?: number) => {
      if (quantity <= 0) return;
      items.push({
        category: 'Equipment',
        description,
        unitPrice,
        quantity,
        total: total ?? unitPrice * quantity,
      });
    };

    const upgradeLabel = (description: string) =>
      description.toLowerCase().includes('(upgrade)') ? description : `${description} (upgrade)`;

    const additionalPumpDescription = (name?: string) => (name ? `Additional Pump - ${name}` : 'Additional Pump');

    const pushUpgrade = (description: string, unitPrice: number, quantity: number) => {
      pushItem(upgradeLabel(description), unitPrice, quantity);
    };

    const pushZeroItem = (description: string, quantity: number) => {
      pushItem(description, 0, quantity, 0);
    };

    const addLightGroup = (lights: typeof poolLights, labelPrefix: string, descriptionSuffix: string = '') => {
      const grouped = new Map<string, { unitPrice: number; quantity: number }>();
      lights.forEach((light) => {
        const cost = getEquipmentItemCost(light as any, 1);
        const key = light?.name || `${labelPrefix} Light`;
        const current = grouped.get(key);
        grouped.set(key, {
          unitPrice: cost,
          quantity: (current?.quantity ?? 0) + 1,
        });
      });

      grouped.forEach((value, name) => {
        if (value.quantity <= 0) return;
        pushItem(`${labelPrefix} Light - ${name}${descriptionSuffix}`, value.unitPrice, value.quantity);
      });
    };

    if (selectedPackage && isFixedEquipmentPackage(selectedPackage)) {
      const includedPumpQty = Math.max(selectedPackage.includedPumpQuantity ?? 0, 0);
      const includedFilterQty = Math.max(selectedPackage.includedFilterQuantity ?? 0, 0);
      const includedCleanerQty = Math.max(selectedPackage.includedCleanerQuantity ?? 0, 0);
      const includedHeaterQty = Math.max(selectedPackage.includedHeaterQuantity ?? 0, 0);
      const includedAutomationQty = Math.max(selectedPackage.includedAutomationQuantity ?? 0, 0);
      const includedSaltQty = Math.max(selectedPackage.includedSaltSystemQuantity ?? 0, 0);
      const includedAutoFillQty = Math.max(selectedPackage.includedAutoFillSystemQuantity ?? 0, 0);
      const includedPoolLightQty = Math.max(selectedPackage.includedPoolLightQuantity ?? 0, 0);
      const includedSpaLightQty = Math.max(selectedPackage.includedSpaLightQuantity ?? 0, 0);
      const includedSanitationAccessoryQty = Math.max(selectedPackage.includedSanitationAccessoryQuantity ?? 0, 0);
      pushItem(selectedPackage.name, getPackageTotal(selectedPackage), 1);

      if (selectedPackage.includeCheckValve !== false) {
        pushZeroItem('Check Valve', 1);
      }
      if (includedPumpQty > 0) {
        pushZeroItem(selectedPackage.includedPumpName || normalizedEquipment.pump?.name || 'Pump', includedPumpQty);
      }
      if (includedFilterQty > 0) {
        pushZeroItem(selectedPackage.includedFilterName || normalizedEquipment.filter?.name || 'Filter', includedFilterQty);
      }
      if (includedCleanerQty > 0) {
        pushZeroItem(selectedPackage.includedCleanerName || normalizedEquipment.cleaner?.name || 'Cleaner', includedCleanerQty);
      }
      if (includedHeaterQty > 0) {
        pushZeroItem(selectedPackage.includedHeaterName || normalizedEquipment.heater?.name || 'Heater', includedHeaterQty);
      }
      if (includedAutomationQty > 0) {
        pushZeroItem(
          selectedPackage.includedAutomationName || normalizedEquipment.automation?.name || 'Automation',
          includedAutomationQty
        );
      }
      if (includedSaltQty > 0) {
        pushZeroItem(
          selectedPackage.includedSaltSystemName || normalizedEquipment.saltSystem?.name || 'Sanitation System',
          includedSaltQty
        );
      }
      if (includedPoolLightQty > 0) {
        pushZeroItem(
          `Pool Light - ${selectedPackage.includedPoolLightName || poolLights[0]?.name || 'Pool Light'}`,
          includedPoolLightQty
        );
      }
      if (includedSpaLightQty > 0) {
        pushZeroItem(
          `Spa Light - ${selectedPackage.includedSpaLightName || spaLights[0]?.name || 'Spa Light'}`,
          includedSpaLightQty
        );
      }
      if (includedAutoFillQty > 0) {
        pushZeroItem(
          selectedPackage.includedAutoFillSystemName || normalizedEquipment.autoFillSystem?.name || 'Auto-Fill System',
          includedAutoFillQty
        );
      }
      if (includedSanitationAccessoryQty > 0) {
        pushZeroItem(
          selectedPackage.includedSanitationAccessoryName ||
            normalizedEquipment.sanitationAccessory?.name ||
            'Sanitation Accessory',
          includedSanitationAccessoryQty
        );
      }

      if (pumpQty > 0 && includedPumpQty === 0 && normalizedEquipment.pump?.name) {
        pushUpgrade(normalizedEquipment.pump.name, pumpCost, pumpQty);
      }

      additionalPrimaryPumps.forEach((pump) => {
        const additionalPumpCost = getEquipmentItemCost(pump as any, pumpOverhead);
        pushUpgrade(additionalPumpDescription(pump?.name), additionalPumpCost, 1);
      });

      auxiliaryPumps.forEach((pump, idx) => {
        const auxCost = getEquipmentItemCost(pump as any, pumpOverhead);
        pushUpgrade(pump?.name || `Blower ${idx + 1}`, auxCost, 1);
      });

      const extraFilterQty = Math.max(filterQty - includedFilterQty, 0);
      if (extraFilterQty > 0 && normalizedEquipment.filter?.name) {
        pushUpgrade(normalizedEquipment.filter.name, filterCost, extraFilterQty);
      }

      additionalFilters.forEach((filter) => {
        pushUpgrade(`Additional Filter - ${filter.name}`, getEquipmentItemCost(filter as any, 1), 1);
      });

      const extraCleanerQty = Math.max(cleanerQty - includedCleanerQty, 0);
      if (extraCleanerQty > 0 && normalizedEquipment.cleaner?.name) {
        pushUpgrade(normalizedEquipment.cleaner.name, cleanerCost, extraCleanerQty);
      }

      const extraHeaterQty = Math.max(heaterQty - includedHeaterQty, 0);
      if (extraHeaterQty > 0 && normalizedEquipment.heater?.name) {
        pushUpgrade(normalizedEquipment.heater.name, heaterCost, extraHeaterQty);
      }

      additionalHeaters.forEach((heater) => {
        pushUpgrade(`Additional Heater - ${heater.name}`, getEquipmentItemCost(heater as any, 1), 1);
      });
      if (heaterChillerQty > 0 && normalizedEquipment.heaterChiller?.name) {
        pushUpgrade(
          `Heater Chiller - ${normalizedEquipment.heaterChiller.name}`,
          heaterChillerCost,
          heaterChillerQty
        );
      }

      addLightGroup(poolLights.slice(includedPoolLightQty), 'Pool', ' (upgrade)');
      if (hasSpa) {
        addLightGroup(spaLights.slice(includedSpaLightQty), 'Spa', ' (upgrade)');
      }

      const extraAutomationQty = Math.max(automationQty - includedAutomationQty, 0);
      if (extraAutomationQty > 0 && normalizedEquipment.automation?.name) {
        pushUpgrade(normalizedEquipment.automation.name, automationCost, extraAutomationQty);
      }

      if ((automationQty > 0 || includedAutomationQty > 0) && normalizedEquipment.automation.zones > 0) {
        pushUpgrade(
          'Additional Automation Zones',
          pricingData.equipment.automationZoneAddon,
          normalizedEquipment.automation.zones
        );
      }

      const extraSaltQty = Math.max(saltQty - includedSaltQty, 0);
      if (extraSaltQty > 0 && normalizedEquipment.saltSystem?.name) {
        pushUpgrade(normalizedEquipment.saltSystem.name, saltCost, extraSaltQty);
      }

      if (normalizedEquipment.additionalSaltSystem?.name) {
        pushUpgrade(normalizedEquipment.additionalSaltSystem.name, additionalSaltCost, 1);
      }

      const extraAutoFillQty = Math.max(autoFillQty - includedAutoFillQty, 0);
      if (extraAutoFillQty > 0 && hasAutoFillSystem) {
        pushUpgrade(normalizedEquipment.autoFillSystem?.name || 'Auto-Fill System', autoFillCost, extraAutoFillQty);
      }

      const extraSanitationAccessoryQty = Math.max(sanitationAccessoryQty - includedSanitationAccessoryQty, 0);
      if (extraSanitationAccessoryQty > 0 && normalizedEquipment.sanitationAccessory?.name) {
        pushUpgrade(normalizedEquipment.sanitationAccessory.name, sanitationAccessoryCost, extraSanitationAccessoryQty);
      }

      if (normalizedEquipment.hasBlanketReel) {
        pushUpgrade('Blanket Reel', pricingData.equipment.blanketReel, 1);
      }
      if (normalizedEquipment.hasSolarBlanket) {
        pushUpgrade('Solar Blanket', pricingData.equipment.solarBlanket, 1);
      }
      if (!hasAutoFillSystem && normalizedEquipment.hasAutoFill) {
        pushUpgrade('Auto Fill', pricingData.equipment.autoFill, 1);
      }
      if (normalizedEquipment.hasHandrail) {
        pushUpgrade('Handrail', pricingData.equipment.handrail, 1);
      }
      if (normalizedEquipment.hasStartupChemicals) {
        pushUpgrade('Startup Chemicals', pricingData.equipment.startupChemicals, 1);
      }
    } else {
      const checkValveCost = Number((pricingData as any)?.equipment?.checkValve || 0);

      pushItem('Base White Goods', prices.baseWhiteGoods, 1);

      if (pumpQty > 0) {
        pushItem(normalizedEquipment.pump.name, pumpCost, pumpQty);
      }

      additionalPrimaryPumps.forEach((pump) => {
        const additionalPumpCost = getEquipmentItemCost(pump as any, pumpOverhead);
        pushItem(additionalPumpDescription(pump?.name), additionalPumpCost, 1);
      });

      auxiliaryPumps.forEach((pump, idx) => {
        const auxCost = getEquipmentItemCost(pump as any, pumpOverhead);
        pushItem(pump.name || `Blower ${idx + 1}`, auxCost, 1);
      });

      if (filterQty > 0) {
        pushItem(normalizedEquipment.filter.name, filterCost, filterQty);
      }

      additionalFilters.forEach((filter) => {
        pushItem(`Additional Filter - ${filter.name}`, getEquipmentItemCost(filter as any, 1), 1);
      });

      if (cleanerCost > 0 && cleanerQty > 0) {
        pushItem(normalizedEquipment.cleaner.name, cleanerCost, cleanerQty);
      }

      if (heaterQty > 0) {
        pushItem(normalizedEquipment.heater.name, heaterCost, heaterQty);
      }

      additionalHeaters.forEach((heater) => {
        pushItem(`Additional Heater - ${heater.name}`, getEquipmentItemCost(heater as any, 1), 1);
      });
      if (heaterChillerQty > 0 && normalizedEquipment.heaterChiller?.name) {
        pushItem(
          `Heater Chiller - ${normalizedEquipment.heaterChiller.name}`,
          heaterChillerCost,
          heaterChillerQty
        );
      }

      addLightGroup(poolLights, 'Pool');
      if (hasSpa) {
        addLightGroup(spaLights, 'Spa');
      }

      if (automationQty > 0) {
        pushItem(normalizedEquipment.automation.name, automationCost, automationQty);
      }

      if (automationQty > 0 && normalizedEquipment.automation.zones > 0) {
        pushItem(
          'Additional Automation Zones',
          pricingData.equipment.automationZoneAddon,
          normalizedEquipment.automation.zones
        );
      }

      if (saltCost > 0 && normalizedEquipment.saltSystem?.name && saltQty > 0) {
        pushItem(normalizedEquipment.saltSystem.name, saltCost, saltQty);
      }

      if (additionalSaltCost > 0 && normalizedEquipment.additionalSaltSystem?.name) {
        pushItem(normalizedEquipment.additionalSaltSystem.name, additionalSaltCost, 1);
      }

      if (hasAutoFillSystem) {
        pushItem(normalizedEquipment.autoFillSystem?.name || 'Auto-Fill System', autoFillCost, autoFillQty);
      }

      if (sanitationAccessoryCost > 0 && sanitationAccessoryQty > 0 && normalizedEquipment.sanitationAccessory?.name) {
        pushItem(normalizedEquipment.sanitationAccessory.name, sanitationAccessoryCost, sanitationAccessoryQty);
      }

      if (normalizedEquipment.hasBlanketReel) {
        pushItem('Blanket Reel', pricingData.equipment.blanketReel, 1);
      }

      if (normalizedEquipment.hasSolarBlanket) {
        pushItem('Solar Blanket', pricingData.equipment.solarBlanket, 1);
      }

      if (!hasAutoFillSystem && normalizedEquipment.hasAutoFill) {
        pushItem('Auto Fill', pricingData.equipment.autoFill, 1);
      }

      if (normalizedEquipment.hasHandrail) {
        pushItem('Handrail', pricingData.equipment.handrail, 1);
      }

      if (normalizedEquipment.hasStartupChemicals) {
        pushItem('Startup Chemicals', pricingData.equipment.startupChemicals, 1);
      }

      if (selectedPackage && isCustomEquipmentPackage(selectedPackage) && selectedPackage.includeCheckValve !== false && checkValveCost > 0) {
        pushItem('Check Valve', checkValveCost, 1);
      }
    }

    const fiberglassPoolModel =
      poolSpecs.poolType === 'fiberglass'
        ? findFiberglassPoolModel(poolSpecs.fiberglassModelName, poolSpecs.fiberglassSize)
        : undefined;
    const equipmentPadCost = Number((pricingData as any)?.fiberglass?.equipmentPadCost || 0);
    const equipmentPadQuantity = fiberglassPoolModel
      ? 1 + heaterQty + additionalHeaters.length + heaterChillerQty
      : 0;
    if (equipmentPadCost > 0 && equipmentPadQuantity > 0) {
      pushItem('Equipment Pad', equipmentPadCost, equipmentPadQuantity);
    }

    const subtotal = items.reduce((sum, i) => sum + i.total, 0);
    const taxRate = getPricingTaxRate(pricingData);
    if (subtotal > 0 && taxRate > 0) {
      const taxAmount = Math.round(subtotal * taxRate * 100) / 100; // match Excel cent rounding
      items.push({
        category: 'Equipment',
        description: 'Equipment Tax',
        unitPrice: taxRate,
        quantity: subtotal,
        total: taxAmount,
      });
    }

    return items;
  }

  static calculateEquipmentSetCost(equipment: Equipment, poolSpecs: PoolSpecs): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.misc.equipmentSet;
    const hasSpa = PoolCalculations.hasSpa(poolSpecs);
    const hasPool = hasPoolDefinition(poolSpecs);
    const normalizedEquipment = normalizeEquipmentLighting(equipment, { hasPool, hasSpa, poolSpecs });
    const heaterQty =
      this.getValidHeaterQuantity(normalizedEquipment) +
      this.getAdditionalHeaters(normalizedEquipment).length +
      this.getValidHeaterChillerQuantity(normalizedEquipment);

    if (!this.hasEquipmentSelection(normalizedEquipment)) {
      return items;
    }

    items.push({
      category: 'Equipment Set',
      description: 'Base Equipment Set',
      unitPrice: prices.base,
      quantity: 1,
      total: prices.base,
    });

    // Heater set (for all heaters, including heat pumps) - Excel PLUM!Row43: $200 per heater
    if (heaterQty > 0) {
      const isHeatPump = normalizedEquipment.heater.name.toLowerCase().includes('heat pump');
      items.push({
        category: 'Equipment Set',
        description: isHeatPump ? 'Heat Pump Set' : 'Heater',
        unitPrice: prices.heater,
        quantity: heaterQty,
        total: prices.heater * heaterQty,
      });
    }

    const additionalPumpCount = getAdditionalPumpSelections(normalizedEquipment).length;

    if (additionalPumpCount > 0) {
      items.push({
        category: 'Equipment Set',
        description: "Add'l Pump(s)",
        unitPrice: prices.additionalPump,
        quantity: additionalPumpCount,
        total: prices.additionalPump * additionalPumpCount,
      });
    }

    return items;
  }
}

// ============================================================================
// WATER FEATURES CALCULATIONS
// ============================================================================

export class WaterFeaturesCalculations {
  static calculateWaterFeaturesCost(waterFeatures: WaterFeatures): CostLineItem[] {
    const items: CostLineItem[] = [];
    const catalog = flattenWaterFeatures(pricingData.waterFeatures);
    const lookup = new Map(catalog.map((entry) => [entry.id, entry]));
    const selections = waterFeatures.selections ?? [];

    selections.forEach((selection) => {
      const feature = lookup.get(selection.featureId) || catalog.find((f) => f.name === selection.featureId);
      if (!feature || selection.quantity <= 0) return;

      const unitPrice = getWaterFeatureCogs(feature);

      items.push({
        category: 'Water Features',
        description: feature.name,
        unitPrice,
        quantity: selection.quantity,
        total: unitPrice * selection.quantity,
        notes: feature.note,
        details: {
          sourceCategory: 'Water Features',
          waterFeatureId: feature.id,
        },
      });
    });

    return items;
  }
}

// ============================================================================
// INTERIOR FINISH CALCULATIONS
// ============================================================================

export class InteriorFinishCalculations {
  static calculateInteriorFinishCost(
    poolSpecs: PoolSpecs,
    interiorFinish: InteriorFinish,
    equipment?: Equipment
  ): { labor: CostLineItem[]; material: CostLineItem[]; waterTruck: CostLineItem[] } {
    const laborItems: CostLineItem[] = [];
    const materialItems: CostLineItem[] = [];
    const waterTruckItems: CostLineItem[] = [];
    const prices = pricingData.interiorFinish;
    const isFiberglass = PoolCalculations.isFiberglassPool(poolSpecs);
    const isGuniteSpa = poolSpecs.spaType === 'gunite';

    if (!hasPoolDefinition(poolSpecs)) {
      return { labor: laborItems, material: materialItems, waterTruck: waterTruckItems };
    }

    if (!isFiberglass) {
      // Interior area from sheet: ((shallow+end)/2 * perimeter) + surfaceArea
      const interiorArea =
        ((poolSpecs.shallowDepth + poolSpecs.endDepth) / 2) * poolSpecs.perimeter + poolSpecs.surfaceArea;
      const chargeArea = Math.max(interiorArea, prices.minimumChargeSqft ?? 850);
      const finish = this.getFinish(prices, interiorFinish.finishType);
      const finishName = finish?.name || interiorFinish.finishType || 'Interior Finish';
      const materialRate = finish?.costPerSqft ?? 0;
      const baseCost = Math.ceil(materialRate * chargeArea);

      laborItems.push({
        category: 'Interior Finish',
        description: `${finishName} Finish`,
        unitPrice: materialRate,
        quantity: chargeArea,
        total: baseCost,
      });

      const surfaceArea = poolSpecs.surfaceArea ?? 0;
      const spaPrepThreshold = prices.extras.poolPrepThreshold ?? 1200;

      if (isGuniteSpa) {
        laborItems.push({
          category: 'Interior Finish',
          description: 'Spa Finish',
          unitPrice: finish?.spaFinishCost ?? 0,
          quantity: 1,
          total: finish?.spaFinishCost ?? 0,
        });
      }

      laborItems.push({
        category: 'Interior Finish',
        description: 'Pool Prep',
        unitPrice: prices.extras.poolPrepBase,
        quantity: 1,
        total: prices.extras.poolPrepBase,
      });
      const overPrepSqft = Math.max(0, chargeArea - (prices.extras.poolPrepThreshold ?? 1200));
      if (overPrepSqft > 0) {
        laborItems.push({
          category: 'Interior Finish',
          description: 'Prep Over 1,200 SQFT',
          unitPrice: prices.extras.poolPrepOverRate,
          quantity: overPrepSqft,
          total: prices.extras.poolPrepOverRate * overPrepSqft,
        });
      }

      if (isGuniteSpa && surfaceArea > spaPrepThreshold) {
        laborItems.push({
          category: 'Interior Finish',
          description: 'Spa Prep over 1200 SQFT',
          unitPrice: prices.extras.spaPrep,
          quantity: 1,
          total: prices.extras.spaPrep,
        });
      }

      laborItems.push({
        category: 'Interior Finish',
        description: 'Miscellaneous',
        unitPrice: prices.extras.misc,
        quantity: 1,
        total: prices.extras.misc,
      });
      if (poolSpecs.travelDistance > 0) {
        laborItems.push({
          category: 'Interior Finish',
          description: 'Travel',
          unitPrice: prices.extras.travelPerMile,
          quantity: poolSpecs.travelDistance,
          total: prices.extras.travelPerMile * poolSpecs.travelDistance,
        });
      }

      if (poolSpecs.totalStepsAndBench > 20) {
        const extraSteps = poolSpecs.totalStepsAndBench - 20;
        laborItems.push({
          category: 'Interior Finish',
          description: 'Step & Bench Detail',
          unitPrice: prices.extras.stepDetailPerLnftOver20,
          quantity: extraSteps,
          total: prices.extras.stepDetailPerLnftOver20 * extraSteps,
        });
      }

      const includeMicroglass =
        interiorFinish.hasWaterproofing !== false && !isBronzePricingTier((pricingData as any).pricingTierId);
      if (poolSpecs.poolType === 'gunite' && includeMicroglass) {
        const waterproofRate = prices.extras.waterproofingPerSqft ?? 0;
        const spaPerimeter = isGuniteSpa
          ? (poolSpecs.spaPerimeter || PoolCalculations.calculateSpaPerimeter(poolSpecs))
          : 0;
        const spaWaterproofSqft = spaPerimeter * 3.45;
        const waterproofQty = interiorArea + spaWaterproofSqft;
        laborItems.push({
          category: 'Interior Finish',
          description: 'Waterproofing (Microglass)',
          unitPrice: waterproofRate,
          quantity: waterproofQty,
          total: waterproofRate * waterproofQty,
        });
        if (isGuniteSpa && poolSpecs.isRaisedSpa) {
          const raisedSpaWaterproof = prices.extras.waterproofingRaisedSpa ?? 0;
          laborItems.push({
            category: 'Interior Finish',
            description: 'Waterproofing (Microglass) - Raised Spa',
            unitPrice: raisedSpaWaterproof,
            quantity: 1,
            total: raisedSpaWaterproof,
          });
        }
      }

      const pumpOverhead = pricingData.equipment.pumpOverheadMultiplier ?? 1;
      const pumpQty = getBasePumpQuantity(equipment);
      const pumpCost = getEquipmentItemCost(equipment?.pump as any, pumpOverhead);
      const additionalPrimaryPumpCount = getAdditionalPumpSelections(equipment).filter(
        (pump) => pump && getEquipmentItemCost(pump as any, pumpOverhead) > 0
      ).length;
      const mainPumpCount = (pumpCost > 0 ? pumpQty : 0) + additionalPrimaryPumpCount;
      const drains = mainPumpCount * 2 * 15;
      const vac = 0;
      const returns = 20;
      const hydro = 60;
      const fittingsTotal = drains + vac + returns + hydro;
      if (fittingsTotal > 0) {
        laborItems.push({
          category: 'Interior Finish',
          description: 'Fittings (Drains/Vac/Returns/Hydro)',
          unitPrice: fittingsTotal,
          quantity: 1,
          total: fittingsTotal,
        });
      }
    }

    // WATER TRUCK
    const gallons = PoolCalculations.calculateGallons(poolSpecs);
    const waterTruckPricing = pricingData.misc?.waterTruck ?? prices.waterTruck;
    const configuredLoadSizeGallons = Number(waterTruckPricing?.loadSizeGallons);
    const loadSizeGallons =
      Number.isFinite(configuredLoadSizeGallons) && configuredLoadSizeGallons > 0
        ? configuredLoadSizeGallons
        : Number(prices.waterTruck?.loadSizeGallons) || 7000;
    const configuredWaterTruckBase = Number(waterTruckPricing?.base);
    const waterTruckBase =
      Number.isFinite(configuredWaterTruckBase)
        ? configuredWaterTruckBase
        : Number(prices.waterTruck?.base) || 0;
    if (gallons > 0) {
      const loads = Math.max(1, Math.ceil(gallons / loadSizeGallons));
      waterTruckItems.push({
        category: 'Water Truck',
        description: 'Water Truck',
        unitPrice: waterTruckBase,
        quantity: loads,
        total: waterTruckBase * loads,
        details: {
          totalGallons: gallons,
          truckTotalGallons: loads * loadSizeGallons,
        },
      });
    }

    return { labor: laborItems, material: materialItems, waterTruck: waterTruckItems };
  }
  private static getFinish(prices: any, finishType: string | undefined) {
    if (!finishType) return undefined;
    return (prices.finishes || []).find((finish: any) => finish.id === finishType) ||
      (prices.finishes || []).find((finish: any) => finish.name === finishType);
  }
}

// ============================================================================
// CLEANUP CALCULATIONS
// ============================================================================

export class CleanupCalculations {
  static calculateCleanupCost(
    poolSpecs: PoolSpecs,
    excavation?: Excavation,
    tileCopingDecking?: TileCopingDecking
  ): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.cleanup;
    const hasSpa = PoolCalculations.hasSpa(poolSpecs);

    if (!hasPoolDefinition(poolSpecs)) {
      return items;
    }

    items.push({
      category: 'Cleanup',
      description: 'Base Pool Cleanup',
      unitPrice: prices.basePool,
      quantity: 1,
      total: prices.basePool,
    });

    if (hasSpa) {
      items.push({
        category: 'Cleanup',
        description: 'Spa Cleanup',
        unitPrice: prices.spa,
        quantity: 1,
        total: prices.spa,
      });
    }

    if (poolSpecs.surfaceArea > 500) {
      const sqftOver = Math.max(0, poolSpecs.surfaceArea - 500);
      items.push({
        category: 'Cleanup',
        description: 'Over 500 SQFT',
        unitPrice: prices.perSqftOver500,
        quantity: sqftOver,
        total: prices.perSqftOver500 * sqftOver,
      });
    }

    const rbbSqft =
      excavation?.totalRBBSqft ??
      (excavation?.rbbLevels || []).reduce((total, level) => {
        const heightInFeet = (level.height ?? 0) / 12;
        return total + (level.length ?? 0) * heightInFeet;
      }, 0);

    if (rbbSqft > 0) {
      items.push({
        category: 'Cleanup',
        description: 'RBB Cleanup',
        unitPrice: prices.rbbPerSqft,
        quantity: rbbSqft,
        total: prices.rbbPerSqft * rbbSqft,
      });
    }

    if (poolSpecs.travelDistance > 0) {
      items.push({
        category: 'Cleanup',
        description: 'Travel',
        unitPrice: prices.travelPerMile,
        quantity: poolSpecs.travelDistance,
        total: prices.travelPerMile * poolSpecs.travelDistance,
      });
    }

    if (tileCopingDecking?.hasRoughGrading) {
      items.push({
        category: 'Cleanup',
        description: 'Rough Grading',
        unitPrice: prices.roughGrading,
        quantity: 1,
        total: prices.roughGrading,
      });
    }

    return items;
  }
}

// ============================================================================
// FIBERGLASS CALCULATIONS
// ============================================================================

export class FiberglassCalculations {
  static calculateFiberglassCost(poolSpecs: PoolSpecs, papDiscountRate: number = 0): CostLineItem[] {
    const items: CostLineItem[] = [];

    const poolIsFiberglass = poolSpecs.poolType === 'fiberglass';
    const spaIsFiberglass = poolSpecs.spaType === 'fiberglass';

    if (!poolIsFiberglass && !spaIsFiberglass) return items;

    const poolModel = poolIsFiberglass
      ? findFiberglassPoolModel(poolSpecs.fiberglassModelName, poolSpecs.fiberglassSize)
      : undefined;
    const spaOption = spaIsFiberglass
      ? findFiberglassNamedOption('spaOptions', poolSpecs.spaFiberglassModelName)
      : undefined;
    const tanningOption = poolIsFiberglass
      ? findFiberglassNamedOption('tanningLedgeOptions', poolSpecs.fiberglassTanningLedgeName)
      : undefined;
    const finishUpgrade = poolIsFiberglass
      ? findFiberglassNamedOption('finishUpgrades', poolSpecs.fiberglassFinishUpgradeName)
      : undefined;
    const discountedShellPrice = getDiscountedFiberglassShellPrice(
      poolModel?.shellPrice,
      poolModel?.discountPercent
    );

    if (poolModel && discountedShellPrice > 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: poolModel.name,
        unitPrice: discountedShellPrice,
        quantity: 1,
        total: discountedShellPrice,
        details: { fiberglassLineType: 'pool-shell' },
      });
    }

    if (spaOption && spaOption.price > 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: `Fiberglass Spa - ${spaOption.name}`,
        unitPrice: spaOption.price,
        quantity: 1,
        total: spaOption.price,
        details: { fiberglassLineType: 'spa-shell' },
      });
    }

    const spilloverSelectedPrice =
      spaIsFiberglass && spaOption && fiberglassSpaOptionSupportsSpillover(spaOption)
        ? getFiberglassSpaSpilloverSelectedPrice(spaOption)
        : undefined;
    const spilloverAdjustment =
      spaOption && Number.isFinite(Number(spilloverSelectedPrice))
        ? roundCurrency(Number(spilloverSelectedPrice) - Number(spaOption.price || 0))
        : 0;

    if (spaIsFiberglass && poolSpecs.hasSpillover && spaOption && spilloverAdjustment !== 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: 'Spillover',
        unitPrice: spilloverAdjustment,
        quantity: 1,
        total: spilloverAdjustment,
        details: { fiberglassLineType: 'spillover' },
      });
    }

    if (tanningOption && tanningOption.price > 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: `Tanning Ledge - ${tanningOption.name}`,
        unitPrice: tanningOption.price,
        quantity: 1,
        total: tanningOption.price,
        details: { fiberglassLineType: 'tanning-ledge' },
      });
    }

    if (finishUpgrade && finishUpgrade.price > 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: `Finish Upgrade - ${finishUpgrade.name}`,
        unitPrice: finishUpgrade.price,
        quantity: 1,
        total: finishUpgrade.price,
        details: { fiberglassLineType: 'finish-upgrade' },
      });
    }

    if (poolModel && poolModel.freight > 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: 'Freight',
        unitPrice: poolModel.freight,
        quantity: 1,
        total: poolModel.freight,
        details: { fiberglassLineType: 'freight' },
      });
    }

    const shellPapDiscountRate = Math.max(0, Number(papDiscountRate) || 0);
    if (poolModel && discountedShellPrice > 0 && shellPapDiscountRate > 0) {
      const discountAmount = roundCurrency(discountedShellPrice * shellPapDiscountRate);
      items.push({
        category: 'Fiberglass Shell',
        description: 'PAP Discount',
        unitPrice: -discountAmount,
        quantity: 1,
        total: -discountAmount,
        details: { fiberglassLineType: 'pap-discount' },
      });
    }

    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const shellTaxRate = getPricingTaxRate(pricingData);
    if (subtotal > 0 && shellTaxRate > 0) {
      items.push({
        category: 'Fiberglass Shell',
        description: 'Tax',
        unitPrice: shellTaxRate,
        quantity: subtotal,
        total: subtotal * shellTaxRate,
      });
    }

    return items;
  }

  static calculateFiberglassInstallCost(poolSpecs: PoolSpecs): CostLineItem[] {
    const items: CostLineItem[] = [];
    const prices = pricingData.fiberglass as any;
    const poolIsFiberglass = poolSpecs.poolType === 'fiberglass';
    const spaIsFiberglass = poolSpecs.spaType === 'fiberglass';

    if (!poolIsFiberglass && !spaIsFiberglass) {
      return items;
    }

    const poolModel = poolIsFiberglass
      ? findFiberglassPoolModel(poolSpecs.fiberglassModelName, poolSpecs.fiberglassSize)
      : undefined;
    const spaOption = spaIsFiberglass
      ? findFiberglassNamedOption('spaOptions', poolSpecs.spaFiberglassModelName)
      : undefined;

    const addInstallItem = (description: string, cost: number) => {
      if (cost <= 0) return;
      items.push({
        category: 'Fiberglass Install',
        description,
        unitPrice: cost,
        quantity: 1,
        total: cost,
      });
    };

    if (poolModel && poolSpecs.needsFiberglassCrane) {
      addInstallItem('Crane', Number(poolModel.crane) || 0);
    }
    if (poolModel) {
      addInstallItem('Install', Number(poolModel.install) || 0);
      if (!isBronzePricingTier((pricingData as any).pricingTierId)) {
        addInstallItem('Gravel', Number(poolModel.gravel) || 0);
      }
    }

    // Drennen workbook FIBER!G74 / COST - NEW!D320 applies spa install labor
    // whenever a fiberglass spa shell is selected, even without a fiberglass pool shell.
    if (spaOption && poolSpecs.needsFiberglassSpaCrane) {
      addInstallItem('Crane - Spa', Number(spaOption.crane ?? 0) || 0);
    }

    if (spaOption) {
      addInstallItem('Install - Spa', Number(prices.spaInstall ?? 0) || 0);
    }

    return items;
  }
}

// ============================================================================
// MASONRY CALCULATIONS
// ============================================================================

export class MasonryCalculations {
  static calculateMasonryCost(
    poolSpecs: PoolSpecs,
    excavation: Excavation,
    options: { allowDistinctRbbBacksideFacing?: boolean } = {}
  ): {
    labor: CostLineItem[];
    material: CostLineItem[];
  } {
    const labor: CostLineItem[] = [];
    const material: CostLineItem[] = [];
    const prices = pricingData.masonry;
    const hasLegacyRetaining =
      (excavation.retainingWallType &&
        excavation.retainingWallType !== 'None' &&
        excavation.retainingWallType !== 'No Retaining Wall') ||
      (excavation.retainingWallLength ?? 0) > 0;
    const retainingWalls =
      excavation.retainingWalls && excavation.retainingWalls.length > 0
        ? excavation.retainingWalls
        : hasLegacyRetaining
          ? [
              {
                type: excavation.retainingWallType || '',
                length: excavation.retainingWallLength ?? 0,
              },
            ]
          : [];

    const rbbFacingOptions = getMasonryFacingOptions(prices, 'rbb');
    const backsideFacingOptions = getMasonryFacingOptions(prices, 'backside');
    const raisedSpaFacingOptions = getMasonryFacingOptions(prices, 'raisedSpa');

    const getRockworkMaterialWaste = (facingKey: string, hasExplicitQty: boolean): number => {
      if (hasExplicitQty) return 1; // caller already applied waste
      if (facingKey === 'panel-ledge' || facingKey === 'stacked-stone') {
        return pricingData.tileCoping.rockworkMaterialWaste?.panelLedge ?? 1.15;
      }
      return 1;
    };

    const addFacing = (
      description: string,
      sqft: number,
      facingKey: string,
      catalog: 'rbb' | 'backside' | 'raisedSpa',
      materialQtyOverride?: number
    ) => {
      const normalizedFacing = normalizeMasonryFacingId(facingKey);
      const laborRate = getMasonryFacingRate(prices, catalog, normalizedFacing, 'labor');
      const materialRate = getMasonryFacingRate(prices, catalog, normalizedFacing, 'material');
      const baseMaterialQty = materialQtyOverride ?? sqft;
      const materialQty =
        Math.round(baseMaterialQty * getRockworkMaterialWaste(normalizedFacing, materialQtyOverride !== undefined) * 100) / 100;
      labor.push({
        category: 'Masonry Labor',
        description,
        unitPrice: laborRate,
        quantity: sqft,
        total: laborRate * sqft,
      });
      material.push({
        category: 'Masonry Material',
        description,
        unitPrice: materialRate,
        quantity: materialQty,
        total: materialRate * materialQty,
      });
    };

    // Columns (only bill when a facing is selected, mirroring NEW POOL!C40 gating)
    const hasColumnFacingSelected = !!(
      excavation.columns.facing &&
      normalizeMasonryFacingId(excavation.columns.facing) !== 'none'
    );
    if (excavation.columns.count > 0 && hasColumnFacingSelected) {
      const totalHeight = excavation.columns.count * excavation.columns.height;
      labor.push({
        category: 'Masonry Labor',
        description: 'Columns',
        unitPrice: prices.columnBase,
        quantity: totalHeight,
        total: prices.columnBase * totalHeight,
      });

      const facingLabel = formatMasonryFacingLabel(excavation.columns.facing, rbbFacingOptions);
      const perimeter = 2 * (excavation.columns.width + excavation.columns.depth);
      const totalFacing = excavation.columns.count * perimeter * excavation.columns.height;
      addFacing(`Column ${facingLabel} Facing`, totalFacing, excavation.columns.facing, 'rbb');
    }

    // RBB facing
    excavation.rbbLevels.forEach((level) => {
      if (level.length > 0 && normalizeMasonryFacingId(level.facing) !== 'none') {
        const sqft = level.length * (level.height / 12);
        const facingLabel = formatMasonryFacingLabel(level.facing, rbbFacingOptions);
        addFacing(`${level.height}" RBB ${facingLabel} Facing`, sqft, level.facing, 'rbb');
        const explicitBacksideFacing = normalizeMasonryFacingId(level.backsideFacing);
        if (
          options.allowDistinctRbbBacksideFacing &&
          explicitBacksideFacing &&
          explicitBacksideFacing !== 'none'
        ) {
          const backsideFacingLabel = formatMasonryFacingLabel(
            explicitBacksideFacing,
            backsideFacingOptions
          );
          addFacing(
            `Backside ${backsideFacingLabel} Facing`,
            sqft,
            explicitBacksideFacing,
            'backside'
          );
        } else if (level.hasBacksideFacing && (!options.allowDistinctRbbBacksideFacing || !explicitBacksideFacing)) {
          // Preserve legacy proposals that selected the old same-facing backside toggle.
          addFacing(`Backside ${facingLabel} Facing`, sqft, level.facing, 'rbb');
        }
      }
    });

    // Exposed pool wall facing
    (excavation.exposedPoolWallLevels ?? []).forEach((level) => {
      if (level.length > 0 && normalizeMasonryFacingId(level.facing) !== 'none') {
        const sqft = level.length * (level.height / 12);
        const facingLabel = formatMasonryFacingLabel(level.facing, rbbFacingOptions);
        addFacing(`Exposed Pool Wall ${facingLabel} Facing`, sqft, level.facing, 'rbb');
      }
    });

    // Raised spa facing
    if (poolSpecs.isRaisedSpa && normalizeMasonryFacingId(poolSpecs.raisedSpaFacing) !== 'none') {
      const spaPerimeter = poolSpecs.spaPerimeter || PoolCalculations.calculateSpaPerimeter(poolSpecs);
      const raisedHeight = 1.5; // 18 inches
      const wasteFactor = prices.raisedSpaWasteMultiplier ?? 1;
      const materialWaste = prices.raisedSpaMaterialWaste ?? 1;
      const laborSqft = Math.round(spaPerimeter * raisedHeight * wasteFactor);
      const materialSqft = Math.round(laborSqft * materialWaste * 100) / 100;
      const facingLabel = formatMasonryFacingLabel(poolSpecs.raisedSpaFacing, raisedSpaFacingOptions);
      addFacing(`Raised Spa ${facingLabel} Facing`, laborSqft, poolSpecs.raisedSpaFacing, 'raisedSpa', materialSqft);
    }

    // Spillway for raised spa
    if (poolSpecs.isRaisedSpa) {
      labor.push({
        category: 'Masonry Labor',
        description: 'Spillway Labor',
        unitPrice: prices.labor.spillway,
        quantity: 1,
        total: prices.labor.spillway,
      });
      material.push({
        category: 'Masonry Material',
        description: 'Spillway Material',
        unitPrice: prices.material.spillway,
        quantity: 1,
        total: prices.material.spillway,
      });
    }

    // Retaining wall (from MASONRY sheet)
    const hasMultipleRetainingWalls = retainingWalls.length > 1;
    retainingWalls.forEach((wall, index) => {
      const typeName = (wall.type || '').trim();
      if (!typeName || typeName === 'None' || typeName === 'No Retaining Wall') return;
      const retaining = prices.retainingWalls?.find((r: any) => r.name === typeName);
      const lnft = wall.length ?? 0;
      if (!retaining || lnft <= 0 || retaining.costPerSqft <= 0) return;
      const sqft = retaining.heightFt * lnft;
      // Cost per sqft is already uplifted in sheet; we separate labor/material evenly
      const total = retaining.costPerSqft * sqft;
      const description = hasMultipleRetainingWalls
        ? `Retaining Wall #${index + 1} - ${retaining.name}`
        : retaining.name;
      labor.push({
        category: 'Masonry Labor',
        description,
        unitPrice: total,
        quantity: 1,
        total,
      });
      material.push({
        category: 'Masonry Material',
        description: hasMultipleRetainingWalls
          ? `Retaining Wall #${index + 1} - ${retaining.name} Material`
          : `${retaining.name} Material`,
        unitPrice: 0,
        quantity: lnft,
        total: 0,
      });
    });

    return { labor, material };
  }
}

// Export all calculation classes together
export const CalculationModules = {
  Pool: PoolCalculations,
  TileCopingDecking: TileCopingDeckingCalculations,
  Drainage: DrainageCalculations,
  Equipment: EquipmentCalculations,
  WaterFeatures: WaterFeaturesCalculations,
  InteriorFinish: InteriorFinishCalculations,
  Cleanup: CleanupCalculations,
  Fiberglass: FiberglassCalculations,
  Masonry: MasonryCalculations,
};
