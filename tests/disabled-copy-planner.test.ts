import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmedMasterCopyEventId, followerCopyEvidenceSchema } from '../src/customer/postgres-disabled-copy-planner.js';
import type { MasterCopyEvent } from '../src/customer/copy-engine-contract.js';

const event: MasterCopyEvent = {
  masterDecisionId: '00000000-0000-0000-0000-000000000001',
  masterLifecycleId: 'chain-1',
  masterOrderId: '00000000-0000-0000-0000-000000000002',
  masterFillId: '00000000-0000-0000-0000-000000000003',
  action: 'OPEN_CSP', symbol: 'AAPL', contractId: 'AAPL260918P00200000',
  masterQuantity: 1, masterFilledQuantity: 1, occurredAt: '2026-09-12T14:00:00.000Z',
};

test('confirmed master copy event identity is deterministic and follower independent', () => {
  assert.equal(confirmedMasterCopyEventId(event), confirmedMasterCopyEventId({ ...event }));
});

test('follower copy evidence preserves unknown values and rejects future quotes', () => {
  const base = { asOf: '2026-09-12T14:00:00.000Z',masterFillTime:'2026-09-12T13:59:58.000Z',
    copyEventTime:'2026-09-12T13:59:59.000Z',followerObservationTime:'2026-09-12T14:00:00.000Z',
    quoteTimestamp: null, quoteAgeMs: null,maximumQuoteAgeMs:10000,
    bid: null, ask: null, proposedLimit: null, equity: null, buyingPower: null,
    economicDirection:'CREDIT' as const,masterExecutionPrice:1.25,followerReferencePrice:null,
    contractMultiplier:null,pricingPolicyVersion:'copy-limit-v1',
    optionsBuyingPower: null, assignmentCapacity: null, concentrationRemaining: null,
    requiredCollateralPerContract: null, expectedExecutionQuality: 'UNKNOWN' as const,
    dataQuality: 'UNKNOWN' as const, providerState: 'UNKNOWN', branchCompatible: true, reasonCodes: [] };
  assert.equal(followerCopyEvidenceSchema.parse(base).equity, null);
  assert.throws(() => followerCopyEvidenceSchema.parse({ ...base,
    quoteTimestamp: '2026-09-12T14:00:01.000Z' }));
  assert.throws(() => followerCopyEvidenceSchema.parse({ ...base, bid: 2, ask: 1 }));
  assert.throws(()=>followerCopyEvidenceSchema.parse({...base,quoteTimestamp:'2026-09-12T13:59:59.000Z',quoteAgeMs:2}));
});
