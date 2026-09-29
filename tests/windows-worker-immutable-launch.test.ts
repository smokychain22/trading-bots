import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const installer = readFileSync('tools/windows/install-theta-local-worker.ps1', 'utf8');
const status = readFileSync('tools/windows/status-theta-local-worker.ps1', 'utf8');

test('Windows scheduled task launches the supervisor from the immutable release', () => {
  assert.match(
    installer,
    /\$workerScript\s*=\s*Join-Path \$releasePath 'tools\\windows\\theta-local-worker\.ps1'/,
  );
  assert.doesNotMatch(
    installer,
    /\$workerScript\s*=\s*Join-Path \$PSScriptRoot 'theta-local-worker\.ps1'/,
  );
  assert.match(installer, /THETA_RELEASE_WORKER_SCRIPT_MISSING/);
  assert.match(
    installer,
    /New-ScheduledTaskAction[\s\S]{0,180}-File `"\$workerScript`"[\s\S]{0,180}-ControlRoot `"\$repositoryPath`"/,
  );
});

test('worker status rejects a mutable or mismatched scheduled-task script', () => {
  assert.match(status, /\$expectedWorkerScript=.*tools\\windows\\theta-local-worker\.ps1/);
  assert.match(status, /\$taskScriptAligned=/);
  assert.match(status, /BLOCKED_TASK_SCRIPT_MISMATCH/);
  assert.match(status, /expectedWorkerScript=\$expectedWorkerScript;taskScriptAligned=\$taskScriptAligned/);
});
