import assert from 'node:assert/strict';
import test from 'node:test';
import { providerReadinessHasBlockingFailure } from '../src/providers/provider-readiness-policy.js';
import type { CheckResult } from '../src/providers/readiness.js';

const result = (capability: string, state: CheckResult['state']): CheckResult => ({
  provider: 'ALPACA', capability, operationAlias: 'test', state,
  httpStatus: state === 'NOT_ENTITLED' ? 403 : 200,
  observedAt: '2026-09-23T00:00:00Z', retrievedAt: '2026-09-23T00:00:00Z', latencyMs: 1,
  provenance: { host: 'data.alpaca.markets', path: '/test', method: 'GET', executableTruth: true, credentialValuesLogged: false },
  details: {},
});

test('OPRA remains NOT_ENTITLED without failing a healthy distinct Paper indicative path', () => {
  assert.equal(providerReadinessHasBlockingFailure([
    result('OPTIONS_MARKET_DATA_OPRA', 'NOT_ENTITLED'),
    result('OPTIONS_MARKET_DATA_INDICATIVE', 'GOOD'),
    result('ACCOUNT_ENVIRONMENT', 'GOOD'),
  ]), false);
});

test('OPRA denial remains blocking when the Paper indicative path is not healthy', () => {
  assert.equal(providerReadinessHasBlockingFailure([
    result('OPTIONS_MARKET_DATA_OPRA', 'NOT_ENTITLED'),
    result('OPTIONS_MARKET_DATA_INDICATIVE', 'DEGRADED'),
  ]), true);
});

test('an unrelated provider failure is never hidden by a healthy indicative feed', () => {
  assert.equal(providerReadinessHasBlockingFailure([
    result('OPTIONS_MARKET_DATA_OPRA', 'NOT_ENTITLED'),
    result('OPTIONS_MARKET_DATA_INDICATIVE', 'GOOD'),
    result('ACCOUNT_ENVIRONMENT', 'INVALID'),
  ]), true);
});
