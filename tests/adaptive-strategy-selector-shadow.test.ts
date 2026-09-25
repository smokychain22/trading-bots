import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdaptiveStrategySelectorShadowReceipt, type ShadowStrategyUtilityEstimate } from '../src/research/adaptive-strategy-selector-shadow.js';
import * as canonicalStrategyFrontier from '../src/theta/canonical-strategy-frontier.js';
import * as canonicalDecisionAuthority from '../src/theta/canonical-decision-authority.js';
import * as managementActionFrontier from '../src/theta/management-action-frontier.js';

function estimate(strategy: ShadowStrategyUtilityEstimate['strategy'], utilityEstimate: number | null = null): ShadowStrategyUtilityEstimate {
  return { strategy, utilityEstimate, uncertainty: null, reasonDecomposition: [] };
}

test('CORE CLAIM: a receipt is structurally brokerAuthority=false and shadowOnly=true', () => {
  const r = buildAdaptiveStrategySelectorShadowReceipt({
    predictionId: 'p1', modelId: 'adaptive-selector', modelVersion: '0.1.0', decisionId: 'd1',
    featureSnapshotHash: 'h1', predictedAt: '2026-09-26T00:00:00Z', sourceSha: 'sha1', workerSha: null,
    estimates: [estimate('THETA_CONVENTIONAL'), estimate('THETA_HOLD_STRIKE'), estimate('THETA_DEFINED_RISK'), estimate('WAIT')],
    shadowPreferredStrategy: null,
  });
  assert.equal(r.brokerAuthority, false);
  assert.equal(r.shadowOnly, true);
});

test('ADVERSARIAL: fewer than 4 distinct strategy estimates is rejected', () => {
  assert.throws(() => buildAdaptiveStrategySelectorShadowReceipt({
    predictionId: 'p2', modelId: 'm', modelVersion: '0.1.0', decisionId: 'd2', featureSnapshotHash: 'h', predictedAt: '2026-09-26T00:00:00Z',
    sourceSha: 'sha1', workerSha: null,
    estimates: [estimate('THETA_CONVENTIONAL'), estimate('THETA_CONVENTIONAL'), estimate('THETA_DEFINED_RISK'), estimate('WAIT')],
    shadowPreferredStrategy: null,
  }), /ADAPTIVE_SELECTOR_SHADOW_MUST_ESTIMATE_ALL_FOUR_ALTERNATIVES_EXACTLY_ONCE/);
});

test('ADVERSARIAL: a preferred strategy with no real utility estimate is rejected', () => {
  assert.throws(() => buildAdaptiveStrategySelectorShadowReceipt({
    predictionId: 'p3', modelId: 'm', modelVersion: '0.1.0', decisionId: 'd3', featureSnapshotHash: 'h', predictedAt: '2026-09-26T00:00:00Z',
    sourceSha: 'sha1', workerSha: null,
    estimates: [estimate('THETA_CONVENTIONAL'), estimate('THETA_HOLD_STRIKE'), estimate('THETA_DEFINED_RISK'), estimate('WAIT')],
    shadowPreferredStrategy: 'THETA_CONVENTIONAL',
  }), /ADAPTIVE_SELECTOR_SHADOW_PREFERRED_STRATEGY_MUST_HAVE_A_REAL_UTILITY_ESTIMATE/);
});

test('a preferred strategy with a real utility estimate is accepted', () => {
  const r = buildAdaptiveStrategySelectorShadowReceipt({
    predictionId: 'p4', modelId: 'm', modelVersion: '0.1.0', decisionId: 'd4', featureSnapshotHash: 'h', predictedAt: '2026-09-26T00:00:00Z',
    sourceSha: 'sha1', workerSha: null,
    estimates: [estimate('THETA_CONVENTIONAL', 12.5), estimate('THETA_HOLD_STRIKE'), estimate('THETA_DEFINED_RISK'), estimate('WAIT')],
    shadowPreferredStrategy: 'THETA_CONVENTIONAL',
  });
  assert.equal(r.shadowPreferredStrategy, 'THETA_CONVENTIONAL');
});

test('STRUCTURAL ISOLATION: this module shares no type/value with canonical decision authority modules', () => {
  const shadowExports = new Set(['adaptiveStrategySelectorShadowVersion', 'buildAdaptiveStrategySelectorShadowReceipt']);
  const canonicalExportNames = [
    ...Object.keys(canonicalStrategyFrontier), ...Object.keys(canonicalDecisionAuthority), ...Object.keys(managementActionFrontier),
  ];
  for (const name of canonicalExportNames) assert.equal(shadowExports.has(name), false, `unexpected shared export name: ${name}`);
});
