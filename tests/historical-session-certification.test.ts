import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoricalCertification, type DailySourceEvidence } from '../src/operations/historical-session-certification.js';

const row = (overrides: Partial<DailySourceEvidence> = {}): DailySourceEvidence => ({
  date: '2026-09-09', gitCommits: 2, changedAreas: { src: 4 }, receiptCount: 0,
  receiptBuildShas: [], receiptScopeStates: {}, reconciliationGoodCount: 0,
  maxPositions: null, maxOpenOrders: null, orderSubmissions: 0, replayCandidateCount: 0,
  replayExecutableCount: 0, replayPositiveQuantityCount: 0, replayRejectionCounts: {},
  databaseCounts: {}, databaseErrorCounts: {}, ...overrides,
});

test('preserves source-only days as explicit evidence gaps', () => {
  const receipt = buildHistoricalCertification({ generatedAt: '2026-09-25T00:00:00Z',
    canonicalSourceSha: 'a'.repeat(40), start: '2026-09-09', end: '2026-09-09', rows: [row()],
    brokerFillCount: 0, brokerOrderSubmissionCount: 0, lockedOrShadowPlanCount: 0,
    unclassifiedWaitCount: 0, historicalRegressions: 0, unexplainedBehavior: 0,
    codeSolvableBlockers: [] });
  assert.equal(receipt.certification, 'PARTIAL_EVIDENCE');
  assert.deepEqual(receipt.days[0]?.unknowns, ['DAY_LEVEL_RUNTIME_OUTCOME_NOT_RETAINED']);
});

test('classifies replay stops without inventing a trade', () => {
  const receipt = buildHistoricalCertification({ generatedAt: '2026-09-25T00:00:00Z',
    canonicalSourceSha: 'b'.repeat(40), start: '2026-09-18', end: '2026-09-18',
    rows: [row({ date: '2026-09-18', receiptCount: 1, replayCandidateCount: 20,
      replayExecutableCount: 4, replayPositiveQuantityCount: 0,
      replayRejectionCounts: { CONTRACT_NOT_EXECUTABLE: 16 } })], brokerFillCount: 0,
    brokerOrderSubmissionCount: 0, lockedOrShadowPlanCount: 3, unclassifiedWaitCount: 0,
    historicalRegressions: 0, unexplainedBehavior: 0, codeSolvableBlockers: [] });
  assert.equal(receipt.certification, 'PASS');
  assert.equal(receipt.totals.actualTrades, 0);
  assert.ok(receipt.days[0]?.exactStops.includes('NO_POSITIVE_QUANTITY_IN_RETAINED_REPLAY'));
  assert.ok(receipt.days[0]?.exactStops.includes('CONTRACT_NOT_EXECUTABLE'));
});
