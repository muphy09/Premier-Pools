import type { TileCopingDecking } from '../types/proposal-new';

export interface TileCopingRateOption {
  id: string;
  name: string;
  materialRate: number;
  laborRate: number;
}

type CatalogKind = 'tile' | 'trimTile' | 'coping' | 'decking' | 'specialty';

const DEFAULT_LABELS: Record<CatalogKind, Record<string, string>> = {
  tile: {
    level1: 'Level 1',
    level2: 'Level 2',
    level3: 'Level 3',
  },
  trimTile: {
    'default-trim-tile': 'Default Trim Tile',
  },
  coping: {
    cantilever: 'Cantilever',
    flagstone: 'Flagstone',
    paver: 'Paver',
    'travertine-level1': 'Travertine - Level 1',
    'travertine-level2': 'Travertine - Level 2',
    concrete: 'Concrete',
  },
  decking: {
    paver: 'Paver',
    'travertine-level1': 'Travertine - Level 1',
    'travertine-level2': 'Travertine - Level 2',
    'travertine-level3': 'Travertine - Level 3',
    concrete: 'Concrete',
  },
  specialty: {
    bullnose: 'Bullnose',
    spillway: 'Spillway',
  },
};

const TILE_DEFAULT_IDS = ['level1', 'level2', 'level3'] as const;
const COPING_DEFAULT_IDS = [
  'cantilever',
  'flagstone',
  'paver',
  'travertine-level1',
  'travertine-level2',
  'concrete',
] as const;
const DECKING_DEFAULT_IDS = [
  'paver',
  'travertine-level1',
  'travertine-level2',
  'travertine-level3',
  'concrete',
] as const;
export const DEFAULT_TRIM_TILE_OPTION_ID = 'default-trim-tile';
const LEGACY_TILE_STEP_TRIM_ID = 'step-trim';
const SPECIALTY_DEFAULT_IDS = ['bullnose', 'spillway'] as const;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toWords = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const getDefaultLabel = (kind: CatalogKind, id: string): string =>
  DEFAULT_LABELS[kind][id] || toWords(id);

export const normalizeTileOptionId = (value?: string | null): string => {
  const normalized = slugify(value || '');
  if (!normalized) return '';
  if (normalized === 'level-1') return 'level1';
  if (normalized === 'level-2') return 'level2';
  if (normalized === 'level-3') return 'level3';
  return normalized;
};

export const normalizeTrimTileOptionId = (value?: string | null): string => {
  const normalized = slugify(value || '');
  if (!normalized) return '';
  if (
    normalized === LEGACY_TILE_STEP_TRIM_ID ||
    normalized === 'steptrim' ||
    normalized === 'default-step-trim'
  ) {
    return DEFAULT_TRIM_TILE_OPTION_ID;
  }
  return normalized;
};

export const normalizeCopingOptionId = (value?: string | null): string => {
  const normalized = slugify(value || '');
  if (!normalized) return '';
  if (normalized === 'pavers') return 'paver';
  if (normalized === 'travertinelevel1') return 'travertine-level1';
  if (normalized === 'travertinelevel2') return 'travertine-level2';
  return normalized;
};

export const normalizeDeckingOptionId = (value?: string | null): string => {
  const normalized = slugify(value || '');
  if (!normalized) return '';
  if (normalized === 'pavers') return 'paver';
  if (normalized === 'travertinelevel1') return 'travertine-level1';
  if (normalized === 'travertinelevel2') return 'travertine-level2';
  if (normalized === 'travertinelevel3') return 'travertine-level3';
  return normalized;
};

const normalizeSpecialtyOptionId = (value?: string | null): string => {
  const normalized = slugify(value || '');
  if (!normalized) return '';
  if (normalized === 'steptrim') return LEGACY_TILE_STEP_TRIM_ID;
  return normalized;
};

const normalizeOptionId = (kind: CatalogKind, value?: string | null): string => {
  if (kind === 'tile') return normalizeTileOptionId(value);
  if (kind === 'trimTile') return normalizeTrimTileOptionId(value);
  if (kind === 'coping') return normalizeCopingOptionId(value);
  if (kind === 'decking') return normalizeDeckingOptionId(value);
  return normalizeSpecialtyOptionId(value);
};

const normalizeRateOptions = (
  rawOptions: unknown[],
  kind: CatalogKind,
  fallbackOptions: TileCopingRateOption[]
): TileCopingRateOption[] => {
  const fallbackById = new Map(fallbackOptions.map((option) => [option.id, option] as const));
  const seen = new Set<string>();

  return rawOptions.reduce<TileCopingRateOption[]>((options, rawOption) => {
    if (!rawOption || typeof rawOption !== 'object') {
      return options;
    }

    const option = rawOption as Partial<TileCopingRateOption>;
    const id = normalizeOptionId(kind, option.id || option.name || '');
    if (!id || seen.has(id)) {
      return options;
    }

    const fallback = fallbackById.get(id);
    seen.add(id);
    options.push({
      id,
      name: String(option.name || fallback?.name || getDefaultLabel(kind, id)).trim(),
      materialRate: toNumber(option.materialRate ?? fallback?.materialRate),
      laborRate: toNumber(option.laborRate ?? fallback?.laborRate),
    });
    return options;
  }, []);
};

const normalizeFixedRateOptions = (
  rawOptions: unknown[],
  fixedOptions: TileCopingRateOption[]
): TileCopingRateOption[] => {
  const rawById = new Map<string, Partial<TileCopingRateOption>>();

  rawOptions.forEach((rawOption) => {
    if (!rawOption || typeof rawOption !== 'object') {
      return;
    }

    const option = rawOption as Partial<TileCopingRateOption>;
    const id = normalizeSpecialtyOptionId(option.id || option.name || '');
    if (!id || rawById.has(id)) {
      return;
    }

    rawById.set(id, option);
  });

  return fixedOptions.map((fallback) => {
    const option = rawById.get(fallback.id);
    return {
      id: fallback.id,
      name: fallback.name,
      materialRate: toNumber(option?.materialRate ?? fallback.materialRate),
      laborRate: toNumber(option?.laborRate ?? fallback.laborRate),
    };
  });
};

const buildLegacyTileOptions = (tileCoping: any): TileCopingRateOption[] => {
  const tile = tileCoping?.tile;
  const baseMaterialRate = toNumber(tile?.material?.level1);
  const level1LaborRate = toNumber(tile?.labor?.level1);
  return [
    {
      id: 'level1',
      name: getDefaultLabel('tile', 'level1'),
      materialRate: baseMaterialRate,
      laborRate: level1LaborRate,
    },
    {
      id: 'level2',
      name: getDefaultLabel('tile', 'level2'),
      materialRate: baseMaterialRate + toNumber(tile?.material?.level2Upgrade),
      laborRate: toNumber(tile?.labor?.level2 ?? level1LaborRate),
    },
    {
      id: 'level3',
      name: getDefaultLabel('tile', 'level3'),
      materialRate: baseMaterialRate + toNumber(tile?.material?.level3Upgrade),
      laborRate: toNumber(tile?.labor?.level3 ?? level1LaborRate),
    },
  ];
};

const buildLegacyTrimTileOptions = (tileCoping: any): TileCopingRateOption[] => [
  {
    id: DEFAULT_TRIM_TILE_OPTION_ID,
    name: getDefaultLabel('trimTile', DEFAULT_TRIM_TILE_OPTION_ID),
    materialRate: toNumber(tileCoping?.tile?.material?.stepTrim),
    laborRate: toNumber(tileCoping?.tile?.labor?.stepTrim),
  },
];

const buildLegacyCopingOptions = (tileCoping: any): TileCopingRateOption[] => {
  const coping = tileCoping?.coping;
  const copingMaterial = tileCoping?.decking?.material?.coping;
  return [
    {
      id: 'cantilever',
      name: getDefaultLabel('coping', 'cantilever'),
      materialRate: 0,
      laborRate: toNumber(coping?.cantilever),
    },
    {
      id: 'flagstone',
      name: getDefaultLabel('coping', 'flagstone'),
      materialRate: toNumber(tileCoping?.decking?.material?.flagstone),
      laborRate: toNumber(coping?.flagstone),
    },
    {
      id: 'paver',
      name: getDefaultLabel('coping', 'paver'),
      materialRate: toNumber(copingMaterial?.paver),
      laborRate: toNumber(coping?.pavers),
    },
    {
      id: 'travertine-level1',
      name: getDefaultLabel('coping', 'travertine-level1'),
      materialRate: toNumber(copingMaterial?.travertineLevel1 ?? copingMaterial?.travertinelevel1),
      laborRate: toNumber(coping?.travertineLevel1),
    },
    {
      id: 'travertine-level2',
      name: getDefaultLabel('coping', 'travertine-level2'),
      materialRate: toNumber(copingMaterial?.travertineLevel2 ?? copingMaterial?.travertinelevel2),
      laborRate: toNumber(coping?.travertineLevel2),
    },
    {
      id: 'concrete',
      name: getDefaultLabel('coping', 'concrete'),
      materialRate: toNumber(copingMaterial?.concrete),
      laborRate: toNumber(coping?.concrete),
    },
  ];
};

const buildLegacyDeckingOptions = (tileCoping: any): TileCopingRateOption[] => {
  const decking = tileCoping?.decking;
  return [
    {
      id: 'paver',
      name: getDefaultLabel('decking', 'paver'),
      materialRate: toNumber(decking?.material?.pavers),
      laborRate: toNumber(decking?.labor?.pavers),
    },
    {
      id: 'travertine-level1',
      name: getDefaultLabel('decking', 'travertine-level1'),
      materialRate: toNumber(decking?.material?.travertineLevel1),
      laborRate: toNumber(decking?.labor?.travertine),
    },
    {
      id: 'travertine-level2',
      name: getDefaultLabel('decking', 'travertine-level2'),
      materialRate: toNumber(decking?.material?.travertineLevel2),
      laborRate: toNumber(decking?.labor?.travertine),
    },
    {
      id: 'travertine-level3',
      name: getDefaultLabel('decking', 'travertine-level3'),
      materialRate: toNumber(decking?.material?.travertineLevel3),
      laborRate: toNumber(decking?.labor?.travertine),
    },
    {
      id: 'concrete',
      name: getDefaultLabel('decking', 'concrete'),
      materialRate: toNumber(decking?.material?.concrete),
      laborRate: toNumber(decking?.labor?.concrete),
    },
  ];
};

const buildLegacySpecialtyOptions = (tileCoping: any): TileCopingRateOption[] => [
  {
    id: 'bullnose',
    name: getDefaultLabel('specialty', 'bullnose'),
    materialRate: toNumber(tileCoping?.decking?.material?.bullnose),
    laborRate: toNumber(tileCoping?.coping?.bullnoseLabor ?? tileCoping?.decking?.bullnoseLabor),
  },
  {
    id: 'spillway',
    name: getDefaultLabel('specialty', 'spillway'),
    materialRate: toNumber(tileCoping?.decking?.spillwayMaterial ?? tileCoping?.decking?.material?.spillway),
    laborRate: toNumber(tileCoping?.decking?.spillwayLabor ?? tileCoping?.coping?.spillwayLabor),
  },
];

export const getTileOptions = (tileCoping: any): TileCopingRateOption[] => {
  const rawOptions = Array.isArray(tileCoping?.tile?.options) ? tileCoping.tile.options : null;
  if (rawOptions) {
    return normalizeRateOptions(rawOptions, 'tile', buildLegacyTileOptions(tileCoping));
  }
  return buildLegacyTileOptions(tileCoping);
};

export const getTrimTileOptions = (tileCoping: any): TileCopingRateOption[] => {
  const rawOptions = Array.isArray(tileCoping?.tile?.stepTrimOptions) ? tileCoping.tile.stepTrimOptions : null;
  const fallback = buildLegacyTrimTileOptions(tileCoping);
  if (!rawOptions) {
    return fallback;
  }

  const upgradedRawOptions = rawOptions.map((rawOption: unknown) => {
    if (!rawOption || typeof rawOption !== 'object') {
      return rawOption;
    }

    const option = rawOption as Partial<TileCopingRateOption>;
    const rawId = slugify(option.id || '');
    if (rawId !== LEGACY_TILE_STEP_TRIM_ID && rawId !== 'steptrim') {
      return rawOption;
    }

    const legacyName = String(option.name || '').trim();
    return {
      ...option,
      id: DEFAULT_TRIM_TILE_OPTION_ID,
      name:
        !legacyName || legacyName.toLowerCase() === 'step trim'
          ? getDefaultLabel('trimTile', DEFAULT_TRIM_TILE_OPTION_ID)
          : legacyName,
    };
  });
  const normalized = normalizeRateOptions(upgradedRawOptions, 'trimTile', fallback);
  const configuredDefault = normalized.find((option) => option.id === DEFAULT_TRIM_TILE_OPTION_ID);
  const defaultOption = configuredDefault || fallback[0];
  return [
    defaultOption,
    ...normalized.filter((option) => option.id !== DEFAULT_TRIM_TILE_OPTION_ID),
  ];
};

// Backward-compatible export for callers outside the main application bundle.
export const getTileStepTrimOptions = getTrimTileOptions;

export const getCopingOptions = (tileCoping: any): TileCopingRateOption[] => {
  const rawOptions = Array.isArray(tileCoping?.coping?.options) ? tileCoping.coping.options : null;
  if (rawOptions) {
    return normalizeRateOptions(rawOptions, 'coping', buildLegacyCopingOptions(tileCoping));
  }
  return buildLegacyCopingOptions(tileCoping);
};

export const getDeckingOptions = (tileCoping: any): TileCopingRateOption[] => {
  const rawOptions = Array.isArray(tileCoping?.decking?.options) ? tileCoping.decking.options : null;
  if (rawOptions) {
    return normalizeRateOptions(rawOptions, 'decking', buildLegacyDeckingOptions(tileCoping));
  }
  return buildLegacyDeckingOptions(tileCoping);
};

export const getBullnoseSpillwayOptions = (tileCoping: any): TileCopingRateOption[] => {
  const rawOptions = Array.isArray(tileCoping?.specialtyOptions) ? tileCoping.specialtyOptions : null;
  const fallback = buildLegacySpecialtyOptions(tileCoping);
  if (rawOptions) {
    return normalizeFixedRateOptions(rawOptions, fallback);
  }
  return fallback;
};

const getOptionById = (
  options: TileCopingRateOption[],
  normalizer: (value?: string | null) => string,
  optionId?: string | null
): TileCopingRateOption | null => {
  const normalized = normalizer(optionId);
  if (!normalized) {
    return null;
  }

  return options.find((option) => option.id === normalized) || null;
};

const getOptionLabel = (
  options: TileCopingRateOption[],
  kind: CatalogKind,
  normalizer: (value?: string | null) => string,
  optionId?: string | null
): string => {
  const normalized = normalizer(optionId);
  if (!normalized) {
    return '';
  }

  return getOptionById(options, normalizer, normalized)?.name || getDefaultLabel(kind, normalized);
};

export const getTileOptionById = (tileCoping: any, optionId?: string | null): TileCopingRateOption | null =>
  getOptionById(getTileOptions(tileCoping), normalizeTileOptionId, optionId) ||
  getOptionById(buildLegacyTileOptions(tileCoping), normalizeTileOptionId, optionId);

export const getTrimTileOptionById = (
  tileCoping: any,
  optionId?: string | null
): TileCopingRateOption | null =>
  getOptionById(getTrimTileOptions(tileCoping), normalizeTrimTileOptionId, optionId) ||
  getOptionById(buildLegacyTrimTileOptions(tileCoping), normalizeTrimTileOptionId, optionId);

export const getCopingOptionById = (tileCoping: any, optionId?: string | null): TileCopingRateOption | null =>
  getOptionById(getCopingOptions(tileCoping), normalizeCopingOptionId, optionId) ||
  getOptionById(buildLegacyCopingOptions(tileCoping), normalizeCopingOptionId, optionId);

export const getDeckingOptionById = (tileCoping: any, optionId?: string | null): TileCopingRateOption | null =>
  getOptionById(getDeckingOptions(tileCoping), normalizeDeckingOptionId, optionId) ||
  getOptionById(buildLegacyDeckingOptions(tileCoping), normalizeDeckingOptionId, optionId);

export const getBullnoseSpillwayOptionById = (
  tileCoping: any,
  optionId?: string | null
): TileCopingRateOption | null =>
  getOptionById(getBullnoseSpillwayOptions(tileCoping), normalizeSpecialtyOptionId, optionId);

export const getTileOptionLabel = (tileCoping: any, optionId?: string | null): string =>
  getOptionLabel(
    [...getTileOptions(tileCoping), ...buildLegacyTileOptions(tileCoping)],
    'tile',
    normalizeTileOptionId,
    optionId
  );

export const getTrimTileOptionLabel = (tileCoping: any, optionId?: string | null): string =>
  getOptionLabel(
    [...getTrimTileOptions(tileCoping), ...buildLegacyTrimTileOptions(tileCoping)],
    'trimTile',
    normalizeTrimTileOptionId,
    optionId
  );

export const getCopingOptionLabel = (tileCoping: any, optionId?: string | null): string =>
  getOptionLabel(
    [...getCopingOptions(tileCoping), ...buildLegacyCopingOptions(tileCoping)],
    'coping',
    normalizeCopingOptionId,
    optionId
  );

export const getDeckingOptionLabel = (tileCoping: any, optionId?: string | null): string =>
  getOptionLabel(
    [...getDeckingOptions(tileCoping), ...buildLegacyDeckingOptions(tileCoping)],
    'decking',
    normalizeDeckingOptionId,
    optionId
  );

export const getTileSelectionId = (tileCopingDecking?: Partial<TileCopingDecking> | null): string => {
  const explicitId = normalizeTileOptionId(tileCopingDecking?.tileOptionId);
  if (explicitId && explicitId !== 'none') {
    return explicitId;
  }

  const legacyTileLevel = Number(tileCopingDecking?.tileLevel || 0);
  if (legacyTileLevel === 1) return 'level1';
  if (legacyTileLevel === 2) return 'level2';
  if (legacyTileLevel === 3) return 'level3';
  return '';
};

export const hasTileSelection = (tileCopingDecking?: Partial<TileCopingDecking> | null): boolean =>
  Boolean(getTileSelectionId(tileCopingDecking));

export const getTrimTileSelectionId = (
  tileCopingDecking?: Partial<TileCopingDecking> | null
): string => {
  const explicitId = normalizeTrimTileOptionId(tileCopingDecking?.trimTileOptionId);
  if (explicitId && explicitId !== 'none') {
    return explicitId;
  }

  return tileCopingDecking?.hasTrimTileOnSteps ? DEFAULT_TRIM_TILE_OPTION_ID : '';
};

export const hasTrimTileSelection = (
  tileCopingDecking?: Partial<TileCopingDecking> | null
): boolean => Boolean(getTrimTileSelectionId(tileCopingDecking));

export const isLegacyTrimTileSelection = (
  tileCopingDecking?: Partial<TileCopingDecking> | null
): boolean =>
  Boolean(tileCopingDecking?.hasTrimTileOnSteps) &&
  !normalizeTrimTileOptionId(tileCopingDecking?.trimTileOptionId);

export const getTrimTileContractLabel = (
  tileCoping: any,
  tileCopingDecking?: Partial<TileCopingDecking> | null
): string => {
  const selectionId = getTrimTileSelectionId(tileCopingDecking);
  if (!selectionId) {
    return 'None';
  }
  if (isLegacyTrimTileSelection(tileCopingDecking)) {
    return 'Trim Tile';
  }
  return getTrimTileOptionLabel(tileCoping, selectionId) || 'Trim Tile';
};

const copyOptions = (options: TileCopingRateOption[]) =>
  options.map((option) => ({
    id: option.id,
    name: option.name,
    materialRate: option.materialRate,
    laborRate: option.laborRate,
  }));

export const ensureTileCopingDeckingCatalogs = (target: any, source?: any, defaults?: any) => {
  const targetTileCoping = target?.tileCoping ?? target;
  if (!targetTileCoping || typeof targetTileCoping !== 'object') {
    return target;
  }

  const sourceTileCoping = source?.tileCoping ?? source ?? targetTileCoping;
  const defaultTileCoping = defaults?.tileCoping ?? defaults ?? targetTileCoping;

  const hasSourceTileOptions = Array.isArray(sourceTileCoping?.tile?.options);
  const hasSourceCopingOptions = Array.isArray(sourceTileCoping?.coping?.options);
  const hasSourceDeckingOptions = Array.isArray(sourceTileCoping?.decking?.options);

  targetTileCoping.tile = targetTileCoping.tile || {};
  targetTileCoping.coping = targetTileCoping.coping || {};
  targetTileCoping.decking = targetTileCoping.decking || {};

  targetTileCoping.tile.options = hasSourceTileOptions
    ? copyOptions(normalizeRateOptions(sourceTileCoping.tile.options, 'tile', getTileOptions(defaultTileCoping)))
    : copyOptions(getTileOptions(sourceTileCoping));

  targetTileCoping.tile.stepTrimOptions = copyOptions(getTrimTileOptions(sourceTileCoping));

  targetTileCoping.coping.options = hasSourceCopingOptions
    ? copyOptions(normalizeRateOptions(sourceTileCoping.coping.options, 'coping', getCopingOptions(defaultTileCoping)))
    : copyOptions(getCopingOptions(sourceTileCoping));

  targetTileCoping.decking.options = hasSourceDeckingOptions
    ? copyOptions(normalizeRateOptions(sourceTileCoping.decking.options, 'decking', getDeckingOptions(defaultTileCoping)))
    : copyOptions(getDeckingOptions(sourceTileCoping));

  targetTileCoping.specialtyOptions = copyOptions(getBullnoseSpillwayOptions(sourceTileCoping));

  return target;
};

export const getTileDefaultOptionIds = () => [...TILE_DEFAULT_IDS];
export const getCopingDefaultOptionIds = () => [...COPING_DEFAULT_IDS];
export const getDeckingDefaultOptionIds = () => [...DECKING_DEFAULT_IDS];
export const getSpecialtyDefaultOptionIds = () => [...SPECIALTY_DEFAULT_IDS];
