import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CanonicalBranchFrontier,
  CanonicalFrontierCandidate,
  CanonicalStrategyFrontier,
} from '../src/theta/canonical-strategy-frontier.js';
import { projectCanonicalStrategyEvidence } from '../src/theta/postgres-theta-cycle-store.js';

const candidate = (
  branch: CanonicalFrontierCandidate['branch'],
  candidateId: string,
  action: CanonicalFrontierCandidate['action'],
  quantity: number,
  legCount: number,
): CanonicalFrontierCandidate => ({
  candidateId,
  branch,
  action,
  underlying: 'SPY',
  legs: Array.from({ length: legCount }, (_, index) => ({
    positionIntent: index === 0 ? 'SELL_TO_OPEN' : 'BUY_TO_OPEN',
    optionSymbol: `SPY260117P00${500 - index}000`,
    optionType: 'PUT',
    strike: 500 - index,
    expiration: '2026-01-17',
    multiplier: 100,
    bid: 2 - index * 0.5,
    ask: 2.1 - index * 0.5,
    quoteTimestamp: '2026-01-02T15:00:00.000Z',
  })),
  dte: legCount === 0 ? null : 15,
  delta: legCount === 0 ? null : -0.2,
  moneyness: legCount === 0 ? null : -0.03,
  spreadPct: legCount === 0 ? null : 0.05,
  liquidity: { volume: legCount === 0 ? null : 100, openInterest: legCount === 0 ? null : 1_000 },
  economics: {
    premiumPerShare: null,
    grossPremium: null,
    collateral: null,
    maxProfit: null,
    maxLoss: null,
    breakEven: null,
    downsideCushion: null,
    retainedUpside: null,
    callAwayProceeds: null,
    wholeChainPnlAtCallAway: null,
    capitalDayYield: null,
    expectedAfterCostEv: null,
  },
  assignmentCapacityQty: null,
  hardBlockers: [],
  softEvidence: [],
  unknownEvidence: ['EMPIRICAL_EV_UNKNOWN'],
  structurallyFeasible: true,
  riskFeasible: true,
  sizing: { quantity, bindingConstraint: quantity === 0 ? 'WAIT_ACTION' : 'RISK_BUDGET', reasons: [] },
  paretoRank: 1,
  dominatedBy: [],
  executionAuthorized: false,
});

const branch = (
  name: CanonicalFrontierCandidate['branch'],
  candidates: readonly CanonicalFrontierCandidate[],
): CanonicalBranchFrontier => ({
  branch: name,
  strategyVersion: `${name.toLowerCase()}-v1`,
  status: name === 'THETA_DEFINED_RISK' ? 'RESEARCH_ONLY' : 'SHADOW',
  applicable: true,
  evaluated: true,
  routeReasons: [],
  evaluationState: 'EVALUATED',
  candidateCount: candidates.length,
  mechanicallyRejected: 0,
  enumerationTruncated: false,
  hardVetoed: 0,
  softRanked: candidates.length,
  dataInsufficient: candidates.filter((item) => item.unknownEvidence.length > 0).length,
  candidates,
  bestCandidateId: candidates[0]?.candidateId ?? null,
  secondBestCandidateId: null,
  bestRejectedCandidateId: null,
  empiricalEconomicsReady: false,
  executionAuthorized: false,
});

test('projects all canonical branches without flattening multi-leg or no-order actions', () => {
  const conventional = candidate('THETA_CONVENTIONAL', 'conventional-put', 'OPEN_CSP', 1, 1);
  const holdStrike = candidate('THETA_HOLD_STRIKE', 'hold-strike-put', 'OPEN_CSP', 1, 1);
  const definedRisk = candidate('THETA_DEFINED_RISK', 'put-credit-spread', 'OPEN_DEFINED_RISK', 1, 2);
  const recoveryWait = candidate('THETA_RECOVERY', 'recovery-wait', 'RECOVERY_WAIT', 0, 0);
  const coveredCall = candidate('THETA_CC', 'covered-call', 'SELL_CC', 1, 1);
  const branches = [
    branch('THETA_CONVENTIONAL', [conventional]),
    branch('THETA_HOLD_STRIKE', [holdStrike]),
    branch('THETA_DEFINED_RISK', [definedRisk]),
    branch('THETA_RECOVERY', [recoveryWait]),
    branch('THETA_CC', [coveredCall]),
  ];
  const frontier = {
    contractVersion: 'theta-canonical-strategy-frontier-v1',
    snapshotId: 'snapshot',
    timestamp: '2026-01-02T15:00:00.000Z',
    strategyVersion: 'theta-strategy-package-v1',
    decisionAuthorityVersion: 'theta-canonical-decision-authority-v1',
    branches,
    branchesConsidered: branches.map((item) => item.branch),
    branchesEvaluated: branches.map((item) => item.branch),
    selectedBranch: 'THETA_DEFINED_RISK',
    selectedCandidateId: definedRisk.candidateId,
    primaryAction: 'OPEN_DEFINED_RISK',
    selectedQuantity: 1,
    empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED',
    secondBestCandidateId: holdStrike.candidateId,
    nearMissCandidateId: conventional.candidateId,
    bestRejectedCandidateId: null,
    globalWaitEarned: false,
    globalWaitReasons: [],
    empiricalEconomicsReady: false,
    executionAuthorized: false,
    optionomicsContext: null,
    contentHash: '0'.repeat(64),
  } satisfies CanonicalStrategyFrontier;

  const projection = projectCanonicalStrategyEvidence(frontier);
  assert.equal(projection.length, 5);
  assert.equal(projection.flatMap((item) => item.candidates).length, 5);
  assert.equal(projection.find((item) => item.branch.branch === 'THETA_DEFINED_RISK')?.candidates[0]?.candidate.legs.length, 2);
  assert.equal(projection.find((item) => item.branch.branch === 'THETA_RECOVERY')?.candidates[0]?.candidate.sizing.quantity, 0);
  assert.deepEqual(
    projection.flatMap((item) => item.candidates).filter((item) => item.selected).map((item) => item.candidate.candidateId),
    ['put-credit-spread'],
  );
});

test('rejects an inconsistent branch candidate count before persistence', () => {
  const item = candidate('THETA_CONVENTIONAL', 'conventional-put', 'OPEN_CSP', 1, 1);
  const inconsistent = { ...branch('THETA_CONVENTIONAL', [item]), candidateCount: 2 };
  const frontier = {
    branches: [inconsistent],
    selectedCandidateId: null,
  } as unknown as CanonicalStrategyFrontier;
  assert.throws(() => projectCanonicalStrategyEvidence(frontier), /CANONICAL_BRANCH_CANDIDATE_COUNT_MISMATCH/);
});
