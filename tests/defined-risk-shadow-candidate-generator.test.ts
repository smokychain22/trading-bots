import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateDefinedRiskCandidates, type DefinedRiskChainInput, type DefinedRiskLegContract,
} from '../src/research/defined-risk-shadow-candidate-generator.js';

const DECISION_TS = '2026-09-22T14:00:00Z';

function leg(overrides: Partial<DefinedRiskLegContract> = {}): DefinedRiskLegContract {
  return {
    contractId: 'AAPL-short', strike: 190,
    quote: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 },
    ...overrides,
  };
}

function chainInput(overrides: Partial<DefinedRiskChainInput> = {}): DefinedRiskChainInput {
  return {
    underlying: 'AAPL', decisionTimestamp: DECISION_TS, expiration: '2026-10-17', dte: 25,
    shortLegCandidates: [leg({ contractId: 'short-190', strike: 190 })],
    longLegCandidates: [leg({ contractId: 'long-185', strike: 185, quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
    quantity: 1, maxSyncAgeMs: 1000, maxQuoteAgeMs: 60000, minDte: 7, maxDte: 60, minWidth: 1, maxWidth: 20,
    sourceEvidenceIds: ['ev-1'], ...overrides,
  };
}

test('accepts a real, structurally valid credit spread pair, reusing the shared structural economics function', () => {
  const result = generateDefinedRiskCandidates(chainInput());
  assert.equal(result.acceptedCandidates.length, 1);
  const c = result.acceptedCandidates[0] as (typeof result.acceptedCandidates)[number];
  assert.equal(c.width, 5);
  assert.equal(c.openingNetCreditPerShare, 0.9); // 1.5 - 0.6
  assert.equal(c.maxLoss, (5 - 0.9) * 100 * 1);
  assert.equal(result.brokerAuthority, false);
});

test('rejects the whole chain with DTE_OUTSIDE_LATTICE when dte is outside the 7-60 lattice, preserving every pair individually', () => {
  const result = generateDefinedRiskCandidates(chainInput({ dte: 3 }));
  assert.equal(result.acceptedCandidates.length, 0);
  assert.equal(result.rejectedCandidates.length, 1);
  assert.equal(result.rejectedCandidates[0]?.reason, 'DTE_OUTSIDE_LATTICE');
});

test('rejects a same-strike leg pair as SAME_STRIKE_LEG_PAIR, distinct from an inverted-strike pair', () => {
  const result = generateDefinedRiskCandidates(chainInput({
    longLegCandidates: [leg({ contractId: 'long-190', strike: 190, quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
  }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'SAME_STRIKE_LEG_PAIR');
});

test('rejects an inverted-strike pair via the shared structural economics function, not a special case here', () => {
  const result = generateDefinedRiskCandidates(chainInput({
    shortLegCandidates: [leg({ contractId: 'short-180', strike: 180 })],
    longLegCandidates: [leg({ contractId: 'long-185', strike: 185, quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
  }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'INVERTED_STRIKES');
});

test('ADVERSARIAL: rejects a width outside the caller-supplied policy range, never inventing a plausible default range', () => {
  const result = generateDefinedRiskCandidates(chainInput({ minWidth: 10, maxWidth: 20 })); // real width is 5
  assert.equal(result.rejectedCandidates[0]?.reason, 'WIDTH_OUTSIDE_POLICY_RANGE');
});

test('ADVERSARIAL: a genuine net-debit pair is rejected via NEGATIVE_OR_ZERO_NET_CREDIT, never normalized', () => {
  const result = generateDefinedRiskCandidates(chainInput({
    shortLegCandidates: [leg({ contractId: 'short-190', strike: 190, quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
    longLegCandidates: [leg({ contractId: 'long-185', strike: 185, quote: { bid: 1.5, ask: 1.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
  }));
  assert.equal(result.rejectedCandidates[0]?.reason, 'NEGATIVE_OR_ZERO_NET_CREDIT');
});

test('ADVERSARIAL: a stale second leg still builds the candidate but preserves DESYNCHRONIZED evidence, never silently synchronized', () => {
  const result = generateDefinedRiskCandidates(chainInput({
    longLegCandidates: [leg({ contractId: 'long-185', strike: 185, quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T14:10:00Z', multiplier: 100 } })],
  }));
  assert.equal(result.acceptedCandidates.length, 1);
  assert.equal(result.acceptedCandidates[0]?.quoteSynchronizationStatus, 'DESYNCHRONIZED');
});

test('enumerates all valid pairs across multiple short/long candidates in one real chain, preserving evidence lineage on every accepted candidate', () => {
  const result = generateDefinedRiskCandidates(chainInput({
    shortLegCandidates: [leg({ contractId: 'short-190', strike: 190 }), leg({ contractId: 'short-195', strike: 195, quote: { bid: 2.5, ask: 2.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
    longLegCandidates: [leg({ contractId: 'long-185', strike: 185, quote: { bid: 0.5, ask: 0.6, quoteTimestamp: '2026-09-22T13:59:30Z', multiplier: 100 } })],
  }));
  assert.equal(result.acceptedCandidates.length, 2);
  assert.ok(result.acceptedCandidates.every((c) => c.evidenceIds.includes('ev-1')));
});
