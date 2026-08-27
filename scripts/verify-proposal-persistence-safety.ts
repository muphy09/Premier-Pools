import assert from 'node:assert/strict';
import type { Proposal } from '../src/types/proposal-new';
import {
  buildLoadedProposalIdentity,
  getExistingProposalSaveBlockReason,
  getUnsafeProposalOverwriteReason,
} from '../src/utils/proposalPersistenceSafety';
import {
  FEENSTRA_FRANCHISE_ID,
  FEENSTRA_MAY_2026_CALCULATION_PROFILE,
  FEENSTRA_MAY_2026_COMPATIBILITY_REVISION,
  FEENSTRA_PROPOSAL_NUMBER,
} from '../src/services/legacy/feenstraMay2026Profile';

const createdDate = '2026-05-13T13:51:22.159Z';

const buildProposal = (overrides: Partial<Proposal> = {}): Proposal =>
  ({
    proposalNumber: 'TEST-SAFETY-1',
    createdDate,
    lastModified: '2026-08-24T18:12:58.079Z',
    customerInfo: { customerName: 'Ryan Norton' },
    pricing: { retailPrice: 121_690 },
    totalCost: 121_690,
    status: 'draft',
    versions: [],
    ...overrides,
  }) as Proposal;

const stored = buildProposal({
  customFeatures: [
    {
      id: 'safety-size-fixture',
      description: 'x'.repeat(13_000),
      price: 1,
    },
  ],
});

assert.equal(
  getExistingProposalSaveBlockReason({
    routeProposalNumber: stored.proposalNumber,
    hydratedProposalNumber: null,
    proposal: {},
    baseline: null,
  }),
  'This proposal has not finished loading. Nothing was saved.'
);

const identity = buildLoadedProposalIdentity(stored);
assert.equal(
  getExistingProposalSaveBlockReason({
    routeProposalNumber: stored.proposalNumber,
    hydratedProposalNumber: stored.proposalNumber,
    proposal: stored,
    baseline: identity,
  }),
  null
);

assert.match(
  getExistingProposalSaveBlockReason({
    routeProposalNumber: stored.proposalNumber,
    hydratedProposalNumber: stored.proposalNumber,
    proposal: buildProposal({ customerInfo: { customerName: '' } }),
    baseline: identity,
  }) || '',
  /customer name disappeared/i
);

assert.equal(
  getUnsafeProposalOverwriteReason(
    buildProposal({ customerInfo: { customerName: 'Ryan Norton and Pat Norton' }, totalCost: 122_000 }),
    stored
  ),
  null,
  'Normal edits must remain saveable.'
);

assert.equal(
  getUnsafeProposalOverwriteReason(
    buildProposal({ proposalNumber: 'TEST-NEW-1', customerInfo: { customerName: '' }, totalCost: 0 }),
    null
  ),
  null,
  'New drafts must remain saveable.'
);

assert.match(
  getUnsafeProposalOverwriteReason(
    buildProposal({ createdDate: '2026-08-24T12:29:55.000Z' }),
    stored
  ) || '',
  /creation date/i
);

const alternateVersion = buildProposal({
  versionId: 'version-2',
  versionName: 'Version 2',
  isOriginalVersion: false,
  createdDate: '2026-08-24T12:29:55.000Z',
  versions: [],
});
const storedWithAlternateVersion = buildProposal({
  versionId: 'original',
  activeVersionId: 'original',
  versions: [alternateVersion],
});
const alternateVersionActive = buildProposal({
  ...alternateVersion,
  activeVersionId: 'version-2',
  versions: [
    buildProposal({
      versionId: 'original',
      activeVersionId: 'version-2',
      versions: [],
    }),
  ],
});

assert.equal(
  getUnsafeProposalOverwriteReason(alternateVersionActive, storedWithAlternateVersion),
  null,
  'Switching the active proposal version must not compare its creation date to a different version.'
);

assert.match(
  getUnsafeProposalOverwriteReason(
    {
      ...alternateVersionActive,
      createdDate: '2026-08-24T12:30:55.000Z',
    },
    storedWithAlternateVersion
  ) || '',
  /creation date/i,
  'Changing the creation date of the same stored version must still be blocked.'
);

assert.match(
  getUnsafeProposalOverwriteReason(buildProposal({ customerInfo: { customerName: '' } }), stored) || '',
  /customer name/i
);

assert.match(
  getUnsafeProposalOverwriteReason(buildProposal({ totalCost: 0, pricing: { retailPrice: 0 } }), stored) || '',
  /much smaller/i
);

assert.equal(
  getUnsafeProposalOverwriteReason(
    stored,
    buildProposal({
      createdDate: '2026-08-24T12:29:55.000Z',
      customerInfo: { customerName: '' },
      totalCost: 0,
      pricing: { retailPrice: 0 },
    })
  ),
  null,
  'A healthy local recovery must be allowed to repair an already-collapsed cloud row.'
);

const feenstraBaseline = buildProposal({
  proposalNumber: FEENSTRA_PROPOSAL_NUMBER,
  franchiseId: FEENSTRA_FRANCHISE_ID,
  versionId: 'original',
  versionName: 'May 11 Contract Baseline',
  isOriginalVersion: true,
  activeVersionId: 'version-current',
  versionLocked: true,
  calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
  compatibilityRevision: FEENSTRA_MAY_2026_COMPATIBILITY_REVISION,
  versions: [],
});
const storedFeenstra = buildProposal({
  proposalNumber: FEENSTRA_PROPOSAL_NUMBER,
  franchiseId: FEENSTRA_FRANCHISE_ID,
  versionId: 'version-current',
  versionName: 'Current Contract Version',
  isOriginalVersion: false,
  activeVersionId: 'version-current',
  versionLocked: false,
  calculationProfile: FEENSTRA_MAY_2026_CALCULATION_PROFILE,
  compatibilityRevision: FEENSTRA_MAY_2026_COMPATIBILITY_REVISION,
  versions: [feenstraBaseline],
});

assert.equal(
  getUnsafeProposalOverwriteReason(
    {
      ...storedFeenstra,
      customerInfo: { customerName: 'Allowed copied-version edit' },
      versions: [
        {
          ...feenstraBaseline,
          lastModified: '2026-08-27T01:00:00.000Z',
          status: 'completed',
          pricing: { retailPrice: 75_800 },
        },
      ],
    },
    storedFeenstra
  ),
  null,
  'Editable copied-version changes and ignored baseline metadata must remain saveable.'
);

assert.match(
  getUnsafeProposalOverwriteReason(
    {
      ...storedFeenstra,
      versions: [{ ...feenstraBaseline, versionLocked: false }],
    },
    storedFeenstra
  ) || '',
  /unlock.*Feenstra contract baseline/i,
  'A stale local copy must not unlock the protected Feenstra baseline.'
);

assert.match(
  getUnsafeProposalOverwriteReason({ ...storedFeenstra, versions: [] }, storedFeenstra) || '',
  /remove.*Feenstra contract baseline/i,
  'A stale local copy must not remove the protected Feenstra baseline.'
);

assert.match(
  getUnsafeProposalOverwriteReason(
    {
      ...storedFeenstra,
      versions: [
        {
          ...feenstraBaseline,
          customerInfo: { customerName: 'Changed protected baseline' },
        },
      ],
    },
    storedFeenstra
  ) || '',
  /alter.*Feenstra contract baseline/i,
  'A stale local copy must not alter protected Feenstra baseline content.'
);

console.log('Proposal persistence safety checks passed.');
