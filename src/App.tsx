import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import HomePage from './pages/HomePage';
import NavigationBar from './components/NavigationBar';
import UpdateNotification from './components/UpdateNotification';
import ChangelogModal from './components/ChangelogModal';
import MessageDetailModal from './components/MessageDetailModal';
import UserProfileModal from './components/UserProfileModal';
import AdminSettingsModal from './components/AdminSettingsModal';
import { setActiveFranchiseId } from './services/pricingDataStore';
import {
  applyFranchiseConfigurationToDocument,
  loadFranchiseConfiguration,
  type LoadedFranchiseConfiguration,
} from './services/franchiseConfiguration';
import { ToastProvider, useToast } from './components/Toast';
import LoginModal from './components/LoginModal';
import { getSupabaseClient, getSupabaseReachability, isSupabaseEnabled } from './services/supabaseClient';
import CloudConnectionNotice, { CloudConnectionIssue } from './components/CloudConnectionNotice';
import useKeyboardNavigation from './hooks/useKeyboardNavigation';
import useGlobalModalScrollLock from './hooks/useGlobalModalScrollLock';
import PasswordResetModal from './components/PasswordResetModal';
import ConfirmDialog from './components/ConfirmDialog';
import {
  completePasswordReset,
  confirmSessionTakeover,
  loadSessionFromSupabase,
  signInWithEmail,
  signOut,
} from './services/auth';
import { assertLoginAllowed, clearLoginAttempts, recordLoginFailure } from './services/loginRateLimiter';
import { APP_SESSION_HEARTBEAT_INTERVAL_MS, heartbeatUserAppSession } from './services/appSession';
import {
  DEFAULT_FRANCHISE_ID,
  type MasterImpersonation,
  type UserSession,
  clearSession,
  clearMasterImpersonation,
  clearRemoteSignoutNotice,
  markRemoteSignoutNotice,
  readMasterImpersonation,
  readSession,
  saveMasterImpersonation,
  subscribeToMasterImpersonationUpdates,
  shouldShowRemoteSignoutNotice,
  updateSession,
} from './services/session';
import {
  acknowledgeChangelog,
  getCurrentAppVersion,
  hasPendingChangelog,
  recordAppLaunch,
} from './services/changelogPrompt';
import { reportCurrentUserAppVersion } from './services/appVersionReporter';
import {
  formatFranchiseAppVersion,
  getUpdateChannel,
  loadFranchiseReleaseAssignment,
} from './services/franchiseRelease';
import type { MasterFranchise } from './services/masterAdminAdapter';
import AdminPinModal from './components/AdminPinModal';
import { useFranchiseAppName } from './hooks/useFranchiseAppName';
import { useGlobalFeedbackEnabled } from './hooks/useGlobalFeedbackEnabled';
import {
  ADMIN_PANEL_PIN_LENGTH,
  ADMIN_PANEL_PIN_LOCKOUT_MESSAGE,
  clearAdminPanelPinFailures,
  getAdminPanelPinLockout,
  recordFailedAdminPanelPinAttempt,
  sanitizeAdminPanelPinInput,
  verifyAdminPanelPin,
} from './services/adminPanelPin';
import {
  FEEDBACK_FEATURE_UNAVAILABLE_MESSAGE,
  GLOBAL_FEEDBACK_DISABLED_MESSAGE,
  isFeedbackFeatureUnavailableError,
  isGlobalFeedbackDisabledError,
  publishGlobalFeedbackEnabled,
  submitFeedback,
} from './services/feedback';
import { hasSeenFeedbackTutorial, markFeedbackTutorialSeen } from './services/feedbackTutorial';
import FeedbackLauncher from './components/FeedbackLauncher';
import FeedbackTutorialOverlay, { type FeedbackTutorialTargetRect } from './components/FeedbackTutorialOverlay';
import FeedbackSubmissionModal from './components/FeedbackSubmissionModal';
import {
  getWorkflowUnreadCount,
  PROPOSAL_CLOUD_SYNC_EVENT,
  syncPendingDeletes,
  syncPendingProposals,
} from './services/proposalsAdapter';
import {
  confirmFranchiseMessage,
  isMessagingFeatureUnavailableError,
  listPendingMessages,
  MESSAGE_STATE_UPDATED_EVENT,
  type FranchiseMessage,
} from './services/messages';
import {
  clearMessageCheckState,
  markMessagesChecked,
  shouldCheckMessages,
} from './services/messageCheck';
import './App.css';

const ProposalForm = lazy(() => import('./pages/ProposalForm'));
const ProposalView = lazy(() => import('./pages/ProposalView'));
const WorkflowPage = lazy(() => import('./pages/WorkflowPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPanelPage = lazy(() => import('./pages/AdminPanelPage'));
const AdminPricingPage = lazy(() => import('./pages/AdminPricingPage'));
const AdminNotesPage = lazy(() => import('./pages/AdminNotesPage'));
const MasterPage = lazy(() => import('./pages/MasterPage'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const ContractPrintPreviewPage = lazy(() => import('./pages/ContractPrintPreviewPage'));

type PendingSessionTakeover = {
  session: UserSession;
};

const WORKFLOW_UNREAD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function readFeedbackLauncherRect(element: HTMLButtonElement | null): FeedbackTutorialTargetRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function RouteLoading() {
  return (
    <div className="app">
      <div style={{ padding: '2rem' }}>Loading...</div>
    </div>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  useKeyboardNavigation();
  useGlobalModalScrollLock();
  const [updateStatus, setUpdateStatus] = useState<'downloading' | 'ready' | 'error' | null>(null);
  const [updateError, setUpdateError] = useState<string>('');
  const [session, setSession] = useState<UserSession | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showAdminSettings, setShowAdminSettings] = useState(false);
  const [showChangelogPrompt, setShowChangelogPrompt] = useState(false);
  const [cloudIssue, setCloudIssue] = useState<CloudConnectionIssue>(null);
  const [masterImpersonation, setMasterImpersonation] = useState<MasterImpersonation | null>(() => readMasterImpersonation());
  const [pendingSessionTakeover, setPendingSessionTakeover] = useState<PendingSessionTakeover | null>(null);
  const [pendingSessionTakeoverError, setPendingSessionTakeoverError] = useState('');
  const [pendingSessionTakeoverLoading, setPendingSessionTakeoverLoading] = useState(false);
  const [showLoggedOutElsewhereNotice, setShowLoggedOutElsewhereNotice] = useState(() => shouldShowRemoteSignoutNotice());
  const [showSessionEndedNotice, setShowSessionEndedNotice] = useState(false);
  const [adminPanelPin, setAdminPanelPin] = useState('');
  const [adminPanelPinError, setAdminPanelPinError] = useState('');
  const [adminPanelPinLoading, setAdminPanelPinLoading] = useState(false);
  const [adminPanelPinPrompt, setAdminPanelPinPrompt] = useState<{
    isOpen: boolean;
    targetPath: string | null;
    cancelDestination: string | null;
  }>({
    isOpen: false,
    targetPath: null,
    cancelDestination: null,
  });
  const [adminPanelAccessFranchiseId, setAdminPanelAccessFranchiseId] = useState<string | null>(null);
  const [adminPanelLockoutUntil, setAdminPanelLockoutUntil] = useState<number | null>(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackError, setFeedbackError] = useState('');
  const [feedbackAvailable, setFeedbackAvailable] = useState(true);
  const [feedbackTutorialSeen, setFeedbackTutorialSeen] = useState(true);
  const [feedbackInboxOpen, setFeedbackInboxOpen] = useState(false);
  const [feedbackInboxLoading, setFeedbackInboxLoading] = useState(false);
  const [feedbackLauncherRect, setFeedbackLauncherRect] = useState<FeedbackTutorialTargetRect | null>(null);
  const [workflowUnreadCount, setWorkflowUnreadCount] = useState(0);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [pendingMessages, setPendingMessages] = useState<FranchiseMessage[]>([]);
  const [messagePromptReady, setMessagePromptReady] = useState(true);
  const adminPanelPinVerificationInFlightRef = useRef(false);
  const forcingRemoteLogoutRef = useRef(false);
  const expectedLocalSignOutRef = useRef(false);
  const expectedLocalSignOutTimeoutRef = useRef<number | null>(null);
  const sessionRef = useRef<UserSession | null>(null);
  const feedbackLauncherRef = useRef<HTMLButtonElement | null>(null);
  const openAdminSettingsAfterPinRef = useRef(false);
  const messageCheckInFlightRef = useRef(false);
  const messageCheckRequestRef = useRef(0);
  const messagePromptTimerRef = useRef<number | null>(null);
  const initiallyCheckedMessageUserRef = useRef<string | null>(null);
  const appVersion = getCurrentAppVersion();
  const displayAppVersion = formatFranchiseAppVersion(appVersion);
  const { feedbackEnabled: globalFeedbackEnabled, isLoading: globalFeedbackEnabledLoading } =
    useGlobalFeedbackEnabled({ poll: Boolean(session) });

  const loadPricingForFranchise = useCallback(async (franchiseId: string) => {
    try {
      await setActiveFranchiseId(franchiseId);
    } catch (error) {
      console.warn('Unable to load pricing for franchise', franchiseId, error);
    }
  }, []);

  const resetSignedOutUiState = useCallback(() => {
    clearSession();
    clearMasterImpersonation();
    setSession(null);
    setShowLogin(true);
    setShowPasswordReset(false);
    setShowProfileSettings(false);
    setShowAdminSettings(false);
    setShowChangelogPrompt(false);
    setMessageUnreadCount(0);
    setPendingMessages([]);
    setMessagePromptReady(true);
    clearMessageCheckState();
    initiallyCheckedMessageUserRef.current = null;
    messageCheckInFlightRef.current = false;
    messageCheckRequestRef.current += 1;
    if (messagePromptTimerRef.current) {
      window.clearTimeout(messagePromptTimerRef.current);
      messagePromptTimerRef.current = null;
    }
    setMasterImpersonation(null);
    setPendingSessionTakeover(null);
    setPendingSessionTakeoverError('');
    setPendingSessionTakeoverLoading(false);
    setAdminPanelAccessFranchiseId(null);
    setAdminPanelLockoutUntil(null);
    setAdminPanelPin('');
    setAdminPanelPinError('');
    setAdminPanelPinLoading(false);
    setAdminPanelPinPrompt({ isOpen: false, targetPath: null, cancelDestination: null });
    openAdminSettingsAfterPinRef.current = false;
  }, []);

  const markExpectedLocalSignOut = useCallback(() => {
    expectedLocalSignOutRef.current = true;
    if (expectedLocalSignOutTimeoutRef.current) {
      window.clearTimeout(expectedLocalSignOutTimeoutRef.current);
    }
    expectedLocalSignOutTimeoutRef.current = window.setTimeout(() => {
      expectedLocalSignOutRef.current = false;
      expectedLocalSignOutTimeoutRef.current = null;
    }, 5000);
  }, []);

  const applySessionUiState = useCallback(
    async (
      nextSession: UserSession,
      options?: {
        passwordResetRequired?: boolean;
        navigateHome?: boolean;
      }
    ) => {
      clearRemoteSignoutNotice();
      setShowLoggedOutElsewhereNotice(false);
      setShowSessionEndedNotice(false);
      setPendingSessionTakeover(null);
      setPendingSessionTakeoverError('');
      setPendingSessionTakeoverLoading(false);
      setSession(nextSession);
      setShowLogin(false);
      setShowPasswordReset(Boolean(options?.passwordResetRequired));
      const normalizedRole = (nextSession.role || '').toLowerCase();
      if (normalizedRole === 'master') {
        setMasterImpersonation(readMasterImpersonation());
      } else {
        clearMasterImpersonation();
        setMasterImpersonation(null);
      }
      if (options?.navigateHome) {
        navigate('/', { replace: true });
      }
      const targetId =
        (normalizedRole === 'master' ? readMasterImpersonation()?.franchiseId : null) ||
        nextSession.franchiseId ||
        DEFAULT_FRANCHISE_ID;
      await loadPricingForFranchise(targetId);
    },
    [loadPricingForFranchise, navigate]
  );

  useEffect(() => {
    recordAppLaunch(appVersion);
  }, [appVersion]);

  useEffect(() => {
    if (!session?.userId || session.isTestAccount) return;
    void reportCurrentUserAppVersion({
      userId: session.userId,
      version: appVersion,
    });
  }, [appVersion, session?.isTestAccount, session?.userId]);

  useEffect(() => {
    if (!session?.userId || !window.electron?.checkForUpdates) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const isMasterAccount = String(session.role || '').toLowerCase() === 'master';
          const assignment = isMasterAccount
            ? null
            : await loadFranchiseReleaseAssignment(session.franchiseId);
          if (cancelled || assignment?.updateEnabled === false || assignment?.releaseChannel === 'paused') return;
          const channel = getUpdateChannel(session.role, session.franchiseCode);
          if (!channel) {
            console.warn('Update check skipped because the franchise release channel is unavailable.');
            return;
          }
          await window.electron.checkForUpdates({ channel });
        } catch (error) {
          if (!cancelled) console.warn('Unable to start the franchise update check:', error);
        }
      })();
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session?.franchiseCode, session?.franchiseId, session?.role, session?.userId]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session?.userId) {
      setFeedbackTutorialSeen(true);
      return;
    }
    setFeedbackTutorialSeen(hasSeenFeedbackTutorial(session.userId));
  }, [session?.userId]);

  useEffect(() => {
    return subscribeToMasterImpersonationUpdates((nextImpersonation) => {
      setMasterImpersonation(nextImpersonation);
    });
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') return;
      const shouldShowNotice = !expectedLocalSignOutRef.current && Boolean(sessionRef.current?.userId);
      const shouldShowRemoteLogoutNotice =
        shouldShowNotice && (forcingRemoteLogoutRef.current || shouldShowRemoteSignoutNotice());
      const shouldShowSessionEndedMessage = shouldShowNotice && !shouldShowRemoteLogoutNotice;
      if (expectedLocalSignOutTimeoutRef.current) {
        window.clearTimeout(expectedLocalSignOutTimeoutRef.current);
        expectedLocalSignOutTimeoutRef.current = null;
      }
      expectedLocalSignOutRef.current = false;

      window.setTimeout(() => {
        if (shouldShowRemoteLogoutNotice) {
          markRemoteSignoutNotice();
          setShowLoggedOutElsewhereNotice(true);
          setShowSessionEndedNotice(false);
        } else if (shouldShowSessionEndedMessage) {
          clearRemoteSignoutNotice();
          setShowLoggedOutElsewhereNotice(false);
          setShowSessionEndedNotice(true);
        }
        resetSignedOutUiState();
      }, 0);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [resetSignedOutUiState]);

  useEffect(() => {
    // Restore session from Supabase Auth if possible
    let cancelled = false;
    const restoreSession = async () => {
      const savedSession = readSession();
      const hadSavedSession = Boolean(savedSession?.userId);
      try {
        const restored = await loadSessionFromSupabase();
        if (cancelled) return;
        if (restored.status === 'restored' || restored.status === 'unverified') {
          void applySessionUiState(restored.session, {
            passwordResetRequired: restored.passwordResetRequired,
          });
          return;
        }

        if (hadSavedSession && restored.reason === 'displaced') {
          markRemoteSignoutNotice();
          setShowLoggedOutElsewhereNotice(true);
          setShowSessionEndedNotice(false);
        } else if (hadSavedSession) {
          clearRemoteSignoutNotice();
          setShowLoggedOutElsewhereNotice(false);
          setShowSessionEndedNotice(true);
        } else {
          clearRemoteSignoutNotice();
          setShowLoggedOutElsewhereNotice(false);
          setShowSessionEndedNotice(false);
        }
        markExpectedLocalSignOut();
        void signOut();
        resetSignedOutUiState();
      } catch (error) {
        console.warn('Unable to restore saved session:', error);
        if (savedSession?.userId) {
          void applySessionUiState(savedSession, {
            passwordResetRequired: Boolean(savedSession.passwordResetRequired),
          });
          return;
        }
        clearRemoteSignoutNotice();
        setShowLoggedOutElsewhereNotice(false);
        setShowSessionEndedNotice(false);
        resetSignedOutUiState();
      }
    };

    void restoreSession();

    // Listen for proposals opened from file system
    if (window.electron && window.electron.onOpenProposal) {
      window.electron.onOpenProposal((proposal: any) => {
        // Navigate to the proposal view page
        navigate(`/proposal/view/${proposal.proposalNumber}`);
      });
    }

    // Listen for update events
    if (window.electron) {
      window.electron.onUpdateAvailable(() => {
        setUpdateStatus('downloading');
      });

      window.electron.onUpdateDownloaded(() => {
        setUpdateStatus('ready');
      });

      window.electron.onUpdateError((error: string) => {
        console.error('Auto-update error:', error);
        setUpdateStatus('error');
        setUpdateError('Error checking for updates');
        // Clear error after 10 seconds
        setTimeout(() => setUpdateStatus(null), 10000);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [applySessionUiState, markExpectedLocalSignOut, navigate, resetSignedOutUiState]);

  const isMaster = (session?.role || '').toLowerCase() === 'master';
  const effectiveSession = (() => {
    if (!session) return null;
    if (!isMaster || !masterImpersonation) return session;
    return {
      ...session,
      franchiseId: masterImpersonation.franchiseId,
      franchiseName: masterImpersonation.franchiseName || session.franchiseName,
      franchiseCode: masterImpersonation.franchiseCode || session.franchiseCode,
      role: (masterImpersonation.actingRole || 'owner') as UserSession['role'],
    };
  })();
  const effectiveRole = (effectiveSession?.role || '').toLowerCase();
  const isAdmin = effectiveRole === 'admin' || effectiveRole === 'owner';
  const canAccessWorkflow =
    Boolean(effectiveSession?.franchiseId) &&
    (effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'bookkeeper');
  const isMasterActingAsOwner =
    isMaster &&
    Boolean(masterImpersonation?.franchiseId) &&
    (masterImpersonation?.actingRole || 'owner') === 'owner';

  const scheduleNextMessagePrompt = useCallback(() => {
    setMessagePromptReady(false);
    if (messagePromptTimerRef.current) window.clearTimeout(messagePromptTimerRef.current);
    messagePromptTimerRef.current = window.setTimeout(() => {
      setMessagePromptReady(true);
      messagePromptTimerRef.current = null;
    }, 1000);
  }, []);

  const refreshPendingMessages = useCallback(async (force = false) => {
    const userId = session?.userId;
    if (!userId || showLogin || showPasswordReset) return;
    if (messageCheckInFlightRef.current && !force) return;
    if (messageCheckInFlightRef.current && force) {
      messageCheckRequestRef.current += 1;
      messageCheckInFlightRef.current = false;
    }
    if (!force && !shouldCheckMessages(userId)) return;

    const requestId = ++messageCheckRequestRef.current;
    messageCheckInFlightRef.current = true;
    try {
      const pending = await listPendingMessages();
      if (requestId !== messageCheckRequestRef.current) return;
      setMessageUnreadCount(pending.total);
      setPendingMessages(pending.messages);
      markMessagesChecked(userId);
    } catch (error) {
      if (requestId !== messageCheckRequestRef.current) return;
      if (!isMessagingFeatureUnavailableError(error)) {
        console.warn('Unable to check for new messages:', error);
      }
    } finally {
      if (requestId === messageCheckRequestRef.current) {
        messageCheckInFlightRef.current = false;
      }
    }
  }, [session?.userId, showLogin, showPasswordReset]);

  useEffect(() => {
    const userId = session?.userId;
    if (!userId || showLogin || showPasswordReset) return;
    if (initiallyCheckedMessageUserRef.current === userId) return;
    initiallyCheckedMessageUserRef.current = userId;
    void refreshPendingMessages(true);
  }, [refreshPendingMessages, session?.userId, showLogin, showPasswordReset]);

  useEffect(() => {
    if (!session?.userId || showLogin || showPasswordReset) return;
    const refreshIfStale = () => void refreshPendingMessages(false);
    const handleVisible = () => {
      if (document.visibilityState !== 'hidden') refreshIfStale();
    };
    const handleMessageStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ reason?: string; messageId?: string }>).detail;
      const reason = detail?.reason;
      if (reason === 'sent') {
        clearMessageCheckState(session.userId);
        return;
      }
      if (reason === 'confirmed') {
        setMessageUnreadCount((current) => Math.max(0, current - 1));
        if (detail?.messageId) {
          setPendingMessages((current) => current.filter((entry) => entry.id !== detail.messageId));
        }
        clearMessageCheckState(session.userId);
      }
    };

    if (location.pathname === '/') refreshIfStale();
    window.addEventListener('focus', refreshIfStale);
    window.addEventListener('online', refreshIfStale);
    window.addEventListener(MESSAGE_STATE_UPDATED_EVENT, handleMessageStateUpdated);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.removeEventListener('focus', refreshIfStale);
      window.removeEventListener('online', refreshIfStale);
      window.removeEventListener(MESSAGE_STATE_UPDATED_EVENT, handleMessageStateUpdated);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [location.pathname, refreshPendingMessages, session?.userId, showLogin, showPasswordReset]);

  useEffect(() => () => {
    if (messagePromptTimerRef.current) window.clearTimeout(messagePromptTimerRef.current);
  }, []);
  const canSubmitFeedback =
    Boolean(session) &&
    session?.isTestAccount !== true &&
    feedbackAvailable &&
    globalFeedbackEnabled &&
    !globalFeedbackEnabledLoading &&
    Boolean(effectiveSession?.franchiseId) &&
    (!isMaster || Boolean(masterImpersonation?.franchiseId));
  const isContractPrintPreviewRoute = location.pathname === '/contract-print-preview';

  useEffect(() => {
    const franchiseId = effectiveSession?.franchiseId;
    let cancelled = false;
    if (!franchiseId) {
      applyFranchiseConfigurationToDocument(null);
      return;
    }
    const handleConfiguration = (event: Event) => {
      const record = (event as CustomEvent<LoadedFranchiseConfiguration>).detail;
      if (record?.franchiseId === franchiseId) applyFranchiseConfigurationToDocument(record);
    };
    window.addEventListener('submerge:franchise-configuration', handleConfiguration);
    void loadFranchiseConfiguration(franchiseId)
      .then((record) => {
        if (!cancelled) applyFranchiseConfigurationToDocument(record);
      });
    return () => {
      cancelled = true;
      window.removeEventListener('submerge:franchise-configuration', handleConfiguration);
    };
  }, [effectiveSession?.franchiseId]);

  const isProposalBuilderRoute =
    location.pathname === '/proposal/new' || location.pathname.startsWith('/proposal/edit/');
  const isProposalSummaryRoute = location.pathname.startsWith('/proposal/view/');
  const adminPanelRequiresPin =
    isAdmin &&
    Boolean(effectiveSession?.franchiseId) &&
    !isMasterActingAsOwner &&
    effectiveSession?.isTestAccount !== true;
  const { displayName } = useFranchiseAppName(effectiveSession?.franchiseId ?? null);

  useEffect(() => {
    if (effectiveSession?.franchiseId) {
      void loadPricingForFranchise(effectiveSession.franchiseId);
    }
  }, [effectiveSession?.franchiseId, loadPricingForFranchise]);

  useEffect(() => {
    if (!canAccessWorkflow || !effectiveSession?.franchiseId || !effectiveSession?.userId) {
      setWorkflowUnreadCount(0);
      return;
    }

    let cancelled = false;
    let requestInFlight = false;
    const activeFranchiseId = effectiveSession.franchiseId;
    const activeUserId = effectiveSession.userId;

    const loadWorkflowUnreadCount = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const nextCount = await getWorkflowUnreadCount(activeFranchiseId, activeUserId);
        if (cancelled) return;
        setWorkflowUnreadCount(nextCount);
      } catch (error) {
        if (!cancelled) {
          console.warn('Unable to load workflow unread count:', error);
        }
      } finally {
        requestInFlight = false;
      }
    };

    void loadWorkflowUnreadCount();
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void loadWorkflowUnreadCount();
    }, WORKFLOW_UNREAD_REFRESH_INTERVAL_MS);
    const handleRefresh = () => {
      void loadWorkflowUnreadCount();
    };
    const handleVisible = () => {
      if (document.visibilityState !== 'hidden') void loadWorkflowUnreadCount();
    };
    window.addEventListener('focus', handleRefresh);
    window.addEventListener('online', handleRefresh);
    window.addEventListener(PROPOSAL_CLOUD_SYNC_EVENT, handleRefresh);
    document.addEventListener('visibilitychange', handleVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('online', handleRefresh);
      window.removeEventListener(PROPOSAL_CLOUD_SYNC_EVENT, handleRefresh);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [canAccessWorkflow, effectiveSession?.franchiseId, effectiveSession?.userId]);

  useEffect(() => {
    const environmentLabel = String(import.meta.env.VITE_SUBMERGE_ENVIRONMENT || '')
      .trim()
      .toUpperCase();
    const environmentSuffix = environmentLabel ? ` [${environmentLabel}]` : '';
    document.title = `${displayName} Proposal Builder${environmentSuffix}`;
  }, [displayName]);

  useEffect(() => {
    const appSessionId = session?.appSessionId;
    const appSessionLeaseToken = session?.appSessionLeaseToken;
    if (!appSessionId || !appSessionLeaseToken || showLogin) return;

    let cancelled = false;
    let inFlight = false;

    const verifyActiveSession = async () => {
      if (cancelled || inFlight || forcingRemoteLogoutRef.current) return;
      inFlight = true;
      try {
        const result = await heartbeatUserAppSession({
          appSessionId,
          appSessionLeaseToken,
        });
        if (!cancelled && result.status === 'displaced') {
          forcingRemoteLogoutRef.current = true;
          markRemoteSignoutNotice();
          setShowLoggedOutElsewhereNotice(true);
          try {
            await signOut();
          } catch (error) {
            console.warn('Unable to sign out displaced session:', error);
          } finally {
            resetSignedOutUiState();
            forcingRemoteLogoutRef.current = false;
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Unable to verify active app session:', error);
        }
      } finally {
        inFlight = false;
      }
    };

    const handleFocusCheck = () => {
      if (document.visibilityState === 'hidden') return;
      void verifyActiveSession();
    };

    void verifyActiveSession();
    const intervalId = window.setInterval(() => {
      void verifyActiveSession();
    }, APP_SESSION_HEARTBEAT_INTERVAL_MS);

    window.addEventListener('focus', handleFocusCheck);
    window.addEventListener('online', handleFocusCheck);
    document.addEventListener('visibilitychange', handleFocusCheck);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusCheck);
      window.removeEventListener('online', handleFocusCheck);
      document.removeEventListener('visibilitychange', handleFocusCheck);
    };
  }, [resetSignedOutUiState, session?.appSessionId, session?.appSessionLeaseToken, showLogin]);

  const handleInstallUpdate = () => {
    if (window.electron) {
      window.electron.installUpdate();
    }
  };

  const handleLogin = async ({
    email,
    password,
    franchiseCode,
  }: {
    email: string;
    password: string;
    franchiseCode?: string;
  }) => {
    assertLoginAllowed(email, franchiseCode);
    try {
      const result = await signInWithEmail({ email, password, franchiseCode });
      clearLoginAttempts(email, franchiseCode);
      if (result.status === 'conflict') {
        setPendingSessionTakeover({
          session: result.session,
        });
        setPendingSessionTakeoverError('');
        setPendingSessionTakeoverLoading(false);
        return;
      }

      await applySessionUiState(result.session, {
        passwordResetRequired: result.passwordResetRequired,
        navigateHome: true,
      });
    } catch (error) {
      recordLoginFailure(email, franchiseCode);
      throw error;
    }
  };

  const handleConfirmPendingSessionTakeover = useCallback(async () => {
    if (!pendingSessionTakeover) return;
    try {
      setPendingSessionTakeoverLoading(true);
      setPendingSessionTakeoverError('');
      const result = await confirmSessionTakeover(pendingSessionTakeover.session);
      await applySessionUiState(result.session, {
        passwordResetRequired: result.passwordResetRequired,
        navigateHome: true,
      });
    } catch (error: any) {
      setPendingSessionTakeoverError(error?.message || 'Unable to take over the existing session.');
      setPendingSessionTakeoverLoading(false);
    }
  }, [applySessionUiState, pendingSessionTakeover]);

  const handleCancelPendingSessionTakeover = useCallback(async () => {
    setPendingSessionTakeover(null);
    setPendingSessionTakeoverError('');
    setPendingSessionTakeoverLoading(false);
    setShowSessionEndedNotice(false);
    try {
      markExpectedLocalSignOut();
      await signOut();
    } catch (error) {
      console.warn('Unable to cancel pending session takeover:', error);
    } finally {
      resetSignedOutUiState();
    }
  }, [resetSignedOutUiState]);

  const handleLogout = async () => {
    clearRemoteSignoutNotice();
    setShowLoggedOutElsewhereNotice(false);
    setShowSessionEndedNotice(false);
    setShowProfileSettings(false);
    // Unmount authenticated pages before clearing the token so their listeners
    // cannot issue requests with a session that is in the process of ending.
    setShowLogin(true);
    try {
      markExpectedLocalSignOut();
      await signOut();
    } finally {
      resetSignedOutUiState();
    }
  };

  const handleActAsFranchise = useCallback(
    async (franchise: MasterFranchise) => {
      if (!franchise?.id) return;
      const next: MasterImpersonation = {
        franchiseId: franchise.id,
        franchiseName: franchise.name || undefined,
        franchiseCode: franchise.franchiseCode || undefined,
        actingRole: 'owner',
        startedAt: new Date().toISOString(),
      };
      saveMasterImpersonation(next);
      setMasterImpersonation(next);
      await loadPricingForFranchise(next.franchiseId);
      navigate('/', { replace: true });
    },
    [loadPricingForFranchise, navigate]
  );

  const handleStopActing = useCallback(async () => {
    clearMasterImpersonation();
    setMasterImpersonation(null);
    const targetId = session?.franchiseId || DEFAULT_FRANCHISE_ID;
    await loadPricingForFranchise(targetId);
    navigate('/master', { replace: true });
  }, [loadPricingForFranchise, navigate, session?.franchiseId]);

  const handleMasterFranchiseUpdated = useCallback((franchise: MasterFranchise) => {
    if (!franchise?.id) return;
    setMasterImpersonation((current) => {
      if (!current || current.franchiseId !== franchise.id) return current;
      const next: MasterImpersonation = {
        ...current,
        franchiseName: franchise.name || undefined,
        franchiseCode: franchise.franchiseCode || undefined,
      };
      saveMasterImpersonation(next);
      return next;
    });
  }, []);

  const handlePasswordReset = async (newPassword: string) => {
    await completePasswordReset(newPassword);
    const updated = updateSession({ passwordResetRequired: false });
    if (updated) {
      setSession(updated);
    }
    setShowPasswordReset(false);
  };

  const handleProfileSessionUpdate = useCallback(
    (partial: Partial<Pick<UserSession, 'userName' | 'userEmail'>>) => {
      setSession((current) => {
        if (!current) return current;
        updateSession(partial);
        return { ...current, ...partial };
      });
    },
    []
  );

  const handleCloseChangelogPrompt = useCallback(() => {
    acknowledgeChangelog(appVersion);
    setShowChangelogPrompt(false);
    scheduleNextMessagePrompt();
  }, [appVersion, scheduleNextMessagePrompt]);

  const handleConfirmPendingMessage = useCallback(async (message: FranchiseMessage) => {
    await confirmFranchiseMessage(message.id);
    setPendingMessages((current) => current.filter((entry) => entry.id !== message.id));
    scheduleNextMessagePrompt();
  }, [scheduleNextMessagePrompt]);

  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    let cancelled = false;
    let cloudWasUnavailable = false;

    const updateCloudStatus = async (forceRefresh = false) => {
      const reachability = await getSupabaseReachability(forceRefresh);
      if (cancelled) return;
      if (!reachability.reachable && (reachability.reason === 'no-internet' || reachability.reason === 'server-issue')) {
        cloudWasUnavailable = true;
        setCloudIssue(reachability.reason);
      } else {
        setCloudIssue(null);
        if (cloudWasUnavailable) {
          cloudWasUnavailable = false;
          await Promise.allSettled([syncPendingProposals(), syncPendingDeletes()]);
          if (!cancelled) window.dispatchEvent(new Event(PROPOSAL_CLOUD_SYNC_EVENT));
        }
      }
    };

    const handleOffline = () => {
      cloudWasUnavailable = true;
      setCloudIssue('no-internet');
    };
    const handleOnline = () => void updateCloudStatus(true);

    void updateCloudStatus(true);
    const intervalId = window.setInterval(() => {
      void updateCloudStatus(true);
    }, 15000);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const isOffline = cloudIssue === 'no-internet' || cloudIssue === 'server-issue';
  const showOfflineGate = isOffline && !session;
  const showTestModeBanner = !isContractPrintPreviewRoute && effectiveSession?.isTestAccount === true;

  // Show navigation bar on main pages, hide it on proposal form/view pages
  const showNavigation =
    Boolean(session) &&
    !showLogin &&
    !location.pathname.startsWith('/proposal/') &&
    !isContractPrintPreviewRoute;
  const isAdminPanelUnlocked = adminPanelAccessFranchiseId === (effectiveSession?.franchiseId || null);
  const canRenderAdminPanel = isAdmin && (!adminPanelRequiresPin || isAdminPanelUnlocked);
  const isAdminPanelLocked = Boolean(adminPanelLockoutUntil && adminPanelLockoutUntil > Date.now());
  const isAdminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const actingLabel = isMaster && masterImpersonation
    ? masterImpersonation.franchiseName && masterImpersonation.franchiseCode
      ? `${masterImpersonation.franchiseName} (${masterImpersonation.franchiseCode})`
      : masterImpersonation.franchiseName ||
        masterImpersonation.franchiseCode ||
        masterImpersonation.franchiseId
    : null;
  const shouldShowFeedbackTutorial =
    location.pathname === '/' &&
    canSubmitFeedback &&
    Boolean(session?.userId) &&
    !feedbackTutorialSeen &&
    !showFeedbackModal &&
    !showChangelogPrompt &&
    pendingMessages.length === 0 &&
    !feedbackInboxLoading &&
    !feedbackInboxOpen &&
    !showOfflineGate &&
    Boolean(feedbackLauncherRect);

  useEffect(() => {
    if (showChangelogPrompt) return;
    if (!effectiveSession || showLogin || showPasswordReset) return;
    if (!['owner', 'admin', 'bookkeeper', 'designer'].includes(effectiveRole)) return;
    if (!hasPendingChangelog(appVersion)) return;

    setShowChangelogPrompt(true);
  }, [appVersion, effectiveRole, effectiveSession, showChangelogPrompt, showLogin, showPasswordReset]);

  const openAdminPanelPrompt = useCallback(
    (options?: { targetPath?: string | null; cancelDestination?: string | null }) => {
      if (!adminPanelRequiresPin) return;
      const franchiseId = effectiveSession?.franchiseId;
      const lockout = franchiseId ? getAdminPanelPinLockout(franchiseId) : null;
      setAdminPanelPin('');
      setAdminPanelLockoutUntil(lockout?.lockedUntil ?? null);
      setAdminPanelPinError(
        adminPanelPinLoading ? '' : lockout?.locked ? ADMIN_PANEL_PIN_LOCKOUT_MESSAGE : ''
      );
      setAdminPanelPinPrompt({
        isOpen: true,
        targetPath: options?.targetPath ?? '/admin',
        cancelDestination: options?.cancelDestination ?? null,
      });
    },
    [adminPanelPinLoading, adminPanelRequiresPin, effectiveSession?.franchiseId]
  );

  const handleAdminPanelTabClick = useCallback(
    (event: ReactMouseEvent<HTMLAnchorElement>) => {
      if (!adminPanelRequiresPin || isAdminPanelUnlocked) return;
      event.preventDefault();
      openAdminPanelPrompt({ targetPath: '/admin', cancelDestination: null });
    },
    [adminPanelRequiresPin, isAdminPanelUnlocked, openAdminPanelPrompt]
  );

  const handleAdminSettingsClick = useCallback(() => {
    if (!isAdmin) return;
    if (!adminPanelRequiresPin || isAdminPanelUnlocked) {
      setShowAdminSettings(true);
      return;
    }
    openAdminSettingsAfterPinRef.current = true;
    openAdminPanelPrompt({ targetPath: null, cancelDestination: null });
  }, [adminPanelRequiresPin, isAdmin, isAdminPanelUnlocked, openAdminPanelPrompt]);

  const closeAdminPanelPrompt = useCallback(() => {
    const cancelDestination = adminPanelPinPrompt.cancelDestination;
    setAdminPanelPin('');
    setAdminPanelPinLoading(false);
    setAdminPanelPinError((current) => (current === ADMIN_PANEL_PIN_LOCKOUT_MESSAGE ? current : ''));
    setAdminPanelPinPrompt({ isOpen: false, targetPath: null, cancelDestination: null });
    openAdminSettingsAfterPinRef.current = false;
    if (cancelDestination) {
      navigate(cancelDestination, { replace: true });
    }
  }, [adminPanelPinPrompt.cancelDestination, navigate]);

  const dismissFeedbackTutorial = useCallback(() => {
    const userId = session?.userId;
    if (!userId) return;
    markFeedbackTutorialSeen(userId);
    setFeedbackTutorialSeen(true);
  }, [session?.userId]);

  const handleOpenFeedbackModal = useCallback(() => {
    if (!canSubmitFeedback) return;
    if (shouldShowFeedbackTutorial) {
      dismissFeedbackTutorial();
    }
    setFeedbackError('');
    setShowFeedbackModal(true);
  }, [canSubmitFeedback, dismissFeedbackTutorial, shouldShowFeedbackTutorial]);

  const handleCloseFeedbackModal = useCallback(() => {
    if (feedbackSubmitting) return;
    setShowFeedbackModal(false);
    setFeedbackError('');
    setFeedbackMessage('');
  }, [feedbackSubmitting]);

  const handleSubmitFeedback = useCallback(async () => {
    const franchiseId = effectiveSession?.franchiseId;
    const trimmedMessage = feedbackMessage.trim();
    if (!franchiseId) {
      setFeedbackError('A franchise is required to submit feedback.');
      return;
    }
    if (!trimmedMessage) {
      setFeedbackError('Please enter a feedback message before sending.');
      return;
    }

    setFeedbackSubmitting(true);
    setFeedbackError('');
    try {
      await submitFeedback({
        franchiseId,
        message: trimmedMessage,
        appVersion,
        effectiveRole: effectiveRole || null,
      });
      setShowFeedbackModal(false);
      setFeedbackMessage('');
      showToast({ type: 'success', message: 'Feedback submitted.' });
    } catch (error: any) {
      if (isFeedbackFeatureUnavailableError(error)) {
        setFeedbackAvailable(false);
        showToast({ type: 'error', message: FEEDBACK_FEATURE_UNAVAILABLE_MESSAGE });
        return;
      }
      if (isGlobalFeedbackDisabledError(error)) {
        publishGlobalFeedbackEnabled(false);
        setShowFeedbackModal(false);
        setFeedbackMessage('');
        setFeedbackError('');
        showToast({ type: 'error', message: GLOBAL_FEEDBACK_DISABLED_MESSAGE });
        return;
      }
      console.error('Failed to submit feedback:', error);
      setFeedbackError(error?.message || 'Unable to submit feedback.');
    } finally {
      setFeedbackSubmitting(false);
    }
  }, [appVersion, effectiveRole, effectiveSession?.franchiseId, feedbackMessage, showToast]);

  const submitAdminPanelPin = useCallback(async () => {
    const franchiseId = effectiveSession?.franchiseId;
    if (!franchiseId) return;
    if (adminPanelPinLoading || adminPanelPinVerificationInFlightRef.current) return;

    const lockout = getAdminPanelPinLockout(franchiseId);
    if (lockout.locked) {
      setAdminPanelPin('');
      setAdminPanelLockoutUntil(lockout.lockedUntil ?? null);
      setAdminPanelPinError(ADMIN_PANEL_PIN_LOCKOUT_MESSAGE);
      return;
    }

    const normalizedPin = sanitizeAdminPanelPinInput(adminPanelPin);
    if (normalizedPin.length !== ADMIN_PANEL_PIN_LENGTH) {
      setAdminPanelPinError(`Enter ${ADMIN_PANEL_PIN_LENGTH} digits.`);
      return;
    }

    adminPanelPinVerificationInFlightRef.current = true;
    setAdminPanelPinLoading(true);
    setAdminPanelPinError('');
    let pinIsValid = false;
    try {
      pinIsValid = await verifyAdminPanelPin(franchiseId, normalizedPin);
    } catch (error) {
      console.error('Unable to verify Admin Panel PIN:', error);
      setAdminPanelPinError('Unable to verify PIN. Check your connection and try again.');
      adminPanelPinVerificationInFlightRef.current = false;
      setAdminPanelPinLoading(false);
      return;
    }
    adminPanelPinVerificationInFlightRef.current = false;
    setAdminPanelPinLoading(false);

    if (!pinIsValid) {
      const failedAttempt = recordFailedAdminPanelPinAttempt(franchiseId);
      setAdminPanelPin('');
      setAdminPanelLockoutUntil(failedAttempt.lockedUntil ?? null);
      setAdminPanelPinError(failedAttempt.locked ? ADMIN_PANEL_PIN_LOCKOUT_MESSAGE : 'Incorrect PIN.');
      return;
    }

    clearAdminPanelPinFailures(franchiseId);
    const targetPath = adminPanelPinPrompt.targetPath;
    const shouldOpenAdminSettings = openAdminSettingsAfterPinRef.current;
    openAdminSettingsAfterPinRef.current = false;
    setAdminPanelAccessFranchiseId(franchiseId);
    setAdminPanelLockoutUntil(null);
    setAdminPanelPin('');
    setAdminPanelPinError('');
    setAdminPanelPinPrompt({ isOpen: false, targetPath: null, cancelDestination: null });
    if (shouldOpenAdminSettings) {
      setShowAdminSettings(true);
    } else if (targetPath) {
      navigate(targetPath);
    }
  }, [
    adminPanelPin,
    adminPanelPinLoading,
    adminPanelPinPrompt.targetPath,
    effectiveSession?.franchiseId,
    navigate,
  ]);

  useEffect(() => {
    setAdminPanelAccessFranchiseId(null);
    setAdminPanelLockoutUntil(null);
    setAdminPanelPin('');
    setAdminPanelPinError('');
    setAdminPanelPinLoading(false);
    setShowAdminSettings(false);
    openAdminSettingsAfterPinRef.current = false;
    setAdminPanelPinPrompt((current) => (current.isOpen ? { isOpen: false, targetPath: null, cancelDestination: null } : current));
  }, [effectiveSession?.userId, effectiveSession?.franchiseId]);

  useEffect(() => {
    if (!adminPanelLockoutUntil) return;
    const remainingMs = adminPanelLockoutUntil - Date.now();
    if (remainingMs <= 0) {
      setAdminPanelLockoutUntil(null);
      setAdminPanelPinError((current) => (current === ADMIN_PANEL_PIN_LOCKOUT_MESSAGE ? '' : current));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setAdminPanelLockoutUntil(null);
      setAdminPanelPinError((current) => (current === ADMIN_PANEL_PIN_LOCKOUT_MESSAGE ? '' : current));
    }, remainingMs + 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [adminPanelLockoutUntil]);

  useEffect(() => {
    if (!adminPanelPinPrompt.isOpen || isAdminPanelLocked || adminPanelPinLoading) return;
    if (adminPanelPin.length !== ADMIN_PANEL_PIN_LENGTH) return;
    void submitAdminPanelPin();
  }, [adminPanelPin, adminPanelPinLoading, adminPanelPinPrompt.isOpen, isAdminPanelLocked, submitAdminPanelPin]);

  useEffect(() => {
    if (!isAdminRoute) return;
    if (!adminPanelRequiresPin || isAdminPanelUnlocked || adminPanelPinPrompt.isOpen) return;
    openAdminPanelPrompt({ targetPath: null, cancelDestination: '/' });
  }, [adminPanelPinPrompt.isOpen, adminPanelRequiresPin, isAdminPanelUnlocked, isAdminRoute, openAdminPanelPrompt]);

  useEffect(() => {
    if (canSubmitFeedback) return;
    setShowFeedbackModal(false);
    setFeedbackMessage('');
    setFeedbackError('');
    setFeedbackSubmitting(false);
    setFeedbackLauncherRect(null);
  }, [canSubmitFeedback]);

  useEffect(() => {
    if (location.pathname === '/') return;
    setFeedbackInboxOpen(false);
    setFeedbackInboxLoading(false);
  }, [location.pathname]);

  useEffect(() => {
    if (location.pathname === '/' && session?.userId) {
      setFeedbackInboxLoading(true);
      return;
    }
    setFeedbackInboxLoading(false);
  }, [location.pathname, session?.userId]);

  useEffect(() => {
    if (!canSubmitFeedback || location.pathname !== '/') {
      setFeedbackLauncherRect(null);
      return;
    }

    const syncRect = () => {
      setFeedbackLauncherRect(readFeedbackLauncherRect(feedbackLauncherRef.current));
    };

    const animationFrame = window.requestAnimationFrame(syncRect);
    const handleResize = () => syncRect();
    window.addEventListener('resize', handleResize);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
    };
  }, [canSubmitFeedback, effectiveSession?.franchiseId, location.pathname, updateStatus]);

  return (
    <div className={`app${showTestModeBanner ? ' app--test-mode' : ''}${showNavigation ? ' app--with-navigation' : ''}`}>
      {showTestModeBanner && (
        <div className="app-test-mode-banner" role="status">
          TEST MODE · {effectiveSession.franchiseName || effectiveSession.franchiseCode || 'Franchise'} ·{' '}
          {String(effectiveSession.role || 'designer').toUpperCase()} · Live franchise settings are read-only
        </div>
      )}
      {showNavigation && (
        <NavigationBar
          userName={session?.userName || session?.userEmail || 'User'}
          onLogout={session ? handleLogout : undefined}
          onProfileSettings={session ? () => setShowProfileSettings(true) : undefined}
          isAdmin={isAdmin}
          isMaster={isMaster}
          franchiseId={effectiveSession?.franchiseId}
          showWorkflowTab={canAccessWorkflow}
          workflowUnreadCount={workflowUnreadCount}
          messageUnreadCount={messageUnreadCount}
          onAdminPanelClick={handleAdminPanelTabClick}
          onAdminSettings={isAdmin ? handleAdminSettingsClick : undefined}
          isAdminSettingsOpen={showAdminSettings}
          showFeedback={canSubmitFeedback && !isProposalBuilderRoute}
          onFeedback={handleOpenFeedbackModal}
          feedbackLauncherRef={feedbackLauncherRef}
          actingLabel={actingLabel}
          onStopActing={actingLabel ? handleStopActing : undefined}
          appVersion={displayAppVersion}
        />
      )}
      <div className="app-route-shell">
        {(isContractPrintPreviewRoute || (session && !showLogin)) && (
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route
                path="/"
                element={
                  <HomePage
                    session={effectiveSession}
                    onFeedbackInboxLoadingChange={setFeedbackInboxLoading}
                    onFeedbackInboxVisibilityChange={setFeedbackInboxOpen}
                  />
                }
              />
          <Route path="/messages" element={<MessagesPage session={session} />} />
          <Route
            path="/admin"
            element={
              canRenderAdminPanel ? (
                <AdminPanelPage
                  onOpenPricingData={(modelId) =>
                    navigate(modelId ? `/admin/pricing?model=${encodeURIComponent(modelId)}` : '/admin/pricing')
                  }
                  session={effectiveSession}
                />
              ) : <Navigate to="/" replace />
            }
          />
          <Route
            path="/admin/messages"
            element={
              canRenderAdminPanel ? (
                <MessagesPage
                  session={effectiveSession}
                  adminMode
                  masterActingAsOwner={isMasterActingAsOwner}
                />
              ) : <Navigate to="/" replace />
            }
          />
          <Route
            path="/admin/pricing"
            element={
              canRenderAdminPanel ? (
                <AdminPricingPage
                  franchiseId={effectiveSession?.franchiseId}
                  franchiseCode={effectiveSession?.franchiseCode}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/admin/notes"
            element={
              canRenderAdminPanel ? (
                <AdminNotesPage
                  franchiseId={effectiveSession?.franchiseId}
                  franchiseName={effectiveSession?.franchiseName}
                  franchiseCode={effectiveSession?.franchiseCode}
                />
              ) : <Navigate to="/" replace />
            }
          />
          <Route path="/workflow" element={canAccessWorkflow ? <WorkflowPage session={effectiveSession} cloudIssue={cloudIssue} /> : <Navigate to="/" replace />} />
          <Route path="/workflow/:proposalNumber" element={canAccessWorkflow ? <WorkflowPage session={effectiveSession} cloudIssue={cloudIssue} /> : <Navigate to="/" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/master"
            element={
              isMaster ? <MasterPage
                session={session}
                onActAsFranchise={handleActAsFranchise}
                actingFranchiseId={masterImpersonation?.franchiseId}
                onFranchiseUpdated={handleMasterFranchiseUpdated}
              /> : <Navigate to="/" replace />
            }
          />
          <Route
            path="/proposal/new"
            element={
              <ProposalForm
                key="new"
                cloudIssue={cloudIssue}
                showFeedbackButton={canSubmitFeedback}
                onOpenFeedback={handleOpenFeedbackModal}
              />
            }
          />
          <Route
            path="/proposal/edit/:proposalNumber"
            element={
              <ProposalForm
                key={location.pathname}
                cloudIssue={cloudIssue}
                showFeedbackButton={canSubmitFeedback}
                onOpenFeedback={handleOpenFeedbackModal}
              />
            }
          />
          <Route path="/proposal/view/:proposalNumber" element={<ProposalView cloudIssue={cloudIssue} />} />
              <Route path="/contract-print-preview" element={<ContractPrintPreviewPage />} />
            </Routes>
          </Suspense>
        )}
      </div>
      {!showNavigation && !isContractPrintPreviewRoute && (actingLabel || location.pathname === '/') && (
        <div className="app-bottom-left-meta">
          {actingLabel && (
            <div className="app-acting">
              <span className="app-acting-text">Acting as Owner for Franchise {actingLabel}</span>
              <button className="app-acting-btn" type="button" onClick={handleStopActing}>
                Stop Acting
              </button>
            </div>
          )}
          {location.pathname === '/' && (
            <div className="app-version">v{displayAppVersion}</div>
          )}
        </div>
      )}
      {!isContractPrintPreviewRoute && canSubmitFeedback && !isProposalBuilderRoute && !showNavigation && (
        <div
          className={`app-feedback-anchor${updateStatus ? ' has-update' : ''}${effectiveSession && location.pathname === '/' ? ' has-session-meta' : ''}`}
        >
          <FeedbackLauncher ref={feedbackLauncherRef} onClick={handleOpenFeedbackModal} />
        </div>
      )}
      {!isContractPrintPreviewRoute && shouldShowFeedbackTutorial && feedbackLauncherRect && (
        <FeedbackTutorialOverlay
          isOpen={shouldShowFeedbackTutorial}
          targetRect={feedbackLauncherRect}
          onDismiss={dismissFeedbackTutorial}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <UpdateNotification
          status={updateStatus}
          onInstall={handleInstallUpdate}
          errorMessage={updateError}
        />
      )}
      {!isContractPrintPreviewRoute && !isProposalBuilderRoute && !isProposalSummaryRoute && (
        <CloudConnectionNotice
          reason={cloudIssue}
          placement="bottom"
        />
      )}
      {!isContractPrintPreviewRoute && showOfflineGate && (
        <div className="offline-gate" role="alert" aria-live="assertive" data-scroll-lock="true">
          <div className="offline-gate-card">
            <div className="offline-gate-title">
              {cloudIssue === 'server-issue' ? 'Cloud Unavailable' : 'No Internet Connection'}
            </div>
            <div className="offline-gate-subtitle">
              {cloudIssue === 'server-issue'
                ? 'Cloud connection cannot be reached. Reconnect to continue.'
                : 'Reconnect to continue using Submerge.'}
            </div>
          </div>
        </div>
      )}
      {!isContractPrintPreviewRoute && effectiveSession && location.pathname === '/' && (
        <div className="app-session-meta">
          <div className="app-session-line">
            {effectiveSession.franchiseName || effectiveSession.franchiseCode || effectiveSession.franchiseId || 'Unknown'}
          </div>
        </div>
      )}
      {!isContractPrintPreviewRoute && showLogin && (
        <LoginModal onSubmit={handleLogin} existingEmail={session?.userEmail} />
      )}
      {!isContractPrintPreviewRoute && showPasswordReset && (
        <PasswordResetModal onSubmit={handlePasswordReset} onLogout={handleLogout} />
      )}
      {!isContractPrintPreviewRoute && (
        <UserProfileModal
          isOpen={showProfileSettings}
          session={session}
          onClose={() => setShowProfileSettings(false)}
          onLogout={handleLogout}
          onSessionUpdated={handleProfileSessionUpdate}
        />
      )}
      {!isContractPrintPreviewRoute && isAdmin && (
        <AdminSettingsModal
          isOpen={showAdminSettings}
          onClose={() => setShowAdminSettings(false)}
          onEditProposalNotes={() => navigate('/admin/notes')}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <ConfirmDialog
          open={Boolean(pendingSessionTakeover)}
          title="Account logged in on another device"
          message="Account logged in on another device. Sign out the other device?"
          confirmLabel="Yes, log me in"
          cancelLabel="No, go back"
          errorMessage={pendingSessionTakeoverError}
          isLoading={pendingSessionTakeoverLoading}
          onConfirm={() => {
            void handleConfirmPendingSessionTakeover();
          }}
          onCancel={() => {
            void handleCancelPendingSessionTakeover();
          }}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <ConfirmDialog
          open={showLoggedOutElsewhereNotice}
          title="Account logged in elsewhere"
          message="Account logged in elsewhere."
          confirmLabel="OK"
          hideCancel
          onConfirm={() => {
            clearRemoteSignoutNotice();
            setShowLoggedOutElsewhereNotice(false);
          }}
          onCancel={() => {
            clearRemoteSignoutNotice();
            setShowLoggedOutElsewhereNotice(false);
          }}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <ConfirmDialog
          open={showSessionEndedNotice}
          title="Session ended"
          message="Your session ended. Please sign in again."
          confirmLabel="OK"
          hideCancel
          onConfirm={() => {
            setShowSessionEndedNotice(false);
          }}
          onCancel={() => {
            setShowSessionEndedNotice(false);
          }}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <AdminPinModal
          isOpen={adminPanelPinPrompt.isOpen}
          pin={adminPanelPin}
          error={adminPanelPinError}
          statusMessage={adminPanelPinLoading ? 'Verifying PIN...' : ''}
          isDisabled={isAdminPanelLocked || adminPanelPinLoading}
          onPinChange={(value) => {
            setAdminPanelPin(value);
            if (adminPanelPinError && adminPanelPinError !== ADMIN_PANEL_PIN_LOCKOUT_MESSAGE) {
              setAdminPanelPinError('');
            }
          }}
          onSubmit={submitAdminPanelPin}
          onClose={closeAdminPanelPrompt}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <ChangelogModal
          isOpen={showChangelogPrompt}
          initialTab={effectiveRole === 'owner' || effectiveRole === 'admin' ? 'global' : 'franchise'}
          onClose={handleCloseChangelogPrompt}
        />
      )}
      {!isContractPrintPreviewRoute && !showLogin && !showPasswordReset && !showChangelogPrompt && messagePromptReady && (
        <MessageDetailModal
          message={pendingMessages[0] || null}
          mode="delivery"
          onConfirm={handleConfirmPendingMessage}
        />
      )}
      {!isContractPrintPreviewRoute && (
        <FeedbackSubmissionModal
          isOpen={showFeedbackModal}
          message={feedbackMessage}
          isSubmitting={feedbackSubmitting}
          errorMessage={feedbackError}
          onMessageChange={setFeedbackMessage}
          onSubmit={() => {
            void handleSubmitFeedback();
          }}
          onClose={handleCloseFeedbackModal}
        />
      )}
    </div>
  );
}

function App() {
  return (
    <Router>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </Router>
  );
}

export default App;
