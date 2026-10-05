import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildCanonicalDecisionExplanation } from '../src/theta/decision-explainability.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';

const candidate = {
  candidateId: 'THETA_CONVENTIONAL:SPY261106P00500000', branch: 'THETA_CONVENTIONAL', action: 'OPEN_CSP',
  underlying: 'SPY', legs: [{ positionIntent: 'SELL_TO_OPEN', optionSymbol: 'SPY261106P00500000', optionType: 'PUT',
    strike: 500, expiration: '2026-11-06', multiplier: 100, bid: 2, ask: 2.1, quoteTimestamp: '2026-10-01T15:00:00Z' }],
  dte: 36, delta: -0.2, moneyness: 0.83, spreadPct: 0.05, liquidity: { volume: 50, openInterest: 1000 },
  shortDteRiskEvidence: null, multiLegRiskEvidence: null,
  economics: { premiumPerShare: 2, grossPremium: 200, collateral: 50_000, maxProfit: 200, maxLoss: 49_800,
    breakEven: 498, downsideCushion: 102, retainedUpside: null, callAwayProceeds: null, wholeChainPnlAtCallAway: null,
    grossReturnOnCollateral: 0.004, capitalDayYield: 0.0001,
    modeledOpeningCosts: { state: 'KNOWN_MODELED', reason: null, costModelVersion: 'cost-v1', optionLegCount: 1,
      commission: 0.65, fees: 0.05, slippage: 1, total: 1.7, netPremiumAfterOpeningCost: 198.3,
      maxProfitAfterOpeningCost: 198.3, maxLossAfterOpeningCost: 49_801.7,
      returnOnCollateralAfterOpeningCost: 0.003966, capitalDayYieldAfterOpeningCost: 0.00011 },
    expectedAfterCostEv: null },
  assignmentCapacityQty: 1, aegisState: 'ALLOW_FULL', hardBlockers: [], softEvidence: ['EVENT_STATE:CLEAR'],
  unknownEvidence: ['IV_UNKNOWN'], structurallyFeasible: true, riskFeasible: true,
  sizing: { quantity: 1, bindingConstraint: 'BROKER_ALLOWED', reasons: ['STRUCTURAL_SIZING_COMPUTED'],
    waterfall: { version: 'theta-canonical-sizing-waterfall-v1', candidateId: 'THETA_CONVENTIONAL:SPY261106P00500000',
      snapshotId: 'snap', asOf: '2026-10-01T15:00:00Z', policyVersion: 'policy-v1', quantityUnit: 'CONTRACTS',
      caps: [{ name: 'BROKER_ALLOWED', value: 1, state: 'KNOWN' }], preAegisQuantity: 1, aegisState: 'ALLOW_FULL',
      reducedMultiplier: 0.5, capitalBudget: {} } },
  paretoRank: 1, dominatedBy: [], executionAuthorized: false,
} as const;

const neighboringStrike = {
  ...candidate,
  candidateId: 'THETA_CONVENTIONAL:SPY261106P00495000',
  legs: [{ ...candidate.legs[0], optionSymbol: 'SPY261106P00495000', strike: 495 }],
  delta: -0.18,
  economics: { ...candidate.economics, grossPremium: 170, collateral: 49_500, breakEven: 493.3,
    downsideCushion: 106.7, modeledOpeningCosts: { ...candidate.economics.modeledOpeningCosts,
      capitalDayYieldAfterOpeningCost: 0.00009 } },
} as const;

const neighboringExpiry = {
  ...candidate,
  candidateId: 'THETA_CONVENTIONAL:SPY261113P00500000',
  legs: [{ ...candidate.legs[0], optionSymbol: 'SPY261113P00500000', expiration: '2026-11-13' }],
  dte: 43,
  economics: { ...candidate.economics, grossPremium: 230, modeledOpeningCosts: {
    ...candidate.economics.modeledOpeningCosts, capitalDayYieldAfterOpeningCost: 0.000095 } },
} as const;

const frontier = {
  contractVersion: 'theta-canonical-strategy-frontier-v1', snapshotId: 'snap', timestamp: '2026-10-01T15:00:00Z',
  strategyVersion: 'strategy-v1', decisionAuthorityVersion: 'theta-canonical-decision-authority-v1',
  branches: [{ branch: 'THETA_CONVENTIONAL', strategyVersion: 'strategy-v1', status: 'SHADOW', applicable: true,
    evaluated: true, routeReasons: ['ROUTE_APPLICABLE'], evaluationState: 'EVALUATED', candidateCount: 1,
    mechanicallyRejected: 0, enumerationTruncated: false, hardVetoed: 0, softRanked: 1, dataInsufficient: 0,
    candidates: [candidate, neighboringStrike, neighboringExpiry], bestCandidateId: candidate.candidateId,
    secondBestCandidateId: neighboringStrike.candidateId,
    bestRejectedCandidateId: null, empiricalEconomicsReady: false, executionAuthorized: false }],
  branchesConsidered: ['THETA_CONVENTIONAL'], branchesEvaluated: ['THETA_CONVENTIONAL'],
  selectedBranch: 'THETA_CONVENTIONAL', selectedCandidateId: candidate.candidateId,
  entrySelectionBasis: 'THETA_Q_DECISION_BOUND', primaryAction: 'OPEN_CSP', selectedQuantity: 1,
  empiricalUtilityState: 'UNKNOWN_NOT_YET_CALIBRATED', secondBestCandidateId: null,
  structuralTopTwo: {}, nearMissCandidateId: null, bestRejectedCandidateId: null, globalWaitEarned: false,
  globalWaitReasons: [], empiricalEconomicsReady: false, executionAuthorized: false, optionomicsContext: {},
  definedRiskLockedPlan: {}, contentHash: '0'.repeat(64),
} as unknown as CanonicalStrategyFrontier;

test('canonical explanation answers underlying, strategy, expiry, strike, time and size without inventing EV', () => {
  const result = buildCanonicalDecisionExplanation({ frontier, qEntryFunnel: null });
  assert.equal(result.whyUnderlying.underlying, 'SPY');
  assert.equal(result.whyStrategy.branch, 'THETA_CONVENTIONAL');
  assert.equal(result.whyExpiry.expiration, '2026-11-06');
  assert.equal(result.whyStrike.strike, 500);
  assert.equal(result.whyNow.aegisState, 'ALLOW_FULL');
  assert.equal(result.whyNow.state, 'ENTER_NOW_STRUCTURALLY_ELIGIBLE');
  assert.equal(result.whyExpiry.neighboringExpiries[0]?.candidateId, neighboringExpiry.candidateId);
  assert.equal(result.whyStrike.neighboringStrikes[0]?.candidateId, neighboringStrike.candidateId);
  assert.equal(result.whyStrike.neighboringStrikes[0]?.capitalDayYieldAfterOpeningCost, 0.00009);
  assert.equal(result.whySize.quantity, 1);
  assert.equal(result.whySize.bindingConstraint, 'BROKER_ALLOWED');
  assert.equal(result.empiricalUtilityState, 'UNKNOWN_NOT_YET_CALIBRATED');
  assert.equal(result.executionAuthorized, false);
});

test('unreached frontier stays an explicit system hold', () => {
  const result = buildCanonicalDecisionExplanation({ frontier: null, qEntryFunnel: null });
  assert.equal(result.action, 'SYSTEM_HOLD');
  assert.equal(result.whyUnderlying.state, 'NOT_REACHED');
  assert.equal(result.whySize.quantity, null);
  assert.ok(result.whyNow.waitReasons.includes('CANONICAL_FRONTIER_NOT_REACHED'));
});

test('a reached frontier with no selected candidate reports a timing conclusion rather than NOT_REACHED', () => {
  const waiting = { ...frontier, selectedBranch: null, selectedCandidateId: null, selectedAction: 'WAIT',
    globalWaitEarned: true, globalWaitReasons: ['WAIT_LIQUIDITY_QUOTE_STALE'] } as const;
  const result = buildCanonicalDecisionExplanation({ frontier: waiting, universe: null });
  assert.equal(result.whyNow.state, 'DEFER_EXECUTION_QUALITY');
  assert.deepEqual(result.whyNow.waitReasons, ['WAIT_LIQUIDITY_QUOTE_STALE']);
});

test('canonical persistence embeds the structured explanation in the existing receipt', () => {
  const source = readFileSync(new URL('../src/theta/postgres-theta-cycle-store.ts', import.meta.url), 'utf8');
  assert.match(source, /buildCanonicalDecisionExplanation/);
  assert.match(source, /releaseIdentity: releaseIdentityPayload, decisionExplanation/);
});
