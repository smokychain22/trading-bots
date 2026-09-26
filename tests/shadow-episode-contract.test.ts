import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShadowEpisodeContract } from '../src/research/shadow-episode-contract.js';
import type { SeriousCandidateSubject, SeriousWaitSubject } from '../src/research/serious-subject-policy.js';

const candidateSubject: SeriousCandidateSubject = {
  subjectId: 'a'.repeat(64), kind: 'CANDIDATE', snapshotId: 'snapshot-1',
  decisionAt: '2026-09-25T15:30:00Z', decisionBucketAt: '2026-09-25T15:00:00Z',
  candidateId: 'candidate-1', branch: 'THETA_DEFINED_RISK', rankAtDecision: 1, selected: false,
  selectionReasons: ['BRANCH_BEST'],
  candidate: {
    candidateId: 'candidate-1', branch: 'THETA_DEFINED_RISK', action: 'OPEN_DEFINED_RISK', underlying: 'SPY',
    legs: [
      { positionIntent: 'SELL_TO_OPEN', optionSymbol: 'SPY261120P00500000', optionType: 'PUT',
        strike: 500, expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1,
        quoteTimestamp: '2026-09-25T15:29:59Z' },
      { positionIntent: 'BUY_TO_OPEN', optionSymbol: 'SPY261120P00495000', optionType: 'PUT',
        strike: 495, expiration: '2026-11-20', multiplier: 100, bid: 1, ask: 1.1,
        quoteTimestamp: '2026-09-25T15:29:59Z' },
    ],
    dte: 56, delta: -0.2, moneyness: 0.91, spreadPct: 0.05,
    liquidity: { volume: 10, openInterest: 100 },
    economics: { premiumPerShare: 1, grossPremium: 100, collateral: 500, maxProfit: 100, maxLoss: 400,
      breakEven: 499, downsideCushion: 0.1, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null, capitalDayYield: 0.001, expectedAfterCostEv: null },
    assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: [], unknownEvidence: [],
    structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] }, paretoRank: 1,
    dominatedBy: [], executionAuthorized: false,
  },
  subjectSelectionPolicyVersion: 'theta-serious-subject-selection-v1',
  shadowOnly: true, brokerAuthority: false, orderSubmitted: false, brokerFill: false,
};

const versions = {
  decisionId: 'decision-1', featureSnapshotHash: 'b'.repeat(64), strategyVersion: 'strategy-v1',
  riskVersion: 'risk-v1', costVersion: 'cost-v1', executionModelVersion: 'execution-v1',
  sourceSha: 'c'.repeat(40), workerSha: 'c'.repeat(40),
};

test('shadow episode preserves both D legs and can never gain broker authority', () => {
  const first = buildShadowEpisodeContract({ subject: candidateSubject, ...versions });
  const second = buildShadowEpisodeContract({ subject: candidateSubject, ...versions });
  assert.deepEqual(first, second);
  assert.equal(first.legs.length, 2);
  assert.deepEqual(first.legs.map((leg) => leg.optionSymbol),
    ['SPY261120P00500000', 'SPY261120P00495000']);
  assert.equal(first.shadowOnly, true);
  assert.equal(first.brokerAuthority, false);
  assert.equal(first.orderSubmitted, false);
  assert.equal(first.brokerFill, false);
});

test('WAIT receives an auditable shadow identity without a fake contract', () => {
  const wait: SeriousWaitSubject = {
    subjectId: 'd'.repeat(64), kind: 'WAIT', snapshotId: 'snapshot-1',
    decisionAt: '2026-09-25T15:30:00Z', decisionBucketAt: '2026-09-25T15:00:00Z',
    candidateId: null, branch: null, rankAtDecision: null, selected: false,
    selectionReasons: ['CANONICAL_WAIT'], primaryAction: 'GLOBAL_WAIT', reasons: ['ACCOUNT_CAPACITY'],
    bestRejectedCandidateId: 'candidate-1', secondBestCandidateId: null, nearMissCandidateId: 'candidate-1',
    subjectSelectionPolicyVersion: 'theta-serious-subject-selection-v1',
    shadowOnly: true, brokerAuthority: false, orderSubmitted: false, brokerFill: false,
  };
  const receipt = buildShadowEpisodeContract({ subject: wait, ...versions });
  assert.equal(receipt.strategy, 'WAIT');
  assert.equal(receipt.candidateId, null);
  assert.deepEqual(receipt.legs, []);
});

test('invalid source lineage and future decision bucket fail closed', () => {
  assert.throws(() => buildShadowEpisodeContract({ subject: candidateSubject, ...versions, sourceSha: 'bad' }),
    /SHADOW_EPISODE_IDENTITY_INVALID/);
  assert.throws(() => buildShadowEpisodeContract({ subject: { ...candidateSubject,
    decisionBucketAt: '2026-09-25T16:00:00Z' }, ...versions }), /SHADOW_EPISODE_TIME_INVALID/);
});
