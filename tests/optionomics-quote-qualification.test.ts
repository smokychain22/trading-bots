import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOptionomicsQuoteQualification } from '../src/theta/optionomics-quote-qualification.js';
import { sanitizeQualificationReport } from '../src/theta/optionomics-quote-qualification-runtime.js';
import type { NormalizedOptionomicsChain } from '../src/theta/optionomics-provider.js';

const NOW = '2026-09-14T15:00:05.000Z';
const chain = (symbol: string, asOf: string): NormalizedOptionomicsChain => ({
  underlying: symbol, requestedAt: NOW, retrievedAt: NOW, httpStatus: 200,
  requestPath: `/api/v1/stocks/${symbol}/options`, requestParameters: {},
  rateLimit: { limit: null, remaining: null, reset: null, retryAfter: null },
  documentationReference: 'https://optionomics.ai/docs/api', contractVersion: 'optionomics-public-api-2026-09-14',
  credentialIdentityRefHash: 'b'.repeat(64), sessionDate: null,
  responseHash: 'a'.repeat(64), rawPayload: [], pagesFetched: 1, complete: true,
  entries: [{
    rawSymbol: `${symbol}261016P00500000`, underlying: symbol, expiration: '2026-10-16', optionType: 'PUT', strike: 500,
    price: 2.05, bid: 2, ask: 2.1, bidSize: 10, askSize: 12, dte: 32, openInterest: 100, volume: 10,
    impliedVolatility: 0.2, impliedVolatilityUnits: 'DECIMAL', impliedVolatilityRaw: 0.2,
    delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1, rho: null, theoreticalPrice: 2.04,
    gammaDollar: null, deltaExposure: null, gammaExposure: null, notionalOpenInterest: null, moneyness: null,
    asOf, retrievedAt: NOW, quoteSemantics: 'SESSION_RECORDED_RESEARCH', executionEligible: false,
  }],
});

test('open-session repeated fresh shapes still cannot override research-only provider semantics', () => {
  const report = assessOptionomicsQuoteQualification({ marketSession: 'OPEN', runAt: NOW, maximumAgeMs: 10_000,
    samples: ['SPY', 'QQQ', 'AAPL'].map((symbol) => ({ symbol, requestedAt: NOW,
      chain: chain(symbol, '2026-09-14T15:00:02.000Z'), operationAlias: 'OPTION_CHAIN' as const,
      httpStatus: 200, failureCode: null, retryAfterSeconds: null, attemptCount: 1 })) });
  assert.equal(report.samplesObserved, 3);
  assert.equal(report.freshObservations, 3);
  assert.equal(report.productionAuth, 'PASS');
  assert.equal(report.ready, false);
  assert.equal(report.readinessState, 'BLOCKED_ON_QUOTE_PROOF');
  assert.ok(report.blockers.includes('ORDER_PRICING_USE_NOT_DOCUMENTED'));
  assert.equal(report.contentHash.length, 64);
});

test('closed sessions and provider failures are distinguished without fake readiness', () => {
  const report = assessOptionomicsQuoteQualification({ marketSession: 'CLOSED', runAt: NOW, maximumAgeMs: 10_000,
    samples: [{ symbol: 'SPY', requestedAt: NOW, chain: null, operationAlias: 'OPTION_CHAIN',
      httpStatus: 403, failureCode: 'NOT_ENTITLED', retryAfterSeconds: null, attemptCount: 1 }] });
  assert.equal(report.readinessState, 'BLOCKED_ON_MARKET_SESSION');
  assert.equal(report.samplesObserved, 0);
  assert.equal(report.ready, false);
  assert.equal(report.productionAuth, 'UNKNOWN');
});

test('sanitized report exposes exact non-secret authentication evidence', () => {
  const report = assessOptionomicsQuoteQualification({ marketSession: 'OPEN', runAt: NOW, maximumAgeMs: 10_000,
    samples: [{ symbol: 'SPY', requestedAt: NOW, chain: null, operationAlias: 'OPTION_CHAIN',
      httpStatus: 401, failureCode: 'AUTHENTICATION_FAILED', retryAfterSeconds: null, attemptCount: 1 }] });
  assert.equal(report.productionAuth, 'FAIL');
  assert.equal(report.authenticationFailure, '401_UNAUTHORIZED');
  const sanitized = sanitizeQualificationReport(report);
  assert.equal(sanitized.productionAuth, 'FAIL');
  assert.equal(sanitized.authenticationFailure, '401_UNAUTHORIZED');
  assert.deepEqual(sanitized.sampleEvidence, [{
    symbol: 'SPY', operationAlias: 'OPTION_CHAIN', httpStatus: 401, observationCount: 0,
    twoSidedCount: 0, timestampedCount: 0, freshCount: 0,
    oldestProviderTimestamp: null, latestProviderTimestamp: null, failureCode: 'AUTHENTICATION_FAILED',
    retryAfterSeconds: null, attemptCount: 1,
  }]);
  assert.equal(JSON.stringify(sanitized).includes('detail'), false);
});

test('a schema-unknown 2xx still proves authentication while preserving no-data readiness', () => {
  const report = assessOptionomicsQuoteQualification({ marketSession: 'OPEN', runAt: NOW, maximumAgeMs: 10_000,
    samples: [{ symbol: 'SPY', requestedAt: NOW, chain: null, operationAlias: 'OPTION_CHAIN',
      httpStatus: 200, failureCode: 'UNRECOGNIZED_RESPONSE', retryAfterSeconds: null, attemptCount: 1 }] });
  assert.equal(report.productionAuth, 'PASS');
  assert.equal(report.samplesObserved, 0);
  assert.equal(report.readinessState, 'BLOCKED_ON_DATA');
});
