import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContractResearchEvidence, buildExpirationBuckets, compareExpirations, compareStrikes,
  type ContractResearchEvidence,
} from '../src/research/contract-research-evidence.js';
import { normalizeOptionContract, type NormalizedOptionContract } from '../src/theta/option-contract.js';

const NOW = '2026-09-19T15:00:00.000Z';

const contract = (overrides: Partial<{
  symbol: string; expiration: string; strike: number; bid: number; ask: number; iv: number | null; delta: number | null;
}> = {}): NormalizedOptionContract => normalizeOptionContract({
  source: 'ALPACA', underlying: 'AAPL', optionSymbol: overrides.symbol ?? 'AAPL261016P00190000',
  occSymbol: overrides.symbol ?? 'AAPL261016P00190000', optionType: 'PUT', strike: overrides.strike ?? 190,
  expiration: overrides.expiration ?? '2026-10-16', asOfDate: '2026-09-19', multiplier: 100,
  underlyingBid: 199.9, underlyingAsk: 200.1, underlyingLast: 200, underlyingTimestamp: NOW,
  bid: overrides.bid ?? 2, ask: overrides.ask ?? 2.1, bidSize: 10, askSize: 10, lastTradePrice: overrides.bid ?? 2,
  lastTradeSize: 1, quoteTimestamp: NOW, tradeTimestamp: NOW, volume: 100, volumeSource: 'ALPACA',
  openInterest: 500, openInterestSource: 'OPTIONOMICS', iv: overrides.iv === undefined ? 0.3 : overrides.iv,
  delta: overrides.delta === undefined ? -0.2 : overrides.delta, gamma: 0.01, theta: -0.04, vega: 0.12, rho: -0.03,
  greeksTimestamp: NOW, greeksSource: 'OPTIONOMICS', feed: 'INDICATIVE', dataQuality: 'GOOD',
  maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
}, NOW);

test('buildContractResearchEvidence reads real quote/Greek fields from the contract, never recomputing them', () => {
  const evidence = buildContractResearchEvidence({ contract: contract() });
  assert.equal(evidence.premiumPerShare, 2); // bid-side, conservative
  assert.equal(evidence.impliedVolatility, 0.3);
  assert.equal(evidence.delta, -0.2);
  assert.equal(evidence.brokerAuthority, false);
  assert.equal(evidence.capitalRequired, 190 * 100);
});

test('optional caller-supplied fields (skew/term/expected-move/event distance) default to UNKNOWN, never fabricated', () => {
  const evidence = buildContractResearchEvidence({ contract: contract() });
  assert.equal(evidence.skew, null);
  assert.equal(evidence.termStructure, null);
  assert.equal(evidence.expectedMoveDistance, null);
  assert.equal(evidence.eventDistanceDays, null);
  assert.ok(evidence.uncertaintyCount > 0);
});

test('uncertaintyCount reflects exactly how many optional research fields are unknown', () => {
  const allKnown = buildContractResearchEvidence({
    contract: contract(), skew: 0.02, termStructure: 0.01, expectedMoveDistance: 5,
    eventDistanceDays: 30, ownershipQualityScore: 0.8, aegisResult: 'ALLOW_FULL',
  });
  assert.equal(allKnown.uncertaintyCount, 0);
});

test('a crossed/unquoted contract reports UNKNOWN premium, never a fabricated value', () => {
  const unquoted = normalizeOptionContract({
    source: 'ALPACA', underlying: 'AAPL', optionSymbol: 'AAPL261016P00190000', occSymbol: 'AAPL261016P00190000',
    optionType: 'PUT', strike: 190, expiration: '2026-10-16', asOfDate: '2026-09-19', multiplier: 100,
    underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
    bid: null, ask: null, bidSize: null, askSize: null, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: null, tradeTimestamp: null, volume: null, volumeSource: null, openInterest: null,
    openInterestSource: null, iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
    greeksTimestamp: null, greeksSource: null, feed: null, dataQuality: 'UNKNOWN',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 0.2,
  }, NOW);
  const evidence = buildContractResearchEvidence({ contract: unquoted });
  assert.equal(evidence.premiumPerShare, null);
});

const evidenceFixture = (overrides: Partial<ContractResearchEvidence> = {}): ContractResearchEvidence => ({
  ...buildContractResearchEvidence({ contract: contract() }), ...overrides,
});

test('buildExpirationBuckets groups by expiration and computes UNKNOWN-safe aggregates', () => {
  const near = evidenceFixture({ optionSymbol: 'near', expiration: '2026-10-16', dte: 27, premiumPerShare: 2, capitalDays: 540 });
  const far = evidenceFixture({ optionSymbol: 'far', expiration: '2026-11-20', dte: 62, premiumPerShare: 3, capitalDays: 1200 });
  const buckets = buildExpirationBuckets([near, far], new Map([
    ['near', { theta: -0.05, gamma: 0.02 }], ['far', { theta: -0.03, gamma: 0.01 }],
  ]));
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0]?.expiration, '2026-10-16'); // sorted by DTE ascending
  assert.equal(buckets[0]?.totalPremium, 2);
  assert.equal(buckets[0]?.thetaProxy, -0.05);
});

test('buildExpirationBuckets reports totalPremium as UNKNOWN (null) when any contract in the bucket has unknown premium, never silently omitted', () => {
  const known = evidenceFixture({ optionSymbol: 'a', expiration: '2026-10-16', premiumPerShare: 2 });
  const unknown = evidenceFixture({ optionSymbol: 'b', expiration: '2026-10-16', premiumPerShare: null });
  const buckets = buildExpirationBuckets([known, unknown], new Map());
  assert.equal(buckets[0]?.totalPremium, null);
});

test('compareExpirations names only the dimensions that genuinely differ, with which side is better', () => {
  const a = { expiration: '2026-10-16', dte: 27, contractCount: 1, totalPremium: 300, meanCapitalDays: 500, thetaProxy: -0.05, gammaProxy: 0.02, meanTermStructure: null, nearestEventDistanceDays: null, meanSpreadPct: 0.05, meanAssignmentCapacityQty: null };
  const b = { expiration: '2026-11-20', dte: 62, contractCount: 1, totalPremium: 200, meanCapitalDays: 500, thetaProxy: -0.03, gammaProxy: 0.01, meanTermStructure: null, nearestEventDistanceDays: null, meanSpreadPct: 0.08, meanAssignmentCapacityQty: null };
  const reasons = compareExpirations(a, b);
  const premiumReason = reasons.find((reason) => reason.dimension === 'totalPremium');
  assert.equal(premiumReason?.aIsBetter, true); // higher premium
  const spreadReason = reasons.find((reason) => reason.dimension === 'meanSpreadPct');
  assert.equal(spreadReason?.aIsBetter, true); // lower spread is better
  assert.ok(!reasons.some((reason) => reason.dimension === 'meanCapitalDays')); // tied, not reported
});

test('compareStrikes rejects a comparison across different expirations/underlyings/option types', () => {
  const put190 = evidenceFixture({ optionType: 'PUT', expiration: '2026-10-16', underlying: 'AAPL' });
  const put190OtherExpiry = evidenceFixture({ optionType: 'PUT', expiration: '2026-11-20', underlying: 'AAPL' });
  assert.throws(() => compareStrikes(put190, put190OtherExpiry));
});

test('compareStrikes names comparable dimensions for two strikes at the same expiration', () => {
  const nearStrike = evidenceFixture({
    optionSymbol: 'near', strike: 195, premiumPerShare: 3, spreadPct: 0.05, openInterest: 200, capitalRequired: 19_500,
  });
  const farStrike = evidenceFixture({
    optionSymbol: 'far', strike: 185, premiumPerShare: 1, spreadPct: 0.02, openInterest: 800, capitalRequired: 18_500,
  });
  const reasons = compareStrikes(nearStrike, farStrike);
  const premiumReason = reasons.find((reason) => reason.dimension === 'premiumPerShare');
  assert.equal(premiumReason?.aIsBetter, true); // nearStrike has higher premium
  const oiReason = reasons.find((reason) => reason.dimension === 'openInterest');
  assert.equal(oiReason?.aIsBetter, false); // farStrike has higher OI
});

test('compareStrikes never uses delta as a comparison dimension -- delta is never treated as probability', () => {
  const a = evidenceFixture({ optionSymbol: 'a', strike: 195, delta: -0.30 });
  const b = evidenceFixture({ optionSymbol: 'b', strike: 185, delta: -0.15 });
  const reasons = compareStrikes(a, b);
  assert.ok(!reasons.some((reason) => (reason.dimension as string) === 'delta'));
});
