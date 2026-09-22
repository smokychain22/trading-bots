import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHoldTheStrikeCandidateEvidence, evaluateHoldTheStrikeApplicability,
  type HoldTheStrikeApplicabilityInput,
} from '../src/research/hold-the-strike-applicability.js';

const applicable = (overrides: Partial<HoldTheStrikeApplicabilityInput> = {}): HoldTheStrikeApplicabilityInput => ({
  underlying: 'AAPL', asOf: '2026-09-19T15:00:00.000Z',
  ownershipWillingnessScore: 0.8, ownershipWillingnessFloor: 0.6,
  intentionalStrikeOwnershipLevel: true, liquidityAcceptable: true, eventRisk: 'ABSENT_VERIFIED',
  capitalCapacityAvailable: true, portfolioConcentrationAcceptable: true, assignmentAcceptable: true,
  premiumEconomicsAcceptable: true, ...overrides,
});

test('every condition met yields APPLICABLE, independent of any other strategy result', () => {
  const result = evaluateHoldTheStrikeApplicability(applicable());
  assert.equal(result.state, 'APPLICABLE');
  assert.equal(result.brokerAuthority, false);
  assert.ok(result.reasons.some((reason) => reason.startsWith('OWNERSHIP_WILLINGNESS_MET')));
});

test('ownership score below the caller-supplied floor is NOT_APPLICABLE, never silently rounded up', () => {
  const result = evaluateHoldTheStrikeApplicability(applicable({ ownershipWillingnessScore: 0.5, ownershipWillingnessFloor: 0.6 }));
  assert.equal(result.state, 'NOT_APPLICABLE');
  assert.ok(result.reasons.some((reason) => reason.startsWith('OWNERSHIP_WILLINGNESS_NOT_MET')));
});

test('a single UNKNOWN condition (with no other failing condition) reports UNKNOWN, never assumed acceptable', () => {
  const result = evaluateHoldTheStrikeApplicability(applicable({ liquidityAcceptable: null }));
  assert.equal(result.state, 'UNKNOWN');
  assert.ok(result.reasons.includes('LIQUIDITY_ACCEPTABLE_UNKNOWN'));
});

test('event risk UNKNOWN is never treated as safe -- it blocks applicability just like a known-present event', () => {
  const unknownEvent = evaluateHoldTheStrikeApplicability(applicable({ eventRisk: 'UNKNOWN' }));
  assert.notEqual(unknownEvent.state, 'APPLICABLE');
  assert.ok(unknownEvent.reasons.includes('EVENT_RISK_UNKNOWN_NOT_TREATED_AS_SAFE'));

  const presentEvent = evaluateHoldTheStrikeApplicability(applicable({ eventRisk: 'PRESENT' }));
  assert.equal(presentEvent.state, 'NOT_APPLICABLE');
});

test('a genuinely failed condition (not merely unknown) reports NOT_APPLICABLE even alongside unknowns elsewhere', () => {
  const result = evaluateHoldTheStrikeApplicability(applicable({ assignmentAcceptable: false, liquidityAcceptable: null }));
  assert.equal(result.state, 'NOT_APPLICABLE');
  assert.ok(result.reasons.includes('ASSIGNMENT_ACCEPTABLE_NOT_MET'));
});

test('applicability never reads or requires any THETA_CONVENTIONAL result -- the function signature carries no such input', () => {
  const result = evaluateHoldTheStrikeApplicability(applicable());
  const keys = Object.keys(result);
  assert.ok(!keys.some((key) => key.toLowerCase().includes('conventional')));
});

test('buildHoldTheStrikeCandidateEvidence computes break-even from bid-side premium as a plain fact, never ranked', () => {
  const evidence = buildHoldTheStrikeCandidateEvidence({
    underlying: 'AAPL', optionSymbol: 'AAPL260922P00195000', expiration: '2026-09-22', dte: 3, strike: 195,
    delta: -0.45, bid: 1.5, spreadPct: 0.04, openInterest: 300, volume: 50, assignmentCapacityQty: 2,
    expectedMoveDistance: 4, eventRisk: 'ABSENT_VERIFIED',
  });
  assert.equal(evidence.premiumPerShare, 1.5);
  assert.equal(evidence.breakEven, 193.5);
  assert.equal(evidence.brokerAuthority, false);
  assert.ok(!('rank' in evidence));
});

test('buildHoldTheStrikeCandidateEvidence reports UNKNOWN premium/break-even for an unquoted contract, never a fabricated value', () => {
  const evidence = buildHoldTheStrikeCandidateEvidence({
    underlying: 'AAPL', optionSymbol: 'AAPL260922P00195000', expiration: '2026-09-22', dte: 3, strike: 195,
    delta: null, bid: null, spreadPct: null, openInterest: null, volume: null, assignmentCapacityQty: null,
    expectedMoveDistance: null, eventRisk: 'UNKNOWN',
  });
  assert.equal(evidence.premiumPerShare, null);
  assert.equal(evidence.breakEven, null);
});
