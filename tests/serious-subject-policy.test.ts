import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanonicalFrontierCandidate, CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { selectSeriousResearchSubjects, seriousSubjectSelectionPolicyVersion } from '../src/research/serious-subject-policy.js';

function candidate(id: string, branch: CanonicalFrontierCandidate['branch'], rank: number): CanonicalFrontierCandidate {
  const legs = branch === 'THETA_DEFINED_RISK'
    ? [
        { positionIntent: 'SELL_TO_OPEN' as const, optionSymbol: `${id}-SHORT`, optionType: 'PUT' as const,
          strike: 500, expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1, quoteTimestamp: '2026-09-25T15:00:00Z' },
        { positionIntent: 'BUY_TO_OPEN' as const, optionSymbol: `${id}-LONG`, optionType: 'PUT' as const,
          strike: 495, expiration: '2026-11-20', multiplier: 100, bid: 1, ask: 1.1, quoteTimestamp: '2026-09-25T15:00:00Z' },
      ]
    : [{ positionIntent: 'SELL_TO_OPEN' as const, optionSymbol: id, optionType: 'PUT' as const,
        strike: 500, expiration: '2026-11-20', multiplier: 100, bid: 2, ask: 2.1,
        quoteTimestamp: '2026-09-25T15:00:00Z' }];
  return {
    candidateId: id, branch, action: branch === 'THETA_DEFINED_RISK' ? 'OPEN_DEFINED_RISK' : 'OPEN_CSP',
    underlying: 'SPY', legs, dte: 45, delta: -0.2, moneyness: 0.9, spreadPct: 0.05,
    liquidity: { volume: 100, openInterest: 1000 },
    economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50000, maxProfit: 200,
      maxLoss: 49800, breakEven: 498, downsideCushion: 0.1, retainedUpside: null,
      callAwayProceeds: null, wholeChainPnlAtCallAway: null, capitalDayYield: 0.0001,
      expectedAfterCostEv: null },
    assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: [],
    unknownEvidence: [], structurallyFeasible: true, riskFeasible: true,
    sizing: { quantity: 1, bindingConstraint: 'BROKER', reasons: [] }, paretoRank: rank,
    dominatedBy: [], executionAuthorized: false,
  };
}

function frontier(): CanonicalStrategyFrontier {
  const q = [candidate('q1', 'THETA_CONVENTIONAL', 1), candidate('q2', 'THETA_CONVENTIONAL', 2),
    candidate('q3', 'THETA_CONVENTIONAL', 3)];
  const h = [candidate('h1', 'THETA_HOLD_STRIKE', 1)];
  const d = [candidate('d1', 'THETA_DEFINED_RISK', 1)];
  return {
    contractVersion: 'theta-canonical-strategy-frontier-v1', snapshotId: 'snapshot-1',
    timestamp: '2026-09-25T15:00:00.000Z', strategyVersion: 'strategy-v1',
    decisionAuthorityVersion: 'theta-canonical-decision-authority-v1',
    branches: [
      { branch: 'THETA_CONVENTIONAL', strategyVersion: 'q-v1', status: 'SHADOW', applicable: true,
        evaluated: true, routeReasons: [], evaluationState: 'EVALUATED', candidateCount: q.length,
        mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 3,
        dataInsufficient: 0, candidates: q, bestCandidateId: 'q1', secondBestCandidateId: 'q2',
        bestRejectedCandidateId: 'q3', empiricalEconomicsReady: false, executionAuthorized: false },
      { branch: 'THETA_HOLD_STRIKE', strategyVersion: 'h-v1', status: 'RESEARCH_ONLY', applicable: true,
        evaluated: true, routeReasons: [], evaluationState: 'EVALUATED', candidateCount: h.length,
        mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 1,
        dataInsufficient: 0, candidates: h, bestCandidateId: 'h1', secondBestCandidateId: null,
        bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false },
      { branch: 'THETA_DEFINED_RISK', strategyVersion: 'd-v1', status: 'RESEARCH_ONLY', applicable: true,
        evaluated: true, routeReasons: [], evaluationState: 'EVALUATED', candidateCount: d.length,
        mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 1,
        dataInsufficient: 0, candidates: d, bestCandidateId: 'd1', secondBestCandidateId: null,
        bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false },
    ],
    branchesConsidered: ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'],
    branchesEvaluated: ['THETA_CONVENTIONAL', 'THETA_HOLD_STRIKE', 'THETA_DEFINED_RISK'],
    selectedBranch: null, selectedCandidateId: null, primaryAction: 'GLOBAL_WAIT', selectedQuantity: 0,
    empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED', secondBestCandidateId: 'q2',
    nearMissCandidateId: 'q1', bestRejectedCandidateId: 'q3', globalWaitEarned: true,
    globalWaitReasons: ['ACCOUNT_CAPACITY'], empiricalEconomicsReady: false, executionAuthorized: false,
    optionomicsContext: null, definedRiskLockedPlan: { state: 'NOT_APPLICABLE', plan: null, reasons: [] },
    contentHash: 'a'.repeat(64),
  };
}

test('serious subject selection is bounded, deterministic, and includes canonical WAIT', () => {
  const first = selectSeriousResearchSubjects(frontier(), {
    version: seriousSubjectSelectionPolicyVersion,
    topNByBranch: { THETA_CONVENTIONAL: 1, THETA_HOLD_STRIKE: 1, THETA_DEFINED_RISK: 1 },
    maximumCandidateSubjects: 3, includeWait: true,
  });
  const second = selectSeriousResearchSubjects(frontier(), {
    version: seriousSubjectSelectionPolicyVersion,
    topNByBranch: { THETA_CONVENTIONAL: 1, THETA_HOLD_STRIKE: 1, THETA_DEFINED_RISK: 1 },
    maximumCandidateSubjects: 3, includeWait: true,
  });
  assert.deepEqual(first, second);
  assert.equal(first.rawCandidateCount, 5);
  assert.equal(first.longLivedCandidateSubjectCount, 3);
  assert.equal(first.waitSubjectCount, 1);
  const wait = first.subjects.find((subject) => subject.kind === 'WAIT');
  assert.ok(wait);
  assert.equal(wait.brokerAuthority, false);
  assert.equal(wait.orderSubmitted, false);
  assert.equal(wait.candidateId, null);
});

test('H retains H identity and D preserves both exact legs', () => {
  const receipt = selectSeriousResearchSubjects(frontier());
  const h = receipt.subjects.find((subject) => subject.kind === 'CANDIDATE' && subject.candidateId === 'h1');
  const d = receipt.subjects.find((subject) => subject.kind === 'CANDIDATE' && subject.candidateId === 'd1');
  assert.ok(h?.kind === 'CANDIDATE');
  assert.equal(h.branch, 'THETA_HOLD_STRIKE');
  assert.ok(d?.kind === 'CANDIDATE');
  assert.equal(d.branch, 'THETA_DEFINED_RISK');
  assert.deepEqual(d.candidate.legs.map((leg) => leg.optionSymbol), ['d1-SHORT', 'd1-LONG']);
});

test('selected candidate remains selected but gains no execution authority', () => {
  const input = frontier();
  const receipt = selectSeriousResearchSubjects({ ...input, selectedBranch: 'THETA_CONVENTIONAL',
    selectedCandidateId: 'q1', primaryAction: 'OPEN_CSP', selectedQuantity: 1, globalWaitEarned: false,
    globalWaitReasons: [] });
  const selected = receipt.subjects.find((subject) => subject.kind === 'CANDIDATE' && subject.candidateId === 'q1');
  assert.ok(selected?.kind === 'CANDIDATE');
  assert.equal(selected.selected, true);
  assert.equal(selected.brokerAuthority, false);
  assert.equal(selected.orderSubmitted, false);
  assert.equal(selected.brokerFill, false);
  assert.equal(receipt.waitSubjectCount, 0);
});

test('a stale frontier reference fails closed instead of silently losing evidence', () => {
  const input = frontier();
  assert.throws(() => selectSeriousResearchSubjects({ ...input, selectedCandidateId: 'missing' }),
    /SERIOUS_SUBJECT_FRONTIER_REFERENCE_MISSING/);
});
