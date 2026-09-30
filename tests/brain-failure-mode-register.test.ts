import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const register = JSON.parse(readFileSync(path.join(root,
  'docs/research/THETA_BRAIN_FAILURE_MODE_REGISTER.json'), 'utf8')) as {
  contractVersion: string;
  modes: Array<{ id: string; state: string; detection: string; test: string; protection: string }>;
};

test('the 19 brain failure modes are explicit and every cited test exists', () => {
  assert.equal(register.contractVersion, 'theta-brain-failure-mode-register-v1');
  assert.equal(register.modes.length, 19);
  assert.equal(new Set(register.modes.map((mode) => mode.id)).size, 19);
  for (const mode of register.modes) {
    assert.match(mode.id, /^[A-Z_]+$/);
    assert.ok(['GUARDED_SOURCE', 'PARTIAL', 'OPEN_AUDIT', 'EMPIRICAL_ONLY'].includes(mode.state));
    assert.ok(mode.detection.length > 10 && mode.protection.length > 10);
    assert.equal(existsSync(path.join(root, mode.test)), true, `${mode.id} has no cited test`);
  }
  for (const unclosed of ['CORRECTION_CASCADE', 'SIGNAL_DOUBLE_COUNTING', 'ACTION_OSCILLATION', 'STRATEGY_THRASHING']) {
    assert.equal(register.modes.find((mode) => mode.id === unclosed)?.state, 'OPEN_AUDIT');
  }
});
