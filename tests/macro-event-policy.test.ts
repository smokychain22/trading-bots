import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveMacroRiskEvidence } from '../src/theta/macro-event-policy.js';
import type { OptionomicsMacroEventCoverage, NormalizedOptionomicsContextObservation } from '../src/theta/optionomics-provider.js';

const observation = (rows: readonly unknown[]): NormalizedOptionomicsContextObservation => ({
  family: 'EVENTS', operationAlias: 'optionomics.list_events', underlying: 'SPY',
  requestedAt: '2026-09-23T14:00:00Z', retrievedAt: '2026-09-23T14:00:01Z', providerTimestamp: null,
  sessionDate: null, httpStatus: 200, requestPath: '/api/v1/events', requestParameters: {},
  rateLimit: { limit: null, remaining: null, resetAt: null, retryAfterSeconds: null },
  documentationReference: 'https://optionomics.ai/docs/api', contractVersion: 'optionomics-public-api-2026-09-14',
  credentialIdentityRefHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), rawPayload: {},
  normalized: { rows }, populated: rows.length > 0,
  informationState: rows.length > 0 ? 'POPULATED' : 'EMPTY_RESULT_COVERAGE_UNVERIFIED',
  paginationComplete: true, evidenceClass: 'RESEARCH_AND_STRATEGY_CONTEXT', executableTruth: false,
});

const coverage = (rows: readonly unknown[], state: 'COMPLETE' | 'INCOMPLETE' = 'COMPLETE'): OptionomicsMacroEventCoverage => ({
  state, reason: state === 'COMPLETE' ? null : 'REQUEST_BUDGET_EXHAUSTED', families: ['macro', 'fed'],
  from: '2026-09-23', to: '2026-10-23', observations: [observation(rows)],
  providerEventCount: rows.length, negativeQualified: rows.length === 0 && state === 'COMPLETE',
});

test('complete bounded coverage produces a versioned known false, never an assumed false', () => {
  const result = deriveMacroRiskEvidence({ coverage: coverage([]), decisionAsOf: '2026-09-23T14:00:02Z' });
  assert.equal(result.state, 'KNOWN_FALSE');
  assert.equal(result.macroRiskFlag, false);
  assert.equal(result.authority, 'PAPER_BOOTSTRAP_NOT_EMPIRICALLY_OPTIMAL');
});

test('a timestamp-valid scheduled Fed event inside the horizon produces known true', () => {
  const result = deriveMacroRiskEvidence({ coverage: coverage([{ type: 'fed',
    scheduledAt: '2026-09-24T18:00:00Z', knownAt: '2026-09-01T12:00:00Z' }]),
  decisionAsOf: '2026-09-23T14:00:02Z' });
  assert.equal(result.state, 'KNOWN_TRUE');
  assert.equal(result.macroRiskFlag, true);
  assert.equal(result.nearEventCount, 1);
});

test('incomplete coverage and missing schedule time remain unknown', () => {
  assert.equal(deriveMacroRiskEvidence({ coverage: coverage([], 'INCOMPLETE'),
    decisionAsOf: '2026-09-23T14:00:02Z' }).state, 'UNKNOWN');
  assert.equal(deriveMacroRiskEvidence({ coverage: coverage([{ type: 'macro', scheduledAt: null }]),
    decisionAsOf: '2026-09-23T14:00:02Z' }).state, 'UNKNOWN');
});
