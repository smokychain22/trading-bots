import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Phase-5 executed Python authority rejects malformed inputs and checks every numeric AEGIS and sizing boundary', () => {
  const result = spawnSync(process.env.PYTHON_EXECUTABLE_FOR_TESTS ?? 'python', ['-m', 'unittest', 'discover',
    '-s', 'bots/theta/tests/quant', '-p', 'test_*numeric_boundaries.py', '-v'],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Ran 12 tests/);
  assert.match(result.stderr, /\bOK\b/);
  assert.doesNotMatch(result.stderr, /skipped|FAILED/);
});
