const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const requireText = (content, pattern, description) => {
  if (!pattern.test(content)) failures.push(description);
};
const rejectText = (content, pattern, description) => {
  if (pattern.test(content)) failures.push(description);
};
const requireOccurrenceCount = (content, needle, expected, description) => {
  const actual = content.split(needle).length - 1;
  if (actual !== expected) failures.push(`${description} Expected ${expected}, found ${actual}.`);
};

const migration = read('supabase/migrations/202607150001_add_franchise_configuration_and_revisions.sql');
const roleMigration = read('supabase/migrations/202607170001_harden_role_permissions.sql');
const draftPrivacyMigration = read('supabase/migrations/202607170002_keep_drafts_creator_private.sql');
const adminSettingsMigration = read('supabase/migrations/202607170003_secure_owner_admin_settings.sql');
const masterDraftMigration = read('supabase/migrations/202607170004_claim_legacy_master_drafts.sql');
const ownershipBackfillMigration = read('supabase/migrations/202607170005_backfill_all_legacy_proposal_owners.sql');
const testAccountsMigration = read('supabase/migrations/202607170006_add_designated_test_accounts.sql');
const testWorkflowUpsertMigration = read('supabase/migrations/202607180001_allow_test_workflow_role_upserts.sql');
const masterProposalMutationMigration = read('supabase/migrations/20260825041352_restrict_master_proposal_mutations_to_own_rows.sql');
requireText(migration, /^begin;[\s\S]*commit;\s*$/im, 'Additive migration is not wrapped in an explicit transaction.');
requireText(roleMigration, /^begin;[\s\S]*commit;\s*$/im, 'Role migration is not wrapped in an explicit transaction.');
requireText(draftPrivacyMigration, /^begin;[\s\S]*commit;\s*$/im, 'Draft privacy migration is not wrapped in an explicit transaction.');
requireText(adminSettingsMigration, /^begin;[\s\S]*commit;\s*$/im, 'Admin Settings migration is not wrapped in an explicit transaction.');
requireText(masterDraftMigration, /^begin;[\s\S]*commit;\s*$/im, 'Master draft migration is not wrapped in an explicit transaction.');
requireText(ownershipBackfillMigration, /^begin;[\s\S]*commit;\s*$/im, 'Ownership backfill migration is not wrapped in an explicit transaction.');
requireText(testAccountsMigration, /^begin;[\s\S]*commit;\s*$/im, 'Testing-account migration is not wrapped in an explicit transaction.');
requireText(testWorkflowUpsertMigration, /^begin;[\s\S]*commit;\s*$/im, 'Testing workflow upsert migration is not wrapped in an explicit transaction.');
requireText(masterProposalMutationMigration, /^begin;[\s\S]*commit;\s*$/im, 'Master proposal mutation migration is not wrapped in an explicit transaction.');
const forbiddenMigrationChanges = [
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table[\s\S]{0,120}\bdrop\s+column\b/i,
];
for (const pattern of forbiddenMigrationChanges) {
  if (pattern.test(migration)) failures.push(`Additive migration contains forbidden operation: ${pattern}`);
  if (pattern.test(roleMigration)) failures.push(`Role migration contains forbidden operation: ${pattern}`);
  if (pattern.test(draftPrivacyMigration)) failures.push(`Draft privacy migration contains forbidden operation: ${pattern}`);
  if (pattern.test(adminSettingsMigration)) failures.push(`Admin Settings migration contains forbidden operation: ${pattern}`);
  if (pattern.test(masterDraftMigration)) failures.push(`Master draft migration contains forbidden operation: ${pattern}`);
  if (pattern.test(ownershipBackfillMigration)) failures.push(`Ownership backfill migration contains forbidden operation: ${pattern}`);
  if (pattern.test(testAccountsMigration)) failures.push(`Testing-account migration contains forbidden operation: ${pattern}`);
  if (pattern.test(masterProposalMutationMigration)) failures.push(`Master proposal mutation migration contains forbidden operation: ${pattern}`);
}

[
  ['creator-owned UPDATE path', /create policy "proposal_role_update"[\s\S]*current_user_owns_proposal/i],
  ['master exclusion from reviewer UPDATE path', /proposal_role_update[\s\S]*not public\.current_user_is_master\(\)[\s\S]*current_user_can_review_franchise/i],
  ['UPDATE result ownership check', /proposal_role_update[\s\S]*with check \([\s\S]*current_user_owns_proposal/i],
  ['creator-owned DELETE path', /create policy "proposal_role_delete"[\s\S]*current_user_owns_proposal/i],
  ['master exclusion from manager DELETE path', /proposal_role_delete[\s\S]*not public\.current_user_is_master\(\)[\s\S]*current_user_can_manage_franchise/i],
].forEach(([description, pattern]) => requireText(masterProposalMutationMigration, pattern, `Master proposal mutation migration is missing ${description}.`));

[
  ['test-account guard', /current_user_is_test_account\(\)/i],
  ['same-franchise guard', /current_user_belongs_to_franchise\(franchise_id\)/i],
  ['creator insert permission', /designer_auth_user_id\s*=\s*auth\.uid\(\)/i],
  ['owner and admin workflow upserts', /current_test_account_role\(\)\s+in\s+\('owner',\s*'admin'\)/i],
  ['submitted-only bookkeeper upserts', /current_test_account_role\(\)\s*=\s*'bookkeeper'[\s\S]*<>\s*'draft'/i],
].forEach(([description, pattern]) => requireText(testWorkflowUpsertMigration, pattern, `Testing workflow upsert migration is missing ${description}.`));

[
  ['separate testing-account table', /create table if not exists public\.app_test_accounts/i],
  ['isolated testing-proposal table', /create table if not exists public\.franchise_test_proposals/i],
  ['one testing identity per role', /role text not null unique check \(role in \('owner', 'admin', 'bookkeeper', 'designer'\)\)/i],
  ['read-only live franchise membership extension', /current_user_belongs_to_franchise[\s\S]*current_user_is_test_account/i],
  ['restrictive live-proposal exclusion', /create policy "test accounts cannot access live proposals"[\s\S]*as restrictive for all[\s\S]*not public\.current_user_is_test_account/i],
  ['production proposal-note mutation guard', /franchise proposal notes manage[\s\S]*current_user_can_manage_franchise/i],
  ['test proposal RLS', /create policy "test proposal role (select|insert|update|delete)"/i],
].forEach(([description, pattern]) => requireText(testAccountsMigration, pattern, `Testing-account migration is missing ${description}.`));

if ((testAccountsMigration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Testing-account migration has an unbalanced dollar-quoted function body.');
}

[
  ['immutable pricing revision table', /create table if not exists public\.franchise_pricing_model_revisions/i],
  ['configuration revision table', /create table if not exists public\.franchise_configuration_revisions/i],
  ['release assignment table', /create table if not exists public\.franchise_release_assignments/i],
  ['contract revision table', /create table if not exists public\.franchise_contract_template_revisions/i],
  ['pricing revision RPC', /create or replace function public\.save_pricing_model_revision/i],
  ['UUID-compatible pricing revision foreign key', /pricing_model_id\s+uuid\s+not null\s+references public\.franchise_pricing_models\(id\)/i],
  ['legacy proposal policy removal', /drop policy if exists "allow updates for franchise proposals" on public\.franchise_proposals/i],
  ['authenticated-only proposal table grants', /revoke select, insert, update, delete on public\.franchise_proposals from public, anon;[\s\S]{0,160}grant select, insert, update, delete on public\.franchise_proposals to authenticated;/i],
  ['configuration revision RPC', /create or replace function public\.publish_franchise_configuration/i],
  ['contract revision RPC', /create or replace function public\.publish_contract_template_revision/i],
  ['future-franchise initialization trigger', /create trigger initialize_new_franchise_foundation/i],
  ['private contract storage bucket', /'franchise-contract-templates',\s*'franchise-contract-templates',\s*false/i],
  ['authenticated RLS', /enable row level security/i],
].forEach(([description, pattern]) => requireText(migration, pattern, `Migration is missing ${description}.`));

if ((migration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Migration has an unbalanced dollar-quoted function body.');
}

[
  ['proposal ownership column', /add column if not exists designer_auth_user_id uuid/i],
  ['proposal ownership helper', /create or replace function public\.current_user_owns_proposal/i],
  ['bookkeeper review helper', /create or replace function public\.current_user_can_review_franchise/i],
  ['proposal role select policy', /create policy "proposal_role_select"/i],
  ['pricing-model role policy', /create policy "pricing_model_role_update"/i],
  ['user self-update policy removal', /drop policy if exists "franchise_users_self_update"/i],
  ['direct authenticated user updates revoked', /revoke insert, update, delete on public\.franchise_users from authenticated/i],
  ['guarded approval settings RPC', /create or replace function public\.update_franchise_user_approval_settings/i],
  ['guarded commission settings RPC', /create or replace function public\.update_franchise_user_commission_rates/i],
  ['guarded last-login RPC', /create or replace function public\.touch_current_user_last_login/i],
].forEach(([description, pattern]) => requireText(roleMigration, pattern, `Role migration is missing ${description}.`));

if ((roleMigration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Role migration has an unbalanced dollar-quoted function body.');
}

[
  ['creator-private proposal SELECT policy', /create policy "proposal_role_select"[\s\S]*current_user_owns_proposal[\s\S]*current_user_can_review_franchise[\s\S]*<> 'draft'/i],
  ['creator-only proposal INSERT policy', /create policy "proposal_role_insert"[\s\S]*with check \([\s\S]*current_user_owns_proposal/i],
  ['creator-private proposal UPDATE policy', /create policy "proposal_role_update"[\s\S]*using \([\s\S]*<> 'draft'[\s\S]*with check \([\s\S]*<> 'draft'/i],
  ['master cross-franchise ownership pin', /target_designer_auth_user_id = auth\.uid\(\)[\s\S]*lower\(profile\.role\) = 'master'/i],
].forEach(([description, pattern]) => requireText(draftPrivacyMigration, pattern, `Draft privacy migration is missing ${description}.`));

if ((draftPrivacyMigration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Draft privacy migration has an unbalanced dollar-quoted function body.');
}

[
  ['owner-only franchise helper', /create or replace function public\.current_user_is_owner_for_franchise/i],
  ['server-side PIN verification', /create or replace function public\.verify_franchise_admin_panel_pin/i],
  ['owner-only branding write RPC', /create or replace function public\.save_franchise_branding_owner_settings/i],
  ['owner-only franchise-code RPC', /create or replace function public\.save_franchise_code_owner_setting/i],
  ['anonymous branding grants revoked', /revoke all privileges on public\.franchise_branding from public, anon, authenticated/i],
  ['PIN omitted from branding column grant', /grant select \(\s*franchise_id,\s*logo_url,\s*app_name,\s*disable_signed_workflow,\s*updated_at,\s*updated_by\s*\) on public\.franchise_branding to authenticated/i],
  ['legacy public branding policy removal', /drop policy if exists "franchise_branding_read" on public\.franchise_branding/i],
].forEach(([description, pattern]) => requireText(adminSettingsMigration, pattern, `Admin Settings migration is missing ${description}.`));

if ((adminSettingsMigration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Admin Settings migration has an unbalanced dollar-quoted function body.');
}

[
  ['null-only legacy ownership guard', /target_designer_auth_user_id is null/i],
  ['master-stamped legacy draft guard', /target_proposal_json ->> 'designerRole'[\s\S]*= 'master'/i],
  ['active master identity match', /lower\(profile\.role\) = 'master'[\s\S]*profile\.auth_user_id = auth\.uid\(\)/i],
  ['unique master identity guard', /select count\(\*\)[\s\S]*lower\(candidate\.role\) = 'master'/i],
].forEach(([description, pattern]) => requireText(masterDraftMigration, pattern, `Master draft migration is missing ${description}.`));

if ((masterDraftMigration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Master draft migration has an unbalanced dollar-quoted function body.');
}

[
  ['unique master ownership backfill', /with master_matches[\s\S]*count\(distinct profile\.auth_user_id\)[\s\S]*ownership\.match_count = 1/i],
  ['same-franchise ownership backfill', /with franchise_matches[\s\S]*profile\.franchise_id = proposal\.franchise_id[\s\S]*ownership\.match_count = 1/i],
  ['ownership-column-only update', /set designer_auth_user_id = ownership\.auth_user_id/i],
].forEach(([description, pattern]) => requireText(ownershipBackfillMigration, pattern, `Ownership backfill migration is missing ${description}.`));

if ((ownershipBackfillMigration.match(/\$\$/g) || []).length % 2 !== 0) {
  failures.push('Ownership backfill migration has an unbalanced dollar-quoted function body.');
}

const tasks = JSON.parse(read('.vscode/tasks.json'));
const taskLabels = new Set((tasks.tasks || []).map((task) => task.label));
[
  'Test App',
  'Test App - Staging (Recommended)',
  'Test App - Production Migration (Isolated)',
  'Supabase - Login CLI',
  'Supabase - Deploy All Edge Functions to Staging',
  'Supabase - Deploy All Edge Functions to Production',
  'Release - One-Time Migration Bootstrap',
  'Release - PPAS West Only (5555)',
  'Release - PPAS East Only (9724)',
  'Release - Global Hotfix (Patch)',
  'Release - Global Minor (All Franchises)',
  'Release - Global Major (All Franchises)',
  'Release - Register New Franchise Channel',
  'Release - Selected Franchise Only',
].forEach((label) => {
  if (!taskLabels.has(label)) failures.push(`VS Code task is missing: ${label}`);
});

const releaseState = JSON.parse(read('release-state.json'));
for (const code of ['5555', '9724']) {
  if (!Number.isInteger(releaseState.franchises?.[code])) {
    failures.push(`release-state.json is missing franchise ${code}.`);
  }
}

const workflow = read('.github/workflows/release.yml');
requireText(workflow, /EP_PRE_RELEASE:/, 'Release workflow does not isolate channel tags as prereleases.');
requireText(workflow, /stage-update-assets\.js/, 'Release workflow does not stage manifest-matched asset names.');
requireText(workflow, /updates-\$channel/, 'Release workflow does not publish fixed per-franchise endpoints.');
requireText(workflow, /sourceManifest\s*=\s*Join-Path\s+\$output\s+"latest\.yml"/, 'Windows channel publishing does not use electron-builder\'s generated latest.yml manifest.');
requireText(workflow, /source_manifest="\$output\/latest-mac\.yml"/, 'macOS channel publishing does not use electron-builder\'s generated latest-mac.yml manifest.');

const main = read('main.js');
requireText(main, /provider:\s*'generic'/, 'Electron updater is not using isolated generic endpoints.');
requireText(main, /updates-\$\{requestedChannel\}/, 'Electron updater does not derive a fixed endpoint from the authenticated channel.');
requireText(main, /app\.setPath\('userData',\s*isolatedUserDataPath\)/, 'Staging does not use an isolated Electron userData directory.');
requireText(main, /DATA_PARTITION[\s\S]{0,180}app\.getPath\('userData'\),\s*'proposals'/, 'Staging proposal files are not isolated from production files.');
requireText(main, /readFranchiseReleaseNoteFiles[\s\S]*role === 'master'[\s\S]*franchiseCode[\s\S]*return \{ globalNotes, franchiseNotes, franchiseNoteGroups \}/, 'Patch notes are not filtered and separated by authenticated franchise.');

const preload = read('preload-script.js');
requireText(preload, /readChangelog:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\('read-changelog',\s*payload\)/, 'The changelog IPC bridge does not pass franchise context.');

const changelogModal = read('src/components/ChangelogModal.tsx');
requireText(changelogModal, /readChangelog\(\{[\s\S]*role:\s*sessionRole[\s\S]*franchiseCode:\s*getSessionFranchiseCode\(\)/, 'The Patch Notes screen does not request notes for the signed-in franchise.');
requireText(changelogModal, /role="tablist"[\s\S]*activeTab[\s\S]*franchiseTabLabel[\s\S]*Global/, 'The Patch Notes screen does not separate franchise and global notes into tabs.');
requireText(changelogModal, /franchiseNoteGroups[\s\S]*patch-notes-franchise-toggle[\s\S]*aria-expanded/, 'Master Patch Notes do not group franchise notes into dropdowns.');

const proposalHome = read('src/pages/HomePage.tsx');
const proposalForm = read('src/pages/ProposalForm.tsx');
const proposalView = read('src/pages/ProposalView.tsx');
const proposalViewCss = read('src/pages/ProposalView.css');
const pricingDataModal = read('src/components/PricingDataModal.tsx');
const pricingDataModalCss = read('src/components/PricingDataModal.css');
const pricingDataDefaults = read('src/services/pricingData.ts');
const proposalDefaults = read('src/utils/proposalDefaults.ts');
const excavationSection = read('src/components/ExcavationSectionNew.tsx');
const interiorFinishSection = read('src/components/InteriorFinishSectionNew.tsx');
const equipmentSection = read('src/components/EquipmentSectionNew.tsx');
const pricingEngine = read('src/services/pricingEngine.ts');
const completePricingEngine = read('src/services/pricingEngineComplete.ts');
const masterPricingEngine = read('src/services/masterPricingEngine.ts');
const pricingDataStore = read('src/services/pricingDataStore.ts');
const franchiseScope = read('src/utils/franchiseScope.ts');
const excavationOptionQuantities = read('src/utils/excavationOptionQuantities.ts');
const masonryFacing = read('src/utils/masonryFacing.ts');
const proposalSelectionSanitizer = read('src/utils/proposalSelectionSanitizer.ts');
const proposalWorkflow = read('src/services/proposalWorkflow.ts');
const contractGenerator = read('src/services/contractGenerator.ts');
const warrantyUtils = read('src/utils/warranty.ts');
const costBreakdownDisplay = read('src/utils/costBreakdownDisplay.ts');
const franchiseConfiguration = read('src/services/franchiseConfiguration.ts');
const franchiseCapabilityHook = read('src/hooks/useFranchiseCapability.ts');
const proposalAdapter = read('src/services/proposalsAdapter.ts');
const authService = read('src/services/auth.ts');
const testAccountsPanel = read('src/components/TestAccountsPanel.tsx');
const manageTestAccountsFunction = read('supabase/functions/manage-test-accounts/index.ts');
for (const [name, content] of [
  ['Dashboard', proposalHome],
  ['Proposal Builder', proposalForm],
  ['Proposal View', proposalView],
]) {
  requireText(content, /isProposalEditingRestricted\s*=\s*isMasterActingAsOwnerSession\(\)/, `${name} does not enforce read-only master inspection mode.`);
  if (/isProposalEditingRestricted\s*=\s*false/.test(content)) {
    failures.push(`${name} hardcodes master inspection editing to enabled.`);
  }
}
requireText(proposalAdapter, /canAttemptProposalWrite[\s\S]{0,180}isMasterActingAsOwnerSession\(\)[\s\S]{0,40}return false/, 'Background proposal sync is not blocked for master inspection sessions.');
requireText(proposalAdapter, /canAttemptProposalWrite[\s\S]{0,260}isMasterSession\(\)[\s\S]{0,80}isMasterOwnedProposal/, 'Background proposal sync does not allow direct masters to sync only their own proposals.');
requireText(proposalAdapter, /export async function saveProposal[\s\S]{0,220}isMasterActingAsOwnerSession\(\)[\s\S]{0,100}MASTER_INSPECTION_READ_ONLY_MESSAGE/, 'Proposal saves are not blocked during master inspection.');
requireText(proposalAdapter, /export async function saveProposal[\s\S]{0,1500}assertMasterProposalMutationAllowed/, 'Proposal saves do not enforce master-area ownership.');
requireText(proposalAdapter, /export async function deleteProposal[\s\S]{0,220}isMasterActingAsOwnerSession\(\)[\s\S]{0,100}MASTER_INSPECTION_READ_ONLY_MESSAGE/, 'Proposal deletes are not blocked during master inspection.');
requireText(proposalAdapter, /export async function deleteProposal[\s\S]{0,1800}designer_auth_user_id[\s\S]{0,900}MASTER_PROPOSAL_OWNERSHIP_MESSAGE/, 'Proposal deletes do not enforce master-area ownership.');
requireText(proposalView, /previewOnly=\{isProposalEditingRestricted\}/, 'Contract revision prompts are not preview-only during master inspection.');
requireText(franchiseConfiguration, /splitCustomerCostWarranty\?:\s*boolean/, 'Franchise configuration is missing the customer-cost/warranty split capability.');
requireText(franchiseCapabilityHook, /isFranchiseCapabilityEnabled[\s\S]*subscribeToFranchiseConfigurationUpdates/, 'The franchise capability hook does not load and subscribe to franchise-scoped configuration.');
requireText(proposalView, /splitCustomerCostWarranty\s*\?\s*'cost'\s*:\s*'combined'/, 'Proposal summaries do not preserve the combined customer breakdown by default.');
requireText(proposalView, /splitCustomerCostWarranty\s*&&\s*\([\s\S]{0,300}warranty-tile/, 'The standalone warranty tile is not gated by franchise configuration.');
requireText(proposalView, /splitCustomerCostWarranty\s*&&\s*canViewCogsBreakdown[\s\S]{0,120}tiles-grid--two-column/, 'The four-card East COGS layout is not constrained to a two-column grid.');
requireText(proposalView, /startViewTransition[\s\S]{0,420}flushSync\(toggle\)/, 'The East COGS grid toggle does not use a smooth layout transition.');
requireText(proposalViewCss, /::view-transition-group\(proposal-customer-card\)[\s\S]{0,500}animation-duration:\s*180ms/, 'The proposal-card layout transition is missing its short animation timing.');
requireText(proposalView, /customerBreakdownMode\s*!==\s*'warranty'[\s\S]{0,600}BreakdownCostExportPageComponent[\s\S]{0,600}customerBreakdownMode\s*!==\s*'cost'[\s\S]{0,300}BreakdownWarrantyExportPagesComponent/, 'Customer cost and warranty exports are not independently composed.');
requireText(proposalView, /customerBreakdownMode\s*===\s*'warranty'[\s\S]{0,180}cloneRetailAdjustments\(targetVersion\.retailAdjustments\)[\s\S]{0,260}customerBreakdownMode\s*===\s*'cost'[\s\S]{0,180}cloneWarrantySections\(targetVersion\.warrantySections\)/, 'Independent customer breakdown saves do not preserve the untouched section.');
requireText(proposalAdapter, /TEST_PROPOSALS_TABLE\s*=\s*'franchise_test_proposals'[\s\S]{0,180}getProposalTableName\(\)[\s\S]{0,100}isTestSession\(\)\s*\?\s*TEST_PROPOSALS_TABLE/, 'Test sessions do not route proposals to the isolated table.');
requireText(proposalAdapter, /TEST-\$\{code\}-\$\{suffix\}/, 'Testing proposals do not receive an unmistakable proposal-number prefix.');
requireText(proposalAdapter, /isProposalNumberForCurrentMode[\s\S]*isTestSession\(\)\s*===\s*isTestProposalNumber/, 'Local proposal queues are not separated between testing and production modes.');
requireText(proposalAdapter, /for \(const proposal of pending\)[\s\S]{0,180}!isProposalNumberForCurrentMode\(proposal\.proposalNumber\)/, 'Pending proposal sync can cross testing and production modes.');
requireText(proposalAdapter, /for \(const record of pendingDeletes\)[\s\S]{0,180}!isProposalNumberForCurrentMode\(record\.proposalNumber\)/, 'Pending proposal deletes can cross testing and production modes.');
requireText(authService, /getTestAccountByAuthId[\s\S]*app_test_accounts/, 'Authentication does not resolve designated testing identities.');
requireText(authService, /buildTestSession[\s\S]*isTestAccount:\s*true/, 'Testing authentication does not mark the session as isolated.');
requireText(testAccountsPanel, /dtest[\s\S]*bktest[\s\S]*atest[\s\S]*otest/, 'Master testing-account controls are missing one or more designated roles.');
requireText(manageTestAccountsFunction, /getRequesterProfile[\s\S]*role[^\n]*master/, 'Testing-account management is not restricted to the master role.');
requireText(pricingDataModal, /title:\s*'Pool Specifications'[\s\S]{0,140}title:\s*'Additional Options'[\s\S]{0,180}title:\s*'Pool Specifications Additional Options'/, 'Pool Specification additional options are not grouped in their correctly named Admin pricing table.');
requireText(pricingDataModal, /title:\s*'Excavation'[\s\S]{0,4000}title:\s*'Additional Options'[\s\S]{0,180}title:\s*'Excavation Additional Options'/, 'Excavation additional options are not grouped in their correctly named Admin pricing table.');
requireText(pricingDataModal, /title:\s*'Interior Finish'[\s\S]{0,5000}title:\s*'Additional Options'[\s\S]{0,180}title:\s*'Interior Finish Additional Options'/, 'Interior Finish additional options are not grouped in their correctly named Admin pricing table.');
requireText(pricingDataModal, /<th scope="col">Additional Feature<\/th>[\s\S]{0,100}<th scope="col">Associated Cost<\/th>[\s\S]{0,100}<th scope="col">Enabled by Default\?<\/th>/, 'The Admin additional-feature table is missing its feature, cost, and default columns.');
requireText(pricingDataModal, /className="pricing-field__info"[\s\S]{0,100}data-tooltip=\{field\.tooltip\}/, 'Additional feature cost rows do not expose application guidance.');
requireText(pricingDataModal, /pricing-table pricing-table--browser pricing-scalar-table[\s\S]{0,2500}setSelectedAdditionalFeature/, 'Additional feature costs do not use the standard selectable Admin table pattern.');
requireText(pricingDataModal, /Edit Additional Feature[\s\S]{0,1500}Additional Feature cannot be renamed/, 'Additional feature rows do not populate the protected right-side details editor.');
requireText(pricingDataModal, /renderLabelText\('Enabled by Default\?'\)[\s\S]{0,1200}updateDefault\(true\)[\s\S]{0,800}updateDefault\(false\)/, 'The additional feature details editor cannot change the new-proposal default.');
requireText(pricingDataModalCss, /\.pricing-scalar-table\s*\{[\s\S]{0,80}min-width:\s*720px/, 'The Admin additional-feature table is missing its minimum readable width.');
requireText(pricingDataDefaults, /additionalFeatureDefaults:\s*\{[\s\S]{0,100}siltFence:\s*true[\s\S]{0,100}tanningShelf:\s*false[\s\S]{0,100}automaticCover:\s*false[\s\S]{0,100}gravelInstall:\s*true[\s\S]{0,100}dirtHaul:\s*true[\s\S]{0,100}soilSampleEngineer:\s*false[\s\S]{0,100}doubleCurtain:\s*false[\s\S]{0,100}additionalSitePrep:\s*false[\s\S]{0,100}tightAccessJob:\s*false[\s\S]{0,100}waterproofing:\s*false/, 'Additional option defaults do not preserve the current new-proposal behavior.');
requireText(proposalDefaults, /isAdditionalFeatureEnabled[\s\S]*hasSiltFence:[\s\S]*hasAutomaticCover:[\s\S]*hasAdditionalSitePrep:[\s\S]*hasDoubleCurtain:[\s\S]*hasWaterproofing:/, 'New proposal defaults are not driven by the active pricing model additional-feature settings.');
requireText(excavationSection, /hasDoubleCurtain\s*\?\?[\s\S]{0,100}doubleCurtainLength[\s\S]*hasAdditionalSitePrep\s*\?\?[\s\S]{0,100}additionalSitePrepHours/, 'Zero-quantity Excavation features cannot remain enabled by default.');
requireText(franchiseScope, /PPAS_EAST_FRANCHISE_CODE\s*=\s*'9724'/, 'PPAS East-only functionality is not pinned to franchise code 9724.');
requireText(pricingDataModal, /isPpasEast[\s\S]{0,1600}label:\s*'Tight Access Job'[\s\S]{0,180}path:\s*\['excavation',\s*'tightAccessJob'\]/, 'Tight Access Job is not gated to PPAS East in Admin Pricing.');
requireText(pricingDataDefaults, /tightAccessJob:\s*6400/, 'Tight Access Job does not have the required $6,400 default cost.');
requireText(excavationSection, /isPpasEast\s*&&[\s\S]{0,350}Tight Access Job/, 'The Proposal Builder does not gate Tight Access Job to PPAS East.');
requireText(pricingEngine, /allowTightAccessJob\s*&&\s*excavation\.hasTightAccessJob[\s\S]{0,300}prices\.tightAccessJob/, 'Tight Access Job is not included in East excavation calculations.');
requireText(pricingEngine, /bronzeIncludesGravel[\s\S]{0,180}prices\.gravelPerSqft/, 'The pricing engine cannot include gravel in PPAS East Bronze pricing.');
requireText(pricingDataStore, /isPpasEastFranchiseCode\(getSessionFranchiseCode\(\)\)[\s\S]{0,120}excavation\.gravelPerSqft/, 'The East Bronze gravel rate is not unlocked in Admin Pricing.');
requireText(excavationOptionQuantities, /MAX_EXCAVATION_OPTION_QUANTITY\s*=\s*9[\s\S]*if\s*\(!selected\)\s*return 0[\s\S]*return 1/, 'East excavation option quantities are not clamped from off through the required x1 default and x9 maximum.');
requireText(excavationSection, /label:\s*'Gravel Install'[\s\S]{0,1200}isPpasEast[\s\S]{0,900}gravelQty[\s\S]{0,1800}label:\s*'Dirt Haul'[\s\S]{0,1200}isPpasEast[\s\S]{0,900}dirtQty/, 'East Gravel Install and Dirt Haul do not use the quantity controls.');
requireText(excavationSection, /Decrease \$\{label\} quantity[\s\S]{0,800}Increase \$\{label\} quantity/, 'East excavation quantity controls are missing increment or decrement actions.');
requireText(pricingEngine, /allowExcavationOptionMultipliers[\s\S]{0,500}gravelInstallQuantity[\s\S]{0,500}dirtHaulQuantity/, 'The East excavation quantities are not resolved as pricing multipliers.');
requireText(pricingEngine, /Gravel Install\$\{gravelMultiplier[\s\S]{0,300}prices\.gravelPerSqft\s*\*\s*gravelMultiplier/, 'Gravel Install cost is not multiplied for East quantities.');
requireText(pricingEngine, /Dirt Haul\$\{dirtHaulMultiplier[\s\S]{0,300}yardageDisplay\s*\*\s*dirtHaulMultiplier/, 'Dirt Haul cost is not multiplied for East quantities.');
requireText(proposalForm, /supportsMicroglass=\{!isPpasEastFranchiseCode\(proposal\.designerCode\s*\|\|\s*getSessionFranchiseCode\(\)\)\}/, 'The Proposal Builder does not hide Microglass for PPAS East.');
requireText(interiorFinishSection, /supportsMicroglass\s*&&\s*\([\s\S]{0,1800}Include Waterproofing \(Microglass\)/, 'The Microglass control is not gated by franchise support.');
requireText(pricingDataModal, /\.\.\.\(!isPpasEast[\s\S]{0,700}Waterproofing \(Microglass\) - Pool & Spa Area/, 'PPAS East Admin Pricing does not hide the Microglass pricing table.');
requireText(masterPricingEngine, /isPpasEast[\s\S]{0,100}hasWaterproofing:\s*false[\s\S]{0,160}calculateInteriorFinishCost/, 'PPAS East pricing does not force Microglass off.');
requireText(proposalSelectionSanitizer, /isPpasEastProposal\(nextProposal\)[\s\S]{0,180}hasWaterproofing:\s*false/, 'Saved PPAS East proposals are not sanitized to remove Microglass.');
requireText(proposalWorkflow, /!isPpasEastProposal\(proposal\)[\s\S]{0,180}key:\s*'waterproofing'/, 'PPAS East workflow details still expose Microglass.');
requireText(warrantyUtils, /micro\\s\*glass[\s\S]{0,300}removeUnsupportedPpasEastWarrantyContent[\s\S]{0,300}isPpasEastProposal/, 'PPAS East warranty output is not protected from legacy Microglass content.');
requireText(warrantyUtils, /resolveWarrantySections[\s\S]{0,900}removeUnsupportedPpasEastWarrantyContent/, 'PPAS East warranty filtering is not applied to resolved warranty sections.');
requireText(costBreakdownDisplay, /micro\\s\*glass[\s\S]{0,300}removeUnsupportedPpasEastCostItems[\s\S]{0,700}interiorFinish/, 'PPAS East COGS and customer breakdown output is not protected from legacy Microglass line items.');
requireText(proposalForm, /colorFieldLabel=\{[\s\S]{0,180}isPpasEastFranchiseCode[\s\S]{0,120}\?\s*'Color'[\s\S]{0,80}:\s*'Color \/ Style'/, 'The PPAS East Interior Finish color label is not franchise-scoped.');
requireText(interiorFinishSection, /colorFieldLabel\s*=\s*'Color \/ Style'[\s\S]{0,5000}>\{colorFieldLabel\}<\/label>/, 'The Interior Finish color label cannot be customized for PPAS East.');
requireText(pricingDataStore, /syncInteriorFinishColorOptions\(normalized\)/, 'Existing pricing models are not normalized for required interior finish colors.');
requireText(pricingDataStore, /syncInteriorFinishColorOptions\(target:[\s\S]{0,120}isPpasEastFranchiseCode\(getSessionFranchiseCode\(\)\)/, 'Assign Later pricing-model normalization is not scoped to PPAS East.');
requireText(pricingDataStore, /finish\.colors\s*=\s*\[ASSIGN_LATER_INTERIOR_FINISH_COLOR,\s*\.\.\.colors\]/, 'Existing pricing model finishes do not receive the Assign Later color.');
requireText(pricingDataStore, /Interior finish colors have no incremental pricing; Assign Later is always a \$0 choice/, 'Assign Later is not documented as a zero-cost color selection.');
requireText(pricingDataStore, /savePricingModelSnapshot[\s\S]{0,300}syncInteriorFinishColorOptions\(basePricingState\)[\s\S]{0,250}savePricingModelRemote/, 'Saved pricing models are not guaranteed to retain Assign Later.');
requireText(proposalForm, /includeAssignLaterColor=\{isPpasEastFranchiseCode\([\s\S]{0,120}proposal\.designerCode\s*\|\|\s*getSessionFranchiseCode\(\)/, 'The Assign Later proposal option is not scoped to PPAS East.');
requireText(interiorFinishSection, /includeAssignLaterColor[\s\S]{0,1600}'Assign Later'[\s\S]{0,300}configuredColorOptions\.filter/, 'PPAS East does not receive Assign Later as the first color choice for every finish.');
requireText(proposalForm, /isPpasEast=\{isPpasEastFranchiseCode\(proposal\.designerCode\s*\|\|\s*getSessionFranchiseCode\(\)\)\}/, 'The Equipment Builder does not receive PPAS East franchise scope.');
requireText(equipmentSection, /supportsMultipleHeatersAndFilters\s*=\s*[\s\S]{0,120}Boolean\(selectedPackage\s*&&\s*isCustomEquipmentPackage\(selectedPackage\)\)/, 'Multiple filters and heaters are not available globally for Custom equipment packages.');
rejectText(equipmentSection, /supportsMultipleHeatersAndFilters\s*=\s*[\s\S]{0,120}isPpasEast/, 'Multiple filters and heaters are still restricted to PPAS East.');
requireText(equipmentSection, /Add Additional Filter/, 'Custom equipment packages cannot add another filter.');
requireText(equipmentSection, /Add Additional Heater/, 'Custom equipment packages cannot add another heater.');
requireText(equipmentSection, /Add Heater Chiller/, 'The PPAS East Custom package cannot add a Heater Chiller.');
requireText(equipmentSection, /\{isPpasEast\s*&&\s*\([\s\S]{0,300}<h2 className="spec-block-title">Heater Chiller<\/h2>/, 'The Heater Chiller option is not always visible to PPAS East.');
requireText(equipmentSection, /heaterChillerAddDisabledReason[\s\S]{0,220}!supportsMultipleHeatersAndFilters[\s\S]{0,220}Custom equipment package/, 'Heater Chiller is not disabled outside the PPAS East Custom package.');
requireText(pricingDataModal, /isPpasEast[\s\S]{0,300}title:\s*'Heater Chiller'[\s\S]{0,180}path:\s*\['equipment',\s*'heaterChillers'\]/, 'The Heater Chiller Admin Pricing table is missing or not scoped to PPAS East.');
requireText(completePricingEngine, /Additional Filter - \$\{filter\.name\}[\s\S]{0,2500}Additional Heater - \$\{heater\.name\}[\s\S]{0,500}Heater Chiller - \$\{normalizedEquipment\.heaterChiller\.name\}/, 'Additional filters, heaters, and Heater Chillers are not emitted as Equipment COGS items.');
requireText(masterPricingEngine, /const equipment = isPpasEast[\s\S]{0,220}heaterChiller:\s*undefined[\s\S]{0,120}heaterChillerQuantity:\s*0/, 'The East-only Heater Chiller selection is not removed from non-East pricing.');
rejectText(masterPricingEngine, /const equipment = isPpasEast[\s\S]{0,220}additionalFilters:\s*\[\]/, 'Additional filters are still removed from non-East pricing.');
rejectText(masterPricingEngine, /const equipment = isPpasEast[\s\S]{0,220}additionalHeaters:\s*\[\]/, 'Additional heaters are still removed from non-East pricing.');
requireText(contractGenerator, /getDefaultContractDepositValue[\s\S]{0,400}isPpasEast[\s\S]{0,220}poolType\s*===\s*'fiberglass'[\s\S]{0,120}formatCurrency\(5000\)/, 'PPAS East fiberglass contracts do not default to a $5,000 deposit.');
requireText(contractGenerator, /resolveContractDepositSourceValue\(overrides\)\s*\|\|\s*getDefaultContractDepositValue\(normalized\)/, 'The editable deposit override does not take precedence over the PPAS East fiberglass default.');
requireText(pricingDataDefaults, /masonry:\s*\{[\s\S]{0,180}rbbFacingOptions:[\s\S]{0,100}backsideFacingOptions:\s*\[\]/, 'New pricing models do not include the Backside Facings catalog.');
requireText(masonryFacing, /MasonryFacingCatalogType\s*=\s*'rbb'\s*\|\s*'backside'\s*\|\s*'raisedSpa'[\s\S]*backsideFacingOptions[\s\S]*\['rbb',\s*'backside',\s*'raisedSpa'\]/, 'Backside Facings are not normalized for current and future pricing models.');
requireText(pricingDataModal, /isPpasEast[\s\S]{0,400}title:\s*'Backside Facings'[\s\S]{0,160}path:\s*\['masonry',\s*'backsideFacingOptions'\]/, 'PPAS East Admin Pricing is missing the Backside Facings table.');
requireText(excavationSection, /isRBB\s*&&\s*isPpasEast\s*&&[\s\S]{0,300}<label className="spec-label">Backside Facing<\/label>/, 'The PPAS East RBB editor is missing the Backside Facing dropdown.');
requireText(excavationSection, /const backside\s*=[\s\S]{0,1800}<option value="none">None<\/option>/, 'The PPAS East Backside Facing dropdown does not begin with None.');
requireText(excavationSection, /normalizeMasonryFacingId\(level\.facing\)\s*\|\|\s*'none'\)\s*===\s*'none'/, 'Backside Facing is not disabled until a primary RBB Facing is selected.');
requireText(completePricingEngine, /getMasonryFacingOptions\(prices,\s*'backside'\)/, 'The Masonry COGS engine does not load the distinct Backside Facings catalog.');
requireText(completePricingEngine, /allowDistinctRbbBacksideFacing[\s\S]{0,800}explicitBacksideFacing[\s\S]{0,800}'backside'/, 'The Masonry COGS engine does not price the selected Backside Facing independently.');
requireText(masterPricingEngine, /allowDistinctRbbBacksideFacing:\s*isPpasEast/, 'Distinct RBB backside-facing pricing is not restricted to PPAS East.');

[
  "path: ['misc', 'layout', 'siltFencing']",
  "path: ['steel', 'tanningShelf']",
  "path: ['excavation', 'coverBox']",
  "path: ['shotcrete', 'labor', 'autoCover']",
  "path: ['shotcrete', 'material', 'autoCover']",
  "path: ['excavation', 'gravelPerSqft']",
  "path: ['excavation', 'dirtHaulPerYard']",
  "path: ['plans', 'soilSampleEngineer']",
  "path: ['steel', 'doubleCurtainPerLnft']",
  "path: ['excavation', 'sitePrep']",
  "path: ['excavation', 'tightAccessJob']",
  "path: ['interiorFinish', 'extras', 'waterproofingPerSqft']",
  "path: ['interiorFinish', 'extras', 'waterproofingRaisedSpa']",
].forEach((pricingPath) => {
  requireOccurrenceCount(
    pricingDataModal,
    pricingPath,
    1,
    `Admin pricing field ${pricingPath} must live in exactly one editor location.`
  );
});

const packageJson = read('package.json');
requireText(packageJson, /"release-notes\/\*\*\/\*"/, 'Franchise patch-note files are not included in packaged applications.');

for (const code of ['5555', '9724']) {
  if (!fs.existsSync(path.join(root, 'release-notes', 'franchises', `${code}.md`))) {
    failures.push(`Franchise patch-note file is missing for ${code}.`);
  }
}

const settings = read('src/pages/SettingsPage.tsx');
requireText(settings, /canViewChangelog\s*=\s*[\s\S]{0,180}sessionRole\s*===\s*'designer'/, 'Designers cannot open their franchise Patch Notes.');
requireText(settings, /getUpdateChannel\(sessionRole,\s*getSessionFranchiseCode\(\)\)/, 'The manual update check does not resolve the authenticated franchise channel.');
requireText(settings, /checkForUpdates\(channel\s*\?\s*\{\s*channel\s*\}/, 'The manual update check does not pass its isolated channel to Electron.');

requireText(main, /canViewGlobalNotes\s*=\s*role\s*===\s*'master'\s*\|\|\s*role\s*===\s*'owner'\s*\|\|\s*role\s*===\s*'admin'/, 'Global Patch Notes are not restricted to master, owner, and admin roles in Electron.');
requireText(main, /const globalNotes\s*=\s*canViewGlobalNotes\s*\?[^:]+:\s*''/s, 'Restricted roles still receive Global Patch Notes content.');
requireText(changelogModal, /\{canViewGlobalNotes\s*&&\s*\([\s\S]{0,500}patch-notes-global-tab/, 'The Global Patch Notes tab is not hidden from designers.');

const releaseScript = read('scripts/release-channel.js');
requireText(releaseScript, /stableTag\s*=\s*bumpMajor\(state\.coreVersion\)/, 'The one-time bootstrap does not create a major-version stable bridge.');
requireText(releaseScript, /rev-parse[\s\S]{0,100}@\{upstream\}/, 'The release script does not resolve the configured upstream remote.');
requireText(releaseScript, /tags\.forEach\(\(tag\)\s*=>\s*run\('git',\s*\['push',\s*remote,\s*tag\]\)\)/, 'The release script does not publish tags individually for GitHub Actions.');

const productionDeploy = read('scripts/deploy-edge-functions-production.js');
requireText(productionDeploy, /\.env\.local/, 'The production Edge Function deploy does not derive its target from .env.local.');
requireText(productionDeploy, /\.env\.staging\.local/, 'The production Edge Function deploy does not compare its target with staging.');
requireText(productionDeploy, /--project-ref/, 'The production Edge Function deploy does not pass an explicit Supabase project ref.');
requireText(productionDeploy, /Validation-only check passed; nothing was deployed/, 'The production Edge Function deploy is missing its validation-only safety path.');

const devStart = read('dev-start.js');
requireText(devStart, /SUBMERGE_DATA_PARTITION\s*=\s*'staging'/, 'The staging task does not activate its isolated data partition.');

const app = read('src/App.tsx');
const appCss = read('src/App.css');
requireText(app, /VITE_SUBMERGE_ENVIRONMENT[\s\S]{0,220}\[\$\{environmentLabel\}\]/, 'The staging environment is not visible in the window title.');
requireText(app, /app-test-mode-banner[\s\S]{0,220}Live franchise settings are read-only/, 'Test sessions do not show a persistent safety banner.');
requireText(app, /className=\{`app\$\{showTestModeBanner\s*\?\s*' app--test-mode'/, 'Test sessions do not activate the non-overlapping top-banner layout.');
requireText(appCss, /\.app-test-mode-banner\s*\{[\s\S]{0,180}top:\s*0;/, 'The Test Mode banner is not anchored to the top of the app window.');
requireText(appCss, /\.app--test-mode \.navigation-bar\s*\{[\s\S]{0,100}top:\s*var\(--test-mode-banner-height\)/, 'The navigation bar is not offset below the Test Mode banner.');
requireText(app, /session\?\.isTestAccount !== true[\s\S]{0,180}canSubmitFeedback|canSubmitFeedback[\s\S]{0,180}session\?\.isTestAccount !== true/, 'Test sessions are not excluded from live franchise feedback.');

if (failures.length) {
  console.error('Multi-franchise foundation verification failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Multi-franchise foundation verification passed.');
