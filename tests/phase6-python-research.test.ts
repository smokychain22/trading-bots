import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Phase-6 Python research executes datasets attribution held-out fitting calibration benchmarks and future-label firewalls', () => {
  const result = spawnSync(process.env.PYTHON_EXECUTABLE_FOR_TESTS ?? 'python',
    ['-m', 'unittest', 'discover', '-s', 'bots/theta/tests/quant', '-p', 'test_*.py'],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const count = /Ran (\d+) tests/.exec(result.stderr);
  assert.ok(count && Number(count[1]) >= 1260, result.stderr);
  assert.match(result.stderr, /\bOK\b/);
  assert.doesNotMatch(result.stderr, /skipped|FAILED/);
});
