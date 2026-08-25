import { getSupabaseClient } from './supabaseClient';
import { assertLiveFranchiseMutationAllowed } from './session';

export type LocationInputMode = 'state' | 'county';
export type ContractResolutionMode = 'state_and_pool_type' | 'pool_type_only';

export type FranchiseCapabilities = {
  priceImpact?: boolean;
  signedWorkflow?: boolean;
  offContractItems?: boolean;
  financingSection?: boolean;
  contractTemplateLibrary?: boolean;
  pricingRevisionReview?: boolean;
  offlineDraftRecovery?: boolean;
  splitCustomerCostWarranty?: boolean;
  [key: string]: boolean | undefined;
};

export type FranchiseConfiguration = {
  themeProfile: string;
  proposalLayout: string;
  locationInputMode: LocationInputMode;
  contractResolutionMode: ContractResolutionMode;
  capabilities: FranchiseCapabilities;
  labels?: Record<string, string>;
  selections?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  pricingPolicy?: string;
};

export type LoadedFranchiseConfiguration = {
  franchiseId: string;
  revisionId: string | null;
  revisionNumber: number;
  schemaVersion: number;
  configuration: FranchiseConfiguration;
  publishedAt?: string | null;
  publishedBy?: string | null;
  source: 'remote' | 'cache' | 'compatibility-default';
};

export const FRANCHISE_CONFIGURATION_SCHEMA_VERSION = 1;
export const PRICE_IMPACT_CAPABILITY: keyof FranchiseCapabilities = 'priceImpact';
export const DEFAULT_PRICE_IMPACT_ENABLED = true;

export const COMPATIBILITY_FRANCHISE_CONFIGURATION: FranchiseConfiguration = {
  themeProfile: 'default',
  proposalLayout: 'standard',
  locationInputMode: 'state',
  contractResolutionMode: 'state_and_pool_type',
  capabilities: {},
};

const CACHE_PREFIX = 'submerge.franchiseConfiguration.v1';
const memoryCache = new Map<string, LoadedFranchiseConfiguration>();

function cacheKey(franchiseId: string) {
  return `${CACHE_PREFIX}.${franchiseId}`;
}

function isMissingFoundationError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('franchise_configuration_assignments') ||
    message.includes('franchise_configuration_revisions') ||
    message.includes('could not find the table')
  );
}

function normalizeConfiguration(value?: Partial<FranchiseConfiguration> | null): FranchiseConfiguration {
  const capabilities =
    value?.capabilities && typeof value.capabilities === 'object'
      ? Object.fromEntries(
          Object.entries(value.capabilities).filter(([, enabled]) => typeof enabled === 'boolean')
        )
      : {};

  return {
    ...COMPATIBILITY_FRANCHISE_CONFIGURATION,
    ...value,
    themeProfile: String(value?.themeProfile || COMPATIBILITY_FRANCHISE_CONFIGURATION.themeProfile),
    proposalLayout: String(value?.proposalLayout || COMPATIBILITY_FRANCHISE_CONFIGURATION.proposalLayout),
    locationInputMode: value?.locationInputMode === 'county' ? 'county' : 'state',
    contractResolutionMode:
      value?.contractResolutionMode === 'pool_type_only' ? 'pool_type_only' : 'state_and_pool_type',
    capabilities,
  };
}

function compatibilityDefault(franchiseId: string): LoadedFranchiseConfiguration {
  return {
    franchiseId,
    revisionId: null,
    revisionNumber: 0,
    schemaVersion: FRANCHISE_CONFIGURATION_SCHEMA_VERSION,
    configuration: { ...COMPATIBILITY_FRANCHISE_CONFIGURATION, capabilities: {} },
    source: 'compatibility-default',
  };
}

function persist(record: LoadedFranchiseConfiguration) {
  memoryCache.set(record.franchiseId, record);
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(record.franchiseId), JSON.stringify(record));
  } catch (error) {
    console.warn('Unable to cache franchise configuration:', error);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('submerge:franchise-configuration', { detail: record }));
  }
}

export function applyFranchiseConfigurationToDocument(record?: LoadedFranchiseConfiguration | null) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const configuration = record?.configuration || COMPATIBILITY_FRANCHISE_CONFIGURATION;
  root.dataset.franchiseId = record?.franchiseId || 'default';
  root.dataset.themeProfile = configuration.themeProfile;
  root.dataset.proposalLayout = configuration.proposalLayout;
  root.dataset.locationInputMode = configuration.locationInputMode;
  root.dataset.contractResolutionMode = configuration.contractResolutionMode;
  root.dataset.franchiseCapabilities = Object.entries(configuration.capabilities || {})
    .filter(([, enabled]) => enabled === true)
    .map(([capability]) => capability)
    .sort()
    .join(',');
}

function readCached(franchiseId: string): LoadedFranchiseConfiguration | null {
  const memory = memoryCache.get(franchiseId);
  if (memory) return memory;
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(franchiseId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LoadedFranchiseConfiguration;
    const record: LoadedFranchiseConfiguration = {
      ...parsed,
      franchiseId,
      configuration: normalizeConfiguration(parsed.configuration),
      source: 'cache',
    };
    memoryCache.set(franchiseId, record);
    return record;
  } catch (error) {
    console.warn('Unable to read cached franchise configuration:', error);
    return null;
  }
}

export function getCachedFranchiseConfiguration(
  franchiseId: string
): LoadedFranchiseConfiguration | null {
  const normalizedFranchiseId = String(franchiseId || '').trim();
  return normalizedFranchiseId ? readCached(normalizedFranchiseId) : null;
}

export function subscribeToFranchiseConfigurationUpdates(
  franchiseId: string,
  listener: (record: LoadedFranchiseConfiguration) => void
) {
  if (typeof window === 'undefined') return () => undefined;
  const normalizedFranchiseId = String(franchiseId || '').trim();
  const handleUpdate = (event: Event) => {
    const record = (event as CustomEvent<LoadedFranchiseConfiguration>).detail;
    if (record?.franchiseId === normalizedFranchiseId) listener(record);
  };
  window.addEventListener('submerge:franchise-configuration', handleUpdate);
  return () => window.removeEventListener('submerge:franchise-configuration', handleUpdate);
}

export async function loadFranchiseConfiguration(
  franchiseId: string,
  options: { force?: boolean } = {}
): Promise<LoadedFranchiseConfiguration> {
  const normalizedFranchiseId = String(franchiseId || '').trim() || 'default';
  if (!options.force) {
    const cached = readCached(normalizedFranchiseId);
    if (cached) return cached;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return readCached(normalizedFranchiseId) || compatibilityDefault(normalizedFranchiseId);
  }

  try {
    const { data: assignment, error: assignmentError } = await supabase
      .from('franchise_configuration_assignments')
      .select('current_revision_id')
      .eq('franchise_id', normalizedFranchiseId)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment?.current_revision_id) {
      const fallback = compatibilityDefault(normalizedFranchiseId);
      persist(fallback);
      return fallback;
    }

    const { data: revision, error: revisionError } = await supabase
      .from('franchise_configuration_revisions')
      .select(
        'id,franchise_id,revision_number,schema_version,configuration_json,published_at,published_by'
      )
      .eq('id', assignment.current_revision_id)
      .eq('franchise_id', normalizedFranchiseId)
      .maybeSingle();
    if (revisionError) throw revisionError;
    if (!revision) {
      const fallback = compatibilityDefault(normalizedFranchiseId);
      persist(fallback);
      return fallback;
    }

    const loaded: LoadedFranchiseConfiguration = {
      franchiseId: normalizedFranchiseId,
      revisionId: revision.id,
      revisionNumber: Number(revision.revision_number) || 1,
      schemaVersion: Number(revision.schema_version) || FRANCHISE_CONFIGURATION_SCHEMA_VERSION,
      configuration: normalizeConfiguration(revision.configuration_json),
      publishedAt: revision.published_at || null,
      publishedBy: revision.published_by || null,
      source: 'remote',
    };
    persist(loaded);
    return loaded;
  } catch (error) {
    if (!isMissingFoundationError(error)) {
      console.warn('Unable to load franchise configuration; using compatibility settings:', error);
    }
    return readCached(normalizedFranchiseId) || compatibilityDefault(normalizedFranchiseId);
  }
}

export async function publishFranchiseConfiguration(payload: {
  franchiseId: string;
  configuration: FranchiseConfiguration;
  changeSummary?: string | null;
  publishedBy?: string | null;
}): Promise<LoadedFranchiseConfiguration> {
  assertLiveFranchiseMutationAllowed();
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is required to publish franchise configuration.');

  const configuration = normalizeConfiguration(payload.configuration);
  const { data, error } = await supabase.rpc('publish_franchise_configuration', {
    p_franchise_id: payload.franchiseId,
    p_configuration_json: configuration,
    p_schema_version: FRANCHISE_CONFIGURATION_SCHEMA_VERSION,
    p_change_summary: payload.changeSummary || null,
    p_published_by: payload.publishedBy || null,
  });
  if (error) throw error;

  const revision = Array.isArray(data) ? data[0] : data;
  if (!revision?.id) throw new Error('Configuration was published but no revision was returned.');
  const loaded: LoadedFranchiseConfiguration = {
    franchiseId: payload.franchiseId,
    revisionId: revision.id,
    revisionNumber: Number(revision.revision_number) || 1,
    schemaVersion: Number(revision.schema_version) || FRANCHISE_CONFIGURATION_SCHEMA_VERSION,
    configuration,
    publishedAt: revision.published_at || null,
    publishedBy: revision.published_by || null,
    source: 'remote',
  };
  persist(loaded);
  return loaded;
}

export function isFranchiseCapabilityEnabled(
  loaded: LoadedFranchiseConfiguration | null | undefined,
  capability: keyof FranchiseCapabilities | string,
  compatibilityDefaultValue = false
) {
  const configured = loaded?.configuration.capabilities?.[capability];
  return typeof configured === 'boolean' ? configured : compatibilityDefaultValue;
}

export function isPriceImpactEnabled(
  loaded: LoadedFranchiseConfiguration | null | undefined
) {
  return isFranchiseCapabilityEnabled(
    loaded,
    PRICE_IMPACT_CAPABILITY,
    DEFAULT_PRICE_IMPACT_ENABLED
  );
}
