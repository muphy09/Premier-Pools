import { saveFranchiseAppName, loadFranchiseAppName } from './franchiseBranding';
import { saveFranchiseCode } from './franchisesAdapter';
import { getSupabaseClient, isSupabaseEnabled } from './supabaseClient';
import { logLedgerEventSafe } from './ledger';
import { normalizeUserCommissionRates, type UserCommissionRates } from './userCommissionRates';

export type MasterFranchise = {
  id: string;
  name?: string | null;
  franchiseCode?: string | null;
  isActive?: boolean;
  deletedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type MasterUser = UserCommissionRates & {
  id: string;
  franchiseId?: string | null;
  email: string;
  name?: string | null;
  role: 'master' | 'owner' | 'admin' | 'bookkeeper' | 'designer';
  isActive: boolean;
  passwordResetRequired?: boolean;
  createdAt?: string;
  updatedAt?: string;
  approvalMarginThresholdPercent?: number;
  discountAllowanceThresholdPercent?: number;
  alwaysRequireApproval?: boolean;
  currentAppVersion?: string | null;
  currentAppVersionReportedAt?: string | null;
};

export type MasterPricingModel = {
  id: string;
  franchiseId: string;
  name: string;
  version?: string;
  isDefault?: boolean;
  isHiddenFromView?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function normalizeText(value?: string | null) {
  return String(value || '').trim();
}

function normalizeComparableText(value?: string | null) {
  return normalizeText(value).toLowerCase();
}

async function extractFunctionErrorMessage(error: any): Promise<string | null> {
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const parsed = await context.json();
      return typeof parsed?.error === 'string' ? parsed.error : null;
    } catch (parseError) {
      // fall through
    }
  }

  const body = context?.body;
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed?.error === 'string' ? parsed.error : null;
    } catch (parseError) {
      return null;
    }
  }
  if (typeof body?.error === 'string') {
    return body.error;
  }
  return null;
}

function requireSupabase() {
  if (!isSupabaseEnabled()) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
}

export async function listAllFranchises(): Promise<MasterFranchise[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    requireSupabase();
    return [];
  }
  const { data, error } = await supabase
    .from('franchises')
    .select('id,name,franchise_code,is_active,deleted_at,created_at,updated_at')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    franchiseCode: row.franchise_code,
    isActive: row.is_active !== false,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function listAllFranchiseUsers(franchiseId?: string | null): Promise<MasterUser[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    requireSupabase();
    return [];
  }
  let query = supabase
    .from('franchise_users')
    .select(
      'id,franchise_id,email,name,role,is_active,password_reset_required,created_at,updated_at,dig_commission_rate,closeout_commission_rate,approval_margin_threshold_percent,discount_allowance_threshold_percent,always_require_approval,current_app_version,current_app_version_reported_at'
    );
  if (franchiseId) query = query.eq('franchise_id', franchiseId);
  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    franchiseId: row.franchise_id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.is_active !== false,
    passwordResetRequired: Boolean(row.password_reset_required),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvalMarginThresholdPercent: Number.isFinite(Number(row.approval_margin_threshold_percent))
      ? Number(row.approval_margin_threshold_percent)
      : 18,
    discountAllowanceThresholdPercent: Number.isFinite(Number(row.discount_allowance_threshold_percent))
      ? Number(row.discount_allowance_threshold_percent)
      : 18,
    alwaysRequireApproval: row.always_require_approval === true,
    currentAppVersion: row.current_app_version || null,
    currentAppVersionReportedAt: row.current_app_version_reported_at || null,
    ...normalizeUserCommissionRates({
      digCommissionRate: row.dig_commission_rate,
      closeoutCommissionRate: row.closeout_commission_rate,
    }),
  }));
}

export async function listAllPricingModels(): Promise<MasterPricingModel[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    requireSupabase();
    return [];
  }
  const { data, error } = await supabase
    .from('franchise_pricing_models')
    .select('id,franchise_id,name,version,is_default,is_hidden_from_view,created_at,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    franchiseId: row.franchise_id,
    name: row.name,
    version: row.version,
    isDefault: row.is_default,
    isHiddenFromView: row.is_hidden_from_view,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createFranchiseWithOwner(payload: {
  franchiseName: string;
  franchiseCode: string;
  ownerEmail: string;
  ownerName?: string | null;
}) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    requireSupabase();
    return null;
  }
  const { data, error } = await supabase.functions.invoke('create-franchise-with-owner', {
    body: {
      franchiseName: payload.franchiseName,
      franchiseCode: String(payload.franchiseCode || '').trim().toUpperCase(),
      ownerEmail: String(payload.ownerEmail || '').trim().toLowerCase(),
      ownerName: payload.ownerName || null,
    },
  });
  if (error) {
    const message = await extractFunctionErrorMessage(error);
    if (message) {
      throw new Error(message);
    }
    throw error;
  }
  return data as { franchiseId?: string; tempPassword?: string };
}

export async function softDeleteFranchise(franchiseId: string) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    requireSupabase();
    return null;
  }
  const { data, error } = await supabase.functions.invoke('delete-franchise', {
    body: { franchiseId },
  });
  if (error) throw error;
  return data as { success?: boolean };
}

export async function saveMasterFranchiseSettings(payload: {
  franchiseId: string;
  franchiseName: string;
  franchiseCode: string;
  previousName?: string | null;
  previousCode?: string | null;
  updatedBy?: string | null;
}) {
  const franchiseId = normalizeText(payload.franchiseId);
  const franchiseName = normalizeText(payload.franchiseName);
  const previousName = normalizeText(payload.previousName);

  if (!franchiseId) {
    throw new Error('Franchise ID is required.');
  }
  if (!franchiseName) {
    throw new Error('Franchise name is required.');
  }

  const result = await saveFranchiseCode({
    franchiseId,
    franchiseName,
    franchiseCode: payload.franchiseCode,
    previousCode: payload.previousCode,
  }, { skipLedger: true });

  const normalizedPreviousCode = normalizeText(payload.previousCode).toUpperCase();
  const normalizedNextCode = normalizeText(result.franchiseCode).toUpperCase();

  try {
    const currentAppName = await loadFranchiseAppName(franchiseId, { force: true });
    const normalizedRawCurrentAppName = normalizeText(currentAppName);
    const normalizedCurrentAppName = normalizeComparableText(currentAppName);
    const normalizedPreviousName = normalizeComparableText(previousName);

    if (
      normalizedCurrentAppName &&
      normalizedPreviousName &&
      normalizedCurrentAppName === normalizedPreviousName &&
      normalizedRawCurrentAppName !== franchiseName
    ) {
      await saveFranchiseAppName({
        franchiseId,
        appName: franchiseName,
        updatedBy: payload.updatedBy ?? null,
      });
    }
  } catch (error) {
    console.warn('Unable to synchronize franchise app name after updating franchise settings:', error);
  }

  if (normalizeComparableText(previousName) !== normalizeComparableText(franchiseName) || normalizedPreviousCode !== normalizedNextCode) {
    await logLedgerEventSafe({
      franchiseId,
      franchiseName,
      action: 'Franchise settings updated',
      targetType: 'franchise',
      targetId: franchiseId,
      details: {
        franchiseId,
        previousName: previousName || null,
        nextName: franchiseName,
        previousCode: normalizedPreviousCode || null,
        nextCode: normalizedNextCode,
      },
    });
  }

  return {
    id: franchiseId,
    name: franchiseName,
    franchiseCode: result.franchiseCode,
  } as MasterFranchise;
}
