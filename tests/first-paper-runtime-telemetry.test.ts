import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFirstPaperRuntimeTelemetry } from '../src/theta/first-paper-runtime-telemetry.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';

const candidate = (quantity: number, bindingConstraint: string, aegisState: 'ALLOW_FULL' | 'HOLD_ONLY') => ({
  branch: 'THETA_CONVENTIONAL', aegisState, sizing: { quantity, bindingConstraint, reasons: [] },
});

test('runtime telemetry reports sizing constraints and observed finalist refresh without granting authority', () => {
  const frontier = { branches: [{ candidates: [
    candidate(1, 'REAL_ASSIGNMENT_CAPACITY', 'ALLOW_FULL'),
    candidate(0, 'AEGIS_HOLD_ONLY', 'HOLD_ONLY'),
  ] }] } as unknown as CanonicalStrategyFrontier;
  const telemetry = buildFirstPaperRuntimeTelemetry({
    frontier,
    alpacaQuoteState: {
      contractVersion: 'theta-finalist-quote-refresh-v1', policyVersion: 'refresh-v1',
      initialCandidateCount: 20, selectedCount: 5, refreshedCount: 4, failedCount: 1,
      candidateBuiltAt: '2026-09-23T14:00:00Z', finalistChosenAt: '2026-09-23T14:00:01Z',
      decisionAsOf: '2026-09-23T14:00:02Z', observations: [], maxFinalists: 5,
    },
  });
  assert.equal(telemetry.candidateCount, 2);
  assert.equal(telemetry.positiveSizeCandidateCount, 1);
  assert.equal(telemetry.zeroSizeCandidateCount, 1);
  assert.deepEqual(telemetry.bindingConstraintCounts, { REAL_ASSIGNMENT_CAPACITY: 1, AEGIS_HOLD_ONLY: 1 });
  assert.deepEqual(telemetry.aegisStateCounts, { ALLOW_FULL: 1, HOLD_ONLY: 1 });
  assert.equal(telemetry.finalistRefresh.state, 'OBSERVED');
  assert.equal(telemetry.finalistRefresh.refreshedCount, 4);
  assert.equal(telemetry.brokerAuthority, false);
});

test('runtime telemetry preserves not observed when the cycle stops before candidate evaluation', () => {
  const telemetry = buildFirstPaperRuntimeTelemetry({ frontier: null, alpacaQuoteState: undefined });
  assert.equal(telemetry.candidateCount, 0);
  assert.equal(telemetry.positiveSizeCandidateCount, 0);
  assert.equal(telemetry.finalistRefresh.state, 'NOT_OBSERVED');
});
