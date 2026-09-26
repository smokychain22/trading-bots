import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2 (Master Build/Hardening Program), THETA-CANONICAL-FRONTIER-NO-PER-
// BRANCH-ISOLATION closure. Proves a branch-specific construction failure
// cannot destroy an unrelated, valid branch's frontier -- and that a
// shared/global-state failure still correctly invalidates the whole cycle.

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
  assignmentCapacityQty: 2, aegisNewRiskState: 'ALLOW_FULL' as const,
  buyingPower: 100_000, brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3,
    assignmentCapacityQtyCap: 3, tailRiskQtyCap: 2, correlationQtyCap: 2,
    liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

// A hostile stock-state object whose `currentPrice` getter throws when
// read -- models a real-world failure class (a lazily-computed/derived
// field that raises instead of returning a value). `shares` (the field
// used for the shared, hoisted applicability/managementAuthorityRequired
// determination) returns a normal safe value, so THETA_RECOVERY is
// genuinely applicable and only fails later, inside its own branch-local
// candidate construction (`stockActionCandidate` reading `currentPrice`) --
// this is deliberately NOT the shared shares-existence read, which is
// correctly hoisted and must remain a global fault boundary (see the third
// test below). THETA_CONVENTIONAL's single-leg PUT candidate construction
// never touches `input.stock` at all.
function hostileStock() {
  return new Proxy({ shares: 100, currentPrice: 100, brokerCostBasisPerShare: 90, wholeChainEconomicBasisPerShare: 90 }, {
    get(target, prop) {
      if (prop === 'currentPrice') throw new Error('SIMULATED_STOCK_CURRENT_PRICE_READ_FAILURE');
      return Reflect.get(target, prop);
    },
  });
}

test('CORE CLAIM: a THETA_RECOVERY-specific construction failure does not prevent a valid THETA_CONVENTIONAL frontier from being produced', () => {
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: hostileStock() as never,
    contracts: [contract()], routing: routing(['THETA_Q', 'THETA_R']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional, 'THETA_CONVENTIONAL branch must still be present in the frontier');
  assert.equal(conventional.evaluationState, 'EVALUATED');
  assert.ok(conventional.candidates.length > 0, 'Q must still produce real candidates despite Recovery failing');

  const recovery = frontier.branches.find((branch) => branch.branch === 'THETA_RECOVERY');
  assert.ok(recovery, 'THETA_RECOVERY branch must still appear in the output, marked as failed, not silently dropped');
  assert.equal(recovery.evaluationState, 'BRANCH_CONSTRUCTION_FAILED');
  assert.ok(recovery.routeReasons.some((reason) => reason.includes('SIMULATED_STOCK_CURRENT_PRICE_READ_FAILURE') || reason === 'BRANCH_CONSTRUCTION_EXCEPTION'),
    `expected a real, typed failure reason on the recovery branch, got: ${recovery.routeReasons.join(', ')}`);
});

test('a stock-existence read failure (shared/hoisted) still invalidates the whole frontier -- it is safety-relevant account state, not a branch-local candidate detail', () => {
  const hostileSharesOnly = new Proxy({ shares: 0, currentPrice: 100, brokerCostBasisPerShare: 90, wholeChainEconomicBasisPerShare: 90 }, {
    get(target, prop) {
      if (prop === 'shares') throw new Error('SIMULATED_SHARED_STOCK_SHARES_READ_FAILURE');
      return Reflect.get(target, prop);
    },
  });
  assert.throws(() => buildCanonicalStrategyFrontier({
    ...base, stock: hostileSharesOnly as never, contracts: [contract()], routing: routing(['THETA_Q']),
  }), /SIMULATED_SHARED_STOCK_SHARES_READ_FAILURE/);
});

test('a THETA_DEFINED_RISK-specific failure does not prevent THETA_CONVENTIONAL', () => {
  // Force D's nested-loop construction to throw by making the contracts
  // array itself throw when iterated a second time (D iterates `puts` in a
  // nested double loop; a hostile array whose Symbol.iterator throws on the
  // second full pass models a real "iterator exhausted/corrupted mid-loop"
  // failure class without touching Q's single first-pass filter/map).
  let iterationCount = 0;
  const contracts = [contract()];
  const hostileContracts = new Proxy(contracts, {
    get(target, prop, receiver) {
      if (prop === Symbol.iterator) {
        iterationCount += 1;
        if (iterationCount > 2) throw new Error('SIMULATED_CONTRACT_ITERATION_FAILURE');
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const frontier = buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: hostileContracts as never,
    routing: routing(['THETA_Q', 'THETA_D']),
  });
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  assert.equal(conventional.evaluationState, 'EVALUATED');
  assert.ok(conventional.candidates.length > 0);
});

test('a shared/global input failure (routing itself throws on read) still invalidates the whole frontier -- isolation must not mask genuinely global failures', () => {
  // input.routing is read identically by EVERY branch (`input.routing?.results.find(...)`)
  // -- unlike the per-branch construction steps above, a failure here is a
  // genuinely shared/global fault, not a single branch's problem, and must
  // remain a hard, visible failure rather than being silently isolated away.
  const hostileRouting = new Proxy({ results: [] as unknown[] }, {
    get(target, prop) {
      if (prop === 'results') throw new Error('SIMULATED_SHARED_ROUTING_READ_FAILURE');
      return Reflect.get(target, prop);
    },
  });
  assert.throws(() => buildCanonicalStrategyFrontier({
    ...base, stock: null, contracts: [contract()], routing: hostileRouting as never,
  }), /SIMULATED_SHARED_ROUTING_READ_FAILURE/);
});
