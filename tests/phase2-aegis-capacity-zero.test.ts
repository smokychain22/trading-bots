import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';
import { classifySizingZero } from '../src/theta/runtime-behavior-diagnostic.js';
import { buildGlobalWaitEvidenceFromFrontier } from '../src/theta/decision-evidence.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';
import { parseStrategyRoutingResponse, type StrategyFamily } from '../src/theta/strategy-router-contract.js';

// Canonical resolution (Phase 2): a VALID candidate on an account that cannot size one contract is a SIZING outcome
// (quantity 0, QUANTITY_ZERO_VALID, a capacity binding constraint, AEGIS state untouched, diagnostic
// ACCOUNT_CAPACITY_ZERO (one canonical label), global wait PORTFOLIO_CAPACITY). It is NOT an AEGIS HARD_VETO, which is
// reserved for a family cap breach or failed/invalid safety input. These tests pin that all four surfaces agree.

const NOW = '2026-09-14T15:00:00.000Z';
const contract = () => normalizeOptionContract({
  source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
  optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-14', multiplier: 100,
  underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
  bid: 2, ask: 2.1, bidSize: 20, askSize: 18, lastTradePrice: 2.05, lastTradeSize: 1,
  quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 250, volumeSource: 'ALPACA', openInterest: 1200,
  openInterestSource: 'OPTIONOMICS', iv: 0.28, delta: -0.22, gamma: 0.01, theta: -0.04, vega: 0.12,
  rho: -0.03, greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'OPRA', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
}, NOW);
const routing = () => parseStrategyRoutingResponse({
  contractVersion: 'theta-strategy-router-runtime-v1', snapshotId: 'snap-1', timestamp: NOW, policyVersion: 'router-v1',
  results: (['THETA_Q', 'THETA_H', 'THETA_R', 'THETA_A', 'THETA_C', 'THETA_D'] as StrategyFamily[]).map((strategyFamily) => ({
    strategyFamily, eligible: strategyFamily === 'THETA_Q',
    eligibilityState: strategyFamily === 'THETA_Q' ? 'ELIGIBLE_CHALLENGER' : 'INELIGIBLE_STATE',
    reasons: [{ code: 'R', polarity: 0, detail: 'test' }], policyVersion: 'router-v1' })),
});
const base = {
  snapshotId: 'snap-1', timestamp: NOW, strategyVersion: 'theta-strategy-package-v1', stock: null,
  assignmentCapacityQty: 2 as number | null, aegisNewRiskState: 'ALLOW_FULL' as const, buyingPower: 100_000 as number | null,
  brokerAllowedQty: 10,
  sizingPolicy: { riskBudgetQtyCap: 4, collateralQtyCap: 4, concentrationQtyCap: 3, assignmentCapacityQtyCap: 3,
    tailRiskQtyCap: 2, correlationQtyCap: 2, liquidityQtyCap: 2, reducedStateMultiplier: 0.5 },
  eventState: 'CLEAR', unmanagedBrokerPositionCount: 0, unevaluatedUnderlyingCount: 0,
  optionomicsContext: { state: 'UNKNOWN' } as const,
};
const run = (overrides: Record<string, unknown>) => {
  const frontier = buildCanonicalStrategyFrontier({ ...base, contracts: [contract()], routing: routing(), ...overrides } as never);
  const conventional = frontier.branches.find((branch) => branch.branch === 'THETA_CONVENTIONAL');
  assert.ok(conventional);
  const candidate = conventional.candidates[0];
  assert.ok(candidate);
  const wait = buildGlobalWaitEvidenceFromFrontier({ frontier, eligibleUnderlyingCount: 1, underlyingsEvaluated: 1,
    existingPositionManagementEvaluated: true, recoveryOpportunitiesEvaluated: true, coveredCallOpportunitiesEvaluated: true,
    redeploymentAlternativesEvaluated: true });
  return { frontier, candidate, wait };
};

test('baseline: ample capital sizes a positive quantity with AEGIS ALLOW_FULL', () => {
  const { candidate, frontier } = run({});
  assert.equal(candidate.aegisState, 'ALLOW_FULL');
  assert.ok(candidate.sizing.quantity > 0);
  assert.equal(classifySizingZero(candidate), null);
  assert.equal(frontier.selectedQuantity, candidate.sizing.quantity);
  assert.equal(frontier.executionAuthorized, false, 'sizing alone never authorizes execution');
});

test('zero assignment capacity: AEGIS stays ALLOW_FULL, sizing is zero with a capacity constraint, diagnostic is CAPACITY_ZERO not HARD_VETO', () => {
  const { candidate, wait, frontier } = run({ assignmentCapacityQty: 0 });
  assert.equal(candidate.aegisState, 'ALLOW_FULL');
  assert.notEqual(candidate.aegisState, 'HARD_VETO');
  assert.equal(candidate.sizing.quantity, 0);
  assert.equal(candidate.sizing.bindingConstraint, 'REAL_ASSIGNMENT_CAPACITY');
  assert.deepEqual(candidate.sizing.reasons, ['QUANTITY_ZERO_VALID']);
  assert.ok(candidate.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.ok(!candidate.hardBlockers.includes('AEGIS_HARD_VETO'));
  assert.equal(candidate.riskFeasible, false);
  assert.equal(classifySizingZero(candidate), 'ACCOUNT_CAPACITY_ZERO');
  assert.equal(wait.reason, 'PORTFOLIO_CAPACITY');
  assert.equal(frontier.selectedCandidateId, null);
  assert.equal(frontier.selectedQuantity, 0);
  assert.equal(frontier.executionAuthorized, false);
});

test('unknown assignment capacity with no buying power is UNKNOWN, never silently zero capacity', () => {
  const { candidate } = run({ assignmentCapacityQty: null, buyingPower: null });
  assert.equal(candidate.assignmentCapacityQty, null);
  assert.ok(candidate.unknownEvidence.includes('ASSIGNMENT_CAPACITY_UNKNOWN'));
  assert.ok(!candidate.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.equal(candidate.sizing.quantity, 0);
  assert.equal(candidate.sizing.bindingConstraint, 'COLLATERAL_INPUT_UNKNOWN');
  assert.equal(classifySizingZero(candidate), 'SIZING_EVIDENCE_UNKNOWN');
});

test('buying power below one contract of collateral and no stated capacity derives zero capacity consistently', () => {
  const { candidate, wait } = run({ assignmentCapacityQty: null, buyingPower: 18_999 });
  assert.equal(candidate.assignmentCapacityQty, 0);
  assert.equal(candidate.aegisState, 'ALLOW_FULL');
  assert.equal(candidate.sizing.quantity, 0);
  assert.ok(candidate.hardBlockers.includes('NO_ASSIGNMENT_CAPACITY'));
  assert.equal(classifySizingZero(candidate), 'ACCOUNT_CAPACITY_ZERO');
  assert.equal(wait.reason, 'PORTFOLIO_CAPACITY');
});

test('exactly one contract of collateral sizes one contract and never rounds a fraction up', () => {
  assert.equal(run({ assignmentCapacityQty: null, buyingPower: 19_000 }).candidate.sizing.quantity, 1);
  assert.equal(run({ assignmentCapacityQty: null, buyingPower: 18_999.99 }).candidate.sizing.quantity, 0);
});

test('stated capacity positive but buying power cannot afford one contract: zero via BUYING_POWER_AFFORDABLE, AEGIS untouched, wait PORTFOLIO_CAPACITY', () => {
  const { candidate, wait } = run({ assignmentCapacityQty: 2, buyingPower: 5_000 });
  assert.equal(candidate.aegisState, 'ALLOW_FULL');
  assert.equal(candidate.sizing.quantity, 0);
  assert.equal(candidate.sizing.bindingConstraint, 'BUYING_POWER_AFFORDABLE');
  assert.deepEqual(candidate.sizing.reasons, ['QUANTITY_ZERO_VALID']);
  assert.equal(classifySizingZero(candidate), 'ACCOUNT_CAPACITY_ZERO', 'CAPZERO-LABEL: buying-power zero uses the one canonical capacity-zero label');
  assert.equal(wait.reason, 'PORTFOLIO_CAPACITY');
});

test('every named zero cap binds as a valid capacity zero and never converts to a HARD_VETO', () => {
  for (const cap of ['riskBudgetQtyCap', 'collateralQtyCap', 'concentrationQtyCap', 'assignmentCapacityQtyCap',
    'tailRiskQtyCap', 'correlationQtyCap', 'liquidityQtyCap']) {
    const { candidate, wait } = run({ sizingPolicy: { ...base.sizingPolicy, [cap]: 0 } });
    assert.equal(candidate.aegisState, 'ALLOW_FULL', cap);
    assert.equal(candidate.sizing.quantity, 0, cap);
    assert.deepEqual(candidate.sizing.reasons, ['QUANTITY_ZERO_VALID'], cap);
    assert.notEqual(classifySizingZero(candidate), 'AEGIS_HARD_VETO', cap);
    assert.equal(wait.reason, 'PORTFOLIO_CAPACITY', cap);
  }
});

test('a missing, negative, NaN or fractional cap is evidence-unknown or invalid, never a capacity zero or a pass', () => {
  for (const bad of [undefined, null, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
    const { candidate } = run({ sizingPolicy: { ...base.sizingPolicy, riskBudgetQtyCap: bad } });
    assert.equal(candidate.sizing.quantity, 0, String(bad));
    assert.match(candidate.sizing.bindingConstraint, /^SIZING_POLICY_(INCOMPLETE|INVALID)$/, String(bad));
    assert.equal(classifySizingZero(candidate), 'SIZING_EVIDENCE_UNKNOWN', String(bad));
  }
});

test('AEGIS HARD_VETO is a different surface from capacity zero: veto blocker, AEGIS binding, HARD_VETO diagnostic', () => {
  const { candidate } = run({ aegisNewRiskState: 'HARD_VETO' });
  assert.equal(candidate.aegisState, 'HARD_VETO');
  assert.equal(candidate.sizing.quantity, 0);
  assert.equal(candidate.sizing.bindingConstraint, 'AEGIS_HARD_VETO');
  assert.ok(candidate.hardBlockers.includes('AEGIS_HARD_VETO'));
  assert.equal(classifySizingZero(candidate), 'AEGIS_HARD_VETO');
  assert.ok(candidate.sizing.waterfall.preAegisQuantity !== null && candidate.sizing.waterfall.preAegisQuantity > 0,
    'pre-AEGIS quantity is preserved so a veto is distinguishable from capacity zero');
});

test('capacity zero and veto together: veto wins the diagnostic (stricter finding is not masked by capacity)', () => {
  const { candidate } = run({ aegisNewRiskState: 'HARD_VETO', assignmentCapacityQty: 0 });
  assert.equal(classifySizingZero(candidate), 'AEGIS_HARD_VETO');
  assert.equal(candidate.sizing.quantity, 0);
});

test('ALLOW_REDUCED with a one-contract cap floors to zero without being a veto, and ALLOW_FULL never reaches max(1, qty)', () => {
  const reduced = run({ aegisNewRiskState: 'ALLOW_REDUCED', assignmentCapacityQty: 1,
    sizingPolicy: { ...base.sizingPolicy, riskBudgetQtyCap: 1, collateralQtyCap: 1, concentrationQtyCap: 1,
      assignmentCapacityQtyCap: 1, tailRiskQtyCap: 1, correlationQtyCap: 1, liquidityQtyCap: 1, reducedStateMultiplier: 0.5 } });
  assert.equal(reduced.candidate.sizing.quantity, 0);
  assert.equal(reduced.candidate.sizing.bindingConstraint, 'AEGIS_ALLOW_REDUCED');
  assert.equal(reduced.candidate.aegisState, 'ALLOW_REDUCED');
  assert.notEqual(classifySizingZero(reduced.candidate), 'AEGIS_HARD_VETO');
});

test('HOLD_ONLY, unknown and DEFINED_RISK_ONLY never size a naked CSP', () => {
  for (const state of ['HOLD_ONLY', 'EMERGENCY_EXIT_ONLY', null] as const) {
    const { candidate } = run({ aegisNewRiskState: state });
    assert.equal(candidate.sizing.quantity, 0, String(state));
    assert.equal(candidate.executionAuthorized, false);
  }
  const defined = run({ aegisNewRiskState: 'DEFINED_RISK_ONLY' });
  assert.ok(defined.candidate.hardBlockers.includes('AEGIS_DEFINED_RISK_ONLY'));
  assert.equal(defined.candidate.riskFeasible, false);
});
