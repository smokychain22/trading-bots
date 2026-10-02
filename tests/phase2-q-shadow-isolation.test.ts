import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier, type CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Phase 2 area Q item 7: a THETA_H (hold-strike) or THETA_D (defined-risk) SHADOW
// evaluation failure or missing feature can never block Q, create a production
// WAIT/SYSTEM_HOLD, or change Q candidate selection, quantity or sizing. Extends
// canonical-frontier-branch-isolation.test.ts with a deterministic adversarial
// sweep over H/D-only contract defects and router/feature variations.

const NOW = '2026-10-01T15:00:00.000Z';
type Raw = Parameters<typeof normalizeOptionContract>[0];
const rawContract = (over: Partial<Raw> = {}): Raw => ({
  source: 'ALPACA', underlying: 'SPY', optionSymbol: 'SPY261106P00500000', occSymbol: 'SPY261106P00500000',
  optionType: 'PUT', strike: 500, expiration: '2026-11-06', asOfDate: '2026-10-01', multiplier: 100,
  underlyingBid: 599.9, underlyingAsk: 600.1, underlyingLast: 600, underlyingTimestamp: NOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
  quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
  openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
  rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.15, ...over,
});
const contract = (over: Partial<Raw> = {}): NormalizedOptionContract => normalizeOptionContract(rawContract(over), NOW);

function routing(eligible: readonly StrategyFamily[]) {
  const families: readonly StrategyFamily[] = ['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'];
  return parseStrategyRoutingResponse({
    contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
    results: families.map((strategyFamily) => ({ strategyFamily, eligible: eligible.includes(strategyFamily),
      eligibilityState: eligible.includes(strategyFamily) ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
      reasons: [{ code: 'ROUTE', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
  });
}
const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'v', stock: null, assignmentCapacityQty: 9,
  aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 10_000_000, brokerAllowedQty: 9,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 3, concentrationQtyCap: 5, assignmentCapacityQtyCap: 6,
    tailRiskQtyCap: 3, correlationQtyCap: 3, liquidityQtyCap: 3, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR' as const, unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};

const sym = (strike: number, expiry: string) => `SPY${expiry}P${String(strike * 1000).padStart(8, '0')}`;
const qContracts = [
  contract({ bid: 3, ask: 3.1 }),
  contract({ optionSymbol: sym(495, '261106'), occSymbol: sym(495, '261106'), strike: 495, delta: -0.2, bid: 2.5, ask: 2.6 }),
  contract({ optionSymbol: sym(480, '261106'), occSymbol: sym(480, '261106'), strike: 480, delta: -0.12, bid: 1.2, ask: 1.25 }),
];

const qView = (frontier: CanonicalStrategyFrontier) => {
  const branch = frontier.branches.find((item) => item.branch === 'THETA_CONVENTIONAL');
  return {
    evaluationState: branch?.evaluationState, candidates: branch?.candidates, bestCandidateId: branch?.bestCandidateId,
    primaryAction: frontier.primaryAction, selectedBranch: frontier.selectedBranch,
    selectedCandidateId: frontier.selectedCandidateId, selectedQuantity: frontier.selectedQuantity,
    globalWaitEarned: frontier.globalWaitEarned, globalWaitReasons: frontier.globalWaitReasons,
  };
};
const run = (contracts: readonly NormalizedOptionContract[], eligible: readonly StrategyFamily[] = ['THETA_Q'], over: Record<string, unknown> = {}) =>
  buildCanonicalStrategyFrontier({ ...base, ...over, contracts, routing: routing(eligible) } as never);

const reference = qView(run(qContracts));

test('reference: Q alone selects a positive-quantity candidate (so the isolation claims below are non-vacuous)', () => {
  assert.equal(reference.evaluationState, 'EVALUATED');
  assert.equal(reference.primaryAction, 'OPEN_CSP');
  assert.ok(reference.selectedQuantity > 0);
  assert.equal(reference.selectedBranch, 'THETA_CONVENTIONAL');
});

test('H/D router eligibility, missing H features and missing D legs never change Q candidates, selection, quantity or WAIT status', () => {
  const variants: [string, ReturnType<typeof run>][] = [
    ['H and D routed eligible', run(qContracts, ['THETA_Q', 'THETA_H', 'THETA_D'])],
    ['H eligible, no gap evidence', run(qContracts, ['THETA_Q', 'THETA_H'], { maxAdverseGap60d: null })],
    ['H eligible, gap evidence present', run(qContracts, ['THETA_Q', 'THETA_H'], { maxAdverseGap60d: 0.2 })],
    ['router result unavailable for H/D only', run(qContracts, ['THETA_Q'])],
    ['provider order reversed', run([...qContracts].reverse(), ['THETA_Q', 'THETA_H', 'THETA_D'])],
  ];
  for (const [name, frontier] of variants) assert.deepEqual(qView(frontier), reference, name);
});

test('H-window (DTE 2-5) and D-structure contracts with missing/invalid features never block Q or alter its result', () => {
  const hOnly = (over: Partial<Raw>) => contract({ optionSymbol: sym(497, '261005'), occSymbol: sym(497, '261005'),
    strike: 497, expiration: '2026-10-05', ...over });
  const defects: Partial<Raw>[] = [
    { gamma: null, theta: null, greeksSource: 'OPTIONOMICS' },
    { delta: null, gamma: null, theta: null, vega: null, rho: null, iv: null, greeksSource: null },
    { bid: null }, { ask: null }, { bid: null, ask: null }, { bid: 3, ask: 2 }, { bid: 0, ask: 0.05 },
    { volume: null, volumeSource: null }, { openInterest: null, openInterestSource: null },
    { quoteTimestamp: null }, { quoteTimestamp: '2026-10-01T16:00:00.000Z' }, { dataQuality: 'STALE' }, { dataQuality: 'UNKNOWN' },
    { underlyingBid: null, underlyingAsk: null, underlyingLast: null }, { multiplier: 50 }, { occSymbol: null },
    { optionSymbol: 'NOT-AN-OCC-SYMBOL', occSymbol: 'NOT-AN-OCC-SYMBOL' }, { strike: 0.01 }, { strike: 1e9 },
    { source: 'OPTIONOMICS' }, { feed: null }, { contractTradable: false, exerciseStyle: null },
  ];
  for (const [index, defect] of defects.entries()) {
    let frontier: CanonicalStrategyFrontier | undefined;
    assert.doesNotThrow(() => { frontier = run([...qContracts, hOnly(defect)], ['THETA_Q', 'THETA_H', 'THETA_D']); },
      `H-only defect #${index} ${JSON.stringify(defect)} must not throw out of the frontier`);
    assert.ok(frontier);
    assert.deepEqual(qView(frontier), reference, `H-only defect #${index} ${JSON.stringify(defect)} changed Q`);
    assert.notEqual(frontier.primaryAction, 'SYSTEM_HOLD');
    assert.equal(frontier.globalWaitEarned, false);
  }
});

test('D-structure defects (extra short/long legs in the D window) never block Q or alter its result', () => {
  const extra = (strike: number, over: Partial<Raw> = {}) => contract({ optionSymbol: sym(strike, '261015'), occSymbol: sym(strike, '261015'),
    strike, expiration: '2026-10-15', delta: -0.1, bid: 1, ask: 1.05, ...over });
  const defects: Partial<Raw>[] = [{}, { bid: null }, { ask: null }, { quoteTimestamp: null }, { dataQuality: 'STALE' }, { multiplier: 50 },
    { occSymbol: null }, { optionSymbol: 'ZZ', occSymbol: 'ZZ' }, { strike: 0.5 }, { bid: 9, ask: 1 }];
  for (const [index, defect] of defects.entries()) {
    let frontier: CanonicalStrategyFrontier | undefined;
    assert.doesNotThrow(() => { frontier = run([...qContracts, extra(450, defect), extra(440)], ['THETA_Q', 'THETA_D']); },
      `D-structure defect #${index} ${JSON.stringify(defect)} must not throw out of the frontier`);
    assert.ok(frontier);
    assert.deepEqual(qView(frontier), reference, `D defect #${index} ${JSON.stringify(defect)} changed Q`);
  }
});

test('D enumeration bound reached (1,000 structures) is shadow-only: Q still evaluated, still selects, never WAIT/HOLD', () => {
  const many: NormalizedOptionContract[] = [];
  for (let strike = 300; strike < 352; strike++) {
    many.push(contract({ optionSymbol: sym(strike, '261120'), occSymbol: sym(strike, '261120'), strike, expiration: '2026-11-20',
      delta: -0.05, bid: 0.5, ask: 0.52 }));
  }
  const frontier = run([...qContracts, ...many], ['THETA_Q', 'THETA_D']);
  const d = frontier.branches.find((branch) => branch.branch === 'THETA_DEFINED_RISK');
  assert.equal(d?.enumerationTruncated, true, 'the fixture must actually reach the D bound');
  assert.equal(frontier.primaryAction, 'OPEN_CSP');
  assert.equal(frontier.selectedBranch, 'THETA_CONVENTIONAL');
  assert.ok(frontier.selectedQuantity > 0);
  assert.equal(frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL')?.evaluationState, 'EVALUATED');
});

test('H/D candidates are never selectable production actions even when they strictly dominate Q on every objective', () => {
  const dominantHold = contract({ optionSymbol: sym(499, '261005'), occSymbol: sym(499, '261005'), strike: 499,
    expiration: '2026-10-05', bid: 50, ask: 50.01, delta: -0.05 });
  const frontier = run([...qContracts, dominantHold], ['THETA_H', 'THETA_D']);
  assert.notEqual(frontier.selectedBranch, 'THETA_HOLD_STRIKE');
  assert.notEqual(frontier.selectedBranch, 'THETA_DEFINED_RISK');
  const hold = frontier.branches.find((branch) => branch.branch === 'THETA_HOLD_STRIKE');
  assert.ok(hold && hold.candidates.every((candidate) => candidate.executionAuthorized === false));
  assert.equal(frontier.executionAuthorized, false);
});

test('Q construction failure is NOT masked by healthy shadow branches (no false production WAIT), while shadow failures stay local', () => {
  const hostile = new Proxy([...qContracts], {
    get(target, prop, receiver) {
      if (prop === 'filter') throw new Error('SIMULATED_Q_ONLY_FAILURE');
      return Reflect.get(target, prop, receiver);
    },
  });
  const frontier = run(hostile as never, ['THETA_Q', 'THETA_H', 'THETA_D']);
  assert.equal(frontier.globalWaitEarned, false);
  assert.notEqual(frontier.primaryAction, 'GLOBAL_WAIT');
  assert.ok(frontier.globalWaitReasons.some((reason) => reason.startsWith('BRANCH_NOT_FULLY_EVALUATED:THETA_CONVENTIONAL')));
});
