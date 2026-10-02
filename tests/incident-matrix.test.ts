import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));

test('every recorded incident names an existing regression test and a fix commit', () => {
  const matrix = JSON.parse(readFileSync(path('docs/operations/THETA_INCIDENT_MATRIX.json'), 'utf8'));
  assert.ok(matrix.incidents.length >= 1);
  for (const incident of matrix.incidents) {
    for (const key of ['INCIDENT_ID', 'DATE', 'AFFECTED_RELEASE', 'FAILED_CYCLE_COUNT', 'PAYLOAD_MIN_BYTES', 'PAYLOAD_MAX_BYTES', 'ROOT_CAUSE', 'FIX_SHA', 'REGRESSION_TEST', 'CURRENT_STATUS']) assert.ok(key in incident, `${incident.INCIDENT_ID} missing ${key}`);
    assert.match(incident.FIX_SHA, /^[0-9a-f]{40}$/);
    assert.ok(existsSync(path(incident.REGRESSION_TEST)), incident.REGRESSION_TEST);
  }
});
