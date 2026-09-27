import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('tools/windows/theta-local-worker.ps1', 'utf8');
const command5aRuntime = readFileSync('tools/theta-command5a-runtime.ts', 'utf8');

test('Windows owner schedules, observes, and matures Command-5A through the immutable release with no broker authority', () => {
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=schedule/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=observe/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=mature/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=health/);
  assert.match(source, /command5aScheduleState=\$command5aScheduleState/);
  assert.match(source, /command5aObservationState=\$command5aObservationState/);
  assert.match(source, /command5aMaturationState=\$command5aMaturationState/);
  assert.match(source, /command5aBacklogState=\$command5aBacklogState/);
  assert.match(source, /command5aScheduleErrorCode=\$command5aScheduleErrorCode/);
  assert.match(source, /command5aObservationErrorCode=\$command5aObservationErrorCode/);
  assert.match(source, /command5aMaturationErrorCode=\$command5aMaturationErrorCode/);
  assert.match(source, /command5aHealthErrorCode=\$command5aHealthErrorCode/);
  assert.match(command5aRuntime, /state:\s*'COMMAND5A_FAILED'/);
  assert.match(command5aRuntime, /errorCode:\s*command5aSafeFailureCode\(error\)/);
  assert.match(source, /\$command5aSince = \[string\]\$runtime\.installedAt/);
  assert.doesNotMatch(source, /command5aSince\s*=.*AddMinutes\(-90\)/);
  assert.match(command5aRuntime, /GREATEST\(f\.created_at,d\.decided_at\) AS ready_at/);
  assert.match(command5aRuntime, /scheduler\.sourceCursor\(\)/);
  assert.match(command5aRuntime, /scheduler\.advanceSourceCursor/);
  assert.match(source, /if \(\$report\.reconciliation\.marketOpen -eq \$true\)/);
  assert.doesNotMatch(source, /theta-command5a-runtime\.ts[\s\S]{0,220}(submit|createOrder|postOrder)/i);
});
