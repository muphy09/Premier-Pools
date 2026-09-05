import { getSupabaseClient, hasSupabaseConnection, isSupabaseEnabled } from './supabaseClient';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import {
  claimUserAppSession,
  createAppSessionCredentials,
  heartbeatUserAppSession,
  releaseUserAppSession,
} from './appSession';
import {
  DEFAULT_FRANCHISE_ID,
  clearSession,
  clearMasterImpersonation,
  readSession,
  saveSession,
  type UserRole,
  type UserSession,
} from './session';
import { normalizeUserCommissionRates } from './userCommissionRates';

type FranchiseRow = {
  id: string;
  name?: string | null;
  franchise_code?: string | null;
};

type FranchiseUserRow = {
  id: string;
  franchise_id?: string | null;
  auth_user_id?: string | null;
  email?: string | null;
  name?: string | null;
  role?: UserRole | null;
  is_active?: boolean | null;
  password_reset_required?: boolean | null;
  dig_commission_rate?: number | null;
  closeout_commission_rate?: number | null;
  approval_margin_threshold_percent?: number | null;
  discount_allowance_threshold_percent?: number | null;
  always_require_approval?: boolean | null;
};

type TestAccountRow = {
  id: string;
  auth_user_id: string;
  email?: string | null;
  name?: string | null;
  role: Exclude<UserRole, 'master'>;
  is_active?: boolean | null;
  password_reset_required?: boolean | null;
};

type SignInSuccessResult = {
  status: 'signed-in';
  session: UserSession;
  passwordResetRequired: boolean;
};

type SignInConflictResult = {
  status: 'conflict';
  session: UserSession;
  passwordResetRequired: boolean;
};

export type SignInWithEmailResult = SignInSuccessResult | SignInConflictResult;

export class LoginConnectionError extends Error {
  constructor() {
    super('Unable to reach the sign-in service. Please try again in a moment.');
    this.name = 'LoginConnectionError';
  }
}

export type LoadSessionFromSupabaseResult =
  | {
      status: 'restored';
      session: UserSession;
      passwordResetRequired: boolean;
    }
  | {
      status: 'unverified';
      session: UserSession;
      passwordResetRequired: boolean;
    }
  | {
      status: 'signed-out';
      reason: 'missing-session' | 'displaced';
    };

function normalizeCode(code?: string | null) {
  return String(code || '').trim().toUpperCase();
}

function normalizeEmailAddress(email?: string | null) {
  return String(email || '').trim().toLowerCase();
}

function normalizeText(value?: string | null) {
  return String(value || '').trim();
}

function isAppSessionAuthorizationError(error: unknown) {
  const message =
    error instanceof Error
      ? normalizeText(error.message).toLowerCase()
      : normalizeText(String(error || '')).toLowerCase();

  return (
    message === 'unauthorized' ||
    message === 'unauthorized.' ||
    message === 'missing authorization token' ||
    message === 'missing authorization token.'
  );
}

function normalizeDisplayName(name?: string | null) {
  return String(name || '').trim();
}

function buildSignedOutRestoreResult(reason: 'missing-session' | 'displaced'): LoadSessionFromSupabaseResult {
  return { status: 'signed-out', reason };
}

function buildUnverifiedRestoreResult(savedSession: UserSession): LoadSessionFromSupabaseResult {
  return {
    status: 'unverified',
    session: savedSession,
    passwordResetRequired: Boolean(savedSession.passwordResetRequired),
  };
}

function assertSupabaseReady() {
  if (!isSupabaseEnabled()) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}

async function extractFunctionErrorMessage(error: any): Promise<string | null> {
  const context = error?.context;
  if (context && typeof context.json === 'function') {
    try {
      const parsed = await context.json();
      return typeof parsed?.error === 'string' ? parsed.error : null;
    } catch (parseError) {
      return null;
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

  return typeof body?.error === 'string' ? body.error : null;
}

async function getFranchiseById(franchiseId: string): Promise<FranchiseRow | null> {
  const supabase = assertSupabaseReady();
  const { data, error } = await supabase
    .from('franchises')
    .select('id,name,franchise_code')
    .eq('id', franchiseId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getFranchiseByCode(franchiseCode: string): Promise<FranchiseRow | null> {
  const supabase = assertSupabaseReady();
  const { data, error } = await supabase
    .from('franchises')
    .select('id,name,franchise_code')
    .eq('franchise_code', franchiseCode)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function getUserProfileByAuthId(authUserId: string, email?: string | null): Promise<FranchiseUserRow | null> {
  const supabase = assertSupabaseReady();
  const { data, error } = await supabase
    .from('franchise_users')
    .select(
      'id,franchise_id,auth_user_id,email,name,role,is_active,password_reset_required,dig_commission_rate,closeout_commission_rate,approval_margin_threshold_percent,discount_allowance_threshold_percent,always_require_approval'
    )
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (data) return data as FranchiseUserRow;

  const fallbackEmail = normalizeEmailAddress(email);
  if (!fallbackEmail) return null;

  const fallback = await supabase
    .from('franchise_users')
    .select(
      'id,franchise_id,auth_user_id,email,name,role,is_active,password_reset_required,dig_commission_rate,closeout_commission_rate,approval_margin_threshold_percent,discount_allowance_threshold_percent,always_require_approval'
    )
    .eq('email', fallbackEmail)
    .maybeSingle();
  if (fallback.error && fallback.error.code !== 'PGRST116') throw fallback.error;
  return (fallback.data as FranchiseUserRow) || null;
}

async function getTestAccountByAuthId(authUserId: string): Promise<TestAccountRow | null> {
  const supabase = assertSupabaseReady();
  const { data, error } = await supabase
    .from('app_test_accounts')
    .select('id,auth_user_id,email,name,role,is_active,password_reset_required')
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as TestAccountRow) || null;
}

async function updateLastLogin(authUserId: string) {
  const supabase = assertSupabaseReady();
  if (!authUserId) return;
  await supabase.rpc('touch_current_user_last_login');
}

function buildSessionFromProfile(options: {
  authUserId: string;
  email: string;
  profile: FranchiseUserRow;
  franchise?: FranchiseRow | null;
  appSession?: {
    appSessionId: string;
    appSessionLeaseToken: string;
  };
}): UserSession {
  const displayName = normalizeDisplayName(options.profile.name) || options.email || 'User';
  const role = (options.profile.role || 'designer') as UserRole;
  const franchise = options.franchise;
  const commissionRates = normalizeUserCommissionRates({
    digCommissionRate: options.profile.dig_commission_rate,
    closeoutCommissionRate: options.profile.closeout_commission_rate,
  });
  return {
    userId: options.authUserId,
    userEmail: options.email,
    userName: displayName,
    franchiseId: franchise?.id || options.profile.franchise_id || DEFAULT_FRANCHISE_ID,
    franchiseName: franchise?.name || undefined,
    franchiseCode: franchise?.franchise_code || undefined,
    role,
    passwordResetRequired: Boolean(options.profile.password_reset_required),
    appSessionId: options.appSession?.appSessionId,
    appSessionLeaseToken: options.appSession?.appSessionLeaseToken,
    approvalMarginThresholdPercent: Number.isFinite(Number(options.profile.approval_margin_threshold_percent))
      ? Number(options.profile.approval_margin_threshold_percent)
      : 18,
    discountAllowanceThresholdPercent: Number.isFinite(Number(options.profile.discount_allowance_threshold_percent))
      ? Number(options.profile.discount_allowance_threshold_percent)
      : 18,
    alwaysRequireApproval: options.profile.always_require_approval === true,
    ...commissionRates,
  };
}

function buildTestSession(options: {
  authUserId: string;
  email: string;
  account: TestAccountRow;
  franchise: FranchiseRow;
}): UserSession {
  return {
    userId: options.authUserId,
    userEmail: options.email,
    userName: normalizeDisplayName(options.account.name) || options.email || 'Test User',
    franchiseId: options.franchise.id,
    franchiseName: options.franchise.name || undefined,
    franchiseCode: options.franchise.franchise_code || undefined,
    role: options.account.role,
    passwordResetRequired: Boolean(options.account.password_reset_required),
    isTestAccount: true,
    testAccountId: options.account.id,
    approvalMarginThresholdPercent: 18,
    discountAllowanceThresholdPercent: 18,
    alwaysRequireApproval: false,
    ...normalizeUserCommissionRates({}),
  };
}

export async function signInWithEmail(payload: {
  email: string;
  password: string;
  franchiseCode?: string | null;
}): Promise<SignInWithEmailResult> {
  const supabase = assertSupabaseReady();
  // A background health endpoint can fail independently of authentication.
  // Let the actual sign-in request determine whether signing in is possible.

  const email = normalizeEmailAddress(payload.email);
  const password = String(payload.password || '');
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (isAuthRetryableFetchError(error)) throw new LoginConnectionError();
  if (error || !data?.user) {
    throw error || new Error('Unable to sign in.');
  }

  const authUser = data.user;
  const profile = await getUserProfileByAuthId(authUser.id, authUser.email);
  const testAccount = profile ? null : await getTestAccountByAuthId(authUser.id);
  if (!profile && !testAccount) {
    await supabase.auth.signOut({ scope: 'local' });
    throw new Error('This account is not linked to a franchise.');
  }

  if (testAccount) {
    const normalizedRole = String(testAccount.role || '').toLowerCase();
    if (!['owner', 'admin', 'bookkeeper', 'designer'].includes(normalizedRole) || testAccount.is_active === false) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('This testing account is not active.');
    }

    clearMasterImpersonation();
    const inputCode = normalizeCode(payload.franchiseCode);
    if (!inputCode) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Franchise code is required for this testing account.');
    }
    const franchise = await getFranchiseByCode(inputCode);
    if (!franchise) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Invalid franchise code.');
    }

    const session = buildTestSession({
      authUserId: authUser.id,
      email: normalizeEmailAddress(authUser.email || email),
      account: testAccount,
      franchise,
    });
    saveSession(session);
    return {
      status: 'signed-in',
      session,
      passwordResetRequired: Boolean(testAccount.password_reset_required),
    };
  }

  const role = (profile!.role || 'designer') as UserRole;
  const normalizedRole = String(role || '').toLowerCase();
  const allowedRoles = ['master', 'owner', 'admin', 'bookkeeper', 'designer'];
  const isActive = profile!.is_active !== false;
  if (!allowedRoles.includes(normalizedRole) || !isActive) {
    await supabase.auth.signOut({ scope: 'local' });
    throw new Error('This account is not active.');
  }

  let franchise: FranchiseRow | null = null;
  if (normalizedRole !== 'master') {
    clearMasterImpersonation();
    const inputCode = normalizeCode(payload.franchiseCode);
    if (!inputCode) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Franchise code is required for this account.');
    }
    franchise = await getFranchiseByCode(inputCode);
    if (!franchise) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Invalid franchise code.');
    }
    if (!profile!.franchise_id || franchise.id !== profile!.franchise_id) {
      await supabase.auth.signOut({ scope: 'local' });
      throw new Error('Invalid franchise code.');
    }
  } else if (profile!.franchise_id) {
    franchise = await getFranchiseById(profile!.franchise_id);
  }

  const appSession = createAppSessionCredentials();
  const session = buildSessionFromProfile({
    authUserId: authUser.id,
    email: normalizeEmailAddress(authUser.email || email),
    profile: profile!,
    franchise,
    appSession,
  });

  const claimResult = await claimUserAppSession({
    appSessionId: appSession.appSessionId,
    appSessionLeaseToken: appSession.appSessionLeaseToken,
    takeover: false,
  });

  if (claimResult.status === 'conflict') {
    return {
      status: 'conflict',
      session,
      passwordResetRequired: Boolean(profile!.password_reset_required),
    };
  }

  saveSession(session);
  if (session.userId) {
    void updateLastLogin(session.userId);
  }

  return {
    status: 'signed-in',
    session,
    passwordResetRequired: Boolean(profile!.password_reset_required),
  };
}

export async function confirmSessionTakeover(session: UserSession) {
  const appSessionId = normalizeText(session.appSessionId);
  const appSessionLeaseToken = normalizeText(session.appSessionLeaseToken);
  if (!appSessionId || !appSessionLeaseToken) {
    throw new Error('Unable to continue this login attempt. Please try signing in again.');
  }

  const claimResult = await claimUserAppSession({
    appSessionId,
    appSessionLeaseToken,
    takeover: true,
  });
  if (claimResult.status !== 'claimed') {
    throw new Error('Unable to take over the existing session. Please try again.');
  }

  saveSession(session);
  if (session.userId) {
    void updateLastLogin(session.userId);
  }

  return {
    session,
    passwordResetRequired: Boolean(session.passwordResetRequired),
  };
}

export async function loadSessionFromSupabase(): Promise<LoadSessionFromSupabaseResult> {
  const savedSession = readSession();
  if (!savedSession) return buildSignedOutRestoreResult('missing-session');
  const supabase = getSupabaseClient();
  if (!supabase) return buildUnverifiedRestoreResult(savedSession);
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    await supabase.auth.signOut({ scope: 'local' });
    clearMasterImpersonation();
    clearSession();
    return buildSignedOutRestoreResult('missing-session');
  }
  const authSession = data?.session;
  if (!authSession?.user) return buildSignedOutRestoreResult('missing-session');

  if (savedSession.isTestAccount === true) {
    let testAccount: TestAccountRow | null = null;
    let franchise: FranchiseRow | null = null;
    try {
      testAccount = await getTestAccountByAuthId(authSession.user.id);
      if (testAccount?.is_active !== false && savedSession.franchiseId) {
        franchise = await getFranchiseById(savedSession.franchiseId);
      }
    } catch (error) {
      return buildUnverifiedRestoreResult(savedSession);
    }
    if (!testAccount || testAccount.is_active === false || !franchise) {
      await supabase.auth.signOut({ scope: 'local' });
      clearSession();
      return buildSignedOutRestoreResult('missing-session');
    }
    const session = buildTestSession({
      authUserId: authSession.user.id,
      email: normalizeEmailAddress(authSession.user.email || savedSession.userEmail || ''),
      account: testAccount,
      franchise,
    });
    saveSession(session);
    return {
      status: 'restored',
      session,
      passwordResetRequired: Boolean(testAccount.password_reset_required),
    };
  }

  let profile: FranchiseUserRow | null = null;
  try {
    profile = await getUserProfileByAuthId(authSession.user.id, authSession.user.email);
  } catch (error) {
    return buildUnverifiedRestoreResult(savedSession);
  }
  if (!profile) return buildSignedOutRestoreResult('missing-session');

  const role = (profile.role || 'designer') as UserRole;
  const normalizedRole = String(role || '').toLowerCase();
  const allowedRoles = ['master', 'owner', 'admin', 'bookkeeper', 'designer'];
  if (!allowedRoles.includes(normalizedRole) || profile.is_active === false) {
    return buildSignedOutRestoreResult('missing-session');
  }
  if (normalizedRole !== 'master') {
    clearMasterImpersonation();
  }
  let franchise: FranchiseRow | null = null;
  if (normalizedRole !== 'master') {
    if (!profile.franchise_id) {
      return buildSignedOutRestoreResult('missing-session');
    }
    try {
      franchise = await getFranchiseById(profile.franchise_id);
    } catch (error) {
      return buildUnverifiedRestoreResult(savedSession);
    }
  } else if (profile.franchise_id) {
    try {
      franchise = await getFranchiseById(profile.franchise_id);
    } catch (error) {
      return buildUnverifiedRestoreResult(savedSession);
    }
  }

  let appSession = {
    appSessionId: normalizeText(savedSession.appSessionId),
    appSessionLeaseToken: normalizeText(savedSession.appSessionLeaseToken),
  };

  if (appSession.appSessionId && appSession.appSessionLeaseToken) {
    let heartbeat;
    try {
      heartbeat = await heartbeatUserAppSession({
        appSessionId: appSession.appSessionId,
        appSessionLeaseToken: appSession.appSessionLeaseToken,
      });
    } catch (error) {
      if (isAppSessionAuthorizationError(error)) {
        await supabase.auth.signOut({ scope: 'local' });
        clearMasterImpersonation();
        clearSession();
        return buildSignedOutRestoreResult('missing-session');
      }
      return buildUnverifiedRestoreResult(savedSession);
    }
    if (heartbeat.status !== 'active') {
      await supabase.auth.signOut({ scope: 'local' });
      clearMasterImpersonation();
      clearSession();
      return buildSignedOutRestoreResult('displaced');
    }
  } else {
    appSession = createAppSessionCredentials();
    let claimResult;
    try {
      claimResult = await claimUserAppSession({
        appSessionId: appSession.appSessionId,
        appSessionLeaseToken: appSession.appSessionLeaseToken,
        takeover: false,
      });
    } catch (error) {
      if (isAppSessionAuthorizationError(error)) {
        await supabase.auth.signOut({ scope: 'local' });
        clearMasterImpersonation();
        clearSession();
        return buildSignedOutRestoreResult('missing-session');
      }
      return buildUnverifiedRestoreResult(savedSession);
    }
    if (claimResult.status !== 'claimed') {
      await supabase.auth.signOut({ scope: 'local' });
      clearMasterImpersonation();
      clearSession();
      return buildSignedOutRestoreResult('missing-session');
    }
  }

  const session = buildSessionFromProfile({
    authUserId: authSession.user.id,
    email: normalizeEmailAddress(authSession.user.email || ''),
    profile,
    franchise,
    appSession,
  });
  saveSession(session);
  return {
    status: 'restored',
    session,
    passwordResetRequired: Boolean(profile.password_reset_required),
  };
}

async function updateCurrentUserPasswordInternal(
  payload: {
    newPassword: string;
    oldPassword?: string;
  },
  action: 'Password reset completed' | 'Password updated'
) {
  const supabase = assertSupabaseReady();
  const trimmed = String(payload.newPassword || '').trim();
  const oldPassword = String(payload.oldPassword || '').trim();
  if (!trimmed) {
    throw new Error('New password is required.');
  }

  const online = await hasSupabaseConnection(true);
  if (!online) {
    throw new Error('No internet connection. Please reconnect to continue.');
  }

  // Updating a password through the guarded Admin API invalidates the access
  // token used to authorize the request. Capture the identity first, then
  // immediately replace that token with a session authenticated by the new
  // password before the app-session heartbeat runs again.
  const { data: currentAuth, error: currentAuthError } = await supabase.auth.getSession();
  if (currentAuthError) throw currentAuthError;
  const currentEmail = normalizeEmailAddress(currentAuth.session?.user?.email || '');
  if (!currentEmail) {
    throw new Error('Your authenticated email could not be verified. Please sign in again.');
  }

  const { error } = await supabase.functions.invoke('change-current-user-password', {
    body: {
      newPassword: trimmed,
      ...(action === 'Password updated' ? { oldPassword } : {}),
      mode: action === 'Password reset completed' ? 'reset' : 'change',
    },
  });

  if (error) {
    const message = await extractFunctionErrorMessage(error);
    throw new Error(message || error.message || 'Unable to update password.');
  }

  const { error: refreshError } = await supabase.auth.signInWithPassword({
    email: currentEmail,
    password: trimmed,
  });
  if (refreshError) {
    throw new Error(
      'Your password was updated, but the app could not refresh your session. Sign in again using the new password.'
    );
  }
}

export async function completePasswordReset(newPassword: string) {
  await updateCurrentUserPasswordInternal({ newPassword }, 'Password reset completed');
}

export async function changeCurrentUserPassword(oldPassword: string, newPassword: string) {
  await updateCurrentUserPasswordInternal({ oldPassword, newPassword }, 'Password updated');
}

export async function signOut() {
  const currentSession = readSession();
  const appSessionId = normalizeText(currentSession?.appSessionId);
  const appSessionLeaseToken = normalizeText(currentSession?.appSessionLeaseToken);
  if (appSessionId && appSessionLeaseToken) {
    await releaseUserAppSession({
      appSessionId,
      appSessionLeaseToken,
    });
  }
  const supabase = getSupabaseClient();
  if (supabase) {
    await supabase.auth.signOut({ scope: 'local' });
  }
  clearMasterImpersonation();
  clearSession();
}
