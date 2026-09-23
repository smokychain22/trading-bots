import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFinalistQuoteRefreshReceipt,
  finalistQuoteRefreshMaxAgeSeconds,
  selectFinalistContractsForRefresh,
  type FinalistQuoteRefreshPolicy,
} from '../src/theta/finalist-quote-refresh.js';
import { normalizeOptionContract } from '../src/theta/option-contract.js';

const NOW = '2026-09-23T15:00:00.000Z';
const policy: FinalistQuoteRefreshPolicy = {
  policyVersion: 'finalist-refresh-v1-test',
  effectiveAt: '2026-09-01T00:00:00.000Z',
  maxFinalists: 2,
  maxAgeSeconds: 30,
};

function contract(symbol: string, dteExpiration: string, delta: number | null, spread: number) {
  return normalizeOptionContract({
    source: 'ALPACA', underlying: 'SPY', optionSymbol: symbol, occSymbol: symbol,
    optionType: 'PUT', strike: 500, expiration: dteExpiration, asOfDate: NOW.slice(0, 10), multiplier: 100,
    underlyingBid: null, underlyingAsk: null, underlyingLast: null, underlyingTimestamp: null,
    bid: 1, ask: 1 + spread, bidSize: 10, askSize: 10, lastTradePrice: null, lastTradeSize: null,
    quoteTimestamp: '2026-09-23T14:59:50.000Z', tradeTimestamp: null,
    volume: 100, volumeSource: 'ALPACA', openInterest: 200, openInterestSource: 'OPTIONOMICS',
    iv: 0.3, delta, gamma: null, theta: null, vega: null, rho: null,
    greeksTimestamp: NOW, greeksSource: 'ALPACA', feed: 'INDICATIVE', dataQuality: 'GOOD',
    maxQuoteAgeSecondsForExecutable: 30, maxSpreadPctForExecutable: 1,
  }, NOW);
}

test('finalist quote refresh policy is independently effective-dated and fail-closed', () => {
  assert.equal(finalistQuoteRefreshMaxAgeSeconds(policy, NOW), 30);
  assert.throws(() => finalistQuoteRefreshMaxAgeSeconds({ ...policy, maxFinalists: 0 }, NOW),
    /FINALIST_QUOTE_REFRESH_POLICY_INVALID/);
  assert.throws(() => finalistQuoteRefreshMaxAgeSeconds({ ...policy, effectiveAt: '2026-09-24T00:00:00.000Z' }, NOW),
    /FINALIST_QUOTE_REFRESH_POLICY_INVALID/);
});

test('bounded finalist selection uses lattice proximity but does not make the canonical decision', () => {
  const selected = selectFinalistContractsForRefresh({
    contracts: [
      contract('SPY261030P00500000', '2026-10-30', -0.24, 0.08),
      contract('SPY261120P00500000', '2026-11-20', -0.23, 0.06),
      contract('SPY261016P00500000', '2026-10-16', null, 0.03),
    ],
    latticeConfig: { minDte: 25, maxDte: 60, deltaBands: [[0.2, 0.3]] },
    policy,
    asOf: NOW,
  });
  assert.deepEqual(selected.map((item) => item.optionSymbol), [
    'SPY261030P00500000',
    'SPY261120P00500000',
  ]);
});

test('refresh receipt preserves stage timing and rejects future-observed evidence', () => {
  const observation = {
    optionSymbol: 'SPY261030P00500000',
    initialProviderTimestamp: '2026-09-23T14:59:40.000Z',
    initialReceivedAt: '2026-09-23T14:59:50.000Z',
    refreshRequestedAt: '2026-09-23T14:59:55.000Z',
    refreshReceivedAt: '2026-09-23T14:59:56.000Z',
    refreshedProviderTimestamp: '2026-09-23T14:59:54.000Z',
    state: 'REFRESHED' as const,
    sanitizedErrorCode: null,
  };
  const receipt = buildFinalistQuoteRefreshReceipt({
    policy, candidateBuiltAt: observation.initialReceivedAt,
    finalistChosenAt: observation.refreshRequestedAt,
    decisionAsOf: NOW, initialCandidateCount: 10, observations: [observation],
  });
  assert.equal(receipt.refreshedCount, 1);
  assert.equal(receipt.failedCount, 0);
  assert.equal(receipt.latency.candidateToDecisionMs, 10_000);
  assert.equal(receipt.latency.refreshRoundTripMsP50, 1_000);
  assert.equal(receipt.latency.initialQuoteAgeAtCandidateSecondsP50, 10);
  assert.equal(receipt.latency.refreshedQuoteAgeAtDecisionSecondsP50, 6);
  assert.equal(receipt.latency.refreshedQuoteTimestampUnavailableCount, 0);
  const futureProviderQuote = buildFinalistQuoteRefreshReceipt({
    policy, candidateBuiltAt: observation.initialReceivedAt,
    finalistChosenAt: observation.refreshRequestedAt,
    decisionAsOf: NOW, initialCandidateCount: 10,
    observations: [{ ...observation, refreshedProviderTimestamp: '2026-09-23T15:00:02.000Z' }],
  });
  assert.equal(futureProviderQuote.latency.refreshedQuoteAgeAtDecisionSecondsP50, null);
  assert.equal(futureProviderQuote.latency.refreshedQuoteTimestampUnavailableCount, 1);
  assert.throws(() => buildFinalistQuoteRefreshReceipt({
    policy, candidateBuiltAt: observation.initialReceivedAt,
    finalistChosenAt: observation.refreshRequestedAt,
    decisionAsOf: NOW, initialCandidateCount: 10,
    observations: [{ ...observation, refreshReceivedAt: '2026-09-23T15:00:01.000Z' }],
  }), /FINALIST_QUOTE_REFRESH_FUTURE_EVIDENCE/);
  assert.throws(() => buildFinalistQuoteRefreshReceipt({
    policy, candidateBuiltAt: observation.initialReceivedAt,
    finalistChosenAt: observation.refreshRequestedAt,
    decisionAsOf: NOW, initialCandidateCount: 10,
    observations: [{ ...observation, refreshRequestedAt: '2026-09-23T14:59:57.000Z' }],
  }), /FINALIST_QUOTE_REFRESH_FUTURE_EVIDENCE/);
  assert.throws(() => buildFinalistQuoteRefreshReceipt({
    policy, candidateBuiltAt: observation.initialReceivedAt,
    finalistChosenAt: '2026-09-23T14:59:49.000Z',
    decisionAsOf: NOW, initialCandidateCount: 10, observations: [observation],
  }), /FINALIST_QUOTE_REFRESH_TIMING_INVALID/);
});
