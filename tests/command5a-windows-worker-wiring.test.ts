import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalObservationJobScheduler } from '../src/storage/local-observation-job-scheduler.js';

const source = readFileSync('tools/windows/theta-local-worker.ps1', 'utf8');
const command5aRuntime = readFileSync('tools/theta-command5a-runtime.ts', 'utf8');

test('local Command-5A health does not depend on a release-local dotenv file', () => {
  const root = mkdtempSync(join(tmpdir(), 'theta-command5a-health-'));
  try {
    const path = join(root, 'jobs.sqlite');
    new LocalObservationJobScheduler(path).close();
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'tools/theta-command5a-runtime.ts',
      '--mode=health', `--environment-file=${join(root, 'missing.env')}`, `--scheduler=${path}`],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).state, 'COMMAND5A_HEALTH_COMPLETE');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Windows owner schedules, observes, and matures Command-5A through the immutable release with no broker authority', () => {
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=schedule/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=observe/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=mature/);
  assert.match(source, /theta-command5a-runtime\.ts[^\r\n]*`?[\s\S]{0,180}--mode=health/);
  assert.match(source, /'--mode=health',[\s\S]{0,100}"--environment-file=\$productionEnvFile"/);
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
  assert.match(command5aRuntime, /allowClosedSessionLatestMark:\s*true/);
  assert.match(command5aRuntime, /maximumAttempts:\s*3/);
  assert.match(source, /command5aCensoredRetryExhausted/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,180}theta-command5a-runtime\.ts/);
  assert.match(source, /COMMAND5A_SCHEDULE_PROCESS_TIMEOUT/);
  assert.match(source, /COMMAND5A_OBSERVATION_PROCESS_TIMEOUT/);
  assert.match(source, /COMMAND5A_MATURATION_PROCESS_TIMEOUT/);
  assert.match(source, /COMMAND5A_HEALTH_PROCESS_TIMEOUT/);
  assert.doesNotMatch(source, /& node --import tsx tools\/theta-command5a-runtime\.ts/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,180}theta-local-evidence-backfill\.ts/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,220}theta-research-export\.ts/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,220}theta-storage-audit\.ts/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,260}archive-canonical-strategy-frontiers\.ts/);
  assert.match(source, /"--source-sha=\$\(\$runtime\.buildSha\)",'--limit=1'/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,180}theta-no-submit-probe\.ts/);
  assert.match(source, /Invoke-ThetaBoundedProcess[\s\S]{0,200}write-local-runtime-receipt\.mjs/);
  assert.doesNotMatch(source, /& node (?:--import|--env-file|tools\/)/);
  assert.doesNotMatch(source, /if \(\$report\.reconciliation\.marketOpen -eq \$true\) \{[\s\S]{0,120}theta-command5a-runtime\.ts[\s\S]{0,100}--mode=observe/);
  assert.match(source, /\$command5aSince = \[string\]\$runtime\.installedAt/);
  assert.match(source, /"--since=\$command5aSince",'--limit=8'/);
  assert.doesNotMatch(source, /"--since=\$command5aSince",'--limit=250'/);
  assert.doesNotMatch(source, /command5aSince\s*=.*AddMinutes\(-90\)/);
  assert.match(command5aRuntime, /GREATEST\(f\.created_at,d\.decided_at\) AS ready_at/);
  assert.match(command5aRuntime, /scheduler\.sourceCursor\(\)/);
  assert.match(command5aRuntime, /scheduler\.advanceSourceCursor/);
  assert.match(source, /if \(\$report\.reconciliation\.marketOpen -eq \$true\)/);
  assert.doesNotMatch(source, /theta-command5a-runtime\.ts[\s\S]{0,220}(submit|createOrder|postOrder)/i);
});
