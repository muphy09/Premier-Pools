import type { PriceImpactDisplayBasis } from './priceImpact';
import { readSession } from './session';
import { getSupabaseClient } from './supabaseClient';

export type PriceImpactPreferences = {
  enabled: boolean;
  displayBasis: PriceImpactDisplayBasis;
};

export const DEFAULT_PRICE_IMPACT_PREFERENCES: PriceImpactPreferences = {
  enabled: true,
  displayBasis: 'retail',
};

export const PRICE_IMPACT_PREFERENCES_UPDATED_EVENT =
  'submerge:price-impact-preferences';

const STORAGE_PREFIX = 'submerge.userPreferences.priceImpact.v1';
const memoryCache = new Map<string, PriceImpactPreferences>();
let loggedMissingPreferencesTable = false;

const normalizeUserId = (value?: string | null) => String(value || '').trim();

const normalizePreferences = (
  value?: Partial<PriceImpactPreferences> | null
): PriceImpactPreferences => ({
  enabled: value?.enabled !== false,
  displayBasis: value?.displayBasis === 'cogs' ? 'cogs' : 'retail',
});

const storageKey = (userId: string) => `${STORAGE_PREFIX}.${userId}`;

const isMissingPreferencesFoundationError = (error: any) => {
  const code = String(error?.code || '');
  const message = String(error?.message || '').toLowerCase();
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('user_preferences') ||
    message.includes('could not find the table')
  );
};

const persistPreferences = (userId: string, preferences: PriceImpactPreferences) => {
  const normalized = normalizePreferences(preferences);
  memoryCache.set(userId, normalized);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(normalized));
    } catch (error) {
      console.warn('Unable to cache Price Impact preferences:', error);
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(PRICE_IMPACT_PREFERENCES_UPDATED_EVENT, {
        detail: { userId, preferences: normalized },
      })
    );
  }
  return normalized;
};

export const getSessionUserId = () => normalizeUserId(readSession()?.userId);

export function getCachedPriceImpactPreferences(
  userId = getSessionUserId()
): PriceImpactPreferences {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return { ...DEFAULT_PRICE_IMPACT_PREFERENCES };

  const memory = memoryCache.get(normalizedUserId);
  if (memory) return memory;
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PRICE_IMPACT_PREFERENCES };

  try {
    const raw = localStorage.getItem(storageKey(normalizedUserId));
    if (!raw) return { ...DEFAULT_PRICE_IMPACT_PREFERENCES };
    const preferences = normalizePreferences(JSON.parse(raw));
    memoryCache.set(normalizedUserId, preferences);
    return preferences;
  } catch (error) {
    console.warn('Unable to read cached Price Impact preferences:', error);
    return { ...DEFAULT_PRICE_IMPACT_PREFERENCES };
  }
}

export async function loadPriceImpactPreferences(
  userId = getSessionUserId()
): Promise<PriceImpactPreferences> {
  const normalizedUserId = normalizeUserId(userId);
  const fallback = getCachedPriceImpactPreferences(normalizedUserId);
  if (!normalizedUserId) return fallback;

  const supabase = getSupabaseClient();
  if (!supabase) return fallback;

  try {
    const { data: authData } = await supabase.auth.getSession();
    if (authData.session?.user.id !== normalizedUserId) return fallback;

    const { data, error } = await supabase
      .from('user_preferences')
      .select('price_impact_enabled,price_impact_display_basis')
      .eq('user_id', normalizedUserId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return persistPreferences(normalizedUserId, DEFAULT_PRICE_IMPACT_PREFERENCES);

    return persistPreferences(normalizedUserId, {
      enabled: data.price_impact_enabled !== false,
      displayBasis: data.price_impact_display_basis === 'cogs' ? 'cogs' : 'retail',
    });
  } catch (error) {
    if (isMissingPreferencesFoundationError(error)) {
      if (!loggedMissingPreferencesTable) {
        console.warn('Price Impact user preferences are unavailable until the database migration is applied.');
        loggedMissingPreferencesTable = true;
      }
    } else {
      console.warn('Unable to load Price Impact user preferences; using cached settings:', error);
    }
    return fallback;
  }
}

export async function savePriceImpactPreferences(
  preferences: PriceImpactPreferences,
  userId = getSessionUserId()
): Promise<PriceImpactPreferences> {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) throw new Error('A signed-in user is required to save Price Impact settings.');

  const previous = getCachedPriceImpactPreferences(normalizedUserId);
  const next = persistPreferences(normalizedUserId, normalizePreferences(preferences));
  const supabase = getSupabaseClient();
  if (!supabase) return next;

  const { data: authData } = await supabase.auth.getSession();
  if (authData.session?.user.id !== normalizedUserId) return next;

  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: normalizedUserId,
        price_impact_enabled: next.enabled,
        price_impact_display_basis: next.displayBasis,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('price_impact_enabled,price_impact_display_basis')
    .single();

  if (error) {
    persistPreferences(normalizedUserId, previous);
    throw error;
  }

  return persistPreferences(normalizedUserId, {
    enabled: data?.price_impact_enabled !== false,
    displayBasis: data?.price_impact_display_basis === 'cogs' ? 'cogs' : 'retail',
  });
}

export function subscribeToPriceImpactPreferences(
  userId: string,
  listener: (preferences: PriceImpactPreferences) => void
) {
  if (typeof window === 'undefined') return () => undefined;
  const normalizedUserId = normalizeUserId(userId);
  const handleUpdate = (event: Event) => {
    const detail = (event as CustomEvent<{
      userId: string;
      preferences: PriceImpactPreferences;
    }>).detail;
    if (detail?.userId === normalizedUserId) listener(normalizePreferences(detail.preferences));
  };
  window.addEventListener(PRICE_IMPACT_PREFERENCES_UPDATED_EVENT, handleUpdate);
  return () => window.removeEventListener(PRICE_IMPACT_PREFERENCES_UPDATED_EVENT, handleUpdate);
}
