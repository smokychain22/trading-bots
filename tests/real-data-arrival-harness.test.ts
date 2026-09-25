import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runRealDataArrivalPipeline, validateBundlePit, validateBundleSchema, type ObservationBundle,
} from '../src/research/real-data-arrival-harness.js';

function bundle(overrides: Partial<ObservationBundle> = {}): ObservationBundle {
  return {
    bundleId: 'bundle-1', decisionAt: '2026-09-26T14:00:00Z', subjectId: 'SPY-590P-20261017',
    wasSelected: false, wasShadowOnly: true,
    rows: [
      {
        subjectId: 'SPY-590P-20261017', checkpoint: '15M', observedAt: '2026-09-26T14:15:00Z',
        marketMarkPrice: 1.25, impliedVolatility: 0.18, underlyingPrice: 592.10,
        sourceSha: 'a'.repeat(40), workerSha: 'b'.repeat(40), provenance: 'REAL_SCHEDULED_OBSERVATION',
      },
    ],
    ...overrides,
  };
}

test('CORE CLAIM: a bundle that arrives real and well-formed passes schema+PIT and builds a real dataset row with zero new code', () => {
  const result = runRealDataArrivalPipeline(bundle());
  assert.equal(result.schemaValid, true);
  assert.equal(result.pitValid, true);
  assert.ok(result.dataset !== null);
  assert.equal(result.dataset?.identifiabilityStatus, 'NOT_IDENTIFIABLE'); // wasSelected=false
});

test('a malformed sourceSha is caught by schema validation before anything else runs', () => {
  const baseRow = bundle().rows[0] as ObservationBundle['rows'][number];
  const malformed = bundle({ rows: [{ ...baseRow, sourceSha: 'not-a-sha' }] });
  const failures = validateBundleSchema(malformed);
  assert.ok(failures.some((f) => f.field === 'sourceSha'));
  const result = runRealDataArrivalPipeline(malformed);
  assert.equal(result.schemaValid, false);
  assert.equal(result.dataset, null);
});

test('CORE CLAIM: a same-cycle observation timestamped before decisionAt is a real PIT leakage failure', () => {
  const baseRow = bundle().rows[0] as ObservationBundle['rows'][number];
  const leaking = bundle({ rows: [{ ...baseRow, checkpoint: '15M', observedAt: '2026-09-26T10:00:00Z' }] });
  const failures = validateBundlePit(leaking);
  assert.ok(failures.length > 0);
  const result = runRealDataArrivalPipeline(leaking);
  assert.equal(result.pitValid, false);
});

test('null market fields are audited with a real, classified UNKNOWN reason, never silently dropped', () => {
  const baseRow = bundle().rows[0] as ObservationBundle['rows'][number];
  const withGap = bundle({ rows: [{ ...baseRow, marketMarkPrice: null }] });
  const result = runRealDataArrivalPipeline(withGap);
  assert.ok(result.unknownAudit.some((u) => u.field === 'marketMarkPrice'));
});

test('a selected/executed subject can reach FACTUAL_OBSERVED', () => {
  const selected = bundle({ wasSelected: true });
  const result = runRealDataArrivalPipeline(selected);
  assert.equal(result.dataset?.identifiabilityStatus, 'FACTUAL_OBSERVED');
});
