const fs = require('fs');
const path = require('path');

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

requireText(
  homePage,
  /setProposals\(await listDashboardProposals\(sessionFranchiseId\)\)/,
  'The designer dashboard no longer has a direct proposal-list render path.'
);
rejectText(
  homePage,
  /MasterPricingEngine|loadPricingSnapshotForExistingProposal|buildPricingRevisionComparison/,
  'The designer dashboard performs pricing work before rendering proposal metadata.'
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
  /getDerivedStateFromError[\s\S]{0,900}window\.location\.reload\(\)/,
  'The application recovery boundary is missing error capture or reload recovery.'
);
requireText(
  contractTemplates,
  /String\(rawState\)\.trim\(\)\.toUpperCase\(\)/,
  'Contract type rendering is not protected from legacy non-string state values.'
);

if (failures.length) {
  console.error('Dashboard load safety verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Dashboard load safety verification passed.');
