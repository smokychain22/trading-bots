import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFusionSnapshot,
  type FusionSnapshotInput,
  verifyFusionSnapshot,
} from '../src/market/fusion-snapshot.js';

const payloadHash = 'a'.repeat(64);

function fixture(): FusionSnapshotInput {
  return {
    botId: 'THETA',
    decisionTimeUtc: '2026-09-09T14:30:00-04:00',
    triggerType: 'PERIODIC_SCAN',
    marketSession: { state: 'OPEN', exchange: 'NYSE' },
    underlyingState: { symbol: 'SPY', price: 650.25 },
    contractCandidates: [{
      contractVersion: 'theta-option-contract-v1',
      underlying: 'SPY', optionSymbol: 'SPY261218P00600000', occSymbol: null, optionType: 'PUT',
      strike: 600, expiration: '2026-12-18', dte: 100, multiplier: 100,
      underlyingBid: null, underlyingAsk: null, underlyingLast: 650.25, underlyingReferencePrice: 650.25,
      underlyingTimestamp: '2026-09-09T18:30:00.000Z',
      bid: 4.1, ask: 4.3, bidSize: null, askSize: null, lastTradePrice: null, lastTradeSize: null,
      quoteTimestamp: '2026-09-09T18:30:00.000Z', tradeTimestamp: null,
      midpointReference: 4.2, spread: 0.2, spreadPct: 0.0476, moneyness: 0.0838, distanceToStrikePct: 0.0838,
      breakEven: 595.9,
      volume: null, volumeSource: null, openInterest: null, openInterestSource: null,
      iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null, greeksTimestamp: null, greeksSource: null,
      source: 'ALPACA', feed: 'OPRA', dataQuality: 'GOOD', receivedAt: '2026-09-09T18:30:00.000Z', dataAgeSeconds: 1,
      executable: true, nonExecutableReason: null,
    }],
    accountState: { status: 'ACTIVE', buyingPower: 100000 },
    positionState: { positions: [] },
    portfolioExposure: { tickerConcentrationPct: 0, sectorConcentrationPct: 0 },
    strategyRouterState: { eligible: ['THETA_Q'] },
    alpacaQuoteState: { bid: 4.1, ask: 4.3, feed: 'OPRA' },
    optionomicsFeatureState: { ivRank: null },
    eventState: { earningsDistanceDays: null },
    regimeState: { state: 'UNKNOWN' },
    expertPriorState: { state: 'UNKNOWN' },
    riskState: { mode: 'PAPER' },
    versions: {
      strategyVersion: 'theta-q-v0',
      featureVersion: 'features-v1',
      riskLimitVersion: 'risk-v1',
      executionVersion: 'execution-v1',
      costModelVersion: 'cost-v1',
      dataVersion: 'data-v1',
      modelVersions: { ownership: 'theta-h-v0' },
    },
    sourceProvenance: [
      {
        provider: 'ALPACA', operationAlias: 'alpaca.get_account',
        asOf: '2026-09-09T18:29:59Z', retrievedAt: '2026-09-09T18:30:00Z',
        state: 'GOOD', contentHash: payloadHash, feed: null, contractVersion: 'alpaca-v2',
        truthRole: 'ACCOUNT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.option_contracts',
        asOf: '2026-09-09T18:29:59Z', retrievedAt: '2026-09-09T18:30:00Z',
        state: 'GOOD', contentHash: payloadHash, feed: null, contractVersion: 'alpaca-v2',
        truthRole: 'CONTRACT', requiredForNewRisk: true,
      },
      {
        provider: 'ALPACA', operationAlias: 'alpaca.option_snapshot',
        asOf: '2026-09-09T18:29:59Z', retrievedAt: '2026-09-09T18:30:00Z',
        state: 'GOOD', contentHash: payloadHash, feed: 'OPRA', contractVersion: 'alpaca-v2',
        truthRole: 'QUOTE', requiredForNewRisk: true,
      },
    ],
    providerHealth: [
      { provider: 'ALPACA', state: 'GOOD', asOf: '2026-09-09T18:29:59Z', retrievedAt: '2026-09-09T18:30:00Z' },
      { provider: 'OPTIONOMICS', state: 'GOOD', asOf: '2026-09-09T18:29:59Z', retrievedAt: '2026-09-09T18:30:00Z' },
    ],
    freshnessFlags: [],
    unknownFeatures: [{ feature: 'ivRank', reasonCode: 'NOT_ENTITLED', provider: 'OPTIONOMICS' }],
    executableTruth: { account: 'GOOD', contract: 'GOOD', quote: 'GOOD' },
  };
}

test('same semantic FusionSnapshot inputs produce the same hash', () => {
  const first = fixture();
  const second = fixture();
  second.underlyingState = { price: 650.25, symbol: 'SPY' };

  const builtFirst = buildFusionSnapshot(first);
  const builtSecond = buildFusionSnapshot(second);

  assert.equal(builtFirst.contentHash, builtSecond.contentHash);
  assert.equal(builtFirst.validForNewRisk, true);
  assert.equal(builtFirst.snapshot.decisionTimeUtc, '2026-09-09T18:30:00.000Z');
  assert.equal(verifyFusionSnapshot(builtFirst.snapshot, builtFirst.contentHash), true);
});

test('stale executable quote truth blocks new risk', () => {
  const input = fixture();
  input.executableTruth.quote = 'STALE';
  const built = buildFusionSnapshot(input);

  assert.equal(built.validForNewRisk, false);
  assert.equal(built.snapshot.validForNewRisk, false);
});

test('required stale provenance blocks new risk even if summary flags claim GOOD', () => {
  const input = fixture();
  const quoteProvenance = input.sourceProvenance[2];
  assert.ok(quoteProvenance);
  quoteProvenance.state = 'STALE';
  const built = buildFusionSnapshot(input);

  assert.equal(built.validForNewRisk, false);
});

test('UNKNOWN intelligence remains explicit and is never converted to zero', () => {
  const built = buildFusionSnapshot(fixture());
  const state = built.snapshot.optionomicsFeatureState as Record<string, unknown>;
  const unknown = built.snapshot.unknownFeatures as unknown[];

  assert.equal(state.ivRank, null);
  assert.equal(unknown.length, 1);
});

test('replay verification detects modified evidence', () => {
  const built = buildFusionSnapshot(fixture());
  const modified = structuredClone(built.snapshot) as Record<string, typeof built.snapshot[string]>;
  modified.accountState = { status: 'ACTIVE', buyingPower: 999999 };

  assert.equal(verifyFusionSnapshot(modified, built.contentHash), false);
});

test('non-JSON numbers and missing Alpaca provenance are rejected', () => {
  const badNumber = fixture();
  badNumber.underlyingState = { price: Number.NaN };
  assert.throws(() => buildFusionSnapshot(badNumber), /non-finite number/);

  const noAlpaca = fixture();
  noAlpaca.sourceProvenance = [];
  assert.throws(() => buildFusionSnapshot(noAlpaca));
});
