import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContractPathObservationReceipt, classifyObservationDeferral } from '../src/research/contract-path-observation-runtime.js';

const base = {
  observationJobId: 'job-1', subjectId: 'a'.repeat(64), checkpoint: '1H' as const,
  targetAt: '2026-09-25T15:00:00Z', actualObservedAt: '2026-09-25T15:17:00Z',
  expectedLegs: [{ optionSymbol: 'SPY261120P00500000', side: 'SHORT' as const, optionType: 'PUT' as const,
    expiration: '2026-11-20', strike: 500, multiplier: 100 }],
  quotes: [{ optionSymbol: 'SPY261120P00500000', bid: 2, ask: 2.1,
    providerTimestamp: '2026-09-25T15:16:59Z', receivedAt: '2026-09-25T15:17:00Z',
    impliedVolatility: 0.2, delta: -0.2, gamma: 0.01, theta: -0.03, vega: 0.1,
    provider: 'ALPACA' as const, feed: 'OPRA' as const, quality: 'GOOD' as const, reasonCodes: [] }],
  underlying: { symbol: 'SPY', price: 550, providerTimestamp: '2026-09-25T15:16:58Z',
    receivedAt: '2026-09-25T15:17:00Z', provider: 'ALPACA' as const,
    purpose: 'RESEARCH_REFERENCE_ONLY' as const },
  sourceSha: 'b'.repeat(40), workerSha: 'b'.repeat(40),
};

test('late observation preserves target, actual time, and delay without backdating', () => {
  const receipt = buildContractPathObservationReceipt(base);
  assert.equal(receipt.targetAt, '2026-09-25T15:00:00.000Z');
  assert.equal(receipt.actualObservedAt, '2026-09-25T15:17:00.000Z');
  assert.equal(receipt.delaySeconds, 1020);
  assert.equal(receipt.executionTruthClass, 'MARKET_OBSERVED');
});

test('market quote is structurally unable to masquerade as a fill or profit', () => {
  const receipt = buildContractPathObservationReceipt(base);
  assert.equal(receipt.marketMarkOnly, true);
  assert.equal(receipt.hypotheticalFill, false);
  assert.equal(receipt.brokerFill, false);
  assert.equal(receipt.modeledExecutionPnl, null);
  assert.equal(receipt.brokerActualPnl, null);
  assert.equal(receipt.brokerAuthority, false);
});

test('missing values remain null while the exact market observation remains factual', () => {
  const quote = base.quotes[0];
  assert.ok(quote);
  const receipt = buildContractPathObservationReceipt({ ...base,
    quotes: [{ ...quote, bid: null, ask: null, impliedVolatility: null,
      delta: null, gamma: null, theta: null, vega: null, quality: 'PARTIAL', reasonCodes: ['BBO_MISSING'] }],
    underlying: { ...base.underlying, price: null } });
  assert.equal(receipt.legs[0]?.bid, null);
  assert.equal(receipt.underlying.price, null);
  assert.deepEqual(receipt.legs[0]?.reasonCodes, ['BBO_MISSING']);
});

test('a different contract or reversed D package leg order fails closed', () => {
  const quote = base.quotes[0];
  assert.ok(quote);
  assert.throws(() => buildContractPathObservationReceipt({ ...base,
    quotes: [{ ...quote, optionSymbol: 'SPY261120P00495000' }] }),
  /CONTRACT_PATH_EXACT_LEG_IDENTITY_MISMATCH/);
});

test('provider and market deferrals remain typed and never become WAIT', () => {
  assert.equal(classifyObservationDeferral({ providerAvailable: false, marketSessionOpen: true }), 'DEFERRED_PROVIDER');
  assert.equal(classifyObservationDeferral({ providerAvailable: true, marketSessionOpen: false }), 'DEFERRED_MARKET');
  assert.equal(classifyObservationDeferral({ providerAvailable: true, marketSessionOpen: null }), 'DEFERRED_MARKET');
  assert.equal(classifyObservationDeferral({ providerAvailable: true, marketSessionOpen: true }), 'DUE');
});
