export type ProposalNoteCategoryKey =
  | 'poolSpecs'
  | 'excavation'
  | 'plumbing'
  | 'electrical'
  | 'tileCopingDecking'
  | 'drainage'
  | 'equipment'
  | 'waterFeatures'
  | 'interiorFinish'
  | 'customFeatures';

export type ProposalNoteOverrides = Record<string, string>;

export type ProposalNoteSubcategory = {
  id: string;
  title: string;
  defaultNote: string;
  conditionalNote?: string;
};

export type ProposalNoteCategory = {
  key: ProposalNoteCategoryKey;
  title: string;
  shortTitle: string;
  subcategories: ProposalNoteSubcategory[];
};

const customOptionsNote: ProposalNoteSubcategory = {
  id: 'customOptions',
  title: 'Custom Options',
  defaultNote: '',
};

export const PROPOSAL_NOTE_CATEGORIES: ProposalNoteCategory[] = [
  {
    key: 'poolSpecs',
    title: 'Pool Specifications',
    shortTitle: 'Pool Specs',
    subcategories: [
      { id: 'customerInformation', title: 'Customer Information', defaultNote: '' },
      { id: 'poolDimensions', title: 'Pool Dimensions', defaultNote: '' },
      { id: 'spa', title: 'Spa', defaultNote: '' },
      { id: 'travel', title: 'Travel', defaultNote: '' },
      { id: 'additionalOptions', title: 'Additional Options', defaultNote: '' },
    ],
  },
  {
    key: 'excavation',
    title: 'Excavation',
    shortTitle: 'Excavation',
    subcategories: [
      { id: 'raisedBondBeam', title: 'Raised Bond Beam (RBB)', defaultNote: 'Add Raised Bond Beams to the project.' },
      { id: 'columns', title: 'Columns', defaultNote: 'Add columns to the project.' },
      { id: 'retainingWall', title: 'Retaining Wall', defaultNote: 'Add Retaining Walls to the project.' },
      {
        id: 'exposedPoolWall',
        title: 'Exposed Pool Wall (Out of Ground Forming)',
        defaultNote: 'Add exposed pool wall forming to the project.',
      },
      { id: 'additionalOptions', title: 'Additional Options', defaultNote: 'Gravel Install and Dirt Haul included by default.' },
      customOptionsNote,
    ],
  },
  {
    key: 'plumbing',
    title: 'Plumbing',
    shortTitle: 'Plumbing',
    subcategories: [
      { id: 'corePlumbing', title: 'Core Plumbing', defaultNote: 'Overruns will calculate automatically.' },
      customOptionsNote,
    ],
  },
  {
    key: 'electrical',
    title: 'Gas / Electrical',
    shortTitle: 'Gas/Electrical',
    subcategories: [
      { id: 'gasRun', title: 'Gas Run', defaultNote: 'Base Gas includes the first 25ft of billed gas run.' },
      { id: 'electricalRuns', title: 'Electrical Runs', defaultNote: 'Base Electrical includes the first 65ft' },
      customOptionsNote,
    ],
  },
  {
    key: 'tileCopingDecking',
    title: 'Tile / Coping / Decking',
    shortTitle: 'Tile/Coping',
    subcategories: [
      { id: 'tile', title: 'Tile', defaultNote: '', conditionalNote: 'Shown for shotcrete pools only.' },
      { id: 'coping', title: 'Coping', defaultNote: '' },
      { id: 'decking', title: 'Decking', defaultNote: '' },
      {
        id: 'stoneRockwork',
        title: 'Stone / Rockwork',
        defaultNote: '',
        conditionalNote: 'Currently hidden in the proposal builder.',
      },
      { id: 'options', title: 'Options', defaultNote: '' },
      customOptionsNote,
    ],
  },
  {
    key: 'drainage',
    title: 'Drainage',
    shortTitle: 'Drainage',
    subcategories: [
      { id: 'coreDrainage', title: 'Core Drainage', defaultNote: '' },
      customOptionsNote,
    ],
  },
  {
    key: 'equipment',
    title: 'Equipment',
    shortTitle: 'Equipment',
    subcategories: [
      { id: 'packageOptions', title: 'Package Options', defaultNote: '' },
      { id: 'pump', title: 'Pump', defaultNote: 'Add a primary pump and any additional pumps to the project.' },
      { id: 'blowers', title: 'Blowers', defaultNote: 'Add a blower to the project.' },
      { id: 'filter', title: 'Filter', defaultNote: 'Add a filter to the project.' },
      { id: 'cleaner', title: 'Cleaner', defaultNote: 'Add a cleaner to the project.' },
      { id: 'heater', title: 'Heater', defaultNote: 'Add a heater to the project.' },
      { id: 'poolLights', title: 'Pool Lights', defaultNote: 'Add pool lights to the project.' },
      { id: 'spaLights', title: 'Spa Lights', defaultNote: 'Add spa lights to the project.', conditionalNote: 'Shown when the proposal includes a spa.' },
      { id: 'automation', title: 'Automation', defaultNote: 'Add automation to the project.' },
      { id: 'sanitationSystem', title: 'Sanitation System', defaultNote: 'Add a sanitation system to the project.' },
      { id: 'additionalSanitationOptions', title: 'Additional Sanitation Options', defaultNote: 'Choose an additional sanitation option.' },
      { id: 'autoFill', title: 'Auto-fill', defaultNote: 'Add an auto-fill system to the project.' },
      customOptionsNote,
    ],
  },
  {
    key: 'waterFeatures',
    title: 'Water Features',
    shortTitle: 'Water Features',
    subcategories: [
      { id: 'sheerDescents', title: 'Sheer Descents', defaultNote: 'Add Sheer Descents to the project.' },
      { id: 'wokPots', title: 'Wok Pots', defaultNote: 'Add Wok Pots to the project.' },
      { id: 'jets', title: 'Jets', defaultNote: 'Add Jets to the project.' },
      { id: 'bubblers', title: 'Bubblers', defaultNote: 'Add Bubblers to the project.' },
      customOptionsNote,
    ],
  },
  {
    key: 'interiorFinish',
    title: 'Interior Finish',
    shortTitle: 'Interior',
    subcategories: [
      { id: 'finishType', title: 'Finish Type', defaultNote: 'Select interior finish and color / style.' },
      { id: 'additionalOptions', title: 'Additional Options', defaultNote: '' },
      customOptionsNote,
    ],
  },
  {
    key: 'customFeatures',
    title: 'Custom Features',
    shortTitle: 'Custom',
    subcategories: [
      {
        id: 'groupedFeatures',
        title: 'Grouped Features',
        defaultNote: '',
        conditionalNote: 'Available options depend on the active pricing model.',
      },
      { id: 'manualCustomFeatures', title: 'Manual Custom Features', defaultNote: '' },
    ],
  },
];

const hasOwn = (target: Record<string, unknown> | undefined | null, key: string) =>
  Boolean(target && Object.prototype.hasOwnProperty.call(target, key));

export function buildProposalNoteKey(categoryKey: ProposalNoteCategoryKey, subcategoryId: string) {
  return `${categoryKey}.${subcategoryId}`;
}

export function sanitizeProposalNoteText(value: unknown) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

export function getProposalNoteDefinition(categoryKey: ProposalNoteCategoryKey, subcategoryId: string) {
  return PROPOSAL_NOTE_CATEGORIES
    .find((category) => category.key === categoryKey)
    ?.subcategories.find((subcategory) => subcategory.id === subcategoryId);
}

export function getProposalNoteDefaultText(categoryKey: ProposalNoteCategoryKey, subcategoryId: string) {
  return sanitizeProposalNoteText(getProposalNoteDefinition(categoryKey, subcategoryId)?.defaultNote);
}

export function getAllProposalNoteKeys() {
  return PROPOSAL_NOTE_CATEGORIES.flatMap((category) =>
    category.subcategories.map((subcategory) => buildProposalNoteKey(category.key, subcategory.id))
  );
}

export function getProposalNoteText(
  overrides: ProposalNoteOverrides | undefined | null,
  categoryKey: ProposalNoteCategoryKey,
  subcategoryId: string
) {
  const key = buildProposalNoteKey(categoryKey, subcategoryId);
  if (hasOwn(overrides, key)) {
    return sanitizeProposalNoteText(overrides?.[key]);
  }
  return getProposalNoteDefaultText(categoryKey, subcategoryId);
}

export function buildProposalNoteValues(overrides: ProposalNoteOverrides | undefined | null = {}) {
  return PROPOSAL_NOTE_CATEGORIES.reduce<ProposalNoteOverrides>((values, category) => {
    category.subcategories.forEach((subcategory) => {
      const key = buildProposalNoteKey(category.key, subcategory.id);
      values[key] = hasOwn(overrides, key)
        ? sanitizeProposalNoteText(overrides?.[key])
        : sanitizeProposalNoteText(subcategory.defaultNote);
    });
    return values;
  }, {});
}

export function normalizeProposalNoteOverrides(input: ProposalNoteOverrides | undefined | null) {
  if (!input || typeof input !== 'object') return {};

  return PROPOSAL_NOTE_CATEGORIES.reduce<ProposalNoteOverrides>((overrides, category) => {
    category.subcategories.forEach((subcategory) => {
      const key = buildProposalNoteKey(category.key, subcategory.id);
      if (!hasOwn(input, key)) return;

      const value = sanitizeProposalNoteText(input[key]);
      const defaultValue = sanitizeProposalNoteText(subcategory.defaultNote);
      if (value !== defaultValue) {
        overrides[key] = value;
      }
    });
    return overrides;
  }, {});
}

export function serializeProposalNoteOverrides(input: ProposalNoteOverrides | undefined | null) {
  const overrides = normalizeProposalNoteOverrides(input);
  return getAllProposalNoteKeys()
    .map((key) => `${key}:${JSON.stringify(overrides[key] ?? null)}`)
    .join('|');
}
