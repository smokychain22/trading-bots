import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessAegisIvStress,
  normalizeOptionomicsAtmIvObservation,
  type AegisIvStressPolicy,
  type OptionomicsIvSessionObservation,
} from '../src/theta/aegis-iv-stress.js';
import type { NormalizedOptionomicsContextObservation } from '../src/theta/optionomics-provider.js';

const policy: AegisIvStressPolicy = {
  policyVersion: 'aegis-iv-shock-paper-bootstrap-v1',
  authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
  maximumBaselineSessions: 30,
  minimumAbsoluteIncrease: 0.03,
  minimumRelativeIncrease: 0.25,
  minimumRobustZ: 3,
  maturity: {
    policyVersion: 'aegis-iv-baseline-paper-bootstrap-v1', minimumRawN: 20, minimumSessionN: 20,
    minimumDistinctUnderlyingN: 1, minimumTemporalSpanDays: 0, maxCurrentObservationAgeSeconds: 86_400,
  },
};

function context(overrides: Partial<NormalizedOptionomicsContextObservation> = {}): NormalizedOptionomicsContextObservation {
  return {
    family: 'METRICS', operationAlias: 'optionomics.get_symbol_metrics', underlying: 'SPY',
    requestedAt: '2026-09-22T14:00:00.000Z', retrievedAt: '2026-09-22T14:00:01.000Z', providerTimestamp: null,
    sessionDate: '2026-09-21', httpStatus: 200, requestPath: '/api/v1/stocks/SPY/metrics',
    requestParameters: { date: '2026-09-21' }, rateLimit: { limit: null, remaining: null, reset: null, retryAfter: null },
    documentationReference: 'https://optionomics.ai/docs/api', contractVersion: 'optionomics-public-api-2026-09-14',
    credentialIdentityRefHash: 'a'.repeat(64), responseHash: 'b'.repeat(64), rawPayload: { date: '2026-09-21' },
    normalized: { atmIv: { state: 'KNOWN', value: 0.2, reason: null, units: 'PROVIDER_REPORTED_UNVERIFIED' } },
    populated: true, informationState: 'POPULATED', paginationComplete: null,
    evidenceClass: 'RESEARCH_AND_STRATEGY_CONTEXT', executableTruth: false,
    ...overrides,
  };
}

function observation(index: number, iv: number): OptionomicsIvSessionObservation {
  const day = String(index + 1).padStart(2, '0');
  const result = normalizeOptionomicsAtmIvObservation(context({
    sessionDate: `2026-08-${day}`, requestParameters: { date: `2026-08-${day}` },
    requestedAt: `2026-09-01T00:00:${day}.000Z`, retrievedAt: `2026-09-01T00:01:${day}.000Z`,
    responseHash: index.toString(16).padStart(64, '0'),
    normalized: { atmIv: { state: 'KNOWN', value: iv, reason: null, units: 'PROVIDER_REPORTED_UNVERIFIED' } },
  }));
  assert.equal(result.state, 'KNOWN');
  return result.observation;
}

function currentObservation(iv: number): OptionomicsIvSessionObservation {
  const result = normalizeOptionomicsAtmIvObservation(context({
    normalized: { atmIv: { state: 'KNOWN', value: iv, reason: null, units: 'PROVIDER_REPORTED_UNVERIFIED' } },
  }));
  assert.equal(result.state, 'KNOWN');
  return result.observation;
}

test('strict metrics normalization preserves exact session, first observation, and decimal range', () => {
  const result = normalizeOptionomicsAtmIvObservation(context());
  assert.equal(result.state, 'KNOWN');
  assert.equal(result.observation.sessionDate, '2026-09-21');
  assert.equal(result.observation.thetaFirstObservedAt, '2026-09-22T14:00:01.000Z');
  assert.equal(result.observation.evidenceAuthority, 'OPTIONOMICS_SESSION_RESEARCH');
});

test('requested/served mismatch and malformed IV never become a known observation', () => {
  assert.equal(normalizeOptionomicsAtmIvObservation(context({ sessionDate: '2026-09-20' })).state, 'INVALID');
  assert.equal(normalizeOptionomicsAtmIvObservation(context({
    normalized: { atmIv: { state: 'KNOWN', value: 'bad', reason: null, units: 'PROVIDER_REPORTED_UNVERIFIED' } },
  })).state, 'INVALID');
});

test('20-session real baseline can produce a no-shock boolean under explicit bootstrap policy', () => {
  const history = Array.from({ length: 20 }, (_, index) => observation(index, 0.19 + (index % 3) * 0.005));
  const current = currentObservation(0.21);
  const assessment = assessAegisIvStress({ current, history, decisionAsOf: '2026-09-22T14:05:00.000Z', policy });
  assert.equal(assessment.maturity.state, 'DETECTOR_READY');
  assert.equal(assessment.stressIvShockDetected, false);
});

test('large real increase produces shock and immature history remains null, never false', () => {
  const history = Array.from({ length: 20 }, (_, index) => observation(index, 0.18 + (index % 3) * 0.002));
  const current = currentObservation(0.35);
  const ready = assessAegisIvStress({ current, history, decisionAsOf: '2026-09-22T14:05:00.000Z', policy });
  assert.equal(ready.maturity.state, 'DETECTOR_READY');
  assert.equal(ready.stressIvShockDetected, true);
  const immature = assessAegisIvStress({ current, history: history.slice(0, 5), decisionAsOf: '2026-09-22T14:05:00.000Z', policy });
  assert.equal(immature.maturity.state, 'BASELINE_ACCUMULATING');
  assert.equal(immature.stressIvShockDetected, null);
});

test('future-observed evidence is rejected', () => {
  const current = { ...currentObservation(0.2), thetaFirstObservedAt: '2026-09-23T00:00:00.000Z' };
  assert.throws(() => assessAegisIvStress({ current, history: [], decisionAsOf: '2026-09-22T14:05:00.000Z', policy }),
    /CURRENT_EVIDENCE_FROM_FUTURE/);
});
