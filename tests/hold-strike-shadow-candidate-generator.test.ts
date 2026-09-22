import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateHoldStrikeCandidates, type HoldStrikeChainContractQuote, type HoldStrikeGeneratorInput,
} from '../src/research/hold-strike-shadow-candidate-generator.js';

const DECISION_TS = '2026-09-22T14:00:00Z';

function contract(overrides: Partial<HoldStrikeChainContractQuote> = {}): HoldStrikeChainContractQuote {
  return {
    contractId: 'AAPL-c1', strike: 190, dte: 3, expiration: '2026-09-25',
    bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:30Z', delta: -0.22, multiplier: 100, ...overrides,
  };
}

function input(overrides: Partial<HoldStrikeGeneratorInput> = {}): HoldStrikeGeneratorInput {
  return {
    underlying: 'AAPL', decisionTimestamp: DECISION_TS, ownershipState: 'ELIGIBLE', eventState: 'CLEAR',
    contracts: [contract()], maxQuoteAgeMs: 60000, minDte: 2, maxDte: 5, sourceEvidenceIds: ['ev-1'], ...overrides,
  };
}

test('accepts a real, structurally sound 2-5 DTE contract with a real maxLossAtZero computed via the shared formula', () => {
  const result = generateHoldStrikeCandidates(input());
  assert.equal(result.acceptedCandidates.length, 1);
  assert.equal(result.rejectedCandidates.length, 0);
  const c = result.acceptedCandidates[0] as (typeof result.acceptedCandidates)[number];
  assert.equal(c.maxLossAtZero, (190 - 1.5) * 100 * 1);
  assert.equal(c.quantity, 1);
  assert.equal(result.brokerAuthority, false);
});

test('rejects a contract outside the 2-5 DTE lattice with DTE_OUTSIDE_LATTICE, preserving the exact reason', () => {
  const result = generateHoldStrikeCandidates(input({ contracts: [contract({ dte: 30 })] }));
  assert.equal(result.acceptedCandidates.length, 0);
  assert.equal(result.rejectedCandidates[0]?.reason, 'DTE_OUTSIDE_LATTICE');
});

test('ADVERSARIAL: ownership INELIGIBLE rejects every contract individually, never silently dropping any', () => {
  const result = generateHoldStrikeCandidates(input({
    ownershipState: 'INELIGIBLE',
    contracts: [contract({ contractId: 'c1' }), contract({ contractId: 'c2', strike: 195 })],
  }));
  assert.equal(result.acceptedCandidates.length, 0);
  assert.equal(result.rejectedCandidates.length, 2);
  assert.ok(result.rejectedCandidates.every((r) => r.reason === 'OWNERSHIP_INELIGIBLE'));
});

test('ADVERSARIAL: UNKNOWN ownership is rejected (fail-closed), never assumed eligible', () => {
  const result = generateHoldStrikeCandidates(input({ ownershipState: 'UNKNOWN' }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'OWNERSHIP_UNKNOWN');
});

test('ADVERSARIAL: an unknown event state blocks generation (fail-closed), distinct from a known NEAR event', () => {
  const unknownEvent = generateHoldStrikeCandidates(input({ eventState: 'UNKNOWN' }));
  assert.equal(unknownEvent.rejectedCandidates[0]?.reason, 'EVENT_STATE_UNKNOWN');
  const nearEvent = generateHoldStrikeCandidates(input({ eventState: 'NEAR' }));
  assert.equal(nearEvent.rejectedCandidates[0]?.reason, 'EVENT_NEAR');
});

test('rejects a stale quote', () => {
  const result = generateHoldStrikeCandidates(input({ contracts: [contract({ quoteTimestamp: '2026-09-22T13:00:00Z' })] }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'QUOTE_STALE');
});

test('REPAIR: rejects a future-dated quote as QUOTE_STALE, never treated as fresh', () => {
  const result = generateHoldStrikeCandidates(input({ contracts: [contract({ quoteTimestamp: '2026-09-22T15:00:00Z' })] }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'QUOTE_STALE');
});

test('rejects a crossed/invalid quote', () => {
  const result = generateHoldStrikeCandidates(input({ contracts: [contract({ bid: 2.0, ask: 1.5 })] }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'QUOTE_INVALID');
});

test('rejects a missing delta, distinct from a missing multiplier', () => {
  assert.equal(generateHoldStrikeCandidates(input({ contracts: [contract({ delta: null })] })).rejectedCandidates[0]?.reason, 'MISSING_DELTA');
  assert.equal(generateHoldStrikeCandidates(input({ contracts: [contract({ multiplier: null })] })).rejectedCandidates[0]?.reason, 'MISSING_MULTIPLIER');
});

test('a mixed real chain produces both accepted and rejected candidates in the same call, each preserved individually', () => {
  const result = generateHoldStrikeCandidates(input({
    contracts: [contract({ contractId: 'good', dte: 3 }), contract({ contractId: 'bad-dte', dte: 30 })],
  }));
  assert.equal(result.acceptedCandidates.length, 1);
  assert.equal(result.rejectedCandidates.length, 1);
  assert.equal(result.acceptedCandidates[0]?.contractId, 'good');
  assert.equal(result.rejectedCandidates[0]?.contractId, 'bad-dte');
});
