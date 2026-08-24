import assert from 'node:assert/strict';
import type { Proposal } from '../src/types/proposal-new';
import {
  buildLoadedProposalIdentity,
  getExistingProposalSaveBlockReason,
  getUnsafeProposalOverwriteReason,
} from '../src/utils/proposalPersistenceSafety';

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

console.log('Proposal persistence safety checks passed.');
