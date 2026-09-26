import assert from 'node:assert/strict';
import test from 'node:test';
import * as module_ from '../src/research/theta-iq-readiness-dimensions.js';
import { buildInitialReadinessReport } from '../src/research/theta-iq-readiness-dimensions.js';

test('CORE CLAIM (directive prohibition): no exported function combines the nine dimensions into a single score', () => {
  const exportNames = Object.keys(module_);
  const forbidden = /score|composite|overall|combined|aggregate|total/i;
  for (const name of exportNames) assert.equal(forbidden.test(name), false, `forbidden combining export found: ${name}`);
});

test('the initial report has all nine dimensions at NONE with no fabricated numeric measure', () => {
  const report = buildInitialReadinessReport('2026-09-26T00:00:00Z');
  assert.equal(report.stateCoverage.level, 'NONE');
  assert.equal(report.tailRiskEvidence.level, 'NONE');
  assert.equal(report.calibrationReadiness.numericMeasure, null);
});

test('the report object itself has exactly the nine named dimensions plus contractVersion/generatedAt', () => {
  const report = buildInitialReadinessReport('2026-09-26T00:00:00Z');
  const keys = Object.keys(report).sort();
  assert.deepEqual(keys, [
    'calibrationReadiness', 'contractVersion', 'executionModelReadiness', 'generatedAt', 'independentN',
    'labelMaturity', 'managementEvidence', 'outcomeCoverage', 'stateCoverage', 'strategyCoverage', 'tailRiskEvidence',
  ]);
});
