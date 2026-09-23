import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveOptionomicsEarningsEvidence } from '../src/theta/earnings-event-evidence.js';
import type { NormalizedOptionomicsContextObservation } from '../src/theta/optionomics-provider.js';

const observation = (earningsInSessions: unknown): NormalizedOptionomicsContextObservation => ({
  family: 'METRICS', operationAlias: 'optionomics.get_symbol_metrics', underlying: 'AAPL',
  requestedAt: '2026-09-23T14:00:00Z', retrievedAt: '2026-09-23T14:00:01Z',
  providerTimestamp: '2026-09-23T00:00:00Z', sessionDate: '2026-09-23', httpStatus: 200,
  requestPath: '/api/v1/stocks/AAPL/metrics', requestParameters: { date: '2026-09-23' },
  rateLimit: { limit: null, remaining: null, resetAt: null, retryAfterSeconds: null },
  documentationReference: 'https://optionomics.ai/docs/api', contractVersion: 'optionomics-public-api-2026-09-14',
  credentialIdentityRefHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), rawPayload: {},
  normalized: { earningsInSessions }, populated: true, informationState: 'POPULATED', paginationComplete: null,
  evidenceClass: 'RESEARCH_AND_STRATEGY_CONTEXT', executableTruth: false,
});

test('known earnings distance preserves trading-session units and positive-only authority', () => {
  const evidence = deriveOptionomicsEarningsEvidence([observation({ state: 'KNOWN', value: 8, reason: null, units: 'TRADING_SESSIONS' })]);
  assert.equal(evidence.state, 'KNOWN_POSITIVE_DISTANCE');
  assert.equal(evidence.distanceTradingSessions, 8);
  assert.equal(evidence.distanceCalendarDays, null);
  assert.equal(evidence.paperEntryNegativeAssurance, false);
  assert.equal(evidence.thetaFirstObservedAt, null);
});

test('missing and invalid provider values stay distinct', () => {
  const unknown = deriveOptionomicsEarningsEvidence([observation({ state: 'UNKNOWN', value: null, reason: 'PROVIDER_VALUE_MISSING_OR_NULL' })]);
  const invalid = deriveOptionomicsEarningsEvidence([observation({ state: 'INVALID', value: null, reason: 'NOT_FINITE' })]);
  assert.equal(unknown.state, 'UNKNOWN');
  assert.equal(unknown.reason, 'PROVIDER_VALUE_MISSING_OR_NULL');
  assert.equal(invalid.state, 'INVALID');
  assert.equal(invalid.reason, 'NOT_FINITE');
});

test('absence of a metrics observation is not negative earnings assurance', () => {
  const evidence = deriveOptionomicsEarningsEvidence([]);
  assert.equal(evidence.state, 'NOT_OBSERVED');
  assert.equal(evidence.distanceTradingSessions, null);
  assert.equal(evidence.paperEntryNegativeAssurance, false);
});
