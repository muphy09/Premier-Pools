import { getSupabaseClient, isSupabaseEnabled } from './supabaseClient';
import { formatFranchiseAppVersion } from './franchiseRelease';

const APP_VERSION_CACHE_KEY_PREFIX = 'submerge-reported-app-version';
const REPORT_APP_VERSION_RPC = 'report_current_user_app_version';

let loggedUnavailable = false;

function normalizeText(value?: string | null) {
  return String(value || '').trim();
}

function normalizeVersion(value?: string | null) {
  const trimmed = normalizeText(value);
  if (!trimmed) return null;
  return trimmed.replace(/^v(?=\d)/i, '') || null;
}

function getCacheKey(userId: string) {
  return `${APP_VERSION_CACHE_KEY_PREFIX}:${userId}`;
}

function readCachedVersion(userId: string) {
  if (typeof localStorage === 'undefined') return null;
  try {
    return normalizeVersion(localStorage.getItem(getCacheKey(userId)));
  } catch (error) {
    console.warn('Unable to read cached app version report state:', error);
    return null;
  }
}

function writeCachedVersion(userId: string, version: string) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(getCacheKey(userId), version);
  } catch (error) {
    console.warn('Unable to cache reported app version state:', error);
  }
}

function isRpcUnavailable(error: any) {
  const code = String(error?.code || '').trim().toUpperCase();
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883') {
    return true;
  }

  const text = [error?.message, error?.details, error?.hint]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .toLowerCase();

  return (
    text.includes(REPORT_APP_VERSION_RPC) &&
    ((text.includes('function') && text.includes('does not exist')) || text.includes('schema cache'))
  );
}

export function formatReportedAppVersion(value?: string | null) {
  const normalizedVersion = normalizeVersion(value);
  return normalizedVersion ? `v${formatFranchiseAppVersion(normalizedVersion)}` : null;
}

export async function reportCurrentUserAppVersion(options: {
  userId?: string | null;
  version?: string | null;
}) {
  const userId = normalizeText(options.userId);
  const version = normalizeVersion(options.version);
  if (!userId || !version) return false;

  if (readCachedVersion(userId) === version) {
    return false;
  }

  if (!isSupabaseEnabled()) {
    return false;
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return false;
  }

  try {
    const { data, error } = await supabase.rpc(REPORT_APP_VERSION_RPC, {
      p_app_version: version,
    });
    if (error) {
      if (isRpcUnavailable(error)) {
        if (!loggedUnavailable) {
          loggedUnavailable = true;
          console.warn('App version reporting is unavailable until the Supabase SQL migration is installed.');
        }
        return false;
      }
      throw error;
    }

    writeCachedVersion(userId, version);
    return Boolean(data);
  } catch (error) {
    console.warn('Unable to report current app version:', error);
    return false;
  }
}
