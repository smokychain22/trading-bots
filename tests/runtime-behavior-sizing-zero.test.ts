import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRuntimeBehavior, classifySizingZero, deriveAntiParalysisFindings, runtimeBehaviorDiagnosticVersion,
  summarizeSizingZero, type RuntimeBehaviorDiagnosticInput } from '../src/theta/runtime-behavior-diagnostic.js';

const zero = (bindingConstraint: string, hardBlockers: readonly string[] = []) =>
  ({ hardBlockers, sizing: { quantity: 0, bindingConstraint } });

const input = (overrides: Partial<RuntimeBehaviorDiagnosticInput> = {}): RuntimeBehaviorDiagnosticInput => ({
  scanId: '11111111-1111-4111-8111-111111111111', decisionIds: [], observedAt: '2026-10-01T14:00:00.000Z',
  session: 'OPEN', universeSize: 3, strategiesConsidered: 10, strategiesApplicable: 2, strategiesRejected: 8, strategyDiagnostics: [],
  completeness: 'COMPLETE', globalWaitEarned: false, globalWaitReasons: [],
  candidateCount: 100, feasibleCandidateCount: 4, selectedCandidateCount: 0, hardRejectedCount: 96, softRankedCount: 4,
  dataInsufficientCount: 0, quantityZeroCount: 100, aegisVetoCount: 0, nearMissCount: 1, providerBlockers: [],
  softEconomicRejectionCount: 0, dataUnknownRejectionCount: 0, quoteRejectionCount: 0, liquidityRejectionCount: 0,
  hardGateCounts: {}, finalAction: 'SYSTEM_HOLD', waitReasons: [], bestRejectedCandidates: [], antiParalysisFindings: [],
  actionPlansReady: 0, actionPlanBlockers: [], ...overrides,
});

test('every zero-quantity cause is distinguished: upstream Q rejection, AEGIS not reached, veto, hold, capacity, required unknown, structural, not applicable', () => {
  assert.equal(classifySizingZero(zero('AEGIS_UNKNOWN', ['THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'])), 'Q_REJECTED_UPSTREAM');
  assert.equal(classifySizingZero(zero('AEGIS_UNKNOWN', ['THETA_Q_NOT_SENT_UPSTREAM_REJECT:CONTRACT_NOT_EXECUTABLE'])), 'Q_REJECTED_UPSTREAM');
  assert.equal(classifySizingZero(zero('AEGIS_UNKNOWN', ['THETA_Q_ACTION_INFEASIBLE'])), 'Q_REJECTED_UPSTREAM');
  assert.equal(classifySizingZero(zero('AEGIS_NOT_REACHED_UPSTREAM')), 'AEGIS_NOT_REACHED');
  assert.equal(classifySizingZero(zero('UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED', ['AEGIS_HARD_VETO'])), 'AEGIS_HARD_VETO');
  assert.equal(classifySizingZero(zero('AEGIS_HOLD_ONLY', ['AEGIS_HOLD_ONLY'])), 'AEGIS_HOLD_ONLY');
  assert.equal(classifySizingZero(zero('REAL_ASSIGNMENT_CAPACITY', ['NO_ASSIGNMENT_CAPACITY'])), 'AEGIS_CAPACITY_ZERO');
  assert.equal(classifySizingZero(zero('AEGIS_UNKNOWN')), 'AEGIS_REQUIRED_UNKNOWN');
  assert.equal(classifySizingZero(zero('COLLATERAL_INPUT_UNKNOWN')), 'SIZING_EVIDENCE_UNKNOWN');
  assert.equal(classifySizingZero(zero('LIQUIDITY:SPREAD_WIDENING_UNKNOWN')), 'AEGIS_REQUIRED_UNKNOWN');
  assert.equal(classifySizingZero(zero('LIQUIDITY:SPREAD_WIDENING_DETECTED')), 'AEGIS_RISK_FAMILY_BLOCK');
  assert.equal(classifySizingZero(zero('BUYING_POWER_AFFORDABLE')), 'STRUCTURAL_SIZING_ZERO');
  assert.equal(classifySizingZero(zero('ROUTER_NOT_APPLICABLE')), 'BRANCH_NOT_APPLICABLE');
  assert.equal(classifySizingZero(zero('BUYING_POWER_AFFORDABLE', ['CONTRACT_NOT_EXECUTABLE'])), 'NO_EXECUTABLE_CANDIDATE');
  assert.equal(classifySizingZero({ hardBlockers: [], sizing: { quantity: 2, bindingConstraint: 'COLLATERAL' } }), null, 'a positive quantity has no zero cause');
});

test('the AEGIS-not-reached population is not counted as a risk-evaluated zero', () => {
  const candidates = [
    ...Array.from({ length: 50 }, () => zero('AEGIS_UNKNOWN', ['THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'])),
    ...Array.from({ length: 5 }, () => zero('AEGIS_NOT_REACHED_UPSTREAM')),
    ...Array.from({ length: 3 }, () => zero('UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED', ['AEGIS_HARD_VETO'])),
    ...Array.from({ length: 40 }, () => zero('ROUTER_NOT_APPLICABLE')),
  ];
  const summary = summarizeSizingZero(candidates);
  assert.deepEqual(summary.breakdown, { AEGIS_HARD_VETO: 3, AEGIS_NOT_REACHED: 5, BRANCH_NOT_APPLICABLE: 40, Q_REJECTED_UPSTREAM: 50 });
  assert.equal(summary.riskEvaluatedZeroCount, 3, 'only the evaluated veto is a risk wait');
});

test('a wait made only of never-evaluated zero-quantity candidates is NOT classified RISK_WAIT; a real veto still is', () => {
  const upstreamOnly = classifyRuntimeBehavior(input({ riskEvaluatedZeroCount: 0, quantityZeroCount: 100,
    sizingZeroBreakdown: { Q_REJECTED_UPSTREAM: 60, BRANCH_NOT_APPLICABLE: 40 } }));
  assert.notEqual(upstreamOnly.waitClassification, 'RISK_WAIT');
  assert.equal(upstreamOnly.waitClassification, 'OVERSTRICT_POLICY_WAIT', 'feasible candidates existed but none were selected');
  assert.ok(upstreamOnly.reasonCodes.includes('SIZING_ZERO_CAUSE:Q_REJECTED_UPSTREAM:60'));
  const vetoed = classifyRuntimeBehavior(input({ riskEvaluatedZeroCount: 3, aegisVetoCount: 3, sizingZeroBreakdown: { AEGIS_HARD_VETO: 3 } }));
  assert.equal(vetoed.waitClassification, 'RISK_WAIT');
  const capacity = classifyRuntimeBehavior(input({ riskEvaluatedZeroCount: 1, sizingZeroBreakdown: { AEGIS_CAPACITY_ZERO: 1 } }));
  assert.equal(capacity.waitClassification, 'RISK_WAIT');
});

test('historical (pre-v6) inputs keep their historical meaning: a missing breakdown falls back to the old quantity-zero rule', () => {
  assert.equal(classifyRuntimeBehavior(input({ quantityZeroCount: 2 })).waitClassification, 'RISK_WAIT');
  assert.equal(runtimeBehaviorDiagnosticVersion, 'theta-runtime-behavior-diagnostic-v6');
});

test('shortlist-bound and not-sent markers are non-evaluation labels, not a dominant hard gate', () => {
  const marker = [['THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'], ['THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND'], ['THETA_Q_NOT_EVALUATED_SHORTLIST_BOUND']];
  assert.deepEqual(deriveAntiParalysisFindings({ candidateHardBlockers: marker, strategyReachability: [] }), []);
  const router = [['ROUTER_NOT_APPLICABLE'], ['ROUTER_NOT_APPLICABLE']];
  assert.deepEqual(deriveAntiParalysisFindings({ candidateHardBlockers: router, strategyReachability: [] }), []);
  const real = [['VOLUME_BELOW_FLOOR'], ['VOLUME_BELOW_FLOOR'], ['VOLUME_BELOW_FLOOR']];
  assert.deepEqual(deriveAntiParalysisFindings({ candidateHardBlockers: real, strategyReachability: [] }),
    ['DOMINANT_HARD_GATE_OBSERVED:VOLUME_BELOW_FLOOR'], 'a genuine rule that rejects nearly everything is still reported');
});

test('provider failures stay DATA_WAIT regardless of zero-quantity causes', () => {
  const result = classifyRuntimeBehavior(input({ providerBlockers: ['ALPACA_PROVIDER_ERROR'], completeness: 'PARTIAL',
    riskEvaluatedZeroCount: 5, sizingZeroBreakdown: { AEGIS_HARD_VETO: 5 } }));
  assert.equal(result.waitClassification, 'DATA_WAIT');
});

test('operator projection: the zero-trade diagnostic uses the risk-evaluated count when recorded and the historical column otherwise', async () => {
  const { riskEvaluatedZeroOf, classifyZeroTradeEvidence } = await import('../src/theta/zero-trade-diagnostic.js');
  assert.equal(riskEvaluatedZeroOf({ quantity_zero_count: 1117, diagnostic_json: { riskEvaluatedZeroCount: 3 } }), 3);
  assert.equal(riskEvaluatedZeroOf({ quantity_zero_count: 1117, diagnostic_json: { riskEvaluatedZeroCount: 0 } }), 0, 'a recorded zero is a real zero');
  assert.equal(riskEvaluatedZeroOf({ quantity_zero_count: 1117, diagnostic_json: {} }), 1117, 'historical rows keep their meaning');
  assert.equal(riskEvaluatedZeroOf({ quantity_zero_count: 7, diagnostic_json: { riskEvaluatedZeroCount: 'x' } }), 7, 'invalid values never become zero');
  const base = { cycleCount: 10, actionReadyCycles: 0, actionPlansReady: 0, orderIntentCount: 0, candidateCount: 1000, feasibleCandidateCount: 30,
    providerBlockedCycles: 0, dataWaitCycles: 0, quoteWaitCycles: 0, aegisVetoCount: 0, paralysisCycles: 0, healthyWaitCycles: 0 };
  assert.equal(classifyZeroTradeEvidence({ ...base, quantityZeroCount: 1117 }), 'SIZING_BLOCKER', 'historical conflation, preserved for old rows');
  assert.notEqual(classifyZeroTradeEvidence({ ...base, quantityZeroCount: 0 }), 'SIZING_BLOCKER', 'never-evaluated zeros no longer read as a sizing blocker');
});
