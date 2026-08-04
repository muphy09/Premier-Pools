import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Proposal } from '../types/proposal-new';
import { useToast } from '../components/Toast';
import FeedbackReplyInboxModal from '../components/FeedbackReplyInboxModal';
import DashboardProposalsPanel from '../components/DashboardProposalsPanel';
import RecentActivity from '../components/RecentActivity';
import './HomePage.css';
import {
  deleteProposal,
  getLocalProposalLoadIssues,
  listDashboardProposals,
  PROPOSAL_CLOUD_SYNC_EVENT,
  type LocalProposalLoadIssue,
} from '../services/proposalsAdapter';
import { isCloudOnlyRenderRecoveryEnabled } from '../services/renderRecovery';
import { getSessionFranchiseId, isMasterActingAsOwnerSession, type UserSession } from '../services/session';
import { recordRecentProposalOpen } from '../services/recentProposalActivity';
import {
  acknowledgeFeedbackReply,
  isFeedbackFeatureUnavailableError,
  listPendingFeedbackReplies,
  type FeedbackEntry,
} from '../services/feedback';

type HomePageProps = {
  session?: UserSession | null;
  onFeedbackInboxVisibilityChange?: (isOpen: boolean) => void;
  onFeedbackInboxLoadingChange?: (isLoading: boolean) => void;
};

function HomePage({
  session,
  onFeedbackInboxVisibilityChange,
  onFeedbackInboxLoadingChange,
}: HomePageProps) {
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalLoadIssues, setProposalLoadIssues] = useState<LocalProposalLoadIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingFeedbackReplies, setPendingFeedbackReplies] = useState<FeedbackEntry[]>([]);
  const [feedbackInboxOpen, setFeedbackInboxOpen] = useState(false);
  const [acknowledgingFeedbackId, setAcknowledgingFeedbackId] = useState<string | null>(null);
  const { showToast } = useToast();
  const sessionFranchiseId = session?.franchiseId || getSessionFranchiseId();
  const isProposalEditingRestricted = isMasterActingAsOwnerSession();
  const proposalEditingRestrictedReason =
    'Master accounts acting as owner can view proposals but cannot create or edit them.';

  const loadProposals = useCallback(async () => {
    if (!session?.userId) {
      setProposals([]);
      setProposalLoadIssues([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // The dashboard only displays saved proposal metadata. Repricing every
      // proposal here made launch time grow with proposal history and repeated
      // the revision checks already performed when a proposal is opened.
      const loadedProposals = await listDashboardProposals(sessionFranchiseId);
      setProposals(loadedProposals);
      setProposalLoadIssues(getLocalProposalLoadIssues());
    } catch (error) {
      console.error('Failed to load proposals:', error);
    } finally {
      setLoading(false);
    }
  }, [session?.userId, sessionFranchiseId]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals]);

  useEffect(() => {
    const handleOnline = () => void loadProposals();
    window.addEventListener('online', handleOnline);
    window.addEventListener(PROPOSAL_CLOUD_SYNC_EVENT, handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(PROPOSAL_CLOUD_SYNC_EVENT, handleOnline);
    };
  }, [loadProposals]);

  const loadFeedbackReplies = useCallback(async () => {
    if (!session?.userId) {
      setPendingFeedbackReplies([]);
      setFeedbackInboxOpen(false);
      onFeedbackInboxLoadingChange?.(false);
      return;
    }
    onFeedbackInboxLoadingChange?.(true);
    try {
      const rows = await listPendingFeedbackReplies(session.userId, 20);
      setPendingFeedbackReplies(rows);
    } catch (error) {
      console.error('Failed to load feedback replies:', error);
    } finally {
      onFeedbackInboxLoadingChange?.(false);
    }
  }, [onFeedbackInboxLoadingChange, session?.userId]);

  useEffect(() => {
    setFeedbackInboxOpen(pendingFeedbackReplies.length > 0);
  }, [pendingFeedbackReplies.length]);

  useEffect(() => {
    onFeedbackInboxVisibilityChange?.(feedbackInboxOpen);
  }, [feedbackInboxOpen, onFeedbackInboxVisibilityChange]);

  useEffect(() => {
    return () => {
      onFeedbackInboxVisibilityChange?.(false);
      onFeedbackInboxLoadingChange?.(false);
    };
  }, [onFeedbackInboxLoadingChange, onFeedbackInboxVisibilityChange]);

  useEffect(() => {
    void loadFeedbackReplies();
    if (!session?.userId) return;

    const intervalId = window.setInterval(() => {
      void loadFeedbackReplies();
    }, 30000);
    const handleOnline = () => void loadFeedbackReplies();

    window.addEventListener('online', handleOnline);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [loadFeedbackReplies, session?.userId]);

  const handleAcknowledgeFeedback = useCallback(
    async (feedback: FeedbackEntry) => {
      setAcknowledgingFeedbackId(feedback.id);
      try {
        await acknowledgeFeedbackReply(feedback.id);
        setPendingFeedbackReplies((current) => current.filter((entry) => entry.id !== feedback.id));
      } catch (error) {
        if (!isFeedbackFeatureUnavailableError(error)) {
          console.error('Failed to acknowledge feedback reply:', error);
        }
        showToast({
          type: 'error',
          message:
            (error as any)?.message || 'Unable to acknowledge the feedback reply.',
        });
      } finally {
        setAcknowledgingFeedbackId(null);
      }
    },
    [showToast]
  );

  const handleNewProposal = () => {
    if (isProposalEditingRestricted) {
      showToast({
        type: 'warning',
        message: proposalEditingRestrictedReason,
      });
      return;
    }
    navigate('/proposal/new');
  };

  const handleOpenProposal = (proposalNumber: string) => {
    recordRecentProposalOpen(proposalNumber, {
      userId: session?.userId,
      franchiseId: sessionFranchiseId,
    });
    navigate(`/proposal/view/${proposalNumber}`);
  };

  const handleDeleteProposal = async (proposalNumber: string) => {
    if (isProposalEditingRestricted) {
      showToast({ type: 'warning', message: proposalEditingRestrictedReason });
      return;
    }
    try {
      await deleteProposal(proposalNumber, sessionFranchiseId);
      setProposals(prev => prev.filter(p => p.proposalNumber !== proposalNumber));
      showToast({ type: 'success', message: 'Proposal deleted.' });
    } catch (error) {
      console.error('Failed to delete proposal', error);
      showToast({ type: 'error', message: 'Failed to delete proposal. Please try again.' });
    }
  };

  return (
    <div className="dashboard-page">
      <RecentActivity
        proposals={proposals}
        loading={loading}
        userId={session?.userId}
        franchiseId={sessionFranchiseId}
        onOpenProposal={handleOpenProposal}
      />

      <div className="dashboard-content">
        <DashboardProposalsPanel
          proposals={proposals}
          loading={loading}
          onCreateProposal={handleNewProposal}
          onDeleteProposal={handleDeleteProposal}
          onOpenProposal={handleOpenProposal}
          disableCreateProposal={isProposalEditingRestricted}
          createProposalDisabledReason={proposalEditingRestrictedReason}
          disableDeleteProposal={isProposalEditingRestricted}
          viewerRole={session?.role}
          recoveryMode={isCloudOnlyRenderRecoveryEnabled()}
          recoveryIssues={proposalLoadIssues}
        />
      </div>
      <FeedbackReplyInboxModal
        isOpen={feedbackInboxOpen}
        entries={pendingFeedbackReplies}
        acknowledgingId={acknowledgingFeedbackId}
        onAcknowledge={(feedback) => {
          void handleAcknowledgeFeedback(feedback);
        }}
      />
    </div>
  );
}

export default HomePage;
