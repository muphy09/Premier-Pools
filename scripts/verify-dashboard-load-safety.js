const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const esbuild = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];

function requireText(content, pattern, message) {
  if (!pattern.test(content)) failures.push(message);
}

function rejectText(content, pattern, message) {
  if (pattern.test(content)) failures.push(message);
}

const homePage = read('src/pages/HomePage.tsx');
const adminPanel = read('src/pages/AdminPanelPage.tsx');
const main = read('src/main.tsx');
const errorBoundary = read('src/components/AppErrorBoundary.tsx');
const contractTemplates = read('src/services/contractTemplates.ts');
const proposalAdapter = read('src/services/proposalsAdapter.ts');
const feedbackService = read('src/services/feedback.ts');
const dashboardPanel = read('src/components/DashboardProposalsPanel.tsx');
const electronMain = read('main.js');
const preload = read('preload-script.js');

requireText(
  homePage,
  /loadedProposals = await listDashboardProposals\(sessionFranchiseId\)[\s\S]{0,180}setProposals\(loadedProposals\)[\s\S]{0,180}setProposalLoadIssues\(getLocalProposalLoadIssues\(\)\)/,
  'The designer dashboard no longer has a direct proposal-list render path.'
);
rejectText(
  homePage,
  /MasterPricingEngine|loadPricingSnapshotForExistingProposal|buildPricingRevisionComparison/,
  'The designer dashboard performs pricing work before rendering proposal metadata.'
);
requireText(
  homePage,
  /listPendingFeedbackReplies\(session\.userId,\s*20\)/,
  'The feedback reply inbox does not identify the signed-in submitter.'
);
requireText(
  feedbackService,
  /listPendingFeedbackReplies\([\s\S]{0,160}submitterAuthUserId[\s\S]{0,900}\.eq\('submitter_auth_user_id',\s*normalizedSubmitterAuthUserId\)[\s\S]{0,220}\.eq\('status',\s*'resolved'\)/,
  'Pending feedback replies are not restricted to the original submitter.'
);
requireText(
  feedbackService,
  /acknowledgeFeedbackReply[\s\S]{0,700}feedback response not found[\s\S]{0,100}return false/,
  'A stale feedback reply can still trap the dashboard behind an acknowledgment error.'
);
requireText(
  adminPanel,
  /setProposals\(\(await listProposalsRemote\(targetFranchiseId\)\) \|\| \[\]\)/,
  'The admin proposal list no longer renders directly from saved proposal snapshots.'
);
rejectText(
  adminPanel,
  /MasterPricingEngine|loadPricingSnapshotForExistingProposal|buildPricingRevisionComparison/,
  'The admin proposal list recalculates franchise history before rendering.'
);
requireText(
  main,
  /<AppErrorBoundary>[\s\S]{0,120}<App \/>[\s\S]{0,80}<\/AppErrorBoundary>/,
  'The application root is not protected by its render recovery boundary.'
);
requireText(
  errorBoundary,
  /getDerivedStateFromError[\s\S]{0,1200}enableCloudOnlyRenderRecovery\(\)[\s\S]{0,120}window\.location\.reload\(\)/,
  'The application recovery boundary is missing error capture or cloud-only reload recovery.'
);
requireText(
  contractTemplates,
  /typeof rawState === 'string'[\s\S]{0,100}rawState\.trim\(\)\.toUpperCase\(\)[\s\S]{0,80}DEFAULT_STATE/,
  'Contract type rendering is not protected from legacy non-string state values.'
);
requireText(
  proposalAdapter,
  /bypassedLocalProposals = isCloudOnlyRenderRecoveryEnabled\(\)[\s\S]{0,100}return isCloudOnlyRenderRecoveryEnabled\(\) \? \[\] : visibleRows/,
  'Cloud-only recovery does not bypass local proposal data.'
);
requireText(
  proposalAdapter,
  /flatMap\(\(entry:[\s\S]{0,500}Skipping an unreadable local proposal/,
  'One unreadable local proposal can still discard or crash the entire local collection.'
);
requireText(
  proposalAdapter,
  /getLocalProposalLoadIssues\(\): LocalProposalLoadIssue\[\]/,
  'Skipped local proposals are not exposed through a user-visible recovery report.'
);
requireText(
  proposalAdapter,
  /detectedIssues\.push\([\s\S]{0,300}reason: 'invalid_data'/,
  'Skipped local proposals are not retained in a user-visible recovery report.'
);
requireText(
  dashboardPanel,
  /dashboard-recovery-notice[\s\S]{0,1200}temporarily unavailable[\s\S]{0,500}getRecoveryIssueLabel/,
  'The dashboard does not identify temporarily unavailable local proposals.'
);
requireText(
  electronMain,
  /get-all-proposals-with-report[\s\S]{0,120}readAllProposalFilesWithReport/,
  'Unreadable local proposal files are not included in the Electron recovery report.'
);
requireText(
  preload,
  /getAllProposalsWithReport:[\s\S]{0,80}get-all-proposals-with-report/,
  'The renderer cannot request the local proposal recovery report.'
);

async function verifyMalformedDashboardRender() {
  const result = await esbuild.build({
    stdin: {
      contents: "export { default } from './src/components/DashboardProposalsPanel.tsx';",
      resolveDir: root,
      sourcefile: 'dashboard-load-safety-runtime.tsx',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['react', 'react-dom', 'react-dom/server'],
    loader: { '.css': 'empty' },
    define: {
      'import.meta.url': JSON.stringify(
        pathToFileURL(path.join(root, 'src/components/DashboardProposalsPanel.tsx')).href
      ),
    },
    logLevel: 'silent',
    write: false,
  });
  const bundledModule = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    require,
    bundledModule,
    bundledModule.exports
  );
  const DashboardProposalsPanel = bundledModule.exports.default;
  const malformedLegacyProposal = {
    proposalNumber: 'LOCAL-LEGACY-1',
    customerInfo: { customerName: { legacy: true }, state: { abbreviation: 'NC' } },
    poolSpecs: { poolType: 'gunite' },
    versions: [null],
    status: 'draft',
    pricingModelName: { legacy: true },
    pricingTierId: 'normal',
    createdDate: '2026-08-01T12:00:00.000Z',
    lastModified: { legacy: true },
  };
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    const html = renderToString(
      React.createElement(DashboardProposalsPanel, {
        proposals: [malformedLegacyProposal],
        loading: false,
        onCreateProposal() {},
        onDeleteProposal() {},
        onOpenProposal() {},
        viewerRole: 'designer',
        recoveryMode: true,
        recoveryIssues: [{
          proposalNumber: 'PROP-RECOVERY-17',
          customerName: 'Recovery Test Customer',
          reason: 'invalid_data',
        }],
      })
    );
    if (
      !html.includes('Untitled Proposal') ||
      !html.includes('Pricing Model') ||
      !html.includes('PROP-RECOVERY-17') ||
      !html.includes('temporarily unavailable')
    ) {
      throw new Error('Malformed dashboard values or recovery identifiers did not render safely.');
    }
  } finally {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
}

async function runVerification() {
  if (failures.length) {
    console.error('Dashboard load safety verification failed:');
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exit(1);
  }
  await verifyMalformedDashboardRender();
  console.log('Dashboard load safety verification passed.');
}

runVerification().catch((error) => {
  console.error(error);
  process.exit(1);
});
