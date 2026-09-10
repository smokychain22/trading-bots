import assert from 'node:assert/strict';
import test from 'node:test';
import { ShadowOpportunityBookBuilder, parseShadowOpportunityEntry } from '../src/theta/shadow-opportunity-book.js';

const baseEntry = (overrides: Record<string, unknown> = {}) => ({
  contractVersion: 'theta-shadow-opportunity-book-v1',
  opportunityId: 'opp-1',
  snapshotId: 'snapshot-1',
  timestamp: new Date().toISOString(),
  underlying: 'AAPL',
  contractSymbol: 'AAPL260116P00200000',
  strategyBranch: 'THETA_CONVENTIONAL',
  evNet: 50,
  tailAdjustedEv: 40,
  returnPerCapitalDay: 0.002,
  capitalRequired: 20000,
  uncertainty: 0.1,
  ownershipSnapshotId: 'own-1',
  regimeSnapshotId: 'regime-1',
  aegisState: 'ALLOW_FULL',
  recommendedQuantity: 2,
  executionQualityAcceptable: true,
  outcome: 'ACCEPTED',
  waitReason: null,
  rejectionCategory: null,
  reasons: [],
  policyVersion: 'v1',
  modelVersions: { ownership: 'v1', regime: 'v1' },
  eventualOutcomeKnown: false,
  eventualRealizedPnl: null,
  ...overrides,
});

test('a WAIT outcome must carry a specific waitReason, never a generic WAIT', () => {
  assert.throws(() => parseShadowOpportunityEntry(baseEntry({ outcome: 'WAIT', waitReason: null })));
  const entry = parseShadowOpportunityEntry(baseEntry({ outcome: 'WAIT', waitReason: 'WAIT_EVENT', recommendedQuantity: null }));
  assert.equal(entry.waitReason, 'WAIT_EVENT');
});

test('waitReason is rejected on any non-WAIT outcome', () => {
  assert.throws(() => parseShadowOpportunityEntry(baseEntry({ outcome: 'ACCEPTED', waitReason: 'WAIT_EVENT' })));
});

test('Q_ZERO outcome must carry recommendedQuantity=0', () => {
  assert.throws(() => parseShadowOpportunityEntry(baseEntry({ outcome: 'Q_ZERO', recommendedQuantity: 1 })));
  const entry = parseShadowOpportunityEntry(baseEntry({ outcome: 'Q_ZERO', recommendedQuantity: 0 }));
  assert.equal(entry.recommendedQuantity, 0);
});

test('eventualRealizedPnl must stay null until eventualOutcomeKnown is true', () => {
  assert.throws(() => parseShadowOpportunityEntry(baseEntry({ eventualOutcomeKnown: false, eventualRealizedPnl: 100 })));
  const entry = parseShadowOpportunityEntry(baseEntry({ eventualOutcomeKnown: true, eventualRealizedPnl: 100 }));
  assert.equal(entry.eventualRealizedPnl, 100);
});

test('the builder validates on record and never silently accepts a malformed entry', () => {
  const builder = new ShadowOpportunityBookBuilder();
  builder.record(baseEntry());
  assert.throws(() => builder.record(baseEntry({ outcome: 'WAIT', waitReason: null })));
  assert.equal(builder.all().length, 1);
});

test('countByOutcome tallies every recorded entry, including PASS/WAIT/rejections', () => {
  const builder = new ShadowOpportunityBookBuilder();
  builder.record(baseEntry({ opportunityId: 'a', outcome: 'ACCEPTED' }));
  builder.record(baseEntry({ opportunityId: 'b', outcome: 'PASS', recommendedQuantity: null }));
  builder.record(baseEntry({ opportunityId: 'c', outcome: 'WAIT', waitReason: 'WAIT_VOL', recommendedQuantity: null }));
  builder.record(baseEntry({ opportunityId: 'd', outcome: 'AEGIS_REJECTED', recommendedQuantity: null }));
  const counts = builder.countByOutcome();
  assert.equal(counts.ACCEPTED, 1);
  assert.equal(counts.PASS, 1);
  assert.equal(counts.WAIT, 1);
  assert.equal(counts.AEGIS_REJECTED, 1);
  assert.equal(counts.REJECTED, 0);
});
