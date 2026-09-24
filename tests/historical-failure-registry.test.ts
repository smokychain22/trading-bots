import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { historicalFailureRegressions, validateHistoricalFailureRegistry } from
  '../src/operations/historical-failure-registry.js';

test('historical failure registry covers F01 through F23 with executable sanitized proofs', () => {
  assert.equal(historicalFailureRegressions.length, 23);
  assert.deepEqual(validateHistoricalFailureRegistry(), []);
  for (const fixture of historicalFailureRegressions) {
    assert.match(fixture.fixtureId, /^F\d{2}_[A-Z0-9_]+$/);
    assert.ok(fixture.inputFamilies.length > 0);
    assert.ok(fixture.expectedTypedResult.length > 0);
    for (const file of fixture.testFiles) {
      assert.equal(existsSync(file), true, `${fixture.fixtureId}:${file}`);
      assert.match(readFileSync(file, 'utf8'), new RegExp(fixture.proofPattern, 'i'));
    }
  }
});
