import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

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

const wide = { riskBudgetQtyCap: 99, collateralQtyCap: 99, concentrationQtyCap: 99, assignmentCapacityQtyCap: 99,
  tailRiskQtyCap: 99, correlationQtyCap: 99, liquidityQtyCap: 99, reducedStateMultiplier: 0.5 };
const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null,
  assignmentCapacityQty: 99, aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 1_000_000, brokerAllowedQty: 99,
  sizingPolicy: wide, eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};
const COLLATERAL = 190 * 100;

/** Quantity of the single CSP candidate under the given overrides. */
function quantity(overrides: Record<string, unknown> = {}): number {
  const frontier = buildCanonicalStrategyFrontier({ ...base, ...overrides, contracts: [contract()], routing: routing(['THETA_Q']) } as never);
  const candidate = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL')?.candidates[0];
  assert.ok(candidate, 'the CSP candidate is visible');
  return candidate.sizing.quantity;
}

test('buying-power boundary is exact to the cent: one cent short yields one fewer contract, zero stays zero (never forced to one)', () => {
  for (const contracts of [1, 2, 3, 5]) {
    assert.equal(quantity({ buyingPower: COLLATERAL * contracts }), contracts, `exactly enough for ${contracts}`);
    assert.equal(quantity({ buyingPower: COLLATERAL * contracts - 0.01 }), contracts - 1, `one cent short of ${contracts}`);
  }
  assert.equal(quantity({ buyingPower: COLLATERAL - 0.01 }), 0, 'one cent below one contract is quantity zero');
  assert.equal(quantity({ buyingPower: 0 }), 0);
});

test('making any single sizing cap stricter can never increase quantity (monotone), and a zero cap yields zero', () => {
  const grid = [99, 6, 5, 4, 3, 2, 1, 0];
  const capKeys = ['riskBudgetQtyCap', 'collateralQtyCap', 'concentrationQtyCap', 'assignmentCapacityQtyCap',
    'tailRiskQtyCap', 'correlationQtyCap', 'liquidityQtyCap'] as const;
  for (const key of capKeys) {
    let previous = Number.POSITIVE_INFINITY;
    for (const value of grid) {
      const q = quantity({ sizingPolicy: { ...wide, [key]: value } });
      assert.ok(q <= previous, `${key}=${value} raised quantity from ${previous} to ${q}`);
      assert.ok(q <= value, `${key}=${value} must bound quantity (got ${q})`);
      previous = q;
    }
  }
  for (const key of ['brokerAllowedQty', 'assignmentCapacityQty'] as const) {
    let previous = Number.POSITIVE_INFINITY;
    for (const value of grid) {
      const q = quantity({ [key]: value });
      assert.ok(q <= previous && q <= value, `${key}=${value} gave ${q}`);
      previous = q;
    }
  }
  let previous = Number.POSITIVE_INFINITY;
  for (const buyingPower of [1_000_000, 120_000, 60_000, 40_000, 19_000, 18_999, 1]) {
    const q = quantity({ buyingPower });
    assert.ok(q <= previous, `buying power ${buyingPower} raised quantity`);
    previous = q;
  }
});

test('the AEGIS state can only hold quantity or reduce it, never raise it above ALLOW_FULL', () => {
  const full = quantity({ aegisNewRiskState: 'ALLOW_FULL', sizingPolicy: { ...wide, tailRiskQtyCap: 4 } });
  const reduced = quantity({ aegisNewRiskState: 'ALLOW_REDUCED', sizingPolicy: { ...wide, tailRiskQtyCap: 4 } });
  assert.ok(reduced <= full);
  for (const blocked of ['HOLD_ONLY', 'HARD_VETO', 'EMERGENCY_EXIT_ONLY'] as const) {
    assert.equal(quantity({ aegisNewRiskState: blocked }), 0, `${blocked} must size to zero`);
  }
  assert.equal(quantity({ aegisNewRiskState: null }), 0, 'unknown AEGIS sizes to zero, not to a default');
});

test('metamorphic: contract order, identical duplicates and provider ordering never change the production decision', () => {
  const contracts = [contract(), contract({ optionSymbol: 'AAPL261016P00185000', occSymbol: 'AAPL261016P00185000', strike: 185, delta: -0.18, bid: 1.5, ask: 1.6 }),
    contract({ optionSymbol: 'AAPL261016P00180000', occSymbol: 'AAPL261016P00180000', strike: 180, delta: -0.14, bid: 1.1, ask: 1.2 })];
  const decide = (input: readonly NormalizedOptionContract[]) => {
    const frontier = buildCanonicalStrategyFrontier({ ...base, sizingPolicy: { ...wide, tailRiskQtyCap: 3 },
      contracts: input, routing: routing(['THETA_Q']) } as never);
    const candidates = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL')?.candidates ?? [];
    return { action: frontier.primaryAction, selected: frontier.selectedCandidateId, quantity: frontier.selectedQuantity,
      ids: candidates.map((candidate) => candidate.candidateId).sort(), sizing: Object.fromEntries(
        candidates.map((candidate) => [candidate.candidateId, candidate.sizing.quantity])) };
  };
  const reference = decide(contracts);
  assert.deepEqual(decide([...contracts].reverse()), reference);
  assert.deepEqual(decide([contracts[1] as NormalizedOptionContract, contracts[2] as NormalizedOptionContract, contracts[0] as NormalizedOptionContract]), reference);
  const duplicated = decide([...contracts, contracts[0] as NormalizedOptionContract, contracts[0] as NormalizedOptionContract]);
  assert.deepEqual(duplicated.ids, reference.ids, 'identical duplicates create no extra candidates');
  assert.equal(duplicated.selected, reference.selected);
  assert.equal(duplicated.quantity, reference.quantity, 'identical duplicates cannot amplify quantity');
});

test('an AEGIS hold caused by an UNKNOWN required input is never an earned WAIT, while a genuine veto remains one', () => {
  const id = 'THETA_CONVENTIONAL:AAPL261016P00190000';
  const run = (state: 'HOLD_ONLY' | 'HARD_VETO', reasons: readonly string[]) => buildCanonicalStrategyFrontier({
    ...base, aegisNewRiskStateByCandidateId: { [id]: state }, aegisBindingReasonsByCandidateId: { [id]: reasons },
    contracts: [contract()], routing: routing(['THETA_Q']) } as never);
  const unknownHold = run('HOLD_ONLY', ['LIQUIDITY:SPREAD_WIDENING_UNKNOWN']);
  assert.equal(unknownHold.selectedQuantity, 0);
  assert.equal(unknownHold.globalWaitEarned, false, 'unknown required evidence cannot earn a WAIT');
  assert.equal(unknownHold.primaryAction, 'SYSTEM_HOLD');
  const veto = run('HARD_VETO', ['UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED']);
  assert.equal(veto.selectedQuantity, 0);
  assert.equal(veto.globalWaitEarned, true, 'a real risk veto is an earned WAIT');
});
