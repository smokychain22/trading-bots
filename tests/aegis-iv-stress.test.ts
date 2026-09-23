import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import {
  assessAegisIvStress,
  normalizeOptionomicsAtmIvObservation,
  refreshAegisIvStress,
  type AegisIvStressPolicy,
  type OptionomicsIvSessionObservation,
} from '../src/theta/aegis-iv-stress.js';
import type { NormalizedOptionomicsContextObservation } from '../src/theta/optionomics-provider.js';

const policy: AegisIvStressPolicy = {
  policyVersion: 'aegis-iv-shock-paper-bootstrap-v2',
  authority: 'PAPER_BOOTSTRAP_BASELINE_NOT_EMPIRICALLY_OPTIMAL',
  maximumBaselineSessions: 30,
  minimumAbsoluteIncrease: 0.03,
  minimumRelativeIncrease: 0.25,
  minimumRobustZ: 3,
  zeroMadFallback: 'ABSOLUTE_AND_RELATIVE',
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
    sessionDate: '2026-09-22', requestParameters: { date: '2026-09-22' },
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
  assert.equal(assessment.sessionState, 'CURRENT_SESSION');
});

test('fresh retrieval of a prior served session cannot assert no IV shock', () => {
  const history = Array.from({ length: 20 }, (_, index) => observation(index, 0.2));
  const current = { ...currentObservation(0.21), sessionDate: '2026-09-21',
    requestParameters: { date: '2026-09-21' } };
  const assessment = assessAegisIvStress({ current, history, decisionAsOf: '2026-09-22T14:05:00.000Z', policy });
  assert.equal(assessment.maturity.state, 'DETECTOR_READY');
  assert.equal(assessment.sessionState, 'LATEST_COMPLETED_SESSION');
  assert.equal(assessment.stressIvShockDetected, null);
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

test('missing persistence schema becomes an explicit AEGIS blocker without throwing out the scan', async () => {
  const schemaMissing = Object.assign(new Error('not exposed'), { code: '42P01' });
  const pool = { query: async () => { throw schemaMissing; } } as unknown as Pool;
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    date: '2026-09-22', symbol: 'SPY', metrics: { atm_iv: 0.2 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await refreshAegisIvStress({
    pool,
    optionomics: {
      apiBase: 'https://optionomics.ai', email: 'owner@example.test', apiToken: 'secret-not-returned',
      fetchImpl, now: () => '2026-09-23T00:00:00.000Z', maxRetryAttempts: 1,
    },
    decisionAsOf: '2026-09-23T00:00:01.000Z',
  });
  assert.deepEqual(result, {
    state: 'PERSISTENCE_ERROR', assessment: null, reason: 'AEGIS_IV_PERSISTENCE_42P01',
  });
});

test('zero-MAD IV baseline records its governed fallback instead of silently passing robust z', () => {
  const history = Array.from({ length: 20 }, (_, index) => observation(index, 0.2));
  const current = currentObservation(0.35);
  const fallback = assessAegisIvStress({ current, history, decisionAsOf: '2026-09-22T14:05:00.000Z', policy });
  assert.equal(fallback.dispersionState, 'MAD_ZERO');
  assert.equal(fallback.robustZApplicability, 'ZERO_MAD_ABSOLUTE_RELATIVE_FALLBACK');
  assert.equal(fallback.stressIvShockDetected, true);
  const disabled = assessAegisIvStress({ current, history, decisionAsOf: '2026-09-22T14:05:00.000Z',
    policy: { ...policy, zeroMadFallback: 'UNAVAILABLE' } });
  assert.equal(disabled.stressIvShockDetected, null);
});

test('live IV read freezes decision time after provider observation, while historical time stays fail-closed', async () => {
  const queries: {sql:string; params:readonly unknown[]|undefined}[] = [];
  const pool = { query: async (sql:string, params?:readonly unknown[]) => {
    queries.push({sql,params});
    return {rows:[]};
  } } as unknown as Pool;
  const optionomics = {
    apiBase:'https://optionomics.ai', email:'owner@example.test', apiToken:'secret-not-returned',
    fetchImpl: async () => new Response(JSON.stringify({date:'2026-09-22',symbol:'SPY',metrics:{atm_iv:0.2}}),
      {status:200,headers:{'content-type':'application/json'}}),
    now:()=>'2026-09-23T00:00:01.000Z', maxRetryAttempts:1,
  };
  const historical = await refreshAegisIvStress({pool,optionomics,
    decisionAsOf:'2026-09-23T00:00:00.000Z'});
  assert.equal(historical.state,'INVALID');
  assert.equal(historical.reason,'CURRENT_EVIDENCE_AFTER_DECISION');
  const live = await refreshAegisIvStress({pool,optionomics,
    decisionAsOf:'2026-09-23T00:00:00.000Z',freezeDecisionAsOf:()=>'2026-09-23T00:00:02.000Z'});
  assert.equal(live.state,'BASELINE_IMMATURE');
  assert.equal(live.assessment?.decisionAsOf,'2026-09-23T00:00:02.000Z');
  const reads=queries.filter((query)=>query.sql.includes('FROM market.optionomics_iv_session_observation'));
  assert.equal(reads.length,1);
  assert.deepEqual(reads[0]?.params,['SPY','2026-09-23T00:00:02.000Z']);
});
