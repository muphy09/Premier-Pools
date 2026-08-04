import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addPricingListItem,
  getPricingDataSnapshot,
  initPricingDataStore,
  getActiveFranchiseId,
  getActivePricingModelMeta,
  clearActivePricingModelMeta,
  getActivePricingTierId,
  getNormalPricingDataSnapshot,
  isActiveBronzeLockedPricingPath,
  savePricingModelSnapshot,
  setActivePricingModel,
  setActivePricingTier,
  removePricingListItem,
  resetPricingTierOverride,
  subscribeToPricingData,
  updatePricingListItem,
  updatePricingValue,
} from '../services/pricingDataStore';
import {
  buildPricingFieldLabelOverrideKey,
  loadPricingFieldLabelOverrides,
  savePricingFieldLabelOverrides,
  type PricingFieldLabelOverrides,
} from '../services/pricingFieldLabels';
import {
  listPricingModels,
  listPricingModelRevisions,
  setDefaultPricingModel,
  deletePricingModel as deletePricingModelRemote,
  type PricingModelRevisionSummary,
} from '../services/pricingModelsAdapter';
import { getDefaultCleanerIndex } from '../utils/cleanerDefaults';
import { normalizeEquipmentPackageOptions } from '../utils/equipmentPackages';
import { slugifyMasonryFacingId } from '../utils/masonryFacing';
import {
  DEFAULT_TRIM_TILE_OPTION_ID,
  normalizeCopingOptionId,
  normalizeDeckingOptionId,
  normalizeTileOptionId,
  normalizeTrimTileOptionId,
} from '../utils/tileCopingCatalogs';
import {
  PRICING_TIER_OPTIONS,
  arePricingValuesEqual,
  isBronzePricingTier,
  normalizePricingTierId,
} from '../services/pricingTiers';
import { isPpasEastFranchiseCode } from '../utils/franchiseScope';
import './PricingDataModal.css';

type Path = (string | number)[];

type ScalarField = {
  label: string;
  path: Path;
  valuePath?: Path;
  type: 'number' | 'boolean' | 'text';
  note?: string;
  tooltip?: string;
  prefix?: string;
  isPercent?: boolean;
  disabled?: boolean;
  isUnused?: boolean;
};

type AdditionalFeatureField = ScalarField & {
  defaultEnabledPath: Path;
};

type ListFieldOption = {
  label: string;
  value: string;
};

type ListFieldOptionsResolver = (context: {
  data: any;
  list: ListConfig;
  entry?: any;
  index?: number;
}) => ListFieldOption[];

type ListField = {
  key: string;
  label: string;
  type: 'number' | 'boolean' | 'text' | 'select';
  placeholder?: string;
  prefix?: string;
  tooltip?: string;
  options?: ListFieldOption[] | ListFieldOptionsResolver;
  defaultValue?: string | number | boolean;
  allowBlank?: boolean;
  hidden?: (entry: any) => boolean;
  readOnly?: boolean | ((entry: any, index: number) => boolean);
};

type ListConfig = {
  title: string;
  path: Path;
  fields: ListField[];
  addLabel: string;
  defaultItem?: Record<string, any> | (() => Record<string, any>);
  variant?: 'card' | 'table';
  emptyMessage?: string;
  allowAdd?: boolean;
  allowRemove?: boolean;
  canRemove?: (entry: any, index: number) => boolean;
};

type Group = {
  title: string;
  scalars?: ScalarField[];
  scalarTable?: {
    title: string;
    rows: AdditionalFeatureField[];
  };
  lists?: ListConfig[];
  render?: () => JSX.Element;
};

type Section = {
  title: string;
  groups: Group[];
};

type ActiveListFieldRename = {
  cellKey: string;
  overrideKey: string;
  defaultLabel: string;
};

type SelectedListItem = {
  sectionTitle: string;
  groupTitle: string;
  listPathKey: string;
  index: number;
};

type SelectedAdditionalFeature = {
  sectionTitle: string;
  groupTitle: string;
  rowPathKey: string;
};

const getValue = (target: any, path: Path) =>
  path.reduce((acc, key) => (acc ? acc[key] : undefined), target);

const toNumber = (value: string) => {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const emptyFromFields = (fields: ListField[]) =>
  fields.reduce<Record<string, any>>((acc, field) => {
    acc[field.key] =
      field.defaultValue !== undefined
        ? field.defaultValue
        : field.type === 'number'
          ? field.allowBlank
            ? undefined
            : 0
          : field.type === 'boolean'
            ? false
            : '';
    return acc;
  }, {});

const getPathKey = (path: Path) => path.join('.');

interface PricingDataModalProps {
  onClose: () => void;
  franchiseId?: string | null;
  franchiseCode?: string | null;
  initialModelId?: string | null;
}

const PricingDataModal: React.FC<PricingDataModalProps> = ({ onClose, franchiseId, franchiseCode, initialModelId }) => {
  const [data, setData] = useState(getPricingDataSnapshot());
  const [normalData, setNormalData] = useState(getNormalPricingDataSnapshot());
  const [selectedPricingTierId, setSelectedPricingTierId] = useState<string>(() => getActivePricingTierId());
  const [isInitializing, setIsInitializing] = useState(true);
  const [fieldLabelOverrides, setFieldLabelOverrides] = useState<PricingFieldLabelOverrides>({});
  const [activeListFieldRename, setActiveListFieldRename] = useState<ActiveListFieldRename | null>(null);
  const [activeListFieldRenameDraft, setActiveListFieldRenameDraft] = useState('');
  const [pricingModels, setPricingModels] = useState<any[]>([]);
  const [pricingModelRevisions, setPricingModelRevisions] = useState<PricingModelRevisionSummary[]>([]);
  const [viewingHistoricalRevision, setViewingHistoricalRevision] = useState<PricingModelRevisionSummary | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    const meta = getActivePricingModelMeta();
    return meta.pricingModelId || null;
  });
  const [modelName, setModelName] = useState('');
  const [hideModelFromView, setHideModelFromView] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [activatedFlash, setActivatedFlash] = useState(false);
  const [activeSectionTitle, setActiveSectionTitle] = useState<string>('');
  const [selectedListItem, setSelectedListItem] = useState<SelectedListItem | null>(null);
  const [selectedAdditionalFeature, setSelectedAdditionalFeature] = useState<SelectedAdditionalFeature | null>(null);
  const activateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<{ id: string; name: string } | null>(null);
  const pricingPageRef = useRef<HTMLDivElement | null>(null);
  const floatingTooltipRef = useRef<HTMLDivElement | null>(null);
  const [floatingTooltip, setFloatingTooltip] = useState<{
    text: string;
    anchor: { top: number; right: number; bottom: number; left: number; width: number };
  } | null>(null);
  const [floatingTooltipPosition, setFloatingTooltipPosition] = useState<{ top: number; left: number } | null>(null);
  const labelFranchiseId = franchiseId || getActiveFranchiseId() || 'default';
  const isPpasEast = isPpasEastFranchiseCode(franchiseCode);
  const activeRenameInputRef = useRef<HTMLInputElement | null>(null);
  const updateTooltipAlign = (e: React.MouseEvent<HTMLSpanElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const ratio = center / vw;
    let align: 'left' | 'right' | 'center' = 'center';
    if (ratio < 0.4) align = 'left';
    else if (ratio > 0.6) align = 'right';
    e.currentTarget.dataset.align = align;
  };
  const updateLabelTooltip = (e: React.MouseEvent<HTMLSpanElement>) => {
    const target = e.currentTarget;
    const clip = target.firstElementChild as HTMLElement | null;
    const isTruncated = clip ? clip.scrollWidth > clip.clientWidth : target.scrollWidth > target.clientWidth;
    target.dataset.truncated = isTruncated ? 'true' : 'false';
    if (!isTruncated) {
      delete target.dataset.align;
      return;
    }
    const rect = target.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const ratio = center / vw;
    let align: 'left' | 'right' | 'center' = 'center';
    if (ratio < 0.4) align = 'left';
    else if (ratio > 0.6) align = 'right';
    target.dataset.align = align;
  };

  const getPricingTooltipTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const tooltipTarget = target.closest<HTMLElement>('[data-tooltip]');
    if (!tooltipTarget || !pricingPageRef.current?.contains(tooltipTarget)) return null;
    const text = tooltipTarget.dataset.tooltip?.trim();
    if (!text) return null;

    if (tooltipTarget.classList.contains('pricing-field__label-text')) {
      const clippedText = tooltipTarget.firstElementChild as HTMLElement | null;
      const isTruncated = clippedText
        ? clippedText.scrollWidth > clippedText.clientWidth
        : tooltipTarget.scrollWidth > tooltipTarget.clientWidth;
      if (!isTruncated) return null;
    }

    return tooltipTarget;
  };

  const showFloatingPricingTooltip = (target: EventTarget | null) => {
    const tooltipTarget = getPricingTooltipTarget(target);
    if (!tooltipTarget) return;
    const rect = tooltipTarget.getBoundingClientRect();
    setFloatingTooltipPosition(null);
    setFloatingTooltip({
      text: tooltipTarget.dataset.tooltip!.trim(),
      anchor: {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
      },
    });
  };

  const hideFloatingPricingTooltip = () => {
    setFloatingTooltip(null);
    setFloatingTooltipPosition(null);
  };

  const handlePricingTooltipPointerOut = (event: React.PointerEvent<HTMLDivElement>) => {
    const previousTarget = getPricingTooltipTarget(event.target);
    const nextTarget = getPricingTooltipTarget(event.relatedTarget);
    if (previousTarget && previousTarget === nextTarget) return;
    hideFloatingPricingTooltip();
  };

  const handlePricingTooltipBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const previousTarget = getPricingTooltipTarget(event.target);
    const nextTarget = getPricingTooltipTarget(event.relatedTarget);
    if (previousTarget && previousTarget === nextTarget) return;
    hideFloatingPricingTooltip();
  };

  useLayoutEffect(() => {
    if (!floatingTooltip || !floatingTooltipRef.current) return;
    const tooltipRect = floatingTooltipRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const edgeGap = 12;
    const anchorGap = 9;

    let left = floatingTooltip.anchor.left + floatingTooltip.anchor.width / 2 - tooltipRect.width / 2;
    left = Math.max(edgeGap, Math.min(left, viewportWidth - tooltipRect.width - edgeGap));

    const aboveTop = floatingTooltip.anchor.top - tooltipRect.height - anchorGap;
    const belowTop = floatingTooltip.anchor.bottom + anchorGap;
    const hasRoomAbove = aboveTop >= edgeGap;
    const hasRoomBelow = belowTop + tooltipRect.height <= viewportHeight - edgeGap;
    let top = hasRoomAbove || !hasRoomBelow ? aboveTop : belowTop;
    top = Math.max(edgeGap, Math.min(top, viewportHeight - tooltipRect.height - edgeGap));

    setFloatingTooltipPosition({ top, left });
  }, [floatingTooltip]);

  useEffect(() => {
    if (!floatingTooltip) return;
    window.addEventListener('resize', hideFloatingPricingTooltip);
    window.addEventListener('scroll', hideFloatingPricingTooltip, true);
    return () => {
      window.removeEventListener('resize', hideFloatingPricingTooltip);
      window.removeEventListener('scroll', hideFloatingPricingTooltip, true);
    };
  }, [floatingTooltip]);

  const renderLabelText = (text: string) => (
    <span className="pricing-field__label-text" data-tooltip={text} onMouseEnter={updateLabelTooltip}>
      <span className="pricing-field__label-text-clip">{text}</span>
    </span>
  );

  useEffect(() => {
    let cancelled = false;
    const targetFranchise = franchiseId || getActiveFranchiseId();
    setIsInitializing(true);
    setModelName('');
    setHideModelFromView(false);
    setSelectedModelId(null);
    setPricingModelRevisions([]);
    setViewingHistoricalRevision(null);
    setHasChanges(false);
    setSelectedListItem(null);
    setSelectedAdditionalFeature(null);
    setFieldLabelOverrides(loadPricingFieldLabelOverrides(targetFranchise || 'default'));
    setActiveListFieldRename(null);
    setActiveListFieldRenameDraft('');
    const unsubscribe = subscribeToPricingData((nextData) => {
      if (!cancelled) {
        setData(nextData);
        setNormalData(getNormalPricingDataSnapshot());
        setSelectedPricingTierId(getActivePricingTierId());
      }
    });
    const load = async () => {
      try {
        await initPricingDataStore(targetFranchise || undefined, undefined, undefined, selectedPricingTierId);
        if (cancelled) return;
        setData(getPricingDataSnapshot());
        setNormalData(getNormalPricingDataSnapshot());
        setSelectedPricingTierId(getActivePricingTierId());
        await loadModels(targetFranchise, initialModelId);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [franchiseId, initialModelId]);

  useEffect(() => {
    if (!activeListFieldRename || !activeRenameInputRef.current) {
      return;
    }
    activeRenameInputRef.current.focus();
    activeRenameInputRef.current.select();
  }, [activeListFieldRename]);

  const emitModelsUpdated = () => {
    window.dispatchEvent(new Event('pricing-models-updated'));
  };

  const loadModels = async (targetFranchiseId?: string, preferredModelId?: string | null) => {
    const idToUse = targetFranchiseId || getActiveFranchiseId();
    try {
      const rows = await listPricingModels(idToUse);
      setPricingModels(rows || []);
      let activeMeta = getActivePricingModelMeta();
      setSelectedPricingTierId(activeMeta.pricingTierId || getActivePricingTierId());
      if (rows?.length) {
        const preferredModel = preferredModelId
          ? rows.find((model) => model.id === preferredModelId)
          : null;
        if (preferredModel && activeMeta.pricingModelId !== preferredModel.id) {
          await setActivePricingModel(preferredModel.id, undefined, activeMeta.pricingTierId || selectedPricingTierId);
          activeMeta = getActivePricingModelMeta();
          setData(getPricingDataSnapshot());
          setNormalData(getNormalPricingDataSnapshot());
          setSelectedPricingTierId(getActivePricingTierId());
        }
        let historyModelId: string | null = null;
        if (activeMeta.pricingModelId) {
          const activeModel = rows.find((model) => model.id === activeMeta.pricingModelId);
          setSelectedModelId(activeMeta.pricingModelId);
          historyModelId = activeMeta.pricingModelId;
          setModelName(
            activeMeta.pricingModelName ||
              activeModel?.name ||
              ''
          );
          setHideModelFromView(Boolean(activeModel?.isHiddenFromView));
        } else {
          const fallback = rows.find((m) => m.isDefault) || rows[0];
          setSelectedModelId(fallback?.id ?? null);
          historyModelId = fallback?.id ?? null;
          setModelName(fallback?.name || '');
          setHideModelFromView(Boolean(fallback?.isHiddenFromView));
        }
        if (historyModelId) {
          setPricingModelRevisions(await listPricingModelRevisions(idToUse, historyModelId));
        } else {
          setPricingModelRevisions([]);
        }
      } else {
        // New franchise: keep name empty, no selected model
        setSelectedModelId(null);
        setModelName('');
        setHideModelFromView(false);
        setPricingModelRevisions([]);
      }
      setViewingHistoricalRevision(null);
      setHasChanges(false);
    } catch (error) {
      console.warn('Unable to load pricing models', error);
    }
  };

  const handleLoadModel = async (modelId: string) => {
    setSelectedModelId(modelId);
    setIsInitializing(true);
    try {
      await setActivePricingModel(modelId, undefined, selectedPricingTierId);
      setViewingHistoricalRevision(null);
      const revisions = await listPricingModelRevisions(
        franchiseId || getActiveFranchiseId(),
        modelId
      );
      setPricingModelRevisions(revisions);
      const meta = getActivePricingModelMeta();
      const selectedRow = pricingModels.find((model) => model.id === modelId);
      setModelName(meta.pricingModelName || selectedRow?.name || '');
      setHideModelFromView(Boolean(selectedRow?.isHiddenFromView));
      setData(getPricingDataSnapshot());
      setNormalData(getNormalPricingDataSnapshot());
      setSelectedPricingTierId(getActivePricingTierId());
      setSelectedListItem(null);
      setSelectedAdditionalFeature(null);
      setPricingModels((prev) =>
        prev.map((m) => ({ ...m, isDefault: m.id === modelId ? m.isDefault : m.isDefault }))
      );
      setHasChanges(false);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    if (!modelId) {
      setSelectedModelId(null);
      setHideModelFromView(false);
      return;
    }
    await handleLoadModel(modelId);
    setHasChanges(false);
  };

  const handleSelectPricingTier = async (tierId: string) => {
    const nextTierId = normalizePricingTierId(tierId);
    setSelectedPricingTierId(nextTierId);
    setIsInitializing(true);
    try {
      await setActivePricingTier(nextTierId);
      setData(getPricingDataSnapshot());
      setNormalData(getNormalPricingDataSnapshot());
      setSelectedListItem(null);
      setSelectedAdditionalFeature(null);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSaveModel = async () => {
    if (viewingHistoricalRevision) {
      setSaveError('Historical pricing revisions are read-only. Return to the current revision to make changes.');
      return;
    }
    if (!modelName.trim()) {
      setSaveError('Please provide a model name.');
      return;
    }
    if (selectedModelIsDefault && hideModelFromView) {
      setSaveError('Active pricing models cannot be hidden. Set another model as active first.');
      return;
    }
    setSaveError(null);
    setSavingModel(true);
    try {
      const savedModel = await savePricingModelSnapshot({
        name: modelName.trim(),
        setDefault: false,
        isHiddenFromView: hideModelFromView,
        createNew: savingAsNew,
      });
      if (savedModel?.pricingModelId) {
        await setActivePricingModel(savedModel.pricingModelId, undefined, selectedPricingTierId);
        setData(getPricingDataSnapshot());
        setNormalData(getNormalPricingDataSnapshot());
        setSelectedPricingTierId(getActivePricingTierId());
      }
      setSavingAsNew(false);
      await loadModels();
      emitModelsUpdated();
      setHasChanges(false);
    } catch (error: any) {
      setSaveError(error?.message || 'Unable to save pricing model.');
    } finally {
      setSavingModel(false);
    }
  };

  const handleViewHistoricalRevision = async (revision: PricingModelRevisionSummary) => {
    if (!selectedModelId) return;
    setIsInitializing(true);
    setSaveError(null);
    try {
      await setActivePricingModel(
        selectedModelId,
        franchiseId || getActiveFranchiseId(),
        selectedPricingTierId,
        revision.id
      );
      setData(getPricingDataSnapshot());
      setNormalData(getNormalPricingDataSnapshot());
      setViewingHistoricalRevision(revision);
      setHasChanges(false);
      setSelectedListItem(null);
      setSelectedAdditionalFeature(null);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleReturnToCurrentRevision = async () => {
    if (!selectedModelId) return;
    await handleLoadModel(selectedModelId);
  };

  const handleCreateNewModel = async () => {
    setIsInitializing(true);
    try {
      clearActivePricingModelMeta();
      await setActivePricingTier('normal');
      setSelectedModelId(null);
      setModelName('');
      setSaveError(null);
      setSelectedListItem(null);
      setSelectedAdditionalFeature(null);
      setSavingAsNew(true);
      setSelectedPricingTierId(getActivePricingTierId());
      setData(getPricingDataSnapshot());
      setNormalData(getNormalPricingDataSnapshot());
      setHasChanges(false);
    } catch (error) {
      console.warn('Unable to start new pricing model', error);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleDeleteModel = async (modelId: string, isDefault: boolean) => {
    if (isDefault) {
      setSaveError('Cannot delete the active pricing model. Set another model as active first.');
      return;
    }
    try {
      await deletePricingModelRemote({
        franchiseId: franchiseId || getActiveFranchiseId(),
        pricingModelId: modelId,
      });
      if (modelId === getActivePricingModelMeta().pricingModelId) {
        const def = pricingModels.find((m) => m.isDefault && m.id !== modelId) || pricingModels.find((m) => m.id !== modelId);
        if (def) {
          await handleLoadModel(def.id);
        }
      }
      await loadModels(franchiseId || getActiveFranchiseId());
    } catch (error: any) {
      setSaveError(error?.message || 'Unable to delete pricing model.');
    }
  };

  const handleSetDefault = async (modelId: string) => {
    try {
      await setDefaultPricingModel({
        franchiseId: franchiseId || getActiveFranchiseId(),
        pricingModelId: modelId,
      });
      await loadModels(franchiseId || getActiveFranchiseId());
      emitModelsUpdated();
      const meta = getActivePricingModelMeta();
      setModelName(meta.pricingModelName || modelName);
      setHasChanges(false);
    } catch (error) {
      console.warn('Unable to set active pricing model', error);
    }
  };

  const handleScalarChange = (field: ScalarField, value: string | boolean) => {
    if (isActiveBronzeLockedPricingPath(field.path)) return;
    let parsed: any = value;
    if (field.type === 'number') {
      const numericValue = typeof value === 'string' ? toNumber(value) : Number(value);
      parsed = field.isPercent ? numericValue / 100 : numericValue;
    } else if (field.type === 'boolean') {
      parsed = Boolean(value);
    }
    updatePricingValue(field.path, parsed);
    if (field.path.join('.') === 'plumbing.twoInchPipe') {
      updatePricingValue(['plumbing', 'waterFeatureRun', 'perFt'], parsed);
    }
    if (field.path.join('.') === 'tileCoping.tile.labor.level1') {
      updatePricingValue(['tileCoping', 'tile', 'labor', 'level2'], parsed);
      updatePricingValue(['tileCoping', 'tile', 'labor', 'level3'], parsed);
    }
    setHasChanges(true);
  };

  const handleListChange = (list: ListConfig, index: number, field: ListField, raw: any) => {
    if (isActiveBronzeLockedPricingPath([...list.path, index, field.key])) return;
    const parsed =
      field.type === 'number'
        ? field.allowBlank && String(raw).trim() === ''
          ? undefined
          : toNumber(String(raw))
        : field.type === 'boolean'
          ? Boolean(raw)
          : String(raw);
    const isDefaultLightChoice =
      field.key === 'defaultLightChoice' &&
      list.path[0] === 'equipment' &&
      list.path[1] === 'lights' &&
      (list.path[2] === 'poolLights' || list.path[2] === 'spaLights');
    const isDefaultAuxiliaryPump =
      field.key === 'defaultAuxiliaryPump' &&
      list.path[0] === 'equipment' &&
      list.path[1] === 'auxiliaryPumps';
    const isDefaultCleaner =
      field.key === 'defaultCleaner' &&
      list.path[0] === 'equipment' &&
      list.path[1] === 'cleaners';

    if (isDefaultLightChoice && parsed) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const nextList = entries.map((entry, idx) => ({
        ...entry,
        defaultLightChoice: idx === index,
      }));
      updatePricingValue(list.path, nextList);
      setHasChanges(true);
      return;
    }
    if (isDefaultAuxiliaryPump && parsed) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const nextList = entries.map((entry, idx) => ({
        ...entry,
        defaultAuxiliaryPump: idx === index,
      }));
      updatePricingValue(list.path, nextList);
      setHasChanges(true);
      return;
    }
    if (isDefaultCleaner) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const currentDefaultIndex = getDefaultCleanerIndex(entries);
      const nextDefaultIndex = parsed ? index : currentDefaultIndex;
      const nextList = entries.map((entry, idx) => ({
        ...entry,
        defaultCleaner: idx === nextDefaultIndex,
      }));
      updatePricingValue(list.path, nextList);
      setHasChanges(true);
      return;
    }

    const isInteriorFinishName =
      field.key === 'name' && list.path[0] === 'interiorFinish' && list.path[1] === 'finishes';
    if (isInteriorFinishName) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const existing = entries[index] || {};
      if (!existing.id) {
        const nextId = slugify(String(parsed));
        if (nextId) {
          updatePricingListItem(list.path, index, 'id', nextId);
        }
      }
    }

    const isMasonryFacingName =
      field.key === 'name' &&
      list.path[0] === 'masonry' &&
      (list.path[1] === 'rbbFacingOptions' ||
        list.path[1] === 'backsideFacingOptions' ||
        list.path[1] === 'raisedSpaFacingOptions');
    if (isMasonryFacingName) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const existing = entries[index] || {};
      if (!existing.id) {
        const baseId = slugifyMasonryFacingId(String(parsed));
        let nextId = baseId;
        let suffix = 2;
        while (
          nextId &&
          entries.some((entry, entryIndex) => entryIndex !== index && String(entry?.id || '').trim() === nextId)
        ) {
          nextId = `${baseId}-${suffix}`;
          suffix += 1;
        }
        if (nextId) {
          updatePricingListItem(list.path, index, 'id', nextId);
        }
      }
    }

    const isGroupedCustomFeatureName =
      field.key === 'name' && list.path[0] === 'customFeatures' && list.path[1] === 'groupedOptions';
    if (isGroupedCustomFeatureName) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const existing = entries[index] || {};
      if (!existing.id) {
        const baseId = slugify(String(parsed)) || `custom-feature-${index + 1}`;
        let nextId = baseId;
        let suffix = 2;
        while (
          nextId &&
          entries.some((entry, entryIndex) => entryIndex !== index && String(entry?.id || '').trim() === nextId)
        ) {
          nextId = `${baseId}-${suffix}`;
          suffix += 1;
        }
        if (nextId) {
          updatePricingListItem(list.path, index, 'id', nextId);
        }
      }
    }

    const isAdditionalDeckingOptionName =
      field.key === 'name' &&
      list.path[0] === 'tileCoping' &&
      list.path[1] === 'decking' &&
      list.path[2] === 'additionalOptions';
    const isTileCatalogOptionName =
      field.key === 'name' &&
      list.path[0] === 'tileCoping' &&
      list.path[1] === 'tile' &&
      list.path[2] === 'options';
    const isTrimTileCatalogOptionName =
      field.key === 'name' &&
      list.path[0] === 'tileCoping' &&
      list.path[1] === 'tile' &&
      list.path[2] === 'stepTrimOptions';
    const isCopingCatalogOptionName =
      field.key === 'name' &&
      list.path[0] === 'tileCoping' &&
      list.path[1] === 'coping' &&
      list.path[2] === 'options';
    const isDeckingCatalogOptionName =
      field.key === 'name' &&
      list.path[0] === 'tileCoping' &&
      list.path[1] === 'decking' &&
      list.path[2] === 'options';
    if (isAdditionalDeckingOptionName) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const existing = entries[index] || {};
      if (!existing.id) {
        const baseId = slugify(String(parsed)) || `additional-decking-${index + 1}`;
        let nextId = baseId;
        let suffix = 2;
        while (
          nextId &&
          entries.some((entry, entryIndex) => entryIndex !== index && String(entry?.id || '').trim() === nextId)
        ) {
          nextId = `${baseId}-${suffix}`;
          suffix += 1;
        }
        if (nextId) {
          updatePricingListItem(list.path, index, 'id', nextId);
        }
      }
    }

    if (
      isTileCatalogOptionName ||
      isTrimTileCatalogOptionName ||
      isCopingCatalogOptionName ||
      isDeckingCatalogOptionName
    ) {
      const entries = (getValue(data, list.path) as any[]) || [];
      const existing = entries[index] || {};
      if (!existing.id) {
        const normalizeId = isTileCatalogOptionName
          ? normalizeTileOptionId
          : isTrimTileCatalogOptionName
            ? normalizeTrimTileOptionId
          : isCopingCatalogOptionName
            ? normalizeCopingOptionId
            : normalizeDeckingOptionId;
        const baseId = normalizeId(String(parsed)) || `option-${index + 1}`;
        let nextId = baseId;
        let suffix = 2;
        while (
          nextId &&
          entries.some((entry, entryIndex) => entryIndex !== index && String(entry?.id || '').trim() === nextId)
        ) {
          nextId = `${baseId}-${suffix}`;
          suffix += 1;
        }
        if (nextId) {
          updatePricingListItem(list.path, index, 'id', nextId);
        }
      }
    }

    updatePricingListItem(list.path, index, field.key, parsed);
    setHasChanges(true);
  };


  const handleAddListItem = (list: ListConfig) => {
    const defaults =
      typeof list.defaultItem === 'function' ? list.defaultItem() : list.defaultItem || {};
    addPricingListItem(list.path, { ...emptyFromFields(list.fields), ...defaults });
    setHasChanges(true);
  };

  const handleRemoveListItem = (list: ListConfig, index: number) => {
    removePricingListItem(list.path, index);
    setHasChanges(true);
  };

  const canRemoveListItem = (list: ListConfig, entry: any, index: number) =>
    list.allowRemove !== false && (list.canRemove ? list.canRemove(entry, index) : true);

  const selectedModel = selectedModelId ? pricingModels.find((m) => m.id === selectedModelId) : null;
  const selectedModelIsDefault = Boolean(selectedModel?.isDefault);
  const selectedModelIsHiddenFromView = Boolean(hideModelFromView);
  const currentPricingRevision = pricingModelRevisions[0] || null;
  const getSectionGlyph = (title: string) => {
    const parts = title.split(' ').filter(Boolean);
    const abbreviation = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).trim();
    return (abbreviation || title.slice(0, 2) || '•').toUpperCase().slice(0, 2);
  };

  const renderSectionIcon = (title: string) => {
    const icons: Record<string, JSX.Element> = {
      'Discounts / Adjustments': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 18l12-12" />
          <circle cx="8" cy="8" r="2.25" />
          <circle cx="16" cy="16" r="2.25" />
        </svg>
      ),
      'Plans & Engineering': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="4" width="12" height="14" rx="2" />
          <path d="M9 8h4M9 11h6M9 14h3" />
        </svg>
      ),
      'Layout & Permit': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="5" width="12" height="14" rx="2" />
          <path d="M9 3h6v4H9z" />
          <path d="M9 10h6M9 13h6M9 16h4" />
        </svg>
      ),
      'Pool Specifications': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 15c2.1-2 4.2-2 6.3 0s4.2 2 6.3 0 3.4-2 3.4-2" />
          <path d="M5 18c1.8-1.5 3.6-1.5 5.4 0s3.6 1.5 5.4 0 3.2-1.5 3.2-1.5" />
          <path d="M6 11V6h4v5M8 6V3M8 4h4" />
        </svg>
      ),
      Excavation: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 13l4-4 2 2-4 4-2 2-2-2z" />
          <path d="M14 5l3-3 2 2-3 3z" />
          <path d="M13 6l2 2" />
        </svg>
      ),
      Plumbing: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10h8a2 2 0 012 2v6" />
          <path d="M12 6V4a2 2 0 012-2h4" />
          <path d="M16 12h4" />
          <circle cx="16" cy="18" r="2" />
        </svg>
      ),
      'Water Features': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5s5 5.2 5 9a5 5 0 11-10 0c0-3.8 5-9 5-9z" />
        </svg>
      ),
      'Electrical & Gas': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13 2L5 14h6l-2 8 8-12h-6z" />
        </svg>
      ),
      Steel: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 8h14M5 12h14M5 16h14" />
          <path d="M7 6v12M17 6v12" />
        </svg>
      ),
      'Shotcrete Labor': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 8l5-4 3 3-2 2 6 6-2 2-6-6-2 2z" />
        </svg>
      ),
      'Shotcrete Material': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 5l5-3 5 3v6l-5 3-5-3z" />
          <path d="M12 11v6" />
          <path d="M17 14l-5 3-5-3" />
        </svg>
      ),
      'Tile, Coping & Decking': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z" />
        </svg>
      ),
      'Water Treatment': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.5s5 5.2 5 9a5 5 0 11-10 0c0-3.8 5-9 5-9z" />
          <path d="M9.5 14.5c.5 1 1.7 1.8 3 1.8a3 3 0 002.5-1.4" />
        </svg>
      ),
      Lighting: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3a5 5 0 015 5 5 5 0 01-2.5 4.3L14 15h-4l-.5-2.7A5 5 0 017 8a5 5 0 015-5z" />
          <path d="M10 18h4M11 21h2" />
        </svg>
      ),
      Cleanup: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 19h14" />
          <path d="M7 19l2-9h6l2 9" />
          <path d="M9 7h6" />
        </svg>
      ),
      Misc: (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4v4" />
          <path d="M12 16v4" />
          <path d="M4 12h4" />
          <path d="M16 12h4" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ),
      'Custom Features': (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />
        </svg>
      ),
    };

    return (
      <span className="pricing-section__icon">
        {icons[title] || <span className="pricing-section__glyph-letter">{getSectionGlyph(title)}</span>}
      </span>
    );
  };

  const handleActivateSelected = async () => {
    if (!selectedModelId) return;
    if (selectedModelIsHiddenFromView) {
      setSaveError('Hidden pricing models must be unhidden before they can be set active.');
      return;
    }
    if (activateTimerRef.current) {
      clearTimeout(activateTimerRef.current);
    }
    await handleSetDefault(selectedModelId);
    setActivatedFlash(true);
    activateTimerRef.current = setTimeout(() => setActivatedFlash(false), 1000);
    setHasChanges(false);
  };

  const displayModelName = isInitializing ? 'Loading Pricing Model...' : modelName || selectedModel?.name || 'New Pricing Model';
  const showSetActiveButton = !isInitializing && ((Boolean(selectedModelId) && !selectedModelIsDefault) || activatedFlash);

  useEffect(() => {
    return () => {
      if (activateTimerRef.current) {
        clearTimeout(activateTimerRef.current);
      }
    };
  }, []);

  const waterFeatureFields: ListField[] = useMemo(
    () => [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'Feature name' },
      { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
      { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
      { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
      {
        key: 'addCost3',
        label: 'Add. Cost 3',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        allowBlank: true,
        tooltip: 'Optional additional cost, such as shipping.',
      },
    ],
    []
  );
  const excavationBaseTableFields: ListField[] = useMemo(
    () => [
      {
        key: 'breakpointRange',
        label: 'Breakpoint Range',
        type: 'text',
        readOnly: true,
        tooltip: 'Fixed excavation surface-area breakpoint label used by proposals.',
      },
      {
        key: 'price',
        label: 'Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Excavation cost applied for this breakpoint row.',
      },
    ],
    []
  );
  const excavationRaisedBondBeamFields: ListField[] = useMemo(
    () => [
      {
        key: 'rbbSize',
        label: 'RBB Size',
        type: 'text',
        readOnly: true,
        tooltip: 'Fixed raised bond beam size billed per linear foot.',
      },
      {
        key: 'price',
        label: 'Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Raised bond beam cost applied per linear foot for this size.',
      },
    ],
    []
  );
  const excavationExposedPoolWallFields: ListField[] = useMemo(
    () => [
      {
        key: 'rbbSize',
        label: 'Height',
        type: 'text',
        readOnly: true,
        tooltip: 'Fixed out of ground forming height billed per linear foot.',
      },
      {
        key: 'price',
        label: 'Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Out of Ground / Exposed Pool Wall forming cost applied per linear foot for this height.',
      },
    ],
    []
  );
  const bubblerFields: ListField[] = useMemo(
    () => [
      ...waterFeatureFields,
      {
        key: 'needsPoolLight',
        label: 'Needs Pool Light',
        type: 'boolean',
        tooltip: 'Adds the default pool light cost to this bubbler in proposals.',
      },
    ],
    [waterFeatureFields]
  );
  const jetFields: ListField[] = useMemo(
    () => [
      ...waterFeatureFields,
      {
        key: 'requiresConduit',
        label: 'Requires Conduit',
        type: 'boolean',
        tooltip: 'Uses the Water Feature run as shared conduit footage for this jet in proposals.',
      },
    ],
    [waterFeatureFields]
  );
  const masonryFacingFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Facing Option',
        type: 'text',
        placeholder: 'Split Face',
        tooltip: 'Label shown in the applicable masonry-facing selector.',
      },
      {
        key: 'materialCost',
        label: 'Material Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Material cost applied per SQFT for this facing option.',
      },
      {
        key: 'laborCost',
        label: 'Labor Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Labor cost applied per SQFT for this facing option.',
      },
    ],
    []
  );
  const tileCopingRateFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Option Name',
        type: 'text',
        placeholder: 'Option name',
        tooltip: 'Label shown in the corresponding proposal-builder dropdown.',
      },
      {
        key: 'materialRate',
        label: 'Material Rate',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Material cost for this option.',
      },
      {
        key: 'laborRate',
        label: 'Labor Rate',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Labor cost for this option.',
      },
    ],
    []
  );
  const fixedTileCopingRateFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Option Name',
        type: 'text',
        readOnly: true,
        tooltip: 'Fixed row name used in the pricing engine.',
      },
      {
        key: 'materialRate',
        label: 'Material Rate',
        type: 'number',
        placeholder: '0',
        prefix: '$',
      },
      {
        key: 'laborRate',
        label: 'Labor Rate',
        type: 'number',
        placeholder: '0',
        prefix: '$',
      },
    ],
    []
  );
  const additionalDeckingFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Option Name',
        type: 'text',
        placeholder: 'Cool Deck',
        tooltip: 'Label shown in the Additional Decking dropdown in the proposal builder.',
      },
      {
        key: 'laborRate',
        label: 'Labor Rate',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Applied per sqft when this additional decking option is selected.',
      },
      {
        key: 'materialRate',
        label: 'Material Rate',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Applied per sqft when this additional decking option is selected.',
      },
      {
        key: 'wasteNotIncluded',
        label: 'Waste not Included',
        type: 'boolean',
        tooltip: 'When enabled, this option skips the standard 5% additional decking waste and freeform waste overhead.',
      },
    ],
    []
  );
  const fiberglassPoolModelFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'Belvedere',
        tooltip: 'Shown in the fiberglass model dropdown for this size bucket.',
      },
      {
        key: 'shellPrice',
        label: 'Shell Price',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Base fiberglass shell cost before freight, finish upgrades, tax, and PAP.',
      },
      {
        key: 'freight',
        label: 'Freight',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Added to the Fiberglass Shell category for the selected model.',
      },
      {
        key: 'crane',
        label: 'Crane',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Used only when the proposal marks crane required for this fiberglass model.',
      },
      {
        key: 'install',
        label: 'Install',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Fiberglass install labor cost for this model.',
      },
      {
        key: 'gravel',
        label: 'Gravel',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Fiberglass gravel cost for this model.',
      },
      {
        key: 'discountPercent',
        label: '% Discount',
        type: 'number',
        allowBlank: true,
        tooltip: 'Optional shell-only discount. Enter 20 for 20% off the shell price.',
      },
    ],
    []
  );
  const fiberglassNamedPriceFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'Crystite G3',
        tooltip: 'Label shown in the fiberglass dropdown on the proposal builder.',
      },
      {
        key: 'price',
        label: 'Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Applied once when this fiberglass option is selected.',
      },
    ],
    []
  );
  const fiberglassSpaOptionFields: ListField[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'Name',
        type: 'text',
        placeholder: 'Mystic',
        tooltip: 'Label shown in the fiberglass spa dropdown on the proposal builder.',
      },
      {
        key: 'price',
        label: 'Base Cost',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Used when fiberglass spa spillover is set to None.',
      },
      {
        key: 'crane',
        label: 'Crane',
        type: 'number',
        placeholder: '0',
        prefix: '$',
        tooltip: 'Used only when the proposal marks crane required for this fiberglass spa option.',
      },
      {
        key: 'spilloverPrice',
        label: 'Spillover Cost',
        type: 'number',
        placeholder: 'Blank = no spillover option',
        prefix: '$',
        allowBlank: true,
        tooltip:
          'Total fiberglass spa shell cost when spillover is set to Yes. Leave blank to disable spillover for this spa option.',
      },
    ],
    []
  );

  const isRenamableAddCostField = (field: ListField) => /^addCost\d+$/.test(field.key);
  const getListFieldOverrideKey = (list: ListConfig, field: ListField) =>
    buildPricingFieldLabelOverrideKey(list.path, field.key);
  const getListFieldLabel = (list: ListConfig, field: ListField) =>
    fieldLabelOverrides[getListFieldOverrideKey(list, field)] || field.label;
  const isListFieldHidden = (field: ListField, entry: any) => Boolean(field.hidden?.(entry));
  const isListFieldReadOnly = (field: ListField, entry: any, index: number) =>
    Boolean(typeof field.readOnly === 'function' ? field.readOnly(entry, index) : field.readOnly);
  const getListFieldOptions = (list: ListConfig, field: ListField, entry?: any, index?: number): ListFieldOption[] => {
    const resolved =
      typeof field.options === 'function' ? field.options({ data, list, entry, index }) : field.options || [];
    const normalized = resolved
      .map((option) => ({
        label: String(option?.label ?? option?.value ?? '').trim(),
        value: String(option?.value ?? '').trim(),
      }))
      .filter((option) => option.label || option.value);
    const currentValue = String(entry?.[field.key] ?? '').trim();
    if (currentValue && !normalized.some((option) => option.value === currentValue)) {
      normalized.unshift({ label: currentValue, value: currentValue });
    }
    return normalized;
  };
  const handleStartRenameListField = (list: ListConfig, field: ListField, cellKey: string) => {
    setActiveListFieldRename({
      cellKey,
      overrideKey: getListFieldOverrideKey(list, field),
      defaultLabel: field.label,
    });
    setActiveListFieldRenameDraft(getListFieldLabel(list, field));
  };
  const handleCancelRenameListField = () => {
    setActiveListFieldRename(null);
    setActiveListFieldRenameDraft('');
  };
  const handleCommitRenameListField = () => {
    if (!activeListFieldRename) {
      return;
    }

    const normalized = activeListFieldRenameDraft.trim();
    const nextOverrides = { ...fieldLabelOverrides };

    if (!normalized || normalized === activeListFieldRename.defaultLabel) {
      delete nextOverrides[activeListFieldRename.overrideKey];
    } else {
      nextOverrides[activeListFieldRename.overrideKey] = normalized;
    }

    const saved = savePricingFieldLabelOverrides(labelFranchiseId, nextOverrides);
    setFieldLabelOverrides(saved);
    setActiveListFieldRename(null);
    setActiveListFieldRenameDraft('');
  };
  const getListFieldLabelClassName = (field: ListField) =>
    `pricing-field__label${isRenamableAddCostField(field) ? ' has-rename' : ''}${field.tooltip ? ' has-info' : ''}`;
  const renderListFieldLabelText = (list: ListConfig, field: ListField, cellKey: string) => {
    if (activeListFieldRename?.cellKey !== cellKey) {
      return renderLabelText(getListFieldLabel(list, field));
    }

    return (
      <input
        ref={activeRenameInputRef}
        type="text"
        className="pricing-field__label-edit"
        value={activeListFieldRenameDraft}
        onChange={(e) => setActiveListFieldRenameDraft(e.target.value)}
        onBlur={handleCommitRenameListField}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            handleCancelRenameListField();
          }
        }}
      />
    );
  };

  const getPackageBuilderOptions = (path: Path, selected?: string) => {
    const names = (((getValue(data, path) as any[]) || []) as Array<{ name?: string }>)
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean);
    const uniqueNames = Array.from(new Set(names));
    if (selected && !uniqueNames.includes(selected)) {
      uniqueNames.unshift(selected);
    }
    return uniqueNames;
  };

  const updatePackageOptions = (nextPackages: any[]) => {
    updatePricingValue(['equipment', 'packageOptions'], normalizeEquipmentPackageOptions(nextPackages));
    setHasChanges(true);
  };

  const getEquipmentPackageOptionsForEditor = () =>
    normalizeEquipmentPackageOptions((((getValue(data, ['equipment', 'packageOptions']) as any[]) || []) as any[]));

  const updatePackageOption = (index: number, key: string, value: any) => {
    const current = getEquipmentPackageOptionsForEditor().map((option) => ({ ...option }));
    current[index] = { ...current[index], [key]: value };
    updatePackageOptions(current);
  };

  const addEquipmentPackageOption = () => {
    const current = getEquipmentPackageOptionsForEditor().map((option) => ({ ...option }));
    current.push({
      id: `package-${Date.now()}`,
      name: 'New Equipment Package',
      mode: 'fixed',
      enabled: true,
      description: '',
      notes: '',
      basePrice: 0,
      includeCheckValve: true,
      supportsSpa: true,
      allowAdditionalPumps: false,
      allowHeaterUpgrade: false,
      allowCleanerUpgrade: false,
      allowAutoFillUpgrade: false,
      allowPoolLightUpgrade: false,
      allowSpaLightUpgrade: false,
      allowWaterFeatureUpgrade: false,
      allowSanitationAccessoryUpgrade: false,
      includedWaterFeaturesBeforeExtraPump: 0,
      includedPumpName: '',
      includedPumpQuantity: 0,
      includedFilterName: '',
      includedFilterQuantity: 0,
      includedCleanerName: '',
      includedCleanerQuantity: 0,
      includedHeaterName: '',
      includedHeaterQuantity: 0,
      includedAutomationName: '',
      includedAutomationQuantity: 0,
      includedSaltSystemName: '',
      includedSaltSystemQuantity: 0,
      includedAutoFillSystemName: '',
      includedAutoFillSystemQuantity: 0,
      includedPoolLightName: '',
      includedPoolLightQuantity: 0,
      includedSpaLightName: '',
      includedSpaLightQuantity: 0,
      includedSanitationAccessoryName: '',
      includedSanitationAccessoryQuantity: 0,
      defaultCleanerName: '',
      defaultCleanerQuantity: 0,
      defaultPoolLightName: '',
      defaultPoolLightQuantity: 0,
      defaultAutoFillSystemName: '',
      defaultAutoFillSystemQuantity: 0,
      defaultSanitationAccessoryName: '',
      defaultSanitationAccessoryQuantity: 0,
    });
    updatePackageOptions(current);
  };

  const removeEquipmentPackageOption = (index: number) => {
    const current = getEquipmentPackageOptionsForEditor().map((option) => ({ ...option }));
    const target = current[index];
    if (!target || target.mode === 'custom' || target.id === 'custom') {
      return;
    }
    updatePackageOptions(current.filter((_, optionIndex) => optionIndex !== index));
  };

  const renderEquipmentPackageBuilder = () => {
    const packageOptions = getEquipmentPackageOptionsForEditor().map((option) => ({ ...option }));
    const equipmentOptions = {
      pumps: getPackageBuilderOptions(['equipment', 'pumps']),
      filters: getPackageBuilderOptions(['equipment', 'filters']),
      cleaners: getPackageBuilderOptions(['equipment', 'cleaners']),
      heaters: getPackageBuilderOptions(['equipment', 'heaters']),
      automation: getPackageBuilderOptions(['equipment', 'automation']),
      sanitation: getPackageBuilderOptions(['equipment', 'saltSystem']),
      autoFill: getPackageBuilderOptions(['equipment', 'autoFillSystem']),
      poolLights: getPackageBuilderOptions(['equipment', 'lights', 'poolLights']),
      spaLights: getPackageBuilderOptions(['equipment', 'lights', 'spaLights']),
      sanitationAccessories: getPackageBuilderOptions(['equipment', 'sanitationAccessories']),
    };

    const renderPackageNameSelect = (
      pkg: any,
      index: number,
      label: string,
      nameKey: string,
      quantityKey: string,
      options: string[],
      noneLabel: string = 'None'
    ) => (
      <div className="pricing-package-item" key={`${pkg.id}-${nameKey}`}>
        <label className="pricing-input-block">
          <span className="pricing-input-block__label">{label}</span>
          <select
            className="pricing-input"
            value={pkg[nameKey] || ''}
            onChange={(e) => updatePackageOption(index, nameKey, e.target.value)}
          >
            <option value="">{noneLabel}</option>
            {options.map((option) => (
              <option key={`${nameKey}-${option}`} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="pricing-input-block pricing-package-item__qty">
          <span className="pricing-input-block__label">Qty</span>
          <input
            type="number"
            className="pricing-input"
            value={pkg[quantityKey] ?? 0}
            min={0}
            onChange={(e) => updatePackageOption(index, quantityKey, toNumber(e.target.value))}
          />
        </label>
      </div>
    );

    const renderPackageCheckbox = (pkg: any, index: number, key: string, label: string, description?: string) => (
      <label className="pricing-package-flag" key={`${pkg.id}-${key}`}>
        <input
          type="checkbox"
          checked={Boolean(pkg[key])}
          onChange={(e) => updatePackageOption(index, key, e.target.checked)}
          disabled={pkg.mode === 'custom' && key === 'enabled'}
        />
        <span>
          <strong>{label}</strong>
          {description && <small>{description}</small>}
        </span>
      </label>
    );

    return (
      <div className="pricing-package-builder">
        <div className="pricing-package-builder__intro">
          <p>
            Package options are specific to this pricing model, so each franchise can bundle equipment differently or
            offer only the Custom option. When the cost of included equipment changes, affected fixed package prices
            are adjusted by the same cost difference automatically.
          </p>
          <button type="button" className="pricing-chip-button" onClick={addEquipmentPackageOption}>
            Add Package
          </button>
        </div>
        {packageOptions.map((pkg, index) => {
          const isCustom = pkg.mode === 'custom' || pkg.id === 'custom';
          return (
            <div key={pkg.id || `package-${index}`} className={`pricing-package-card ${isCustom ? 'is-custom' : ''}`}>
              <div className="pricing-package-card__header">
                <div>
                  <h5>{pkg.name || (isCustom ? 'Custom' : 'Unnamed Package')}</h5>
                  <p>
                    {isCustom
                      ? 'Custom keeps normal itemized pricing. Keep this option available for franchises that do not use fixed bundles.'
                      : 'Fixed package price replaces the bundled equipment COGS, tracks included equipment cost changes, and leaves extras as upgrades.'}
                  </p>
                </div>
                {!isCustom && (
                  <button
                    type="button"
                    className="pricing-chip-button danger"
                    onClick={() => removeEquipmentPackageOption(index)}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="pricing-package-card__grid">
                <label className="pricing-input-block">
                  <span className="pricing-input-block__label">Package Name</span>
                  <input
                    type="text"
                    className="pricing-input"
                    value={pkg.name || ''}
                    onChange={(e) => updatePackageOption(index, 'name', e.target.value)}
                  />
                </label>
                <label className="pricing-input-block">
                  <span className="pricing-input-block__label">Package ID</span>
                  <input type="text" className="pricing-input" value={pkg.id || ''} readOnly />
                </label>
                <label className="pricing-input-block">
                  <span className="pricing-input-block__label">Pricing Mode</span>
                  <input
                    type="text"
                    className="pricing-input"
                    value={isCustom ? 'Custom / Itemized' : 'Fixed Package'}
                    readOnly
                  />
                </label>
                <label className="pricing-input-block">
                  <span className="pricing-input-block__label">Base Package Price</span>
                  <div className="pricing-field__input-wrap has-prefix">
                    <span className="pricing-field__prefix">$</span>
                    <input
                      type="number"
                      className="pricing-field__input pricing-field__input--bare"
                      value={pkg.basePrice ?? 0}
                      onChange={(e) => updatePackageOption(index, 'basePrice', toNumber(e.target.value))}
                    />
                  </div>
                </label>
                <label className="pricing-input-block">
                  <span className="pricing-input-block__label">Description</span>
                  <input
                    type="text"
                    className="pricing-input"
                    value={pkg.description || ''}
                    onChange={(e) => updatePackageOption(index, 'description', e.target.value)}
                  />
                </label>
                <label className="pricing-input-block pricing-package-card__notes">
                  <span className="pricing-input-block__label">Designer Notes / Restrictions</span>
                  <textarea
                    className="pricing-package-textarea"
                    value={pkg.notes || ''}
                    onChange={(e) => updatePackageOption(index, 'notes', e.target.value)}
                  />
                </label>
              </div>

              <div className="pricing-package-flags">
                {renderPackageCheckbox(pkg, index, 'enabled', 'Enabled', 'Disable to hide this package from designers.')}
                {renderPackageCheckbox(pkg, index, 'includeCheckValve', 'Include Check Valve', 'Adds the equipment check valve cost to the package total.')}
                {renderPackageCheckbox(pkg, index, 'supportsSpa', 'Spa Compatible', 'When off, spa selection and spa-incompatible package buttons are blocked.')}
              </div>

              {!isCustom && (
                <>
                  <div className="pricing-package-section">
                    <h6>Included Equipment</h6>
                    <div className="pricing-package-items">
                      {renderPackageNameSelect(pkg, index, 'Pump', 'includedPumpName', 'includedPumpQuantity', equipmentOptions.pumps)}
                      {renderPackageNameSelect(pkg, index, 'Filter', 'includedFilterName', 'includedFilterQuantity', equipmentOptions.filters)}
                      {renderPackageNameSelect(pkg, index, 'Cleaner', 'includedCleanerName', 'includedCleanerQuantity', equipmentOptions.cleaners)}
                      {renderPackageNameSelect(pkg, index, 'Automation', 'includedAutomationName', 'includedAutomationQuantity', equipmentOptions.automation)}
                      {renderPackageNameSelect(pkg, index, 'Sanitation System', 'includedSaltSystemName', 'includedSaltSystemQuantity', equipmentOptions.sanitation)}
                      {renderPackageNameSelect(pkg, index, 'Heater', 'includedHeaterName', 'includedHeaterQuantity', equipmentOptions.heaters)}
                      {renderPackageNameSelect(pkg, index, 'Pool Lights', 'includedPoolLightName', 'includedPoolLightQuantity', equipmentOptions.poolLights)}
                      {renderPackageNameSelect(pkg, index, 'Spa Lights', 'includedSpaLightName', 'includedSpaLightQuantity', equipmentOptions.spaLights)}
                      {renderPackageNameSelect(pkg, index, 'Auto-Fill', 'includedAutoFillSystemName', 'includedAutoFillSystemQuantity', equipmentOptions.autoFill)}
                      {renderPackageNameSelect(pkg, index, 'Sanitation Accessory', 'includedSanitationAccessoryName', 'includedSanitationAccessoryQuantity', equipmentOptions.sanitationAccessories)}
                    </div>
                  </div>

                  <div className="pricing-package-section">
                    <h6>Default Upgrade Selections</h6>
                    <div className="pricing-package-items">
                      {renderPackageNameSelect(pkg, index, 'Cleaner Default', 'defaultCleanerName', 'defaultCleanerQuantity', equipmentOptions.cleaners)}
                      {renderPackageNameSelect(pkg, index, 'Auto-Fill Default', 'defaultAutoFillSystemName', 'defaultAutoFillSystemQuantity', equipmentOptions.autoFill)}
                      {renderPackageNameSelect(
                        pkg,
                        index,
                        'Sanitation Accessory Default',
                        'defaultSanitationAccessoryName',
                        'defaultSanitationAccessoryQuantity',
                        equipmentOptions.sanitationAccessories
                      )}
                    </div>
                  </div>

                  <div className="pricing-package-section">
                    <h6>Allowed Upgrades</h6>
                    <div className="pricing-package-flags">
                      {renderPackageCheckbox(pkg, index, 'allowAdditionalPumps', 'Additional Pumps')}
                      {renderPackageCheckbox(pkg, index, 'allowHeaterUpgrade', 'Heaters')}
                      {renderPackageCheckbox(pkg, index, 'allowCleanerUpgrade', 'Cleaners')}
                      {renderPackageCheckbox(pkg, index, 'allowAutoFillUpgrade', 'Auto-Fill')}
                      {renderPackageCheckbox(pkg, index, 'allowPoolLightUpgrade', 'Pool Lights')}
                      {renderPackageCheckbox(pkg, index, 'allowSpaLightUpgrade', 'Spa Lights')}
                      {renderPackageCheckbox(pkg, index, 'allowWaterFeatureUpgrade', 'Water Features')}
                      {renderPackageCheckbox(pkg, index, 'allowSanitationAccessoryUpgrade', 'Sanitation Accessories')}
                    </div>
                    <label className="pricing-input-block pricing-package-water-feature-limit">
                      <span className="pricing-input-block__label">Water Feature Categories Allowed Before Another Pump</span>
                      <input
                        type="number"
                        className="pricing-input"
                        min={0}
                        value={pkg.includedWaterFeaturesBeforeExtraPump ?? 0}
                        onChange={(e) =>
                          updatePackageOption(index, 'includedWaterFeaturesBeforeExtraPump', toNumber(e.target.value))
                        }
                      />
                    </label>
                  </div>
                </>
              )}

              {isCustom && (
                <div className="pricing-package-section">
                  <h6>Default Equipment Selections</h6>
                  <div className="pricing-package-items">
                    {renderPackageNameSelect(
                      pkg,
                      index,
                      'Default Pool Lights',
                      'defaultPoolLightName',
                      'defaultPoolLightQuantity',
                      equipmentOptions.poolLights
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const sections: Section[] = useMemo(
    () => [
      {
        title: 'Discounts / Adjustments',
        groups: [
          {
            title: 'Preferred Approved Provider Discounts',
            scalars: [
              { label: 'Excavation', path: ['papDiscountRates', 'excavation'], type: 'number', tooltip: 'Applies % discount to Excavation line items (not fiberglass pools).', prefix: '%', isPercent: true },
              { label: 'Plumbing', path: ['papDiscountRates', 'plumbing'], type: 'number', tooltip: 'Applies % discount to Plumbing line items.', prefix: '%', isPercent: true },
              { label: 'Steel', path: ['papDiscountRates', 'steel'], type: 'number', tooltip: 'Applies % discount to Steel line items.', prefix: '%', isPercent: true },
              { label: 'Electrical', path: ['papDiscountRates', 'electrical'], type: 'number', tooltip: 'Applies % discount to Electrical line items.', prefix: '%', isPercent: true },
              { label: 'Shotcrete (Labor + Material)', path: ['papDiscountRates', 'shotcrete'], type: 'number', tooltip: 'Applies % discount to combined Shotcrete labor + material.', prefix: '%', isPercent: true },
              { label: 'Tile/Coping Labor', path: ['papDiscountRates', 'tileCopingLabor'], type: 'number', tooltip: 'Applies % discount to Tile & Coping labor items.', prefix: '%', isPercent: true },
              { label: 'Tile/Coping Material', path: ['papDiscountRates', 'tileCopingMaterial'], type: 'number', tooltip: 'Applies % discount to flagstone coping material only.', prefix: '%', isPercent: true },
              { label: 'Equipment (Pre-Tax)', path: ['papDiscountRates', 'equipment'], type: 'number', tooltip: 'Applies % discount to equipment subtotal before tax (tax recalculated).', prefix: '%', isPercent: true },
              { label: 'Interior Finish Labor', path: ['papDiscountRates', 'interiorFinish'], type: 'number', tooltip: 'Applies % discount to Interior Finish labor items.', prefix: '%', isPercent: true },
              { label: 'Startup/Orientation', path: ['papDiscountRates', 'startup'], type: 'number', tooltip: 'Applies % discount to Start-Up / Orientation items.', prefix: '%', isPercent: true },
              { label: 'Fiberglass Shell', path: ['papDiscountRates', 'fiberglassShell'], type: 'number', tooltip: 'Applies % discount to the fiberglass pool shell only before fiberglass shell tax is calculated.', prefix: '%', isPercent: true },
            ],
          },
          {
            title: 'Manual Retail Price Adjustments',
            scalars: [
              {
                label: 'COGS vs Retail Price Increase',
                path: ['pricingDefaults', 'targetMargin'],
                type: 'number',
                tooltip: 'Controls the default model-wide retail pricing formula. 70 means retail is calculated as COGS divided by 0.70 before fixed retail adjustments.',
                prefix: '%',
                isPercent: true,
              },
              { label: 'Positive Adjustment 1', path: ['manualAdjustments', 'positive1'], type: 'number', tooltip: 'Default value in Adjustments card; adds to retail price.', prefix: '$' },
              { label: 'Positive Adjustment 2', path: ['manualAdjustments', 'positive2'], type: 'number', tooltip: 'Default value in Adjustments card; adds to retail price.', prefix: '$' },
              { label: 'Negative Adjustment 1', path: ['manualAdjustments', 'negative1'], type: 'number', tooltip: 'Default value in Adjustments card; subtracts from retail price.', prefix: '-$' },
              { label: 'Negative Adjustment 2', path: ['manualAdjustments', 'negative2'], type: 'number', tooltip: 'Default value in Adjustments card; subtracts from retail price.', prefix: '-$' },
            ],
          },
        ],
      },
      {
        title: 'Pool Specifications',
        groups: [
          {
            title: 'Additional Options',
            scalarTable: {
              title: 'Pool Specifications Additional Options',
              rows: [
                {
                  label: 'Silt Fence',
                  path: ['misc', 'layout', 'siltFencing'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'siltFence'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Added once under Layout when Silt Fence Required is enabled. This feature is enabled by default on new proposals.',
                },
                {
                  label: 'Tanning Shelf',
                  path: ['steel', 'tanningShelf'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'tanningShelf'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Added once under Steel when a tanning shelf is enabled on a shotcrete pool.',
                },
                {
                  label: 'Automatic Cover - Excavation Cover Box',
                  path: ['excavation', 'coverBox'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'automaticCover'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Added once under Excavation when Automatic Cover is enabled on a shotcrete pool. This is separate from the manufacturer cost entered by the designer.',
                },
                {
                  label: 'Automatic Cover - Shotcrete Labor',
                  path: ['shotcrete', 'labor', 'autoCover'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'automaticCover'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Applied per calculated automatic-cover forming unit under Shotcrete Labor. Units round up from ((maximum pool width + 2 ft) x 7) / 22. The designer-entered manufacturer cost is separate.',
                },
                {
                  label: 'Automatic Cover - Shotcrete Material',
                  path: ['shotcrete', 'material', 'autoCover'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'automaticCover'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Applied per calculated automatic-cover forming unit under Shotcrete Material. Units round up from ((maximum pool width + 2 ft) x 7) / 22. The designer-entered manufacturer cost is separate.',
                },
              ],
            },
          },
        ],
      },
      {
        title: 'Plans & Engineering',
        groups: [
          {
            title: 'Base Costs',
            scalars: [
              {
                label: 'Pool',
                path: ['plans', 'poolOnly'],
                type: 'number',
                tooltip: 'Added when a pool is defined. Quantity is always 1 if defined.',
                prefix: '$',
              },
              {
                label: 'Spa',
                path: ['plans', 'spa'],
                type: 'number',
                tooltip: 'Added when a spa exists. Quantity is always 1 if spa exists.',
                prefix: '$',
              },
              {
                label: 'Waterfall',
                path: ['plans', 'waterfall'],
                type: 'number',
                tooltip: 'Added when a waterfall exists. Quantity equals the total waterfall count.',
                prefix: '$',
              },
              {
                label: 'Water Feature',
                path: ['plans', 'waterFeature'],
                type: 'number',
                tooltip: 'Applies when a water feature exists. Quantity equals total water feature count.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Layout & Permit',
        groups: [
          {
            title: 'Layout',
            scalars: [
              {
                label: 'Pool',
                path: ['misc', 'layout', 'poolOnly'],
                type: 'number',
                tooltip: 'Added when a pool is defined. Quantity is always 1 if defined.',
                prefix: '$',
              },
              {
                label: 'Spa',
                path: ['misc', 'layout', 'spa'],
                type: 'number',
                tooltip: 'Added when a spa exists. Quantity is always 1 if spa exists.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Permit',
            scalars: [
              {
                label: 'Pool',
                path: ['misc', 'permit', 'poolOnly'],
                type: 'number',
                tooltip: 'Added when a pool is defined. Quantity is always 1 if defined.',
                prefix: '$',
              },
              {
                label: 'Spa',
                path: ['misc', 'permit', 'spa'],
                type: 'number',
                tooltip: 'Added when a spa exists. Quantity is always 1 if spa exists.',
                prefix: '$',
              },
              {
                label: 'Permit Runner',
                path: ['misc', 'permit', 'permitRunner'],
                type: 'number',
                tooltip: 'Added for every defined pool. Quantity is always 1.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Excavation',
        groups: [
          {
            title: 'Base & allowances',
            scalars: [
              {
                label: 'Over 1,000 sqft surcharge',
                path: ['excavation', 'over1000Sqft'],
                type: 'number',
                tooltip: 'Applied per sqft over 1,000 when surface area exceeds 1,000 sqft.',
                prefix: '$',
              },
              {
                label: 'Additional 6" depth (per sqft)',
                path: ['excavation', 'additional6InchDepth'],
                type: 'number',
                tooltip: 'Added per 6" depth increment beyond 8\' end depth.',
                prefix: '$',
              },
              {
                label: 'Backfill',
                path: ['excavation', 'backfill'],
                type: 'number',
                tooltip: 'Added once for non-fiberglass pools.',
                prefix: '$',
              },
              {
                label: 'Travel (per mile)',
                path: ['excavation', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
              {
                label: 'Miscellaneous',
                path: ['excavation', 'misc'],
                type: 'number',
                tooltip: 'Added once for non-fiberglass pools.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Additional Options',
            scalarTable: {
              title: 'Excavation Additional Options',
              rows: [
                {
                  label: 'Gravel Install',
                  path: ['excavation', 'gravelPerSqft'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'gravelInstall'],
                  type: 'number',
                  prefix: '$',
                  tooltip: isPpasEast
                    ? 'Applied per pool surface sqft when Gravel Install is enabled. Gravel Install is included in PPAS East Bronze pricing.'
                    : 'Applied per pool surface sqft when Gravel Install is enabled. This feature is enabled by default for non-Bronze shotcrete proposals and is unavailable in Bronze pricing.',
                },
                {
                  label: 'Dirt Haul',
                  path: ['excavation', 'dirtHaulPerYard'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'dirtHaul'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Applied per calculated cubic yard when Dirt Haul is enabled. Calculated yardage includes pool overdig, adjusted depth, and the spa allowance. This feature is enabled by default.',
                },
                {
                  label: 'Soil Sample / Engineer',
                  path: ['plans', 'soilSampleEngineer'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'soilSampleEngineer'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Added once under Plans & Engineering when Soil Sample / Engineer is enabled in Excavation.',
                },
                {
                  label: 'Double Curtain',
                  path: ['steel', 'doubleCurtainPerLnft'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'doubleCurtain'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Applied per linear foot under Steel when Double Curtain is enabled and a length is entered in Excavation. Its length also contributes to calculated shotcrete yardage.',
                },
                {
                  label: 'Additional Site Prep',
                  path: ['excavation', 'sitePrep'],
                  defaultEnabledPath: ['additionalFeatureDefaults', 'additionalSitePrep'],
                  type: 'number',
                  prefix: '$',
                  tooltip: 'Applied per additional site-preparation hour entered after Additional Site Prep is enabled.',
                },
                ...(isPpasEast
                  ? [
                      {
                        label: 'Tight Access Job',
                        path: ['excavation', 'tightAccessJob'],
                        defaultEnabledPath: ['additionalFeatureDefaults', 'tightAccessJob'],
                        type: 'number' as const,
                        prefix: '$',
                        tooltip: 'Added once under Excavation when Tight Access Job is enabled. This PPAS East option is not enabled by default.',
                      },
                    ]
                  : []),
              ],
            },
          },
          {
            title: 'Base excavation (surface area breakpoints)',
            lists: [
              {
                title: 'Base excavation rates',
                path: ['excavation', 'baseExcavationTable'],
                addLabel: 'Add breakpoint',
                allowAdd: false,
                allowRemove: false,
                variant: 'table',
                fields: excavationBaseTableFields,
              },
            ],
          },
          {
            title: 'Spa excavation',
            scalars: [
              {
                label: 'Spa base excavation',
                path: ['excavation', 'baseSpa'],
                type: 'number',
                tooltip: 'Added when a shotcrete spa exists.',
                prefix: '$',
              },
              {
                label: 'Raised spa excavation',
                path: ['excavation', 'raisedSpa'],
                type: 'number',
                tooltip: 'Added when the spa is raised.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Raised bond beam (per lnft)',
            lists: [
              {
                title: 'Raised bond beam rates',
                path: ['excavation', 'raisedBondBeamTable'],
                addLabel: 'Add RBB size',
                allowAdd: false,
                allowRemove: false,
                variant: 'table',
                fields: excavationRaisedBondBeamFields,
              },
            ],
          },
          {
            title: 'Out of Ground forming (per lnft)',
            lists: [
              {
                title: 'Out of Ground forming rates',
                path: ['excavation', 'exposedPoolWallFormingTable'],
                addLabel: 'Add Out of Ground size',
                allowAdd: false,
                allowRemove: false,
                variant: 'table',
                fields: excavationExposedPoolWallFields,
              },
            ],
          },
          {
            title: 'Out of Ground strip forms',
            scalars: [
              {
                label: 'Out of Ground strip forms additional',
                path: ['plumbing', 'exposedPoolWallStripFormsAdditional'],
                type: 'number',
                tooltip: 'Additional strip forms cost per LNFT of Out of Ground / Exposed Pool Wall. This is independent from the RBB strip forms additional rate.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Plumbing',
        groups: [
          {
            title: 'Base & overruns',
            scalars: [
              {
                label: 'Short stub / base plumbing',
                path: ['plumbing', 'shortStub'],
                type: 'number',
                tooltip: 'Added once when a pool is defined.',
                prefix: '$',
              },
              {
                label: 'Spa base plumbing',
                path: ['plumbing', 'spaBase'],
                type: 'number',
                tooltip: 'Added once when a shotcrete spa exists.',
                prefix: '$',
              },
              {
                label: 'Fiberglass plumbing multiplier',
                path: ['plumbing', 'fiberglassMultiplier'],
                type: 'number',
                tooltip: 'Multiplier applied to the full plumbing subtotal for fiberglass pool proposals after any PAP plumbing discount. Enter 40 for 40% of standard plumbing.',
                prefix: '%',
                isPercent: true,
              },
              {
                label: 'Pool overrun per ft',
                path: ['plumbing', 'poolOverrunPerFt'],
                type: 'number',
                tooltip: 'Applied to skimmer run length above the threshold.',
                prefix: '$',
                note: `Applies over ${data.plumbing.poolOverrunThreshold} ft`,
              },
              {
                label: 'Pool overrun threshold',
                path: ['plumbing', 'poolOverrunThreshold'],
                type: 'number',
                tooltip: 'Feet included before pool overrun charges apply.',
                prefix: 'LNFT',
              },
              {
                label: 'Spa overrun per ft',
                path: ['plumbing', 'spaOverrunPerFt'],
                type: 'number',
                tooltip: 'Applied to spa run length above the threshold.',
                prefix: '$',
                note: `Applies over ${data.plumbing.spaOverrunThreshold} ft`,
              },
              {
                label: 'Spa overrun threshold',
                path: ['plumbing', 'spaOverrunThreshold'],
                type: 'number',
                tooltip: 'Feet included before spa overrun charges apply.',
                prefix: 'LNFT',
              },
            ],
          },
          {
            title: 'Pipe sizes',
            scalars: [
              {
                label: '1/2" pipe (per ft)',
                path: ['plumbing', 'cleanerPerFt'],
                type: 'number',
                tooltip: 'Unused in current plumbing calculations.',
                prefix: '$',
                isUnused: true,
              },
              {
                label: '3/4" pipe (per ft)',
                path: ['plumbing', 'threeQuarterInchPipe'],
                type: 'number',
                tooltip: 'Unused in current plumbing calculations.',
                prefix: '$',
                isUnused: true,
              },
              {
                label: '1" pipe (per ft)',
                path: ['plumbing', 'autoFillPerFt'],
                type: 'number',
                tooltip: 'Used for auto-fill run length.',
                prefix: '$',
              },
              {
                label: '1.5" pipe (per ft)',
                path: ['plumbing', 'onePointFiveInchPipe'],
                type: 'number',
                tooltip: 'Unused in current plumbing calculations.',
                prefix: '$',
                isUnused: true,
              },
              {
                label: '2" pipe (per ft)',
                path: ['plumbing', 'twoInchPipe'],
                type: 'number',
                tooltip: 'Used for core plumbing runs, cleaner line, and water feature overage.',
                prefix: '$',
              },
              {
                label: '2.5" pipe (per ft)',
                path: ['plumbing', 'twoPointFiveInchPipe'],
                type: 'number',
                tooltip: 'Used for main drain length per active pump, plus one spa loop length.',
                prefix: '$',
              },
              {
                label: '3" pipe (per ft)',
                path: ['plumbing', 'threeInchPipe'],
                type: 'number',
                tooltip: 'Used when gas run exceeds 100 ft (qty = gas run - 100).',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Water feature plumbing',
            scalars: [
              {
                label: 'Setup (per run)',
                path: ['plumbing', 'waterFeatureRun', 'setup'],
                type: 'number',
                tooltip: 'Added once per water feature run.',
                prefix: '$',
              },
              {
                label: 'Base allowance (ft)',
                path: ['plumbing', 'waterFeatureRun', 'baseAllowanceFt'],
                type: 'number',
                tooltip: 'Included feet per water feature run before overage.',
              },
              {
                label: 'Per ft over allowance',
                path: ['plumbing', 'waterFeatureRun', 'perFt'],
                valuePath: ['plumbing', 'twoInchPipe'],
                type: 'number',
                disabled: true,
                tooltip: 'Applied to overage beyond the base allowance; rate is linked to 2" pipe.',
                prefix: '$',
              },
              {
                label: 'Additional Water Feature Run (per ft)',
                path: ['plumbing', 'additionalWaterFeatureRunPerFt'],
                type: 'number',
                tooltip: 'Applied to total water feature run length; Bronze defaults to $6 and is independent from 2" pipe.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Misc. Plumbing',
            scalars: [
              {
                label: 'Additional skimmer',
                path: ['plumbing', 'additionalSkimmer'],
                type: 'number',
                tooltip: 'Applied per additional skimmer count.',
                prefix: '$',
              },
              {
                label: 'Valve Actuator',
                path: ['plumbing', 'valveActuator'],
                type: 'number',
                tooltip: 'Added once per unique selected water feature zone/subcategory. Fire-only and water/fire wok pots add one controller per selected quantity.',
                prefix: '$',
              },
              {
                label: "Add'l Main Drain (When Additional Pump is active)",
                path: ['plumbing', 'addlMainDrainWhenAuxPump'],
                type: 'number',
                tooltip: 'Added once when an additional pump is selected.',
                prefix: '$',
              },
              {
                label: 'Infloor (per ft)',
                path: ['plumbing', 'infloorPerFt'],
                type: 'number',
                tooltip: 'Applied when infloor is selected; qty = 0.5 x pool surface area.',
                prefix: '$',
              },
              {
                label: 'Conduit (per ft)',
                path: ['plumbing', 'conduitPerFt'],
                type: 'number',
                tooltip: 'Applied to electrical run + light run x conduit multiplier.',
                prefix: '$',
              },
              {
                label: 'Manifold',
                path: ['plumbing', 'manifold'],
                type: 'number',
                tooltip: 'Added once per pad (always).',
                prefix: '$',
              },
              {
                label: 'Heater set',
                path: ['plumbing', 'heaterSet'],
                type: 'number',
                tooltip: 'Added once unless a spa and a heater are both selected.',
                prefix: '$',
              },
              {
                label: 'Strip forms',
                path: ['plumbing', 'stripForms'],
                type: 'number',
                tooltip: 'Added once per pad (always).',
                prefix: '$',
              },
              {
                label: 'Strip forms RBB additional',
                path: ['plumbing', 'stripFormsRbbAdditional'],
                type: 'number',
                tooltip: 'Additional cost per LNFT of RBB',
                prefix: '$',
              },
              {
                label: 'Travel (per mile)',
                path: ['plumbing', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Water Features',
        groups: [
          {
            title: 'Sheer Descent',
            lists: [
              {
                title: 'Sheer Descents',
                path: ['waterFeatures', 'sheerDescents'],
                addLabel: 'Add sheer descent',
                fields: waterFeatureFields,
                defaultItem: () => ({ id: `wf-sheer-${Date.now()}` }),
              },
            ],
          },
          {
            title: 'Jets',
            lists: [
              {
                title: 'Jets',
                path: ['waterFeatures', 'jets'],
                addLabel: 'Add jet',
                fields: jetFields,
                defaultItem: () => ({ id: `wf-jet-${Date.now()}` }),
              },
            ],
          },
          {
            title: 'Wok Pots',
            lists: [
              {
                title: 'Water Only',
                path: ['waterFeatures', 'woks', 'waterOnly'],
                addLabel: 'Add water-only wok',
                fields: waterFeatureFields,
                defaultItem: () => ({ id: `wf-wok-water-${Date.now()}` }),
              },
              {
                title: 'Fire Only',
                path: ['waterFeatures', 'woks', 'fireOnly'],
                addLabel: 'Add fire-only wok',
                fields: waterFeatureFields,
                defaultItem: () => ({ id: `wf-wok-fire-${Date.now()}` }),
              },
              {
                title: 'Water & Fire',
                path: ['waterFeatures', 'woks', 'waterAndFire'],
                addLabel: 'Add water & fire wok',
                fields: waterFeatureFields,
                defaultItem: () => ({ id: `wf-wok-both-${Date.now()}` }),
              },
            ],
          },
          {
            title: 'Bubbler',
            lists: [
              {
                title: 'Bubbler models',
                path: ['waterFeatures', 'bubblers'],
                addLabel: 'Add bubbler',
                fields: bubblerFields,
                defaultItem: () => ({ id: `wf-bubbler-${Date.now()}` }),
              },
            ],
          },
        ],
      },
      {
        title: 'Electrical & Gas',
        groups: [
          {
            title: 'Electrical runs',
            scalars: [
              {
                label: 'Base electrical',
                path: ['electrical', 'baseElectrical'],
                type: 'number',
                tooltip: `Added when a pool is defined. Includes first ${data.electrical.overrunThreshold} ft of electrical run.`,
                prefix: '$',
              },
              {
                label: 'Electrical overrun per ft',
                path: ['electrical', 'overrunPerFt'],
                type: 'number',
                tooltip: 'Applied per ft of electrical run beyond the threshold.',
                prefix: '$',
                note: `Applies over ${data.electrical.overrunThreshold} ft`,
              },
              {
                label: 'Electrical overrun threshold',
                path: ['electrical', 'overrunThreshold'],
                type: 'number',
                tooltip: 'Feet included before electrical overrun charges apply.',
                prefix: 'LNFT',
              },
              {
                label: 'Heater cost',
                path: ['electrical', 'spaElectrical'],
                type: 'number',
                tooltip: 'Added per heater when a heater is selected.',
                prefix: '$',
              },
              {
                label: 'Light additional (each)',
                path: ['electrical', 'lightAdditionalPerLight'],
                type: 'number',
                tooltip: 'Added for each light beyond the first.',
                prefix: '$',
              },
              {
                label: 'Heat pump electrical base',
                path: ['electrical', 'heatPumpElectricalBase'],
                type: 'number',
                tooltip: 'Added once when heat pump electrical run is entered.',
                prefix: '$',
              },
              {
                label: 'Heat pump overrun per ft',
                path: ['electrical', 'heatPumpPerFtOver'],
                type: 'number',
                tooltip: 'Applied per ft of heat pump electrical run beyond the threshold.',
                prefix: '$',
                note: `Applies over ${data.electrical.heatPumpOverrunThreshold ?? 40} ft`,
              },
              {
                label: 'Heat pump overrun threshold',
                path: ['electrical', 'heatPumpOverrunThreshold'],
                type: 'number',
                tooltip: 'Feet included before heat pump electrical overrun applies.',
                prefix: 'LNFT',
              },
              {
                label: 'Automation add',
                path: ['electrical', 'automation'],
                type: 'number',
                tooltip: 'Added once when automation is selected.',
                prefix: '$',
              },
              {
                label: 'Additional Sanitation System',
                path: ['electrical', 'saltSystem'],
                type: 'number',
                tooltip: 'Added per sanitation system beyond the first.',
                prefix: '$',
              },
              {
                label: 'Bonding',
                path: ['electrical', 'bonding'],
                type: 'number',
                tooltip: 'Added once per pool (always).',
                prefix: '$',
              },
              {
                label: 'Outlet',
                path: ['electrical', 'outlet'],
                type: 'number',
                tooltip: 'Added once per pool (always).',
                prefix: '$',
              },
              {
                label: 'Auto-fill (per ft)',
                path: ['electrical', 'autoFillPerFt'],
                type: 'number',
                tooltip: 'Applied per ft of auto-fill run when the selected system requires electric run.',
                prefix: '$',
              },
              {
                label: 'Travel per mile',
                path: ['electrical', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Gas',
            scalars: [
              {
                label: 'Base gas set',
                path: ['electrical', 'baseGas'],
                type: 'number',
                tooltip: 'Added once when a gas run is entered.',
                prefix: '$',
              },
              {
                label: 'Gas overrun per ft',
                path: ['electrical', 'gasPerFtOverThreshold'],
                type: 'number',
                tooltip: 'Applied per ft of gas run beyond the threshold.',
                prefix: '$',
                note: `Applies over ${data.plumbing.gasOverrunThreshold} ft`,
              },
              {
                label: 'Gas overrun threshold',
                path: ['plumbing', 'gasOverrunThreshold'],
                type: 'number',
                tooltip: 'Feet included before gas overrun charges apply.',
                prefix: 'LNFT',
              },
            ],
          },
        ],
      },
      {
        title: 'Steel',
        groups: [
          {
            title: 'Rebar',
            scalars: [
              {
                label: 'Pool base (per lnft)',
                path: ['steel', 'poolBase'],
                type: 'number',
                tooltip: 'Applied per linear foot of pool perimeter.',
                prefix: '$',
              },
              {
                label: 'Spa base',
                path: ['steel', 'spaBase'],
                type: 'number',
                tooltip: 'Added once when a shotcrete spa exists.',
                prefix: '$',
              },
              {
                label: 'Raised spa',
                path: ['steel', 'raisedSpa'],
                type: 'number',
                tooltip: 'Added once when a raised shotcrete spa is selected.',
                prefix: '$',
              },
              {
                label: '4-bar beam',
                path: ['steel', 'fourBarBeam'],
                type: 'number',
                tooltip: 'Added once for the pool.',
                prefix: '$',
              },
              {
                label: 'Pool bonding',
                path: ['steel', 'poolBonding'],
                type: 'number',
                tooltip: 'Added once per pool and billed under Steel.',
                prefix: '$',
              },
              {
                label: 'Steps & bench (per lnft)',
                path: ['steel', 'stepsPerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of steps/bench.',
                prefix: '$',
              },
              {
                label: 'Depth over 8ft (per 6")',
                path: ['steel', 'depthOver8Ft'],
                type: 'number',
                tooltip: 'Applied per 6" depth increment over 8 ft end depth.',
                prefix: '$',
              },
              {
                label: '6" RBB steel (per lnft)',
                path: ['steel', 'rbb6PerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of 6" raised bond beam.',
                prefix: '$',
              },
              {
                label: '12" RBB steel (per lnft)',
                path: ['steel', 'rbb12PerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of 12" raised bond beam.',
                prefix: '$',
              },
              {
                label: '18" RBB steel (per lnft)',
                path: ['steel', 'rbb18PerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of 18" raised bond beam.',
                prefix: '$',
              },
              {
                label: '24" RBB steel (per lnft)',
                path: ['steel', 'rbb24PerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of 24" raised bond beam.',
                prefix: '$',
              },
              {
                label: '30" RBB steel (per lnft)',
                path: ['steel', 'rbb30PerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of 30" raised bond beam.',
                prefix: '$',
              },
              {
                label: '36" RBB steel (per lnft)',
                path: ['steel', 'rbb36PerLnft'],
                type: 'number',
                tooltip: 'Applied per linear foot of 36" raised bond beam.',
                prefix: '$',
              },
              {
                label: 'Spa double curtain',
                path: ['steel', 'spaDoubleCurtain'],
                type: 'number',
                tooltip: 'Added once when a raised shotcrete spa is selected.',
                prefix: '$',
              },
              {
                label: 'Travel per mile',
                path: ['steel', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
              {
                label: 'Muck out (unit price)',
                path: ['steel', 'muckOut'],
                type: 'number',
                tooltip: 'Added for shotcrete pools; multiplied by Muck Out Qty.',
                prefix: '$',
              },
              {
                label: 'Muck out qty',
                path: ['steel', 'muckOutQty'],
                type: 'number',
                tooltip: 'Quantity multiplier for Muck Out.',
              },
            ],
          },
        ],
      },
      {
        title: 'Shotcrete Labor',
        groups: [
          {
            title: 'Crew rates',
            scalars: [
              {
                label: 'Pool base (per yard)',
                path: ['shotcrete', 'labor', 'poolBase'],
                type: 'number',
                tooltip: 'Labor rate per yard (used for minimum and additional yardage).',
                prefix: '$',
              },
              {
                label: 'Minimum yards',
                path: ['shotcrete', 'labor', 'minimumYards'],
                type: 'number',
                tooltip: 'Minimum billable yardage for shotcrete labor.',
              },
              {
                label: 'Spa',
                path: ['shotcrete', 'labor', 'spa'],
                type: 'number',
                tooltip: 'Added once when a shotcrete spa exists.',
                prefix: '$',
              },
              {
                label: 'Distance 251-300',
                path: ['shotcrete', 'labor', 'distance250to300'],
                type: 'number',
                tooltip: 'Added when pool-to-street distance is 251-300.',
                prefix: '$',
              },
              {
                label: 'Distance 301-350',
                path: ['shotcrete', 'labor', 'distance300to350'],
                type: 'number',
                tooltip: 'Added when pool-to-street distance is 301-350.',
                prefix: '$',
              },
              {
                label: 'Travel per mile',
                path: ['shotcrete', 'labor', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Shotcrete Material',
        groups: [
          {
            title: 'Material rates',
            scalars: [
              {
                label: 'Material per yard',
                path: ['shotcrete', 'material', 'perYard'],
                type: 'number',
                tooltip: 'Yardage is rounded up from a formula using perimeter, interior area, RBB sqft, spa perimeter, double bullnose/curtain, and raised spa add.',
                prefix: '$',
              },
              {
                label: 'Clean-out',
                path: ['shotcrete', 'material', 'cleanOut'],
                type: 'number',
                tooltip: 'Added once for clean-out.',
                prefix: '$',
              },
              {
                label: 'Env/Fuel per yard',
                path: ['shotcrete', 'material', 'envFuelPerYard'],
                type: 'number',
                tooltip: 'Applied per shotcrete yard (same yardage used for material per yard).',
                prefix: '$',
              },
              {
                label: 'Miscellaneous',
                path: ['shotcrete', 'material', 'misc'],
                type: 'number',
                tooltip: 'Added once as a miscellaneous material charge.',
                prefix: '$',
              },
              {
                label: 'Travel per mile',
                path: ['shotcrete', 'material', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Tile, Coping & Decking',
        groups: [
          {
            title: 'Tile catalog',
            lists: [
              {
                title: 'Tile options',
                path: ['tileCoping', 'tile', 'options'],
                addLabel: 'Add tile option',
                emptyMessage: 'No tile options yet. Add one to expose it in the proposal builder.',
                defaultItem: () => ({
                  id: '',
                  name: '',
                  materialRate: 0,
                  laborRate: 0,
                }),
                fields: tileCopingRateFields,
              },
              {
                title: 'Trim Tile options',
                path: ['tileCoping', 'tile', 'stepTrimOptions'],
                addLabel: 'Add Trim Tile Option',
                emptyMessage: 'No trim tile options yet. Add one to expose it in the proposal builder.',
                defaultItem: () => ({
                  id: '',
                  name: '',
                  materialRate: 0,
                  laborRate: 0,
                }),
                canRemove: (entry) =>
                  normalizeTrimTileOptionId(entry?.id) !== DEFAULT_TRIM_TILE_OPTION_ID,
                fields: tileCopingRateFields,
              },
            ],
          },
          {
            title: 'Coping catalog',
            lists: [
              {
                title: 'Coping options',
                path: ['tileCoping', 'coping', 'options'],
                addLabel: 'Add coping option',
                emptyMessage: 'No coping options yet. Add one to expose it in the proposal builder.',
                defaultItem: () => ({
                  id: '',
                  name: '',
                  materialRate: 0,
                  laborRate: 0,
                }),
                fields: tileCopingRateFields,
              },
            ],
          },
          {
            title: 'Decking catalog',
            lists: [
              {
                title: 'Decking options',
                path: ['tileCoping', 'decking', 'options'],
                addLabel: 'Add decking option',
                emptyMessage: 'No decking options yet. Add one to expose it in the proposal builder.',
                defaultItem: () => ({
                  id: '',
                  name: '',
                  materialRate: 0,
                  laborRate: 0,
                }),
                fields: tileCopingRateFields,
              },
            ],
          },
          {
            title: 'Concrete steps',
            scalars: [
              {
                label: 'Material Rate',
                path: ['tileCoping', 'decking', 'material', 'concreteSteps'],
                type: 'number',
                tooltip: 'Applied per lnft of concrete steps length.',
                prefix: '$',
              },
              {
                label: 'Labor Rate',
                path: ['tileCoping', 'decking', 'labor', 'concreteSteps'],
                type: 'number',
                tooltip: 'Applied per lnft of concrete steps length.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Additional decking catalog',
            lists: [
              {
                title: 'Additional decking options',
                path: ['tileCoping', 'decking', 'additionalOptions'],
                addLabel: 'Add additional decking option',
                fields: additionalDeckingFields,
                defaultItem: () => ({ id: '' }),
                emptyMessage: 'No additional decking options yet. Add one to expose it in the proposal builder.',
              },
            ],
          },
          {
            title: 'Bullnose & spillway',
            lists: [
              {
                title: 'Bullnose & spillway rates',
                path: ['tileCoping', 'specialtyOptions'],
                addLabel: 'Add specialty row',
                allowAdd: false,
                allowRemove: false,
                fields: fixedTileCopingRateFields,
              },
            ],
          },
          {
            title: 'Material multipliers',
            scalars: [
              {
                label: 'Flagstone material multiplier',
                path: ['tileCoping', 'flagstoneQuantityMultiplier'],
                type: 'number',
                tooltip: 'Multiplies flagstone coping material quantity (1.1 = 10% overage).',
              },
            ],
          },
        ],
      },
      {
        title: 'Equipment',
        groups: [
          {
            title: 'Bundle Pricing',
            scalars: [
              { label: 'Check Valve', path: ['equipment', 'checkValve'], type: 'number', prefix: '$', tooltip: 'Added to fixed package totals when enabled, and billed directly on the Custom package option.' },
              { label: 'Base White Goods', path: ['equipment', 'baseWhiteGoods'], type: 'number', prefix: '$', tooltip: 'Legacy itemized equipment charge used outside of fixed package pricing.' },
            ],
            render: renderEquipmentPackageBuilder,
          },
          {
            title: 'Pumps',
            lists: [
              {
                title: 'Pump models',
                path: ['equipment', 'pumps'],
                addLabel: 'Add pump',
                defaultItem: { overheadMultiplier: 1.1 },
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Pump name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'overheadMultiplier', label: 'Overhead Multiplier', type: 'number', placeholder: '1.1' },
                ],
              },
            ],
          },
          {
            title: 'Blowers',
            lists: [
              {
                title: 'Blower models',
                path: ['equipment', 'auxiliaryPumps'],
                addLabel: 'Add blower',
                defaultItem: { overheadMultiplier: 1.1, defaultAuxiliaryPump: false },
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Blower name' },
                  { key: 'defaultAuxiliaryPump', label: 'Default Blower for Spa', type: 'boolean' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'overheadMultiplier', label: 'Overhead Multiplier', type: 'number', placeholder: '1.1' },
                ],
              },
            ],
          },
          {
            title: 'Filters',
            lists: [
              {
                title: 'Filter models',
                path: ['equipment', 'filters'],
                addLabel: 'Add filter',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Filter name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                ],
              },
            ],
          },
          {
            title: 'Cleaners',
            lists: [
              {
                title: 'Cleaner models',
                path: ['equipment', 'cleaners'],
                addLabel: 'Add cleaner',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Cleaner name' },
                  {
                    key: 'defaultCleaner',
                    label: 'Default Cleaner',
                    type: 'boolean',
                    tooltip: 'Used as the preselected cleaner for new proposals. Only one cleaner can be selected.',
                  },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                ],
              },
            ],
          },
          {
            title: 'Heaters',
            lists: [
              {
                title: 'Heater models',
                path: ['equipment', 'heaters'],
                addLabel: 'Add heater',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Heater name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                ],
              },
            ],
          },
          ...(isPpasEast
            ? ([
                {
                  title: 'Heater Chiller',
                  lists: [
                    {
                      title: 'Heater Chiller models',
                      path: ['equipment', 'heaterChillers'],
                      addLabel: 'Add heater chiller',
                      fields: [
                        { key: 'name', label: 'Name', type: 'text', placeholder: 'Heater Chiller name' },
                        { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                        { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                        { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                      ],
                    },
                  ],
                },
              ] satisfies Group[])
            : []),
          {
            title: 'Lighting & automation rates',
            scalars: [{ label: 'Automation extra zone', path: ['equipment', 'automationZoneAddon'], type: 'number' }],
            lists: [
              {
                title: 'Pool lights',
                path: ['equipment', 'lights', 'poolLights'],
                addLabel: 'Add pool light',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Pool light name' },
                  { key: 'defaultLightChoice', label: 'Default Light Choice', type: 'boolean' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                ],
              },
              {
                title: 'Spa lights',
                path: ['equipment', 'lights', 'spaLights'],
                addLabel: 'Add spa light',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Spa light name' },
                  { key: 'defaultLightChoice', label: 'Default Light Choice', type: 'boolean' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                ],
              },
              {
                title: 'Automation kits',
                path: ['equipment', 'automation'],
                addLabel: 'Add automation',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Automation name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost3', label: 'Add. Cost 3', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'includesSaltCell', label: 'Includes Salt Cell', type: 'boolean' },
                ],
              },
            ],
          },
          {
            title: 'Sanitation & accessories',
            lists: [
              {
                title: 'Sanitation systems',
                path: ['equipment', 'saltSystem'],
                addLabel: 'Add sanitation system',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Sanitation system name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'excludedFromSaltCell', label: 'Excluded from Salt Cell', type: 'boolean' },
                ],
              },
              {
                title: 'Sanitation accessories',
                path: ['equipment', 'sanitationAccessories'],
                addLabel: 'Add sanitation accessory',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Accessory name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                ],
              },
            ],
          },
          {
            title: 'Auto-fill systems',
            lists: [
              {
                title: 'Auto-fill systems',
                path: ['equipment', 'autoFillSystem'],
                addLabel: 'Add auto-fill system',
                fields: [
                  { key: 'name', label: 'Name', type: 'text', placeholder: 'Auto-fill system name' },
                  { key: 'basePrice', label: 'Base Price', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost1', label: 'Add. Cost 1', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'addCost2', label: 'Add. Cost 2', type: 'number', placeholder: '0', prefix: '$' },
                  { key: 'percentIncrease', label: '% cost increase', type: 'number', placeholder: '0' },
                  { key: 'requiresElectricRun', label: 'Requires electric run', type: 'boolean' },
                ],
              },
            ],
          },
        ],
      },
      {
        title: 'Interior Finish',
        groups: [
          {
            title: 'Prep & extras',
            scalars: [
              {
                label: 'Minimum charge',
                path: ['interiorFinish', 'minimumChargeSqft'],
                type: 'number',
                tooltip: 'Minimum billable interior finish area in sqft.',
                prefix: 'SQFT',
              },
              {
                label: 'Pool prep base',
                path: ['interiorFinish', 'extras', 'poolPrepBase'],
                type: 'number',
                tooltip: 'Added once for pool prep.',
                prefix: '$',
              },
              {
                label: 'Pool prep threshold',
                path: ['interiorFinish', 'extras', 'poolPrepThreshold'],
                type: 'number',
                tooltip: 'Sqft threshold before prep overage applies.',
                prefix: 'SQFT',
              },
              {
                label: 'Pool prep overage (per sqft)',
                path: ['interiorFinish', 'extras', 'poolPrepOverRate'],
                type: 'number',
                tooltip: 'Applied per sqft above the prep threshold using billed area.',
                prefix: '$',
              },
              {
                label: 'Spa prep add-on (over threshold)',
                path: ['interiorFinish', 'extras', 'spaPrep'],
                type: 'number',
                tooltip: 'Added once when a shotcrete spa exists and pool surface area exceeds the prep threshold.',
                prefix: '$',
              },
              {
                label: 'Miscellaneous',
                path: ['interiorFinish', 'extras', 'misc'],
                type: 'number',
                tooltip: 'Added once as a miscellaneous interior finish charge.',
                prefix: '$',
              },
              {
                label: 'Travel per mile',
                path: ['interiorFinish', 'extras', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
              {
                label: 'Step & bench detail (per lnft over 20)',
                path: ['interiorFinish', 'extras', 'stepDetailPerLnftOver20'],
                type: 'number',
                tooltip: 'Applied to steps/bench quantity above 20.',
                prefix: '$',
              },
            ],
          },
          ...(!isPpasEast
            ? ([
                {
                  title: 'Additional Options',
                  scalarTable: {
                    title: 'Interior Finish Additional Options',
                    rows: [
                      {
                        label: 'Waterproofing (Microglass) - Pool & Spa Area',
                        path: ['interiorFinish', 'extras', 'waterproofingPerSqft'],
                        defaultEnabledPath: ['additionalFeatureDefaults', 'waterproofing'],
                        type: 'number',
                        prefix: '$',
                        tooltip: 'Applied per sqft of pool interior plus calculated spa waterproofing area when Waterproofing (Microglass) is enabled. This feature is enabled by default and unavailable in Bronze pricing.',
                      },
                      {
                        label: 'Waterproofing (Microglass) - Raised Spa',
                        path: ['interiorFinish', 'extras', 'waterproofingRaisedSpa'],
                        defaultEnabledPath: ['additionalFeatureDefaults', 'waterproofing'],
                        type: 'number',
                        prefix: '$',
                        tooltip: 'Added once in addition to the per-sqft waterproofing charge when a raised shotcrete spa is waterproofed. This feature is unavailable in Bronze pricing.',
                      },
                    ],
                  },
                },
              ] satisfies Group[])
            : []),
          {
            title: 'Finishes catalog',
            lists: [
              {
                title: 'Interior finishes',
                path: ['interiorFinish', 'finishes'],
                addLabel: 'Add finish',
                fields: [
                  { key: 'name', label: 'Interior Finish Name', type: 'text', placeholder: 'Pebble Sheen - Level 1' },
                  { key: 'costPerSqft', label: 'Cost Per Sqft', type: 'number', prefix: '$' },
                  { key: 'spaFinishCost', label: 'Spa Finish Cost', type: 'number', prefix: '$' },
                  { key: 'colors', label: 'Finish Colors (comma separated)', type: 'text' },
                ],
              },
            ],
          },
        ],
      },
      {
        title: 'Cleanup',
        groups: [
          {
            title: 'Final cleanup',
            scalars: [
              {
                label: 'Base pool cleanup',
                path: ['cleanup', 'basePool'],
                type: 'number',
                tooltip: 'Added once when a pool is defined.',
                prefix: '$',
              },
              {
                label: 'Spa cleanup add-on',
                path: ['cleanup', 'spa'],
                type: 'number',
                tooltip: 'Added once when a spa exists.',
                prefix: '$',
              },
              {
                label: 'Overage per sqft (over 500)',
                path: ['cleanup', 'perSqftOver500'],
                type: 'number',
                tooltip: 'Applied per sqft above 500 sqft of pool surface area.',
                prefix: '$',
              },
              {
                label: 'RBB cleanup (per sqft)',
                path: ['cleanup', 'rbbPerSqft'],
                type: 'number',
                tooltip: 'Applied per sqft of raised bond beam area.',
                prefix: '$',
              },
              {
                label: 'Travel per mile',
                path: ['cleanup', 'travelPerMile'],
                type: 'number',
                tooltip: 'Applied per mile of travel distance.',
                prefix: '$',
              },
              {
                label: 'Rough grading',
                path: ['cleanup', 'roughGrading'],
                type: 'number',
                tooltip: 'Added once when rough grading is selected.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Fiberglass Shells',
        groups: [
          {
            title: 'Shell settings',
            scalars: [
              {
                label: 'Spillover',
                path: ['fiberglass', 'spillover'],
                type: 'number',
                tooltip:
                  'Legacy fallback add-on used only when fiberglass spa options do not define their own spillover shell price.',
                prefix: '$',
              },
              {
                label: 'Equipment pad cost',
                path: ['fiberglass', 'equipmentPadCost'],
                type: 'number',
                tooltip: 'Added to Equipment Ordered for fiberglass shells at a quantity of 1 + heater quantity.',
                prefix: '$',
              },
              {
                label: 'Spa install cost',
                path: ['fiberglass', 'spaInstall'],
                type: 'number',
                tooltip:
                  'Workbook-style install labor added when a fiberglass spa option is selected, even if the pool shell is not fiberglass.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Pool shell catalogs',
            lists: [
              {
                title: 'Small fiberglass pool models',
                path: ['fiberglass', 'poolModels', 'small'],
                addLabel: 'Add small model',
                variant: 'table',
                emptyMessage: 'No small fiberglass models yet. Add one to show it in the proposal builder.',
                defaultItem: () => ({
                  name: '',
                  shellPrice: 0,
                  freight: 0,
                  crane: 0,
                  install: 0,
                  gravel: 0,
                }),
                fields: fiberglassPoolModelFields,
              },
              {
                title: 'Medium fiberglass pool models',
                path: ['fiberglass', 'poolModels', 'medium'],
                addLabel: 'Add medium model',
                variant: 'table',
                emptyMessage: 'No medium fiberglass models yet. Add one to show it in the proposal builder.',
                defaultItem: () => ({
                  name: '',
                  shellPrice: 0,
                  freight: 0,
                  crane: 0,
                  install: 0,
                  gravel: 0,
                }),
                fields: fiberglassPoolModelFields,
              },
              {
                title: 'Large fiberglass pool models',
                path: ['fiberglass', 'poolModels', 'large'],
                addLabel: 'Add large model',
                variant: 'table',
                emptyMessage: 'No large fiberglass models yet. Add one to show it in the proposal builder.',
                defaultItem: () => ({
                  name: '',
                  shellPrice: 0,
                  freight: 0,
                  crane: 0,
                  install: 0,
                  gravel: 0,
                }),
                fields: fiberglassPoolModelFields,
              },
            ],
          },
          {
            title: 'Spa options',
            lists: [
              {
                title: 'Fiberglass spa options',
                path: ['fiberglass', 'spaOptions'],
                addLabel: 'Add spa option',
                variant: 'table',
                emptyMessage: 'No fiberglass spa options yet. Add one to show it in the proposal builder.',
                defaultItem: () => ({
                  name: '',
                  price: 0,
                  crane: 0,
                }),
                fields: fiberglassSpaOptionFields,
              },
            ],
          },
          {
            title: 'Tanning ledges',
            lists: [
              {
                title: 'Fiberglass tanning ledge options',
                path: ['fiberglass', 'tanningLedgeOptions'],
                addLabel: 'Add tanning ledge option',
                variant: 'table',
                emptyMessage: 'No tanning ledge options yet. Add one to show it in the proposal builder.',
                defaultItem: () => ({
                  name: '',
                  price: 0,
                }),
                fields: fiberglassNamedPriceFields,
              },
            ],
          },
          {
            title: 'Finish upgrades',
            lists: [
              {
                title: 'Fiberglass finish upgrades',
                path: ['fiberglass', 'finishUpgrades'],
                addLabel: 'Add finish upgrade',
                variant: 'table',
                emptyMessage: 'No finish upgrades yet. Add one to show it in the proposal builder.',
                defaultItem: () => ({
                  name: '',
                  price: 0,
                }),
                fields: fiberglassNamedPriceFields,
              },
            ],
          },
          {
            title: 'Contract payment schedule',
            scalars: [
              {
                label: 'Permitting',
                path: ['misc', 'contractPaymentSchedule', 'fiberglass', 'permitting'],
                type: 'number',
                tooltip: 'Percent of remaining cash price due at permitting for fiberglass contracts.',
                prefix: '%',
                isPercent: true,
              },
              {
                label: 'Shell Delivery',
                path: ['misc', 'contractPaymentSchedule', 'fiberglass', 'shellDelivery'],
                type: 'number',
                tooltip: 'Percent of remaining cash price due at shell delivery for fiberglass contracts.',
                prefix: '%',
                isPercent: true,
              },
              {
                label: 'Equipment Set',
                path: ['misc', 'contractPaymentSchedule', 'fiberglass', 'equipmentSet'],
                type: 'number',
                tooltip: 'Percent of remaining cash price due at equipment set for fiberglass contracts.',
                prefix: '%',
                isPercent: true,
              },
              {
                label: 'Balance at Decking',
                path: ['misc', 'contractPaymentSchedule', 'fiberglass', 'decking'],
                type: 'number',
                tooltip: 'Percent of remaining cash price due at decking for fiberglass contracts.',
                prefix: '%',
                isPercent: true,
              },
            ],
          },
        ],
      },
      {
        title: 'Misc',
        groups: [
          {
            title: 'Tax',
            scalars: [
              {
                label: 'Tax Rate',
                path: ['misc', 'taxRate'],
                type: 'number',
                tooltip: 'Default tax rate used by all tax line calculations.',
                prefix: '%',
                isPercent: true,
              },
            ],
          },
          {
            title: 'Equipment Set',
            scalars: [
              {
                label: 'Base equipment set',
                path: ['misc', 'equipmentSet', 'base'],
                type: 'number',
                tooltip: 'Added once when any equipment is selected.',
                prefix: '$',
              },
              {
                label: 'Heater set (per unit)',
                path: ['misc', 'equipmentSet', 'heater'],
                type: 'number',
                tooltip: 'Applied per heater or heat pump selected.',
                prefix: '$',
              },
              {
                label: 'Additional pump (per unit)',
                path: ['misc', 'equipmentSet', 'additionalPump'],
                type: 'number',
                tooltip: 'Applied per pump beyond the first.',
                prefix: '$',
              },
              {
                label: 'Pool bonding (per lnft)',
                path: ['excavation', 'poolBonding', 'pricePerLnft'],
                type: 'number',
                prefix: '$',
                tooltip: 'Applied to pool perimeter with 10% overhead (billed under Excavation).',
              },
            ],
          },
          {
            title: 'Startup / Orientation',
            scalars: [
              {
                label: 'Start-Up & 30 Days',
                path: ['misc', 'startup', 'base'],
                type: 'number',
                tooltip: 'Added once when a pool is defined.',
                prefix: '$',
              },
              {
                label: 'Automation add-on',
                path: ['misc', 'startup', 'automationAdd'],
                type: 'number',
                tooltip: 'Added once when automation is selected.',
                prefix: '$',
              },
              {
                label: '5 Year Warranty',
                path: ['misc', 'startup', 'fiveYearWarranty'],
                type: 'number',
                tooltip: 'Added once to the Startup/Orientation COGS category.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Water truck',
            scalars: [
              {
                label: 'Water truck cost',
                path: ['misc', 'waterTruck', 'base'],
                type: 'number',
                tooltip: 'Applied per water truck load.',
                prefix: '$',
              },
              {
                label: 'Water truck size (gallons)',
                path: ['misc', 'waterTruck', 'loadSizeGallons'],
                type: 'number',
                tooltip: 'Gallons per water truck load used to calculate total loads.',
                prefix: 'Gal',
              },
            ],
          },
          {
            title: 'Drainage rates',
            scalars: [
              {
                label: 'Base cost (per line)',
                path: ['misc', 'drainage', 'baseCost'],
                type: 'number',
                tooltip: 'Charged once per drain line when length > 0 (includes first included feet).',
                prefix: '$',
              },
              {
                label: 'Included feet',
                path: ['misc', 'drainage', 'includedFt'],
                type: 'number',
                tooltip: 'Feet included per drain line before overage applies.',
                prefix: 'LNFT',
              },
              {
                label: 'Per lnft over included',
                path: ['misc', 'drainage', 'perFtOver'],
                type: 'number',
                tooltip: 'Applied to length above included feet for each drain line.',
                prefix: '$',
              },
            ],
          },
        ],
      },
      {
        title: 'Masonry',
        groups: [
          {
            title: 'Columns & spillway',
            scalars: [
              {
                label: 'Column base (per ft height)',
                path: ['masonry', 'columnBase'],
                type: 'number',
                tooltip: 'Applied per ft of column height (qty = column count x column height) when columns + facing are selected.',
                prefix: '$',
              },
              {
                label: 'Spillway labor (per unit)',
                path: ['masonry', 'labor', 'spillway'],
                type: 'number',
                tooltip: 'Added once when a raised spa exists.',
                prefix: '$',
              },
              {
                label: 'Spillway material (per unit)',
                path: ['masonry', 'material', 'spillway'],
                type: 'number',
                tooltip: 'Added once when a raised spa exists.',
                prefix: '$',
              },
            ],
          },
          {
            title: 'Facing options',
            lists: [
              {
                title: 'RBB / Exposed Pool Wall facings',
                path: ['masonry', 'rbbFacingOptions'],
                addLabel: 'Add facing option',
                variant: 'table',
                emptyMessage: 'No RBB facing options yet. Add one to get started.',
                defaultItem: () => ({
                  id: '',
                  name: '',
                  materialCost: 0,
                  laborCost: 0,
                }),
                fields: masonryFacingFields,
              },
              ...(isPpasEast
                ? ([
                    {
                      title: 'Backside Facings',
                      path: ['masonry', 'backsideFacingOptions'],
                      addLabel: 'Add backside facing',
                      variant: 'table',
                      emptyMessage: 'No backside facing options yet. Add one to get started.',
                      defaultItem: () => ({
                        id: '',
                        name: '',
                        materialCost: 0,
                        laborCost: 0,
                      }),
                      fields: masonryFacingFields,
                    },
                  ] satisfies ListConfig[])
                : []),
              {
                title: 'Raised Spa facings',
                path: ['masonry', 'raisedSpaFacingOptions'],
                addLabel: 'Add facing option',
                variant: 'table',
                emptyMessage: 'No raised spa facing options yet. Add one to get started.',
                defaultItem: () => ({
                  id: '',
                  name: '',
                  materialCost: 0,
                  laborCost: 0,
                }),
                fields: masonryFacingFields,
              },
            ],
          },
          {
            title: 'Raised spa multipliers',
            scalars: [
              {
                label: 'Raised spa labor multiplier',
                path: ['masonry', 'raisedSpaWasteMultiplier'],
                type: 'number',
                tooltip: 'Multiplies raised spa facing labor sqft (1.125 = 12.5% overhead).',
              },
              {
                label: 'Raised spa material multiplier',
                path: ['masonry', 'raisedSpaMaterialWaste'],
                type: 'number',
                tooltip: 'Multiplies raised spa facing material sqft (1.15 = 15% overhead).',
              },
            ],
          },
          {
            title: 'Retaining wall catalog',
            lists: [
              {
                title: 'Retaining wall types',
                path: ['masonry', 'retainingWalls'],
                addLabel: 'Add retaining wall',
                fields: [
                  {
                    key: 'name',
                    label: 'Name',
                    type: 'text',
                    placeholder: '24\" High - Standard',
                    tooltip: 'Label shown in the proposal builder.',
                  },
                  {
                    key: 'heightFt',
                    label: 'Height',
                    type: 'number',
                    prefix: 'FT',
                    tooltip: 'Used to convert length to sqft (height x length).',
                  },
                  {
                    key: 'costPerSqft',
                    label: 'Cost per sqft',
                    type: 'number',
                    prefix: '$',
                    tooltip: 'Total cost per sqft (labor + material combined).',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        title: 'Custom Features',
        groups: [
          {
            title: 'Grouped feature catalog',
            lists: [
              {
                title: 'Additional Options',
                path: ['customFeatures', 'groupedSubcategories'],
                addLabel: 'Add additional option',
                variant: 'table',
                emptyMessage: 'No additional options yet. Add one to configure shared add-on costs like gates.',
                defaultItem: () => ({
                  id: `additional-option-${Date.now()}`,
                  groupName: '',
                  name: '',
                  addonUnitPrice: 0,
                }),
                fields: [
                  {
                    key: 'groupName',
                    label: 'Additional Options Group',
                    type: 'text',
                    placeholder: 'Gate Type',
                    tooltip: 'Shown as the dropdown label for grouped features that use this option group.',
                  },
                  {
                    key: 'name',
                    label: 'Additional Option',
                    type: 'text',
                    placeholder: 'Single Gate',
                    tooltip: 'One selectable option inside the additional options dropdown.',
                  },
                  {
                    key: 'addonUnitPrice',
                    label: 'Additional Option Cost',
                    type: 'number',
                    prefix: '$',
                    tooltip: 'Per-item cost added when this additional option is attached to a grouped feature.',
                  },
                ],
              },
              {
                title: 'Grouped custom features',
                path: ['customFeatures', 'groupedOptions'],
                addLabel: 'Add grouped feature',
                variant: 'table',
                emptyMessage: 'No grouped custom features yet. Add one to show it on the proposal builder.',
                defaultItem: () => ({
                  id: `custom-feature-${Date.now()}`,
                  name: '',
                  subcategory: '',
                  additionalOptionCategory: '',
                  description: '',
                  pricingMode: 'total',
                  totalPrice: 0,
                  pricePerSqft: 0,
                }),
                fields: [
                  {
                    key: 'name',
                    label: 'Feature Name',
                    type: 'text',
                    placeholder: 'Sod Package',
                    tooltip: 'Label shown on the selectable block in the Custom Features proposal page.',
                  },
                  {
                    key: 'subcategory',
                    label: 'Subcategory',
                    type: 'text',
                    placeholder: 'Sod',
                    tooltip: 'Used to group this item inside the Grouped Features section in the proposal builder.',
                  },
                  {
                    key: 'additionalOptionCategory',
                    label: 'Additional Options Category',
                    type: 'select',
                    defaultValue: '',
                    options: ({ data }) => {
                      const additionalOptionNames = (
                        ((data?.customFeatures?.groupedSubcategories as any[]) || []) as Array<{
                          groupName?: string;
                          name?: string;
                          addonLabel?: string;
                        }>
                      )
                        .map((option) => String(option?.groupName || option?.name || option?.addonLabel || '').trim())
                        .filter(Boolean);
                      const uniqueNames = Array.from(new Set(additionalOptionNames));
                      return [{ label: 'None', value: '' }, ...uniqueNames.map((name) => ({ label: name, value: name }))];
                    },
                    tooltip: 'Optional add-on category for this grouped feature, such as Gate for fence items.',
                  },
                  {
                    key: 'description',
                    label: 'Description',
                    type: 'text',
                    placeholder: 'Prepared area with sod install around pool',
                    tooltip: 'Visible to designers beneath the feature name.',
                  },
                  {
                    key: 'pricingMode',
                    label: 'Pricing Mode',
                    type: 'select',
                    defaultValue: 'total',
                    options: [
                      { label: 'Total', value: 'total' },
                      { label: 'SQFT', value: 'sqft' },
                    ],
                    tooltip: 'Choose whether this grouped feature uses a flat total or a per-square-foot price.',
                  },
                  {
                    key: 'totalPrice',
                    label: 'Total Price',
                    type: 'number',
                    prefix: '$',
                    tooltip: 'Preset total used when the designer selects this grouped feature.',
                    hidden: (entry) => String(entry?.pricingMode || 'total') === 'sqft',
                  },
                  {
                    key: 'pricePerSqft',
                    label: 'Price per SF',
                    type: 'number',
                    prefix: '$',
                    tooltip: 'Per-square-foot price used when the designer enters square footage for this grouped feature.',
                    hidden: (entry) => String(entry?.pricingMode || 'total') !== 'sqft',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    [
      data,
      additionalDeckingFields,
      excavationBaseTableFields,
      excavationExposedPoolWallFields,
      excavationRaisedBondBeamFields,
      fixedTileCopingRateFields,
      masonryFacingFields,
      tileCopingRateFields,
      data.electrical.overrunThreshold,
      data.electrical.heatPumpOverrunThreshold,
      data.plumbing.gasOverrunThreshold,
      data.plumbing.poolOverrunThreshold,
      data.plumbing.spaOverrunThreshold,
      data.papDiscountRates,
      data.manualAdjustments,
      isPpasEast,
    ],
  );

  useEffect(() => {
    if (!sections.length) {
      setActiveSectionTitle('');
      return;
    }

    setActiveSectionTitle((current) =>
      current && sections.some((section) => section.title === current) ? current : sections[0].title
    );
  }, [sections]);

  const activeSection = useMemo(
    () => sections.find((section) => section.title === activeSectionTitle) || sections[0] || null,
    [activeSectionTitle, sections]
  );

  useEffect(() => {
    if (!selectedListItem || !activeSection || selectedListItem.sectionTitle !== activeSection.title) {
      return;
    }

    const selectedGroup = activeSection.groups.find((group) => group.title === selectedListItem.groupTitle);
    const selectedList = selectedGroup?.lists?.find((list) => getPathKey(list.path) === selectedListItem.listPathKey);
    const entries = selectedList ? ((getValue(data, selectedList.path) as any[]) || []) : [];

    if (!selectedList || selectedListItem.index >= entries.length) {
      setSelectedListItem(null);
    }
  }, [activeSection, data, selectedListItem]);

  useEffect(() => {
    if (!activeSection || !selectedListItem || selectedListItem.sectionTitle === activeSection.title) {
      return;
    }
    setSelectedListItem(null);
  }, [activeSection, selectedListItem]);

  useEffect(() => {
    if (!selectedAdditionalFeature || !activeSection) {
      return;
    }

    const selectedGroup = activeSection.groups.find(
      (group) => group.title === selectedAdditionalFeature.groupTitle
    );
    const selectedRow = selectedGroup?.scalarTable?.rows.find(
      (row) => getPathKey(row.path) === selectedAdditionalFeature.rowPathKey
    );

    if (
      selectedAdditionalFeature.sectionTitle !== activeSection.title ||
      !selectedGroup ||
      !selectedRow
    ) {
      setSelectedAdditionalFeature(null);
    }
  }, [activeSection, selectedAdditionalFeature]);

  const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`;

  const getGroupSummary = (group: Group) => {
    const hasCustom = Boolean(group.render);
    const hasScalars = Boolean(group.scalars?.length);
    const hasScalarTable = Boolean(group.scalarTable?.rows.length);
    const hasLists = Boolean(group.lists?.length);

    if (hasScalarTable) {
      return 'Edit the fixed costs for optional features available to designers in this proposal category.';
    }

    if (hasCustom && hasScalars && hasLists) {
      return 'Use the builder below, then tune the related pricing inputs and catalog entries.';
    }
    if (hasCustom && hasScalars) {
      return 'Use the builder below, then tune the related pricing inputs.';
    }
    if (hasCustom && hasLists) {
      return 'Use the builder below, then manage the related catalog entries.';
    }
    if (hasCustom) {
      return 'Use the builder below to manage this pricing area.';
    }
    if (hasScalars && hasLists) {
      return 'Adjust the rates and manage the selectable items used in this subcategory.';
    }
    return null;
  };

  const formatNumericValue = (value: number) => {
    if (!Number.isFinite(value)) {
      return '0';
    }
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  };

  const formatPercentInputValue = (value: number) => {
    if (!Number.isFinite(value)) {
      return '';
    }
    return value.toFixed(6).replace(/\.?0+$/, '');
  };

  const formatPrefixedValue = (prefix: string | undefined, value: string) => {
    if (!prefix) {
      return value;
    }
    if (prefix === '$' || prefix === '%' || prefix === '-$') {
      return `${prefix}${value}`;
    }
    return `${prefix} ${value}`;
  };

  const getListFieldValue = (list: ListConfig, entry: any, field: ListField, index: number) => {
    let fieldValue = entry ? entry[field.key] : '';
    if (field.key === 'colors' && Array.isArray(fieldValue)) {
      fieldValue = fieldValue.join(', ');
    }
    if (field.type === 'select' && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
      fieldValue = field.defaultValue ?? getListFieldOptions(list, field, entry, index)[0]?.value ?? '';
    }
    if (field.key === 'overheadMultiplier' && (fieldValue === undefined || fieldValue === null)) {
      fieldValue = 1.1;
    }
    if (
      field.key === 'defaultCleaner' &&
      list.path[0] === 'equipment' &&
      list.path[1] === 'cleaners'
    ) {
      const entries = (getValue(data, list.path) as any[]) || [];
      fieldValue = index === getDefaultCleanerIndex(entries);
    }
    return fieldValue;
  };

  const formatListFieldValue = (list: ListConfig, entry: any, field: ListField, index: number) => {
    if (isListFieldHidden(field, entry)) {
      return '—';
    }
    const fieldValue = getListFieldValue(list, entry, field, index);
    if (field.type === 'boolean') {
      return fieldValue ? 'Yes' : 'No';
    }
    if (field.type === 'select') {
      const selected = getListFieldOptions(list, field, entry, index).find((option) => option.value === fieldValue);
      return selected?.label || String(fieldValue || '—');
    }
    if (field.type === 'number') {
      if (field.allowBlank && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
        return '—';
      }
      return formatPrefixedValue(field.prefix, formatNumericValue(Number(fieldValue) || 0));
    }
    const normalized = String(fieldValue ?? '').trim();
    return normalized || '—';
  };

  const getListEntryLabel = (list: ListConfig, entry: any, index: number) => {
    const nameLikeField = list.fields.find((field) =>
      ['name', 'description', 'breakpointRange', 'rbbSize'].includes(field.key)
    );
    const nameLikeValue = nameLikeField ? getListFieldValue(list, entry, nameLikeField, index) : '';
    return String(nameLikeValue || entry?.name || entry?.id || `${list.title} ${index + 1}`);
  };

  const getPreviewFields = (list: ListConfig) => list.fields;

  const selectedListEditor = useMemo(() => {
    if (!selectedListItem || !activeSection || selectedListItem.sectionTitle !== activeSection.title) {
      return null;
    }

    const group = activeSection.groups.find((candidate) => candidate.title === selectedListItem.groupTitle);
    const list = group?.lists?.find((candidate) => getPathKey(candidate.path) === selectedListItem.listPathKey);
    const entry = list ? (((getValue(data, list.path) as any[]) || [])[selectedListItem.index] ?? null) : null;

    if (!group || !list || !entry) {
      return null;
    }

    return {
      group,
      list,
      entry,
      index: selectedListItem.index,
    };
  }, [activeSection, data, selectedListItem]);

  const selectedAdditionalFeatureEditor = useMemo(() => {
    if (
      !selectedAdditionalFeature ||
      !activeSection ||
      selectedAdditionalFeature.sectionTitle !== activeSection.title
    ) {
      return null;
    }

    const group = activeSection.groups.find(
      (candidate) => candidate.title === selectedAdditionalFeature.groupTitle
    );
    const field = group?.scalarTable?.rows.find(
      (candidate) => getPathKey(candidate.path) === selectedAdditionalFeature.rowPathKey
    );

    if (!group || !field) {
      return null;
    }

    return { group, field };
  }, [activeSection, selectedAdditionalFeature]);

  const isBronzeEditor = isBronzePricingTier(selectedPricingTierId);
  const isTierPathDifferent = (path: Path) =>
    isBronzeEditor && !arePricingValuesEqual(getValue(data, path), getValue(normalData, path));
  const handleResetTierPath = (path: Path) => {
    resetPricingTierOverride(path);
    setData(getPricingDataSnapshot());
    setNormalData(getNormalPricingDataSnapshot());
    setSelectedPricingTierId(getActivePricingTierId());
    setHasChanges(true);
  };
  const renderTierResetButton = (path: Path, disabled = false) => {
    if (!isTierPathDifferent(path) || disabled || isActiveBronzeLockedPricingPath(path)) return null;
    return (
      <button
        type="button"
        className="pricing-tier-reset-button"
        data-tooltip="Reset to Normal Tier value"
        aria-label="Reset to Normal Tier value"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleResetTierPath(path);
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M12.6 5.4A5 5 0 108 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M12.6 2.5v2.9H9.7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    );
  };

  const renderScalar = (field: ScalarField) => {
    const value = getValue(data, field.valuePath ?? field.path);
    const displayValue =
      field.type === 'number' && field.isPercent && typeof value === 'number'
        ? formatPercentInputValue(value * 100)
        : value;
    const isLocked = isActiveBronzeLockedPricingPath(field.path);
    const isDisabled = Boolean(field.disabled) || isLocked;
    const isUnused = Boolean(field.isUnused);
    const isTierDifferent = isTierPathDifferent(field.path);
    if (field.type === 'boolean') {
      return (
        <label className={`pricing-field${isDisabled ? ' is-disabled' : ''}${isUnused ? ' is-unused' : ''}${isLocked ? ' is-tier-locked' : ''}${isTierDifferent ? ' is-tier-different' : ''}`}>
          <div className="pricing-field__label">
            <input
              type="checkbox"
              checked={Boolean(value)}
              disabled={isDisabled}
              aria-disabled={isDisabled}
              onChange={(e) => handleScalarChange(field, e.target.checked)}
            />
            {renderLabelText(field.label)}
            {field.tooltip && (
              <span
                className="pricing-field__info"
                data-tooltip={field.tooltip}
                aria-label={field.tooltip}
                role="img"
                onMouseEnter={updateTooltipAlign}
              >
                i
              </span>
            )}
            {renderTierResetButton(field.path, isDisabled)}
          </div>
          {field.note && <div className="pricing-field__note">{field.note}</div>}
        </label>
      );
    }

    return (
      <label className={`pricing-field${isDisabled ? ' is-disabled' : ''}${isUnused ? ' is-unused' : ''}${isLocked ? ' is-tier-locked' : ''}${isTierDifferent ? ' is-tier-different' : ''}`}>
        <div className="pricing-field__label">
          {renderLabelText(field.label)}
          {field.tooltip && (
            <span
              className="pricing-field__info"
              data-tooltip={field.tooltip}
              aria-label={field.tooltip}
              role="img"
              onMouseEnter={updateTooltipAlign}
            >
              i
            </span>
          )}
          {renderTierResetButton(field.path, isDisabled)}
        </div>
        <div className={`pricing-field__input-wrap${field.prefix ? ' has-prefix' : ''}`}>
          {field.prefix && <span className="pricing-field__prefix">{field.prefix}</span>}
          <input
            className={`pricing-field__input${field.prefix ? ' pricing-field__input--bare' : ''}`}
            type={field.type === 'number' ? 'number' : 'text'}
            value={typeof displayValue === 'number' ? displayValue : displayValue ?? ''}
            step={field.type === 'number' && field.isPercent ? '0.01' : undefined}
            disabled={isDisabled}
            aria-disabled={isDisabled}
            onChange={(e) => handleScalarChange(field, e.target.value)}
          />
        </div>
        {field.note && <div className="pricing-field__note">{field.note}</div>}
      </label>
    );
  };

  const renderScalarTable = (
    config: NonNullable<Group['scalarTable']>,
    sectionTitle: string,
    groupTitle: string
  ) => (
    <div className="pricing-browser-card pricing-scalar-table-card">
      <div className="pricing-browser-card__header">
        <div className="pricing-browser-card__title-block">
          <h5>{config.title}</h5>
          <span className="pricing-browser-card__meta">{pluralize(config.rows.length, 'feature')}</span>
        </div>
      </div>
      <div className="pricing-browser-card__body">
        <div className="pricing-table-wrapper">
          <table className="pricing-table pricing-table--browser pricing-scalar-table">
            <thead>
              <tr>
                <th scope="col" className="pricing-table__select-col" />
                <th scope="col">Additional Feature</th>
                <th scope="col">Associated Cost</th>
                <th scope="col">Enabled by Default?</th>
              </tr>
            </thead>
            <tbody>
              {config.rows.map((field) => {
                const value = getValue(data, field.valuePath ?? field.path);
                const isLocked = isActiveBronzeLockedPricingPath(field.path);
                const isTierDifferent = isTierPathDifferent(field.path);
                const isDefaultTierDifferent = isTierPathDifferent(field.defaultEnabledPath);
                const isEnabledByDefault = Boolean(getValue(data, field.defaultEnabledPath));
                const rowPathKey = getPathKey(field.path);
                const isSelected =
                  selectedAdditionalFeature?.sectionTitle === sectionTitle &&
                  selectedAdditionalFeature?.groupTitle === groupTitle &&
                  selectedAdditionalFeature?.rowPathKey === rowPathKey;

                const selectRow = () => {
                  setSelectedListItem(null);
                  setSelectedAdditionalFeature({ sectionTitle, groupTitle, rowPathKey });
                };

                return (
                  <tr
                    key={`${sectionTitle}-${groupTitle}-${field.path.join('.')}`}
                    className={isSelected ? 'is-selected' : ''}
                    tabIndex={0}
                    onClick={selectRow}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectRow();
                      }
                    }}
                  >
                    <td className="pricing-table__select-col">
                      <span className={`pricing-table__row-indicator${isSelected ? ' is-selected' : ''}`}>
                        {isSelected ? '>' : ''}
                      </span>
                    </td>
                    <td className="pricing-scalar-table__feature">
                      <div className="pricing-scalar-table__feature-label">
                        {renderLabelText(field.label)}
                        {field.tooltip && (
                          <span
                            className="pricing-field__info"
                            data-tooltip={field.tooltip}
                            aria-label={field.tooltip}
                            role="img"
                            onMouseEnter={updateTooltipAlign}
                          >
                            i
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`pricing-scalar-table__cost${isTierDifferent ? ' is-tier-different' : ''}${
                        isLocked ? ' is-tier-locked' : ''
                      }`}
                    >
                      {formatPrefixedValue(field.prefix, formatNumericValue(Number(value) || 0))}
                    </td>
                    <td className={isDefaultTierDifferent ? 'is-tier-different' : ''}>
                      {isEnabledByDefault ? 'Yes' : 'No'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pricing-browser-card__hint">
          Select a row to edit its cost and new-proposal default in the details panel.
        </div>
      </div>
    </div>
  );

  const renderSelectedAdditionalFeatureEditor = () => {
    if (!selectedAdditionalFeatureEditor) {
      return null;
    }

    const { group, field } = selectedAdditionalFeatureEditor;
    const value = getValue(data, field.valuePath ?? field.path);
    const displayValue =
      field.type === 'number' && field.isPercent && typeof value === 'number'
        ? formatPercentInputValue(value * 100)
        : value;
    const isCostLocked = Boolean(field.disabled) || isActiveBronzeLockedPricingPath(field.path);
    const isCostDifferent = isTierPathDifferent(field.path);
    const isDefaultDifferent = isTierPathDifferent(field.defaultEnabledPath);
    const isEnabledByDefault = Boolean(getValue(data, field.defaultEnabledPath));
    const isReadOnly = Boolean(viewingHistoricalRevision);

    const updateDefault = (enabled: boolean) => {
      if (isReadOnly) return;
      updatePricingValue(field.defaultEnabledPath, enabled);
      setHasChanges(true);
    };

    return (
      <div className="pricing-rail-card">
        <div className="pricing-rail-card__header">
          <div>
            <p className="pricing-rail-card__eyebrow">{group.title}</p>
            <h3>Edit Additional Feature</h3>
            <p className="pricing-rail-card__summary">{field.label}</p>
          </div>
          <button
            type="button"
            className="pricing-rail-card__close"
            aria-label="Close additional feature editor"
            onClick={() => setSelectedAdditionalFeature(null)}
          >
            ×
          </button>
        </div>
        <div className="pricing-rail-card__body">
          <label className="pricing-field is-disabled">
            <div className="pricing-field__label">{renderLabelText('Additional Feature')}</div>
            <input
              className="pricing-field__input"
              type="text"
              value={field.label}
              disabled
              aria-label="Additional Feature cannot be renamed"
            />
            <div className="pricing-field__note">Feature names are fixed and cannot be renamed.</div>
          </label>

          <label
            className={`pricing-field${isCostLocked || isReadOnly ? ' is-disabled' : ''}${
              isCostDifferent ? ' is-tier-different' : ''
            }`}
          >
            <div className="pricing-field__label">
              {renderLabelText('Associated Cost')}
              {field.tooltip && (
                <span
                  className="pricing-field__info"
                  data-tooltip={field.tooltip}
                  aria-label={field.tooltip}
                  role="img"
                  onMouseEnter={updateTooltipAlign}
                >
                  i
                </span>
              )}
              {renderTierResetButton(field.path, isCostLocked || isReadOnly)}
            </div>
            <div className={`pricing-field__input-wrap${field.prefix ? ' has-prefix' : ''}`}>
              {field.prefix && <span className="pricing-field__prefix">{field.prefix}</span>}
              <input
                className={`pricing-field__input${field.prefix ? ' pricing-field__input--bare' : ''}`}
                type={field.type === 'number' ? 'number' : 'text'}
                value={typeof displayValue === 'number' ? displayValue : displayValue ?? ''}
                step={field.type === 'number' && field.isPercent ? '0.01' : undefined}
                disabled={isCostLocked || isReadOnly}
                onChange={(event) => handleScalarChange(field, event.target.value)}
              />
            </div>
          </label>

          <div className={`pricing-field${isReadOnly ? ' is-disabled' : ''}${isDefaultDifferent ? ' is-tier-different' : ''}`}>
            <div className="pricing-field__label">
              {renderLabelText('Enabled by Default?')}
              <span
                className="pricing-field__info"
                data-tooltip="Controls whether this feature starts enabled when a designer creates a new proposal. Existing proposals are not changed."
                aria-label="Controls whether this feature starts enabled when a designer creates a new proposal. Existing proposals are not changed."
                role="img"
                onMouseEnter={updateTooltipAlign}
              >
                i
              </span>
              {renderTierResetButton(field.defaultEnabledPath, isReadOnly)}
            </div>
            <div className="pricing-choice-toggle" role="group" aria-label="Enabled by Default?">
              <button
                type="button"
                className={`pricing-choice-toggle__option${isEnabledByDefault ? ' is-active' : ''}`}
                disabled={isReadOnly}
                onClick={() => updateDefault(true)}
              >
                Yes
              </button>
              <button
                type="button"
                className={`pricing-choice-toggle__option${!isEnabledByDefault ? ' is-active' : ''}`}
                disabled={isReadOnly}
                onClick={() => updateDefault(false)}
              >
                No
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderList = (config: ListConfig, sectionTitle: string, groupTitle: string) => {
    const entries = (getValue(data, config.path) as any[]) || [];
    const entryCountLabel = pluralize(entries.length, 'item');
    return (
      <div className="pricing-browser-card">
        <div className="pricing-browser-card__header">
          <div className="pricing-browser-card__title-block">
            <h5>{config.title}</h5>
            <span className="pricing-browser-card__meta">{entryCountLabel}</span>
          </div>
          {config.allowAdd !== false && (
            <button
              type="button"
              className="pricing-chip-button"
              onClick={() => {
                const nextIndex = entries.length;
                handleAddListItem(config);
                setSelectedAdditionalFeature(null);
                setSelectedListItem({
                  sectionTitle,
                  groupTitle,
                  listPathKey: getPathKey(config.path),
                  index: nextIndex,
                });
              }}
            >
              {config.addLabel || 'Add'}
            </button>
          )}
        </div>
        <div className="pricing-browser-card__body">
          <div className="pricing-table-wrapper">
            <table className="pricing-table pricing-table--browser">
              <thead>
                <tr>
                  <th scope="col" className="pricing-table__select-col" />
                  {getPreviewFields(config).map((field) => (
                    <th key={`${config.title}-${field.key}`} scope="col">
                      <span>{getListFieldLabel(config, field)}</span>
                      {field.tooltip && (
                        <span
                          className="pricing-field__info"
                          data-tooltip={field.tooltip}
                          aria-label={field.tooltip}
                          role="img"
                          onMouseEnter={updateTooltipAlign}
                        >
                          i
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const isSelected =
                    selectedListItem?.sectionTitle === sectionTitle &&
                    selectedListItem?.groupTitle === groupTitle &&
                    selectedListItem?.listPathKey === getPathKey(config.path) &&
                    selectedListItem?.index === index;

                  return (
                    <tr
                      key={`${config.title}-${index}`}
                      className={isSelected ? 'is-selected' : ''}
                      tabIndex={0}
                      onClick={() => {
                        setSelectedAdditionalFeature(null);
                        setSelectedListItem({
                          sectionTitle,
                          groupTitle,
                          listPathKey: getPathKey(config.path),
                          index,
                        });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedAdditionalFeature(null);
                          setSelectedListItem({
                            sectionTitle,
                            groupTitle,
                            listPathKey: getPathKey(config.path),
                            index,
                          });
                        }
                      }}
                    >
                      <td className="pricing-table__select-col">
                        <span className={`pricing-table__row-indicator${isSelected ? ' is-selected' : ''}`}>
                          {isSelected ? '>' : ''}
                        </span>
                      </td>
                      {getPreviewFields(config).map((field) => {
                        const cellPath = [...config.path, index, field.key];
                        const isCellDifferent = isTierPathDifferent(cellPath);
                        const isCellLocked = isActiveBronzeLockedPricingPath(cellPath);
                        return (
                          <td
                            key={field.key}
                            className={`${isCellDifferent ? 'is-tier-different' : ''}${isCellLocked ? ' is-tier-locked' : ''}`}
                          >
                            {formatListFieldValue(config, entry, field, index)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={getPreviewFields(config).length + 1} className="pricing-table__empty">
                      {config.emptyMessage || 'No items yet. Add one to get started.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pricing-browser-card__hint">
            Select a row to edit its values in the details panel.
          </div>
        </div>
      </div>
    );
  };

  const renderSelectedListEditor = () => {
    if (!selectedListEditor) {
      return (
        <div className="pricing-rail-card pricing-rail-card--empty">
          <div className="pricing-rail-card__header">
            <h3>Item Details</h3>
          </div>
          <p>Select a catalog row from the center workspace to edit its values here.</p>
        </div>
      );
    }

    const { list, entry, index } = selectedListEditor;
    const itemLabel = getListEntryLabel(list, entry, index);
    const editTitle = list.title.endsWith('s') ? list.title.slice(0, -1) : list.title;

    return (
      <div className="pricing-rail-card">
        <div className="pricing-rail-card__header">
          <div>
            <p className="pricing-rail-card__eyebrow">{selectedListEditor.group.title}</p>
            <h3>{`Edit ${editTitle}`}</h3>
            <p className="pricing-rail-card__summary">{itemLabel}</p>
          </div>
          <button
            type="button"
            className="pricing-rail-card__close"
            aria-label="Close item editor"
            onClick={() => setSelectedListItem(null)}
          >
            ×
          </button>
        </div>
        <div className="pricing-rail-card__body">
          {list.fields.map((field) => {
            const cellKey = `${list.path.join('.')}.${index}.${field.key}`;
            const cellPath = [...list.path, index, field.key];
            const fieldValue = getListFieldValue(list, entry, field, index);
            const isLocked = isActiveBronzeLockedPricingPath(cellPath);
            const isReadOnly = isListFieldReadOnly(field, entry, index) || isLocked;
            const isTierDifferent = isTierPathDifferent(cellPath);

            if (isListFieldHidden(field, entry)) {
              return null;
            }

            if (field.type === 'boolean') {
              return (
                <label
                  key={field.key}
                  className={`pricing-field${isReadOnly ? ' is-disabled' : ''}${isLocked ? ' is-tier-locked' : ''}${isTierDifferent ? ' is-tier-different' : ''}`}
                >
                  <div className={getListFieldLabelClassName(field)}>
                    <input
                      type="checkbox"
                      checked={Boolean(fieldValue)}
                      disabled={isReadOnly}
                      onChange={(e) => handleListChange(list, index, field, e.target.checked)}
                    />
                    {renderListFieldLabelText(list, field, cellKey)}
                    {isRenamableAddCostField(field) && (
                      <button
                        type="button"
                        className="pricing-field__rename-btn"
                        aria-label={`Rename ${field.label} for ${list.title}`}
                        title={`Rename ${field.label}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleStartRenameListField(list, field, cellKey);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path
                            d="M11.7 2.3a1 1 0 011.4 0l.6.6a1 1 0 010 1.4l-7.9 7.9-2.6.6.6-2.6 7.9-7.9zM9.9 4.1l2 2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                    {field.tooltip && (
                      <span
                        className="pricing-field__info"
                        data-tooltip={field.tooltip}
                        aria-label={field.tooltip}
                        role="img"
                        onMouseEnter={updateTooltipAlign}
                      >
                        i
                      </span>
                    )}
                    {renderTierResetButton(cellPath, isReadOnly)}
                  </div>
                </label>
              );
            }

            if (field.type === 'select') {
              const options = getListFieldOptions(list, field, entry, index);
              return (
                <label
                  key={field.key}
                  className={`pricing-field${isReadOnly ? ' is-disabled' : ''}${isLocked ? ' is-tier-locked' : ''}${isTierDifferent ? ' is-tier-different' : ''}`}
                >
                  <div className={getListFieldLabelClassName(field)}>
                    {renderListFieldLabelText(list, field, cellKey)}
                    {field.tooltip && (
                      <span
                        className="pricing-field__info"
                        data-tooltip={field.tooltip}
                        aria-label={field.tooltip}
                        role="img"
                        onMouseEnter={updateTooltipAlign}
                      >
                        i
                      </span>
                    )}
                    {renderTierResetButton(cellPath, isReadOnly)}
                  </div>
                  <div className="pricing-choice-toggle" role="group" aria-label={getListFieldLabel(list, field)}>
                    {options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`pricing-choice-toggle__option${fieldValue === option.value ? ' is-active' : ''}`}
                        disabled={isReadOnly}
                        onClick={() => handleListChange(list, index, field, option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </label>
              );
            }

            return (
              <label
                key={field.key}
                className={`pricing-field${isReadOnly ? ' is-disabled' : ''}${isLocked ? ' is-tier-locked' : ''}${isTierDifferent ? ' is-tier-different' : ''}`}
              >
                <div className={getListFieldLabelClassName(field)}>
                  {renderListFieldLabelText(list, field, cellKey)}
                  {isRenamableAddCostField(field) && (
                    <button
                      type="button"
                      className="pricing-field__rename-btn"
                      aria-label={`Rename ${field.label} for ${list.title}`}
                      title={`Rename ${field.label}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleStartRenameListField(list, field, cellKey);
                      }}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M11.7 2.3a1 1 0 011.4 0l.6.6a1 1 0 010 1.4l-7.9 7.9-2.6.6.6-2.6 7.9-7.9zM9.9 4.1l2 2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                  {field.tooltip && (
                    <span
                      className="pricing-field__info"
                      data-tooltip={field.tooltip}
                      aria-label={field.tooltip}
                      role="img"
                      onMouseEnter={updateTooltipAlign}
                    >
                      i
                    </span>
                  )}
                  {renderTierResetButton(cellPath, isReadOnly)}
                </div>
                <div className={`pricing-field__input-wrap${field.prefix ? ' has-prefix' : ''}`}>
                  {field.prefix && <span className="pricing-field__prefix">{field.prefix}</span>}
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    className={`pricing-field__input${field.prefix ? ' pricing-field__input--bare' : ''}`}
                    value={
                      field.type === 'number'
                        ? field.allowBlank && (fieldValue === undefined || fieldValue === null)
                          ? ''
                          : fieldValue ?? 0
                        : fieldValue ?? ''
                    }
                    placeholder={field.placeholder}
                    readOnly={isReadOnly}
                    onChange={(e) => handleListChange(list, index, field, e.target.value)}
                  />
                </div>
              </label>
            );
          })}
        </div>
        {canRemoveListItem(list, entry, index) && (
          <div className="pricing-rail-card__footer">
            <button
              type="button"
              className="pricing-chip-button danger"
              onClick={() => {
                handleRemoveListItem(list, index);
                setSelectedListItem(null);
              }}
            >
              Delete Item
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderWorkspaceSupportRail = (className: string) => (
    <aside className={className}>
      {selectedAdditionalFeatureEditor
        ? renderSelectedAdditionalFeatureEditor()
        : renderSelectedListEditor()}
      {selectedModelId && pricingModelRevisions.length > 0 && (
        <div className="pricing-rail-card pricing-revision-history">
          <div className="pricing-rail-card__header">
            <h3>Revision History</h3>
          </div>
          <div className="pricing-revision-history__list">
            {pricingModelRevisions.map((revision, index) => {
              const isCurrent = index === 0;
              const isViewing = viewingHistoricalRevision?.id === revision.id;
              return (
                <button
                  key={revision.id}
                  type="button"
                  className={`pricing-revision-history__item${isCurrent ? ' is-current' : ''}${isViewing ? ' is-viewing' : ''}`}
                  onClick={() =>
                    isCurrent
                      ? void handleReturnToCurrentRevision()
                      : void handleViewHistoricalRevision(revision)
                  }
                  disabled={isInitializing}
                >
                  <span>Revision {revision.revisionNumber}</span>
                  <small>
                    {isCurrent
                      ? 'Current'
                      : revision.publishedAt
                        ? new Date(revision.publishedAt).toLocaleDateString()
                        : 'Historical'}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="pricing-rail-card pricing-rail-card--actions">
        <div className="pricing-rail-card__header">
          <h3>Model Actions</h3>
        </div>
        <div className="pricing-rail-actions">
          <button
            className={`pricing-chip-button ${!hasChanges || isInitializing ? 'disabled' : ''}`}
            type="button"
            disabled={!selectedModelId || !hasChanges || isInitializing || Boolean(viewingHistoricalRevision)}
            onClick={() => selectedModelId && void handleLoadModel(selectedModelId)}
          >
            Reset Changes
          </button>
          <button
            className={`pricing-chip-button primary ${!hasChanges || isInitializing ? 'disabled' : ''}`}
            onClick={handleSaveModel}
            disabled={!hasChanges || savingModel || isInitializing || Boolean(viewingHistoricalRevision)}
          >
            {savingModel
              ? 'Publishing...'
              : viewingHistoricalRevision
                ? 'Historical Revision — Read-only'
                : currentPricingRevision
                  ? `Publish Revision ${currentPricingRevision.revisionNumber + 1}`
                  : 'Publish Revision 1'}
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div
      ref={pricingPageRef}
      className="pricing-page-shell"
      onPointerOver={(event) => showFloatingPricingTooltip(event.target)}
      onPointerOut={handlePricingTooltipPointerOut}
      onFocusCapture={(event) => showFloatingPricingTooltip(event.target)}
      onBlurCapture={handlePricingTooltipBlur}
    >
      <div className="pricing-page">
        <aside className="pricing-page__sidebar">
          <div className="pricing-page__sidebar-top">
            <div className="pricing-page__nav-block">
              <p className="pricing-page__nav-title">Pricing Categories</p>
              <div className="pricing-page__nav">
                {sections.map((section) => {
                  const isActive = section.title === activeSection?.title;
                  return (
                    <button
                      key={section.title}
                      type="button"
                      className={`pricing-page__nav-item${isActive ? ' is-active' : ''}`}
                      onClick={() => setActiveSectionTitle(section.title)}
                    >
                      <span className="pricing-page__nav-icon">{renderSectionIcon(section.title)}</span>
                      <span>{section.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {renderWorkspaceSupportRail('pricing-page__support-rail')}
          </div>

          <div className="pricing-page__sidebar-bottom">
            <button className="pricing-close pricing-close--page" onClick={onClose} aria-label="Back to admin panel">
              Back to Admin
            </button>
          </div>
        </aside>

        <div className="pricing-page__main">
          <div className="pricing-hero pricing-hero--page">
            <div className="pricing-hero__content">
              <h2>Admin Pricing Model Editor</h2>
              <div className="pricing-hero__controls">
                <label className="pricing-input-block pricing-hero__control">
                  <span className="pricing-input-block__label">Select Pricing Model</span>
                  <div className="pricing-select">
                    <select
                      value={selectedModelId || ''}
                      onChange={(e) => void handleSelectModel(e.target.value)}
                      disabled={isInitializing}
                    >
                      <option value="">Start a new pricing model</option>
                      {pricingModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {`${model.name}${model.isDefault ? ' (Active)' : ''}${model.isHiddenFromView ? ' (Hidden)' : ''}`}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                <label className="pricing-input-block pricing-hero__control pricing-hero__control--tier">
                  <span className="pricing-input-block__label">Pricing Tier</span>
                  <div className="pricing-select">
                    <select
                      value={selectedPricingTierId}
                      onChange={(e) => void handleSelectPricingTier(e.target.value)}
                      disabled={isInitializing}
                    >
                      {PRICING_TIER_OPTIONS.map((tier) => (
                        <option key={tier.id} value={tier.id}>
                          {tier.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </label>
                <label className="pricing-input-block pricing-hero__control">
                  <div className="pricing-input-block__label-row">
                    <span className="pricing-input-block__label">Model Name</span>
                    <div
                      className="pricing-tooltip"
                      data-tooltip="Hide this pricing model from the dropdown selection in the proposal builder"
                    >
                      <label className="pricing-checkbox inline pricing-model-visibility-toggle">
                        <input
                          type="checkbox"
                          checked={hideModelFromView}
                          disabled={isInitializing}
                          onChange={(e) => {
                            setHideModelFromView(e.target.checked);
                            setHasChanges(true);
                          }}
                        />
                        <span>Hide this model from view</span>
                      </label>
                    </div>
                  </div>
                  <input
                    type="text"
                    className="pricing-input"
                    value={modelName}
                    placeholder="'Black Friday', 'Summer Promo', etc."
                    disabled={isInitializing}
                    onChange={(e) => {
                      setModelName(e.target.value);
                      setHasChanges(true);
                    }}
                  />
                </label>
                <div className="pricing-hero__actions">
                  <button
                    className="pricing-chip-button ghost"
                    type="button"
                    onClick={handleCreateNewModel}
                    disabled={isInitializing}
                  >
                    Create New Model
                  </button>
                  {showSetActiveButton && (
                    <button
                      className="pricing-chip-button"
                      type="button"
                      disabled={!selectedModelId || activatedFlash || isInitializing}
                      onClick={handleActivateSelected}
                    >
                      {activatedFlash ? 'Activated!' : 'Set Active'}
                    </button>
                  )}
                  <div
                    className="pricing-tooltip"
                    data-tooltip={selectedModelIsDefault ? 'Cannot delete active model' : undefined}
                  >
                    <button
                      className={`pricing-chip-button danger ${selectedModelIsDefault || isInitializing ? 'disabled' : ''}`}
                      type="button"
                      disabled={!selectedModelId || selectedModelIsDefault || isInitializing}
                      onClick={() => {
                        if (!selectedModelId || selectedModelIsDefault) return;
                        setConfirmDeleteModel({
                          id: selectedModelId,
                          name: selectedModel?.name || displayModelName,
                        });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <div className="pricing-card pricing-model-summary-card">
            <div className="pricing-model-summary-card__content">
              <span className="pricing-label muted">Current Model:</span>
              <span className="pricing-model-panel__name">{displayModelName}</span>
              {currentPricingRevision && (
                <span className="pricing-pill">Revision {currentPricingRevision.revisionNumber}</span>
              )}
              {viewingHistoricalRevision && (
                <span className="pricing-pill warning">
                  Viewing Revision {viewingHistoricalRevision.revisionNumber} — Read-only
                </span>
              )}
              {selectedModelIsDefault && <span className="pricing-pill success">Active</span>}
              {selectedModelIsHiddenFromView && <span className="pricing-pill">Hidden</span>}
            </div>
          </div>

          {saveError && <div className="pricing-model-error">{saveError}</div>}

          <div className="pricing-workspace">
            <div
              className={`pricing-workspace__center${viewingHistoricalRevision ? ' is-read-only-revision' : ''}`}
              aria-readonly={viewingHistoricalRevision ? 'true' : undefined}
            >
              {isInitializing ? (
                <div className="pricing-empty">Loading pricing model data...</div>
              ) : !activeSection ? (
                <div className="pricing-empty">No pricing sections are available.</div>
              ) : (
                <>
                  <section className="pricing-section pricing-section--page">
                    <div className="pricing-section__header pricing-section__header--static">
                      <div className="pricing-section__header-left">
                        {renderSectionIcon(activeSection.title)}
                        <span className="pricing-section__title">{activeSection.title}</span>
                      </div>
                    </div>
                    <div className="pricing-section__body pricing-section__body--open">
                      <div className="pricing-section__body-content">
                        {activeSection.groups.map((group) => {
                          const groupSummary = getGroupSummary(group);

                          return (
                            <div key={group.title} className="pricing-group">
                              <div className="pricing-group__header">
                                <div className="pricing-group__heading">
                                  <p className="pricing-group__eyebrow">Pricing Subcategory</p>
                                  <h4>{group.title}</h4>
                                  {groupSummary && <p className="pricing-group__summary">{groupSummary}</p>}
                                </div>
                              </div>

                              <div className="pricing-group__content">
                                {group.render && <div className="pricing-group__custom">{group.render()}</div>}
                                {group.scalars && (
                                  <div className="pricing-group__surface">
                                    <div className="pricing-fields-grid">
                                      {group.scalars.map((field) => (
                                        <React.Fragment key={`${activeSection.title}-${group.title}-${field.label}`}>
                                          {renderScalar(field)}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {group.scalarTable && (
                                  <div className="pricing-group__surface">
                                    {renderScalarTable(
                                      group.scalarTable,
                                      activeSection.title,
                                      group.title
                                    )}
                                  </div>
                                )}
                                {group.lists && (
                                  <div className="pricing-group__surface">
                                    <div className="pricing-group__surface-header">
                                      <h5>Catalog Editors</h5>
                                    </div>
                                    <div className="pricing-lists">
                                      {group.lists.map((list) => (
                                        <React.Fragment key={`${group.title}-${list.title}`}>
                                          {renderList(list, activeSection.title, group.title)}
                                        </React.Fragment>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>

            <aside className="pricing-workspace__rail pricing-workspace__rail--desktop">
              {selectedAdditionalFeatureEditor
                ? renderSelectedAdditionalFeatureEditor()
                : renderSelectedListEditor()}
              {selectedModelId && pricingModelRevisions.length > 0 && (
                <div className="pricing-rail-card pricing-revision-history">
                  <div className="pricing-rail-card__header">
                    <h3>Revision History</h3>
                  </div>
                  <div className="pricing-revision-history__list">
                    {pricingModelRevisions.map((revision, index) => {
                      const isCurrent = index === 0;
                      const isViewing = viewingHistoricalRevision?.id === revision.id;
                      return (
                        <button
                          key={revision.id}
                          type="button"
                          className={`pricing-revision-history__item${isCurrent ? ' is-current' : ''}${isViewing ? ' is-viewing' : ''}`}
                          onClick={() =>
                            isCurrent
                              ? void handleReturnToCurrentRevision()
                              : void handleViewHistoricalRevision(revision)
                          }
                          disabled={isInitializing}
                        >
                          <span>Revision {revision.revisionNumber}</span>
                          <small>{isCurrent ? 'Current' : revision.publishedAt ? new Date(revision.publishedAt).toLocaleDateString() : 'Historical'}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="pricing-rail-card pricing-rail-card--actions">
                <div className="pricing-rail-card__header">
                  <h3>Model Actions</h3>
                </div>
                <div className="pricing-rail-actions">
                  <button
                    className={`pricing-chip-button ${!hasChanges || isInitializing ? 'disabled' : ''}`}
                    type="button"
                    disabled={!selectedModelId || !hasChanges || isInitializing || Boolean(viewingHistoricalRevision)}
                    onClick={() => selectedModelId && void handleLoadModel(selectedModelId)}
                  >
                    Reset Changes
                  </button>
                  <button
                    className={`pricing-chip-button primary ${!hasChanges || isInitializing ? 'disabled' : ''}`}
                    onClick={handleSaveModel}
                    disabled={!hasChanges || savingModel || isInitializing || Boolean(viewingHistoricalRevision)}
                  >
                    {savingModel
                      ? 'Publishing...'
                      : viewingHistoricalRevision
                        ? 'Historical Revision — Read-only'
                        : currentPricingRevision
                          ? `Publish Revision ${currentPricingRevision.revisionNumber + 1}`
                          : 'Publish Revision 1'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
      {confirmDeleteModel && (
        <div className="pricing-confirm-backdrop" data-scroll-lock="true">
          <div className="pricing-confirm-card">
            <div className="pricing-confirm-message">
              {`Are you sure you want to remove the '${confirmDeleteModel.name}' price model?`}
            </div>
            <div className="pricing-confirm-actions">
              <button
                className="pricing-chip-button danger"
                type="button"
                onClick={() => {
                  void handleDeleteModel(confirmDeleteModel.id, false);
                  setConfirmDeleteModel(null);
                  setHasChanges(false);
                }}
              >
                I'm sure
              </button>
              <button
                className="pricing-chip-button ghost"
                type="button"
                onClick={() => {
                  setConfirmDeleteModel(null);
                }}
              >
                No
              </button>
            </div>
          </div>
        </div>
      )}
      {floatingTooltip && createPortal(
        <div
          ref={floatingTooltipRef}
          className="pricing-floating-tooltip"
          role="tooltip"
          style={{
            top: floatingTooltipPosition?.top ?? 0,
            left: floatingTooltipPosition?.left ?? 0,
            visibility: floatingTooltipPosition ? 'visible' : 'hidden',
          }}
        >
          {floatingTooltip.text}
        </div>,
        document.body
      )}
    </div>
  );
};

export default PricingDataModal;
