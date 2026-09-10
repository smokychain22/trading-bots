import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyObservation, classifyObservations, DEFAULT_FRESHNESS_POLICIES, type ObservationInput } from '../src/theta/data-freshness.js';

const NOW = '2026-09-10T15:00:00.000Z';
const secondsAgo = (s: number): string => new Date(new Date(NOW).getTime() - s * 1000).toISOString();

const base = (overrides: Partial<ObservationInput> = {}): ObservationInput => ({
  observationClass: 'OPTION_QUOTE',
  observedAt: secondsAgo(1),
  receivedAt: NOW,
  providerEntitlement: 'ENTITLED',
  providerReachable: true,
  valuePresent: true,
  ...overrides,
});

test('a fresh option quote (1s old) is GOOD against OPTION_QUOTE policy (goodMaxAgeSeconds=10)', () => {
  const result = classifyObservation(base(), DEFAULT_FRESHNESS_POLICIES.OPTION_QUOTE);
  assert.equal(result.state, 'GOOD');
  assert.equal(result.ageSeconds, 1);
});

test('the SAME age is GOOD for open interest but would be STALE for an option quote -- classes never share one global threshold', () => {
  const oneHourOld = secondsAgo(3600);
  const oiResult = classifyObservation(base({ observationClass: 'OPTION_OPEN_INTEREST', observedAt: oneHourOld }), DEFAULT_FRESHNESS_POLICIES.OPTION_OPEN_INTEREST);
  const quoteResult = classifyObservation(base({ observationClass: 'OPTION_QUOTE', observedAt: oneHourOld }), DEFAULT_FRESHNESS_POLICIES.OPTION_QUOTE);
  assert.equal(oiResult.state, 'GOOD');
  assert.equal(quoteResult.state, 'STALE');
});

test('an unreachable provider yields UNKNOWN, never a stale-but-usable classification', () => {
  const result = classifyObservation(base({ providerReachable: false }), DEFAULT_FRESHNESS_POLICIES.OPTION_QUOTE);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.ageSeconds, null);
});

test('NOT_ENTITLED is reported distinctly, never silently coerced to UNKNOWN or GOOD', () => {
  const result = classifyObservation(base({ providerEntitlement: 'NOT_ENTITLED' }), DEFAULT_FRESHNESS_POLICIES.OPTION_GREEKS);
  assert.equal(result.state, 'NOT_ENTITLED');
});

test('a missing value (valuePresent=false) is UNKNOWN, never coerced to zero/default', () => {
  const result = classifyObservation(base({ valuePresent: false, observedAt: null }), DEFAULT_FRESHNESS_POLICIES.OPTION_OPEN_INTEREST);
  assert.equal(result.state, 'UNKNOWN');
});

test('a present value with no observation timestamp is UNKNOWN, never assumed fresh', () => {
  const result = classifyObservation(base({ observedAt: null }), DEFAULT_FRESHNESS_POLICIES.OPTION_QUOTE);
  assert.equal(result.state, 'UNKNOWN');
  assert.equal(result.ageSeconds, null);
});

test('DEGRADED sits strictly between GOOD and STALE', () => {
  // OPTION_QUOTE: goodMaxAgeSeconds=10, staleMinAgeSeconds=60
  const result = classifyObservation(base({ observedAt: secondsAgo(30) }), DEFAULT_FRESHNESS_POLICIES.OPTION_QUOTE);
  assert.equal(result.state, 'DEGRADED');
});

test('a negative/unparseable age is INVALID, never silently treated as fresh', () => {
  const result = classifyObservation(base({ observedAt: new Date(new Date(NOW).getTime() + 60_000).toISOString() }), DEFAULT_FRESHNESS_POLICIES.OPTION_QUOTE);
  assert.equal(result.state, 'INVALID');
});

test('classifyObservations classifies a batch, each against its own class policy', () => {
  const results = classifyObservations([
    base({ observationClass: 'OPTION_QUOTE', observedAt: secondsAgo(1) }),
    base({ observationClass: 'OPTION_OPEN_INTEREST', observedAt: secondsAgo(1800) }),
    base({ observationClass: 'ACCOUNT', providerReachable: false }),
  ]);
  assert.deepEqual(results.map((r) => r.state), ['GOOD', 'GOOD', 'UNKNOWN']);
});
