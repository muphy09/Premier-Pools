import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvVar } from './env';

let client: SupabaseClient | null = null;
let loggedMissing = false;
let loggedEnabled = false;

// Cache Supabase reachability checks so we do not spam the endpoint
let lastReachabilityCheck = 0;
let lastReachabilityResult = false;
let lastReachabilityReason: SupabaseReachabilityReason = null;
let consecutiveReachabilityFailures = 0;
let hasSuccessfulReachabilityCheck = false;
let reachabilityCheckInFlight: Promise<SupabaseReachability> | null = null;

const REACHABILITY_CACHE_MS = 5000;
const REACHABILITY_TIMEOUT_MS = 8000;
const REACHABILITY_FAILURE_THRESHOLD = 2;

export type SupabaseReachabilityReason = 'no-internet' | 'server-issue' | 'disabled' | null;

export type SupabaseReachability = {
  reachable: boolean;
  reason: SupabaseReachabilityReason;
};

export function isSupabaseEnabled() {
  const url = getEnvVar('VITE_SUPABASE_URL');
  const key = getEnvVar('VITE_SUPABASE_ANON_KEY');
  return Boolean(url && key);
}

function createSupabaseClient() {
  const url = getEnvVar('VITE_SUPABASE_URL');
  const key = getEnvVar('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    if (!loggedMissing) {
      console.info('Supabase not configured (missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY); falling back to local/IPC.');
      loggedMissing = true;
    }
    return null;
  }

  const instance = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  if (!loggedEnabled) {
    console.info('Supabase client initialized with provided env vars.');
    loggedEnabled = true;
  }
  return instance;
}

export function getSupabaseClient() {
  if (client) return client;
  client = createSupabaseClient();
  return client;
}

function cacheReachability(
  reachable: boolean,
  reason: SupabaseReachabilityReason,
  timestamp = Date.now()
): SupabaseReachability {
  lastReachabilityCheck = timestamp;
  lastReachabilityResult = reachable;
  lastReachabilityReason = reason;
  return { reachable, reason };
}

async function probeSupabaseEndpoint(
  endpoint: string,
  key: string,
  acceptResponse: (response: Response) => boolean
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { apikey: key },
      signal: controller.signal,
    });
    return acceptResponse(response);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function runSupabaseReachabilityCheck(url: string, key: string): Promise<SupabaseReachability> {
  const normalizedUrl = url.replace(/\/+$/, '');
  const authHealthy = await probeSupabaseEndpoint(
    `${normalizedUrl}/auth/v1/health`,
    key,
    (response) => response.ok
  );
  if (authHealthy) {
    consecutiveReachabilityFailures = 0;
    hasSuccessfulReachabilityCheck = true;
    return cacheReachability(true, null);
  }

  // Some Electron/network combinations can fail the health route while the
  // Supabase gateway is still reachable. A real HTTP response below 500 from
  // Auth settings proves that the cloud is reachable, even if it rejects an
  // invalid or expired credential.
  const gatewayReachable = await probeSupabaseEndpoint(
    `${normalizedUrl}/auth/v1/settings`,
    key,
    (response) => response.status > 0 && response.status < 500
  );
  if (gatewayReachable) {
    consecutiveReachabilityFailures = 0;
    hasSuccessfulReachabilityCheck = true;
    return cacheReachability(true, null);
  }

  consecutiveReachabilityFailures += 1;
  if (
    hasSuccessfulReachabilityCheck &&
    consecutiveReachabilityFailures < REACHABILITY_FAILURE_THRESHOLD
  ) {
    return cacheReachability(true, null);
  }
  return cacheReachability(false, 'server-issue');
}

/**
 * Lightweight connectivity check to confirm we can talk to Supabase.
 * Uses the public Auth health endpoint so this remains valid before login and
 * after logout without probing a protected application table.
 */
export async function getSupabaseReachability(forceRefresh = false): Promise<SupabaseReachability> {
  const now = Date.now();
  if (!isSupabaseEnabled()) return cacheReachability(false, 'disabled', now);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    consecutiveReachabilityFailures = REACHABILITY_FAILURE_THRESHOLD;
    return cacheReachability(false, 'no-internet', now);
  }
  if (!forceRefresh && now - lastReachabilityCheck < REACHABILITY_CACHE_MS) {
    return { reachable: lastReachabilityResult, reason: lastReachabilityReason };
  }

  const url = getEnvVar('VITE_SUPABASE_URL');
  const key = getEnvVar('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    return cacheReachability(false, 'disabled', now);
  }

  if (!reachabilityCheckInFlight) {
    reachabilityCheckInFlight = runSupabaseReachabilityCheck(url, key).finally(() => {
      reachabilityCheckInFlight = null;
    });
  }
  return reachabilityCheckInFlight;
}

export function resetSupabaseReachabilityForTests() {
  lastReachabilityCheck = 0;
  lastReachabilityResult = false;
  lastReachabilityReason = null;
  consecutiveReachabilityFailures = 0;
  hasSuccessfulReachabilityCheck = false;
  reachabilityCheckInFlight = null;
}

export async function hasSupabaseConnection(forceRefresh = false): Promise<boolean> {
  const result = await getSupabaseReachability(forceRefresh);
  return result.reachable;
}
