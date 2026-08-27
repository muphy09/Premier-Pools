import { getDefaultProposal } from '../../src/utils/proposalDefaults';
import {
  deleteProposal,
  listDashboardProposals,
  saveProposal,
} from '../../src/services/proposalsAdapter';

const sessionStorageKey = 'submerge-user-session';
const masterImpersonationKey = 'submerge-master-impersonation';

const masterSession = {
  userId: 'playwright-master-user',
  userEmail: 'master@playwright.invalid',
  userName: 'Playwright Master',
  franchiseId: 'default',
  role: 'master' as const,
};

let persistedProposal: any = null;
let dashboardProposals: any[] = [];

(window as any).electron = {
  saveProposal: async (proposal: any) => {
    persistedProposal = JSON.parse(JSON.stringify(proposal));
    return 1;
  },
  deleteProposal: async () => undefined,
  getAllProposals: async () => JSON.parse(JSON.stringify(dashboardProposals)),
  getAllProposalsWithReport: async () => ({
    entries: dashboardProposals.map((proposal) => ({
      proposal: JSON.parse(JSON.stringify(proposal)),
    })),
    issues: [],
  }),
};

function setMasterSession(actingAsOwner = false) {
  localStorage.setItem(sessionStorageKey, JSON.stringify(masterSession));
  if (actingAsOwner) {
    localStorage.setItem(
      masterImpersonationKey,
      JSON.stringify({
        franchiseId: 'playwright-franchise',
        franchiseName: 'Playwright Franchise',
        franchiseCode: 'PWTEST',
        actingRole: 'owner',
      })
    );
  } else {
    localStorage.removeItem(masterImpersonationKey);
  }
  persistedProposal = null;
}

function setFranchiseSession(role: 'owner' | 'admin' | 'bookkeeper' | 'designer') {
  localStorage.setItem(sessionStorageKey, JSON.stringify({
    userId: `playwright-${role}-user`,
    userEmail: `${role}@playwright.invalid`,
    userName: `Playwright ${role}`,
    franchiseId: 'playwright-franchise',
    role,
  }));
  localStorage.removeItem(masterImpersonationKey);
}

function buildProposal(options: {
  ownerId: string;
  franchiseId?: string;
  proposalNumber?: string;
}) {
  const defaults = getDefaultProposal();
  return {
    ...defaults,
    proposalNumber: options.proposalNumber || 'PROP-PW-MASTER-AUTH',
    franchiseId: options.franchiseId || 'default',
    designerAuthUserId: options.ownerId,
    designerName:
      options.ownerId === masterSession.userId
        ? masterSession.userName
        : 'Playwright Franchise Designer',
    designerRole: options.ownerId === masterSession.userId ? 'master' : 'designer',
    status: 'draft',
    pricingModelFranchiseId: 'borrowed-pricing-franchise',
    versionId: 'original',
    versionName: 'Original Version',
    isOriginalVersion: true,
    activeVersionId: 'original',
    versions: [],
  };
}

async function capture(action: () => Promise<unknown>) {
  try {
    const result = await action();
    return {
      ok: true,
      result: JSON.parse(JSON.stringify(result)),
      persistedProposal,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      persistedProposal,
    };
  }
}

(window as any).masterProposalAuthorizationFixture = {
  saveOwnProposal: async () => {
    setMasterSession(false);
    return capture(() => saveProposal(buildProposal({ ownerId: masterSession.userId }) as any));
  },
  saveFranchiseOwnedProposal: async () => {
    setMasterSession(false);
    return capture(() =>
      saveProposal(buildProposal({ ownerId: 'playwright-franchise-designer' }) as any)
    );
  },
  saveWhileActingAsOwner: async () => {
    setMasterSession(true);
    return capture(() => saveProposal(buildProposal({ ownerId: masterSession.userId }) as any));
  },
  deleteOutsideMasterArea: async () => {
    setMasterSession(false);
    return capture(() => deleteProposal('PROP-PW-FRANCHISE-DELETE', 'playwright-franchise'));
  },
  listDashboardForDirectMaster: async () => {
    setMasterSession(false);
    dashboardProposals = [
      {
        ...buildProposal({ ownerId: masterSession.userId, proposalNumber: 'PROP-PW-MASTER-OWN' }),
        designerName: 'Legacy Master Name',
      },
      {
        ...buildProposal({ ownerId: 'playwright-other-master', proposalNumber: 'PROP-PW-MASTER-OTHER' }),
        designerName: masterSession.userName,
      },
    ];
    return (await listDashboardProposals('default')).map((proposal) => proposal.proposalNumber);
  },
  listDashboardForFranchiseRole: async (role: 'owner' | 'admin' | 'bookkeeper' | 'designer') => {
    setFranchiseSession(role);
    dashboardProposals = [
      {
        ...buildProposal({ ownerId: `playwright-${role}-user`, franchiseId: 'playwright-franchise', proposalNumber: `PROP-PW-${role}-OWN` }),
        designerName: `Legacy ${role} Name`,
        designerRole: role,
      },
      {
        ...buildProposal({ ownerId: 'playwright-other-user', franchiseId: 'playwright-franchise', proposalNumber: `PROP-PW-${role}-OTHER` }),
        designerName: `Playwright ${role}`,
      },
    ];
    return (await listDashboardProposals('playwright-franchise')).map((proposal) => proposal.proposalNumber);
  },
};

document.querySelector('#fixture-status')!.textContent = 'Ready';
