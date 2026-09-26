import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';
import { parseThetaQResponse } from '../src/theta/theta-q-contract.js';

// Phase 3 Final Closure B, item 19: UNKNOWN empirical EV must never behave
// like zero during sort/ranking/serialization/persistence.

const NOW = '2026-09-14T15:00:00.000Z';

function contract(overrides: Partial<Parameters<typeof normalizeOptionContract>[0]> = {}): NormalizedOptionContract {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
    underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
    bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
    quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
    openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
    rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2, ...overrides,
  }, NOW);
}

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({
      strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: eligible.includes(strategyFamily) ? 'ROUTE_APPLICABLE' : 'ROUTE_NOT_APPLICABLE', polarity: 0, detail: 'test route' }],
      policyVersion: 'router-v1',
    })),
  });
}

const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1',
  stock: null, assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3,
    assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2, correlationQtyCap: 2,
    liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: null, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

test('expectedAfterCostEv is null on every canonical candidate action type, never a fabricated zero -- and Pareto ranking never uses it as an objective (traced from source: objectives() has no expectedAfterCostEv dimension)', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_Q']) });
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.economics.expectedAfterCostEv, null);
  // A candidate with unknown EV must still receive a real Pareto rank based
  // on its OTHER real dimensions -- it is never excluded or demoted purely
  // because EV is unknown (EV isn't even consulted).
  assert.ok(typeof candidate.paretoRank === 'number' && candidate.paretoRank >= 1);
});

test('JSON round-trip preserves null EV exactly -- serialization never coerces null to 0', () => {
  const c = contract();
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [c], routing: routing(['THETA_Q']) });
  const candidate = frontier.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate);
  const roundTripped = JSON.parse(JSON.stringify(candidate));
  assert.equal(roundTripped.economics.expectedAfterCostEv, null);
  assert.notEqual(roundTripped.economics.expectedAfterCostEv, 0);
});

test('WAIT VS TRADE (item 30): a feasible candidate selects a real trade; an infeasible one earns real governed GLOBAL_WAIT -- current governed semantics only, no empirical EV invented either way', () => {
  const feasible = contract();
  const caseA = buildCanonicalStrategyFrontier({ ...base, contracts: [feasible], routing: routing(['THETA_Q']) });
  assert.equal(caseA.primaryAction, 'OPEN_CSP');
  assert.notEqual(caseA.selectedCandidateId, null);

  const infeasible = contract({ bid: null, ask: null, delta: null });
  const caseB = buildCanonicalStrategyFrontier({ ...base, aegisNewRiskState: 'HARD_VETO', contracts: [infeasible], routing: routing(['THETA_Q']) });
  assert.equal(caseB.primaryAction, 'GLOBAL_WAIT');
  assert.equal(caseB.selectedCandidateId, null);
  assert.equal(caseB.selectedQuantity, 0);
  // WAIT is never assigned a fabricated numeric EV in either the selected
  // action's economics or anywhere on the frontier itself.
  const q = caseB.branches.find((b) => b.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(q);
  assert.equal(q.economics.expectedAfterCostEv, null);
});

test('a real ev_net=null response from the Q bridge is preserved as null through parseThetaQResponse, never defaulted to 0', () => {
  const response = parseThetaQResponse({
    contractVersion: 'theta-q-runtime-v1', fusionSnapshotHash: 'b'.repeat(64),
    candidates: [{
      candidateId: 'candidate-1', rank: 1, actionFeasible: true, quantity: 1,
      economics: {
        max_profit: 150, break_even_price: 48.5, secured_collateral_per_contract: 5000, credit_collateral_ratio: 0.03,
        ev_net: null, ev_net_unknown_reason: 'No calibrated entry-outcome model is available.',
        commission_per_contract: 0.65, fees_per_contract: 0.05, est_slippage_per_contract: 1.0, cost_model_version: 'TEST-COST-1',
      },
      ownershipScore: 0.72, eligibilityBasis: 'EMPIRICAL_OWNERSHIP', paperBootstrapPolicyVersion: null,
      paperBootstrapAllowedUnknownComponents: [], paperBootstrapReasonCodes: [],
      reasons: [{ code: 'OWNERSHIP_ACCEPTABLE', polarity: 1, detail: 'synthetic fixture' }],
    }],
    wait: { candidateId: 'WAIT', actionFeasible: true, quantity: 0 },
    recommendation: { actionCode: 'OPEN_CSP', selectedCandidateId: 'candidate-1', quantity: 1, executionAuthorized: false, requiresAegis: true, requiresFreshAlpacaBbo: true },
  }, 'b'.repeat(64));
  const economics = response.candidates[0]?.economics;
  assert.ok(economics);
  assert.equal(economics.ev_net, null);
  assert.notEqual(economics.ev_net, 0);
  // A downstream sum/average over multiple candidates' ev_net must skip
  // nulls, never treat them as zero contributions.
  const values = response.candidates.map((c2) => c2.economics?.ev_net).filter((v): v is number => v !== null && v !== undefined);
  assert.equal(values.length, 0, 'no real numeric ev_net exists in this fixture -- an accidental null-to-0 coercion would make this 1');
});
