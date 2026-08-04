import { getSupabaseClient, isSupabaseEnabled } from './supabaseClient';

export type FeedbackStatus = 'new' | 'resolved' | 'archived';

export const FEEDBACK_FEATURE_UNAVAILABLE_MESSAGE =
  'Feedback is not available in this environment yet.';
export const GLOBAL_FEEDBACK_DISABLED_MESSAGE =
  'Global feedback is currently turned off.';

export type FeedbackEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  franchiseId: string;
  franchiseName?: string | null;
  submitterAuthUserId?: string | null;
  submitterProfileId?: string | null;
  submitterName: string;
  submitterEmail?: string | null;
  submitterRole: string;
  effectiveRole: string;
  appVersion?: string | null;
  message: string;
  status: FeedbackStatus;
  resolutionMessage?: string | null;
  resolvedAt?: string | null;
  resolvedByName?: string | null;
  resolvedByEmail?: string | null;
  responseReadAt?: string | null;
  archivedAt?: string | null;
  archivedByName?: string | null;
  archivedByEmail?: string | null;
};

export type FeedbackSummary = {
  newCount: number;
  resolvedCount: number;
  archivedCount: number;
};

const FEEDBACK_BACKEND_IDENTIFIERS = [
  'franchise_feedback',
  'submit_franchise_feedback',
  'resolve_franchise_feedback',
  'archive_franchise_feedback',
  'delete_franchise_feedback',
  'acknowledge_franchise_feedback',
];
const GLOBAL_FEEDBACK_SETTINGS_TABLE = 'feedback_settings';
const GLOBAL_FEEDBACK_TOGGLE_RPC = 'set_global_feedback_enabled';
const GLOBAL_FEEDBACK_UPDATED_EVENT = 'submerge-global-feedback-enabled-updated';
const GLOBAL_FEEDBACK_CACHE_KEY = 'submerge.feedback.enabled';
const GLOBAL_FEEDBACK_CACHE_TTL_MS = 60 * 1000;
const GLOBAL_FEEDBACK_DISABLED_IDENTIFIER = GLOBAL_FEEDBACK_DISABLED_MESSAGE.toLowerCase();

type GlobalFeedbackCacheRecord = {
  enabled: boolean;
  fetchedAt: number;
};

let feedbackBackendUnavailable = false;
let loggedFeedbackBackendUnavailable = false;
let globalFeedbackCache: GlobalFeedbackCacheRecord | undefined;
let pendingGlobalFeedbackLoad: Promise<boolean> | null = null;
let loggedGlobalFeedbackSettingsUnavailable = false;

function requireSupabase() {
  if (!isSupabaseEnabled()) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
}

function getFeedbackUnavailableError() {
  return new Error(FEEDBACK_FEATURE_UNAVAILABLE_MESSAGE);
}

function getFeedbackErrorText(error: any) {
  return [error?.message, error?.details, error?.hint]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();
}

function errorMentionsFeedbackBackend(error: any) {
  const text = getFeedbackErrorText(error);
  return FEEDBACK_BACKEND_IDENTIFIERS.some((identifier) => text.includes(identifier));
}

export function isFeedbackFeatureUnavailableError(error: any) {
  if (error instanceof Error && error.message === FEEDBACK_FEATURE_UNAVAILABLE_MESSAGE) {
    return true;
  }

  const code = String(error?.code || '').trim().toUpperCase();
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883') {
    return true;
  }

  const status = Number(error?.status || error?.context?.status || 0);
  if (status === 404 && errorMentionsFeedbackBackend(error)) {
    return true;
  }

  const text = getFeedbackErrorText(error);
  if (!errorMentionsFeedbackBackend(error)) {
    return false;
  }

  return (
    (text.includes('relation') && text.includes('does not exist')) ||
    (text.includes('function') && text.includes('does not exist')) ||
    text.includes('schema cache')
  );
}

function markFeedbackBackendUnavailable(error: any) {
  feedbackBackendUnavailable = true;
  if (loggedFeedbackBackendUnavailable) return;
  loggedFeedbackBackendUnavailable = true;
  console.warn('Feedback backend is unavailable; disabling feedback features for this session.', error);
}

function emitGlobalFeedbackEnabledUpdate(enabled: boolean) {
  if (typeof window === 'undefined' || !window.dispatchEvent) return;
  window.dispatchEvent(
    new CustomEvent(GLOBAL_FEEDBACK_UPDATED_EVENT, { detail: { enabled } })
  );
}

function persistGlobalFeedbackEnabled(enabled: boolean, fetchedAt = Date.now()) {
  globalFeedbackCache = {
    enabled,
    fetchedAt,
  };

  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(GLOBAL_FEEDBACK_CACHE_KEY, JSON.stringify(globalFeedbackCache));
  } catch (error) {
    console.warn('Unable to persist global feedback setting cache:', error);
  }
}

function getGlobalFeedbackCacheRecord(): GlobalFeedbackCacheRecord | undefined {
  if (globalFeedbackCache) return globalFeedbackCache;
  if (typeof localStorage === 'undefined') return undefined;

  try {
    const raw = localStorage.getItem(GLOBAL_FEEDBACK_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<GlobalFeedbackCacheRecord> | null;
    if (!parsed || typeof parsed.enabled !== 'boolean' || typeof parsed.fetchedAt !== 'number') {
      return undefined;
    }

    globalFeedbackCache = {
      enabled: parsed.enabled,
      fetchedAt: parsed.fetchedAt,
    };
    return globalFeedbackCache;
  } catch (error) {
    console.warn('Unable to read global feedback setting cache:', error);
    return undefined;
  }
}

function isGlobalFeedbackCacheFresh(record?: GlobalFeedbackCacheRecord) {
  if (!record) return false;
  return Date.now() - record.fetchedAt < GLOBAL_FEEDBACK_CACHE_TTL_MS;
}

export function getCachedGlobalFeedbackEnabled() {
  return getGlobalFeedbackCacheRecord()?.enabled;
}

export function publishGlobalFeedbackEnabled(enabled: boolean) {
  persistGlobalFeedbackEnabled(enabled);
  emitGlobalFeedbackEnabledUpdate(enabled);
}

export function subscribeToGlobalFeedbackEnabledUpdates(
  callback: (enabled: boolean) => void
) {
  if (typeof window === 'undefined' || !window.addEventListener) return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
    if (!detail || typeof detail.enabled !== 'boolean') return;
    callback(detail.enabled);
  };

  window.addEventListener(GLOBAL_FEEDBACK_UPDATED_EVENT, handler as EventListener);
  return () => window.removeEventListener(GLOBAL_FEEDBACK_UPDATED_EVENT, handler as EventListener);
}

export function isGlobalFeedbackDisabledError(error: any) {
  return getFeedbackErrorText(error).includes(GLOBAL_FEEDBACK_DISABLED_IDENTIFIER);
}

async function runFeedbackRead<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  if (feedbackBackendUnavailable) {
    return fallback;
  }

  try {
    return await operation();
  } catch (error) {
    if (isFeedbackFeatureUnavailableError(error)) {
      markFeedbackBackendUnavailable(error);
      return fallback;
    }
    throw error;
  }
}

async function runFeedbackWrite<T>(operation: () => Promise<T>): Promise<T> {
  if (feedbackBackendUnavailable) {
    throw getFeedbackUnavailableError();
  }

  try {
    return await operation();
  } catch (error) {
    if (isFeedbackFeatureUnavailableError(error)) {
      markFeedbackBackendUnavailable(error);
      throw getFeedbackUnavailableError();
    }
    throw error;
  }
}

function normalizeFeedbackStatus(value: unknown): FeedbackStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'resolved' || normalized === 'archived') return normalized;
  return 'new';
}

function normalizeFeedbackRow(row: any): FeedbackEntry {
  return {
    id: String(row.id || ''),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || row.created_at || ''),
    franchiseId: String(row.franchise_id || ''),
    franchiseName: row.franchise_name || null,
    submitterAuthUserId: row.submitter_auth_user_id || null,
    submitterProfileId: row.submitter_profile_id || null,
    submitterName: String(row.submitter_name || '').trim() || 'Unknown User',
    submitterEmail: row.submitter_email || null,
    submitterRole: String(row.submitter_role || '').trim().toLowerCase() || 'designer',
    effectiveRole: String(row.effective_role || '').trim().toLowerCase() || 'designer',
    appVersion: row.app_version || null,
    message: String(row.message || '').trim(),
    status: normalizeFeedbackStatus(row.status),
    resolutionMessage: row.resolution_message || null,
    resolvedAt: row.resolved_at || null,
    resolvedByName: row.resolved_by_name || null,
    resolvedByEmail: row.resolved_by_email || null,
    responseReadAt: row.response_read_at || null,
    archivedAt: row.archived_at || null,
    archivedByName: row.archived_by_name || null,
    archivedByEmail: row.archived_by_email || null,
  };
}

async function countFeedbackByStatus(status: FeedbackStatus, franchiseId?: string | null) {
  return runFeedbackRead(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    let query = supabase
      .from('franchise_feedback')
      .select('id', { count: 'exact', head: true })
      .eq('status', status);

    if (franchiseId) {
      query = query.eq('franchise_id', franchiseId);
    }

    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  }, 0);
}

export async function submitFeedback(payload: {
  franchiseId: string;
  message: string;
  appVersion?: string | null;
  effectiveRole?: string | null;
}) {
  return runFeedbackWrite(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.rpc('submit_franchise_feedback', {
      p_franchise_id: payload.franchiseId,
      p_message: payload.message,
      p_app_version: payload.appVersion || null,
      p_effective_role: payload.effectiveRole || null,
    });
    if (error) throw error;
    return String(data || '');
  });
}

export async function loadGlobalFeedbackEnabled(
  options: { force?: boolean } = {}
): Promise<boolean> {
  const cached = getGlobalFeedbackCacheRecord();
  if (!options.force && isGlobalFeedbackCacheFresh(cached)) {
    return cached?.enabled ?? true;
  }

  if (pendingGlobalFeedbackLoad) {
    return pendingGlobalFeedbackLoad;
  }

  const loadPromise = (async () => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      const fallbackEnabled = cached?.enabled ?? true;
      publishGlobalFeedbackEnabled(fallbackEnabled);
      return fallbackEnabled;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.access_token) {
      const fallbackEnabled = cached?.enabled ?? true;
      publishGlobalFeedbackEnabled(fallbackEnabled);
      return fallbackEnabled;
    }

    const { data, error } = await supabase
      .from(GLOBAL_FEEDBACK_SETTINGS_TABLE)
      .select('feedback_enabled')
      .eq('singleton_key', true)
      .maybeSingle();

    if (error) {
      if (isFeedbackFeatureUnavailableError(error)) {
        if (!loggedGlobalFeedbackSettingsUnavailable) {
          loggedGlobalFeedbackSettingsUnavailable = true;
          console.warn('Global feedback setting is unavailable; defaulting to enabled.', error);
        }
        publishGlobalFeedbackEnabled(true);
        return true;
      }
      throw error;
    }

    const enabled = data?.feedback_enabled !== false;
    publishGlobalFeedbackEnabled(enabled);
    return enabled;
  })();

  pendingGlobalFeedbackLoad = loadPromise;
  try {
    return await loadPromise;
  } finally {
    pendingGlobalFeedbackLoad = null;
  }
}

export async function setGlobalFeedbackEnabled(enabled: boolean) {
  requireSupabase();
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.rpc(GLOBAL_FEEDBACK_TOGGLE_RPC, {
    p_feedback_enabled: enabled,
  });
  if (error) throw error;

  const nextEnabled = typeof data === 'boolean' ? data : enabled;
  publishGlobalFeedbackEnabled(nextEnabled);
  return nextEnabled;
}

export async function listMasterFeedback(options: {
  status: FeedbackStatus;
  franchiseId?: string | null;
  limit?: number;
}): Promise<FeedbackEntry[]> {
  return runFeedbackRead(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    let query = supabase
      .from('franchise_feedback')
      .select(
        'id,created_at,updated_at,franchise_id,franchise_name,submitter_auth_user_id,submitter_profile_id,submitter_name,submitter_email,submitter_role,effective_role,app_version,message,status,resolution_message,resolved_at,resolved_by_name,resolved_by_email,response_read_at,archived_at,archived_by_name,archived_by_email'
      )
      .eq('status', options.status)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(500, Math.floor(options.limit || 200))));

    if (options.franchiseId) {
      query = query.eq('franchise_id', options.franchiseId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizeFeedbackRow);
  }, []);
}

export async function getMasterFeedbackSummary(franchiseId?: string | null): Promise<FeedbackSummary> {
  const [newCount, resolvedCount, archivedCount] = await Promise.all([
    countFeedbackByStatus('new', franchiseId),
    countFeedbackByStatus('resolved', franchiseId),
    countFeedbackByStatus('archived', franchiseId),
  ]);

  return {
    newCount,
    resolvedCount,
    archivedCount,
  };
}

export async function resolveFeedback(feedbackId: string, resolutionMessage: string) {
  return runFeedbackWrite(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.rpc('resolve_franchise_feedback', {
      p_feedback_id: feedbackId,
      p_resolution_message: resolutionMessage,
    });
    if (error) throw error;
    return Boolean(data);
  });
}

export async function archiveFeedback(feedbackId: string) {
  return runFeedbackWrite(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.rpc('archive_franchise_feedback', {
      p_feedback_id: feedbackId,
    });
    if (error) throw error;
    return Boolean(data);
  });
}

export async function deleteFeedback(feedbackId: string) {
  return runFeedbackWrite(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.rpc('delete_franchise_feedback', {
      p_feedback_id: feedbackId,
    });
    if (error) throw error;
    return Boolean(data);
  });
}

export async function listPendingFeedbackReplies(
  submitterAuthUserId: string,
  limit = 20
): Promise<FeedbackEntry[]> {
  return runFeedbackRead(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const normalizedSubmitterAuthUserId = String(submitterAuthUserId || '').trim();
    if (!normalizedSubmitterAuthUserId) return [];

    const { data, error } = await supabase
      .from('franchise_feedback')
      .select(
        'id,created_at,updated_at,franchise_id,franchise_name,submitter_auth_user_id,submitter_profile_id,submitter_name,submitter_email,submitter_role,effective_role,app_version,message,status,resolution_message,resolved_at,resolved_by_name,resolved_by_email,response_read_at,archived_at,archived_by_name,archived_by_email'
      )
      .eq('submitter_auth_user_id', normalizedSubmitterAuthUserId)
      .eq('status', 'resolved')
      .is('response_read_at', null)
      .not('resolution_message', 'is', null)
      .order('resolved_at', { ascending: false })
      .limit(Math.max(1, Math.min(100, Math.floor(limit || 20))));
    if (error) throw error;
    return (data || []).map(normalizeFeedbackRow);
  }, []);
}

export async function acknowledgeFeedbackReply(feedbackId: string) {
  return runFeedbackWrite(async () => {
    requireSupabase();
    const supabase = getSupabaseClient();
    if (!supabase) throw new Error('Supabase is not configured.');

    const { data, error } = await supabase.rpc('acknowledge_franchise_feedback', {
      p_feedback_id: feedbackId,
    });
    if (error) {
      // Treat a stale/already-cleared reply as acknowledged so the inbox can
      // recover instead of trapping the user behind an undismissable modal.
      if (getFeedbackErrorText(error).includes('feedback response not found')) {
        return false;
      }
      throw error;
    }
    return Boolean(data);
  });
}
