import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContractPathResearchHandoff } from '../src/research/contract-path-handoff.js';
import { matureContractPath } from '../src/research/contract-path-label-maturation.js';
import { buildContractPathObservationReceipt } from '../src/research/contract-path-observation-runtime.js';
import { buildShadowEpisodeContract } from '../src/research/shadow-episode-contract.js';
import type { SeriousCandidateSubject } from '../src/research/serious-subject-policy.js';

const sourceSha = 'b'.repeat(40);
const subject: SeriousCandidateSubject = {
  subjectId: 'a'.repeat(64), kind: 'CANDIDATE', snapshotId: 'snapshot-1',
  decisionAt: '2026-09-25T15:30:00Z', decisionBucketAt: '2026-09-25T15:00:00Z',
  candidateId: 'candidate-1', branch: 'THETA_CONVENTIONAL', rankAtDecision: 1, selected: false,
  selectionReasons: ['BRANCH_BEST'],
  candidate: {
    candidateId: 'candidate-1', branch: 'THETA_CONVENTIONAL', action: 'OPEN_CSP', underlying: 'SPY',
    legs: [{ positionIntent: 'SELL_TO_OPEN', optionSymbol: 'SPY261120P00500000', optionType: 'PUT',
      strike: 500, expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1,
      quoteTimestamp: '2026-09-25T15:29:59Z' }],
    dte: 56, delta: -0.2, moneyness: 0.91, spreadPct: 0.05,
    liquidity: { volume: 10, openInterest: 100 },
    economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50_000, maxProfit: 200, maxLoss: 49_800,
      breakEven: 498, downsideCushion: 0.1, retainedUpside: null, callAwayProceeds: null,
      wholeChainPnlAtCallAway: null, capitalDayYield: 0.001, expectedAfterCostEv: null },
    assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: [], unknownEvidence: [],
    structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] }, paretoRank: 1,
    dominatedBy: [], executionAuthorized: false,
  },
  subjectSelectionPolicyVersion: 'theta-serious-subject-selection-v1',
  shadowOnly: true, brokerAuthority: false, orderSubmitted: false, brokerFill: false,
};

function bundle() {
  const episode = buildShadowEpisodeContract({ subject, decisionId: 'decision-1', featureSnapshotHash: 'c'.repeat(64),
    strategyVersion: 'strategy-v1', riskVersion: 'risk-v1', costVersion: 'cost-v1',
    executionModelVersion: 'execution-v1', sourceSha, workerSha: sourceSha });
  const observation = buildContractPathObservationReceipt({ observationJobId: 'job-1', subjectId: subject.subjectId,
    checkpoint: '15M', targetAt: '2026-09-25T15:45:00Z', actualObservedAt: '2026-09-25T15:46:00Z',
    expectedLegs: [{ optionSymbol: 'SPY261120P00500000', side: 'SHORT', optionType: 'PUT', expiration: '2026-11-20',
      strike: 500, multiplier: 100 }],
    quotes: [{ optionSymbol: 'SPY261120P00500000', bid: 1.8, ask: 1.9,
      providerTimestamp: '2026-09-25T15:45:58Z', receivedAt: '2026-09-25T15:45:59Z',
      impliedVolatility: 0.19, delta: -0.19, gamma: 0.01, theta: -0.03, vega: 0.1,
      provider: 'ALPACA', feed: 'OPRA', quality: 'GOOD', reasonCodes: [] }],
    underlying: { symbol: 'SPY', price: 551, providerTimestamp: '2026-09-25T15:45:58Z',
      receivedAt: '2026-09-25T15:45:59Z', provider: 'ALPACA', purpose: 'RESEARCH_REFERENCE_ONLY' },
    sourceSha, workerSha: sourceSha });
  const maturation = matureContractPath({ subjectId: subject.subjectId, decisionAt: subject.decisionAt,
    requiredCheckpoints: ['15M'], points: [{ checkpoint: '15M', targetAt: observation.targetAt,
      actualObservedAt: observation.actualObservedAt, providerTimestamp: observation.legs[0]?.providerTimestamp ?? null,
      receivedAt: observation.legs[0]?.receivedAt ?? observation.actualObservedAt, markChangeDollars: 20,
      evidenceClass: 'MARKET_OBSERVED', evidenceId: observation.observationId }] });
  return { episode, observation, maturation };
}

test('Codex handoff binds episodes, factual observations, labels, hashes, and zero broker authority', () => {
  const { episode, observation, maturation } = bundle();
  const first = buildContractPathResearchHandoff({ sourceSha, workerSha: sourceSha,
    sourceWindow: { start: '2026-09-25T15:00:00Z', end: '2026-09-25T16:00:00Z' },
    episodes: [episode], observations: [observation], maturations: [maturation] });
  const second = buildContractPathResearchHandoff({ sourceSha, workerSha: sourceSha,
    sourceWindow: { start: '2026-09-25T15:00:00Z', end: '2026-09-25T16:00:00Z' },
    episodes: [episode], observations: [observation], maturations: [maturation] });
  assert.deepEqual(first, second);
  assert.equal(first.producer, 'CODEX');
  assert.equal(first.brokerAuthority, false);
  assert.equal(first.observationCount, 1);
});

test('unrelated observations or maturation evidence fail lineage checks', () => {
  const { episode, observation, maturation } = bundle();
  assert.throws(() => buildContractPathResearchHandoff({ sourceSha, workerSha: sourceSha,
    sourceWindow: { start: '2026-09-25T15:00:00Z', end: '2026-09-25T16:00:00Z' },
    episodes: [episode], observations: [{ ...observation, subjectId: 'd'.repeat(64) }],
    maturations: [maturation] }), /CONTRACT_PATH_HANDOFF_OBSERVATION_LINEAGE_MISMATCH/);
});

test('observations outside the declared source window fail closed', () => {
  const { episode, observation, maturation } = bundle();
  assert.throws(() => buildContractPathResearchHandoff({ sourceSha, workerSha: sourceSha,
    sourceWindow: { start: '2026-09-25T15:00:00Z', end: '2026-09-25T15:45:30Z' },
    episodes: [episode], observations: [observation], maturations: [maturation] }),
  /CONTRACT_PATH_HANDOFF_OBSERVATION_LINEAGE_MISMATCH/);
});
