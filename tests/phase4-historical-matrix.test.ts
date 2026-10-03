// Phase 4: the historical incident regression matrix. Every incident names a real regression test, and the test title (or distinctive text) it cites must still be in that file.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const path = (relative: string): string => fileURLToPath(new URL(`../${relative}`, import.meta.url));
type Incident = { INCIDENT_ID: string; TITLE: string; ORIGINAL_FAILURE: string; ROOT_CAUSE: string; FIX: string; TEST_LEVEL: string; CURRENT_STATUS: string;
  REGRESSION_TEST: { file: string; titleFragment: string }[] };
const matrix = JSON.parse(readFileSync(path('docs/operations/THETA_HISTORICAL_REGRESSION_MATRIX.json'), 'utf8')) as { incidents: Incident[] };

test('the matrix covers exactly 41 distinct incidents with every field present', () => {
  assert.equal(matrix.incidents.length, 41);
  assert.equal(new Set(matrix.incidents.map((incident) => incident.INCIDENT_ID)).size, 41);
  for (const incident of matrix.incidents) {
    for (const field of ['INCIDENT_ID', 'TITLE', 'ORIGINAL_FAILURE', 'ROOT_CAUSE', 'FIX', 'TEST_LEVEL', 'CURRENT_STATUS', 'REGRESSION_TEST'] as const) {
      assert.ok(incident[field] !== undefined && incident[field] !== '', `${incident.INCIDENT_ID} missing ${field}`);
    }
  }
});

test('every cited regression test exists and still contains the cited title; a COVERED incident cites at least one', () => {
  for (const incident of matrix.incidents) {
    if (incident.CURRENT_STATUS === 'COVERED') assert.ok(incident.REGRESSION_TEST.length > 0, `${incident.INCIDENT_ID} is COVERED without a test`);
    for (const cited of incident.REGRESSION_TEST) {
      assert.ok(existsSync(path(cited.file)), `${incident.INCIDENT_ID}: ${cited.file} missing`);
      assert.ok(readFileSync(path(cited.file), 'utf8').includes(cited.titleFragment), `${incident.INCIDENT_ID}: "${cited.titleFragment}" not found in ${cited.file}`);
    }
  }
});

test('no incident is silently untested: a non-COVERED incident states why', () => {
  for (const incident of matrix.incidents.filter((entry) => entry.CURRENT_STATUS !== 'COVERED')) {
    assert.match(incident.CURRENT_STATUS, /^(PARTIAL|NO_TEST) ?\(.{12,}\)$/, `${incident.INCIDENT_ID}: ${incident.CURRENT_STATUS}`);
  }
});
