import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('tools/windows/theta-local-worker.ps1', 'utf8');

test('Windows owner schedules and observes Command-5A through the immutable release with no broker authority', () => {
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=schedule/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=observe/);
  assert.match(source, /command5aScheduleState=\$command5aScheduleState/);
  assert.match(source, /command5aObservationState=\$command5aObservationState/);
  assert.match(source, /if \(\$report\.reconciliation\.marketOpen -eq \$true\)/);
  assert.doesNotMatch(source, /theta-command5a-runtime\.ts[\s\S]{0,220}(submit|createOrder|postOrder)/i);
});
