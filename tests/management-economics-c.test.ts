import assert from 'node:assert/strict';
import test from 'node:test';
import { blackScholes } from '../src/theta/management-economics/black-scholes.js';
import { evaluateCoveredCallShadow, expectedCallPayoff, type CoveredCallShadowInput } from '../src/theta/management-economics/c-covered-call-utility.js';

const input = (over: Partial<CoveredCallShadowInput> = {}): CoveredCallShadowInput => ({
  inventory: { ownedShares: 100, sharesCommittedToOpenCalls: 0, pendingCallCommitmentShares: 0, multiplier: 100 },
  stockMark: 100, stockCostBasisPerShare: 98, wholeChainBasisPerShare: 96, realizedVolatility: 0.2, momentumDrift: null,
  eventInWindowByContractId: { C100: false, C105: false, C110: false }, exDividendAmountInWindow: null,
  candidates: [
    { contractId: 'C100', strike: 100, dte: 30, bid: 3.0, ask: 3.1, delta: 0.52, iv: 0.3 },
    { contractId: 'C105', strike: 105, dte: 30, bid: 1.2, ask: 1.3, delta: 0.25, iv: 0.3 },
    { contractId: 'C110', strike: 110, dte: 30, bid: 0.4, ask: 0.5, delta: 0.1, iv: 0.3 },
  ], ...over,
});

test('with zero drift and zero rate, the expected forfeited upside equals the Black-Scholes call value (MATH_REPRODUCED)', () => {
  assert.ok(Math.abs(expectedCallPayoff(100, 105, 0.25, 0.3, 0) - blackScholes('CALL', 100, 105, 0.25, 0.3, 0).price) < 1e-9);
  assert.equal(expectedCallPayoff(100, 90, 0, 0.3, 0), 10);
});

test('IV rich vs realized: every call carries edge; the divergence flag is recorded against the zero-weight pick', () => {
  const r = evaluateCoveredCallShadow(input());
  assert.equal(r.decision, 'SELL_CC');
  assert.equal(r.legacyZeroWeightContractId, 'C100');
  assert.ok(r.assessments.every((a) => (a.edgeUsd as number) > 0), 'IV 0.30 vs realized 0.20');
  assert.equal(r.authority, 'SHADOW_RESEARCH_NO_EXECUTION');
  assert.equal(typeof r.divergesFromLegacy, 'boolean');
});

test('strong upside momentum makes forfeited upside dominate: HOLD_SHARES_NO_CC (C may say no)', () => {
  const r = evaluateCoveredCallShadow(input({ momentumDrift: 1.5, realizedVolatility: 0.3 }));
  assert.equal(r.decision, 'HOLD_SHARES_NO_CC');
  assert.equal(r.shadowSelectedContractId, null);
  assert.equal(r.legacyZeroWeightContractId, 'C100');
  assert.equal(r.divergesFromLegacy, true);
});

test('free shares exclude committed and pending calls; no naked call; below-basis call-away is never selected', () => {
  const committed = evaluateCoveredCallShadow(input({ inventory: { ownedShares: 100, sharesCommittedToOpenCalls: 100, pendingCallCommitmentShares: 0, multiplier: 100 } }));
  assert.deepEqual([committed.decision, committed.coverableContracts, committed.shadowSelectedContractId], ['NO_FREE_SHARES', 0, null]);
  const pending = evaluateCoveredCallShadow(input({ inventory: { ownedShares: 150, sharesCommittedToOpenCalls: 0, pendingCallCommitmentShares: 100, multiplier: 100 } }));
  assert.equal(pending.coverableContracts, 0);
  const below = evaluateCoveredCallShadow(input({ wholeChainBasisPerShare: 107 }));
  assert.ok(below.assessments.filter((a) => a.callAwayBelowWholeChainBasis).every((a) => !a.selectable));
  assert.notEqual(below.shadowSelectedContractId, 'C100');
});

test('unknown event state or missing quote makes a call unrankable rather than safe', () => {
  const r = evaluateCoveredCallShadow(input({ eventInWindowByContractId: { C100: null, C105: false, C110: false } }));
  const c100 = r.assessments.find((a) => a.contractId === 'C100');
  assert.equal(c100?.edgeUsd, null);
  assert.ok(c100?.reasons.includes('EVENT_STATE_UNKNOWN_NOT_TREATED_AS_SAFE'));
  assert.notEqual(r.shadowSelectedContractId, 'C100');
});
