import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import type { AutonomousRuntimeReport } from '../src/theta/autonomous-runtime.js';
import { completedCandidateEvidenceScan } from '../src/worker/postgres-worker-runtime-store.js';

const report=(status:string|null,errorCode:string|null):AutonomousRuntimeReport=>({
  correlationId:'theta-runtime:2026-09-12T14:30',status:status==='DEGRADED'?'DEGRADED':'SUCCEEDED',
  runtimeVersion:'test',policyVersion:'test',jobsAttempted:1,jobsCompleted:1,
  jobResults:[{jobType:'OPPORTUNITY_SCAN',outcome:'RAN',status,errorCode}],reconciliation:null,
  runtimeMode:'MASTER_THETA_PAPER',executionGate:'EXTERNAL_QUOTE_BLOCKER',masterPaperOrdersSubmitted:0,followerPaperOrdersSubmitted:0,liveOrdersSubmitted:0,
});

test('Windows supervisor exports once after a complete scan without gaining an order surface', async () => {
  const source = await readFile('tools/windows/theta-local-worker.ps1', 'utf8');
  assert.match(source, /last-auto-export-session/);
  assert.match(source, /OPPORTUNITY_SCAN/);
  assert.match(source, /\.status -eq 'SUCCEEDED'/);
  assert.match(source, /--env-file=\$productionEnvFile/);
  assert.match(source, /tools\/theta-research-export\.ts --latest/);
  assert.match(source, /THETA_PRODUCTION_ENV_NOT_PROVISIONED/);
  assert.match(source, /\$researchExit = \$LASTEXITCODE/);
  assert.match(source, /\$pipelineExit = \$LASTEXITCODE/);
  assert.match(source, /CURRENT_SESSION_EXPORTED/);
  assert.match(source, /BLOCKED_ON_EVIDENCE/);
  assert.match(source, /last-empirical-dataset-identity/);
  assert.match(source, /last-alpaca-indicative-qualification-session/);
  assert.match(source, /alpaca-indicative-quote-qualification/);
  assert.match(source, /\.qualified -eq \$true/);
  assert.match(source, /AUTO-DESCRIPTIVE-\$\(\$runtime\.buildSha\.Substring\(0,12\)\)/);
  assert.match(source, /RESEARCH_RESULT_IDENTITY_INVALID/);
  assert.match(source, /existingResult\.source_code_commit/);
  assert.match(source, /research\.empirical_pipeline/);
  assert.match(source, /EXPORTED_AND_RESEARCHED/);
  assert.match(source, /RESEARCH_CURRENT/);
  assert.match(source, /pending-auto-export-session/);
  assert.match(source, /DEFERRED_MARKET_CRITICAL/);
  assert.match(source, /RESEARCH_DEFERRED_MARKET_CRITICAL/);
  assert.match(source, /marketOpen -eq \$true/);
  assert.match(source, /last-storage-audit-date/);
  assert.match(source, /theta-storage-audit\.ts/);
  assert.match(source, /storageAuditState.*DEFERRED_MARKET_CRITICAL/);
  assert.match(source, /archive-canonical-strategy-frontiers\.ts/);
  assert.match(source, /compact-local-research-spool\.py/);
  assert.match(source, /localResearchArchiveState/);
  assert.match(source, /localResearchParquetState/);
  assert.match(source, /research-archives/);
  assert.match(source, /import duckdb/);
  assert.match(source, /DEPENDENCY_UNAVAILABLE_NONCRITICAL/);
  assert.match(source, /NO_SPLIT_DESCRIPTIVE_ONLY/);
  assert.match(source, /runtime-broker-cycle/);
  assert.match(source, /runtime-lifecycle-cycle/);
  assert.match(source, /runtime-management-cycle/);
  assert.match(source, /runtime-observation-cycle/);
  assert.match(source, /runtime-evidence-cycle/);
  assert.match(source, /write-local-runtime-receipt\.mjs/);
  assert.match(source, /localReceiptState/);
  assert.match(source, /localReceiptHash/);
  assert.match(source, /write-local-durable-evidence\.mjs/);
  assert.match(source, /localEvidenceState/);
  assert.match(source, /FAILED_NONCRITICAL/);
  assert.match(source, /Invoke-RestMethod[^\r\n]+-TimeoutSec 180/);
  assert.match(source, /Invoke-RestMethod[^\r\n]+-TimeoutSec 290/);
  assert.match(source, /failedOperation=\$currentOperation/);
  assert.match(source, /operationStartedAt=\$operationStartedAt\.ToString\('o'\)/);
  assert.match(source, /elapsedMilliseconds=/);
  assert.match(source, /X-Theta-Safe-Error-Code/);
  assert.match(source, /serverErrorCode=\$serverErrorCode/);
  assert.match(source, /RUNTIME_EVIDENCE_CYCLE/);
  assert.match(source, /OPTIONOMICS_QUOTE_QUALIFICATION/);
  assert.doesNotMatch(source, /ErrorDetails\.Message|Response\.Content/);
  assert.doesNotMatch(source, /\/v2\/orders/i);
  assert.doesNotMatch(source, /APCA-API-KEY-ID|APCA-API-SECRET-KEY/);
  assert.doesNotMatch(source, /\$report\.(providerAccountRefHash|positions|rawPayload)/);
});

test('Windows installer does not silently queue evidence capture on laptop battery',async()=>{
  const source=await readFile('tools/windows/install-theta-local-worker.ps1','utf8');
  assert.match(source,/-AllowStartIfOnBatteries/);
  assert.match(source,/-DontStopIfGoingOnBatteries/);
  assert.match(source,/-RunOnlyIfNetworkAvailable/);
  assert.match(source,/-WakeToRun/);
  assert.match(source,/-StartWhenAvailable/);
  assert.match(source,/-MultipleInstances IgnoreNew/);
  assert.match(source,/THETA_PRODUCTION_ENV_NOT_PROVISIONED/);
  assert.match(source,/git worktree add --detach/);
  assert.match(source,/releasePath=\$releasePath/);
  assert.match(source,/-ControlRoot/);
  assert.match(source,/\$currentTask = Get-ScheduledTask -TaskName \$TaskName/);
  assert.match(source,/New-Item -ItemType File -Force -Path \$currentStopFile/);
  assert.match(source,/Stop-ScheduledTask -TaskName \$TaskName/);
  assert.match(source,/Remove-Item -LiteralPath \$currentStopFile/);
  assert.match(source,/\$existingRuntime\.workerId/);
  assert.match(source,/workerId=\$workerId/);
  assert.match(source,/THETA_CUTOVER_OLD_SUPERVISOR_NOT_RELEASED/);
  assert.match(source,/\$cutoverMutex\.WaitOne\(20000\)/);
  assert.ok(source.indexOf('$cutoverMutex.WaitOne') < source.indexOf('@{ repositoryPath='));
});

test('non-owner supervisor cleanup cannot delete the active lease or overwrite health', { skip: process.platform !== 'win32' }, () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    $source = Get-Content -Raw -LiteralPath tools/windows/theta-local-worker.ps1
    $tokens = $null; $parseErrors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw 'PARSE_ERRORS' }
    $finally = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.TryStatementAst] -and
      $null -ne $node.Finally -and $node.Finally.Extent.Text.Contains('$mutex.Dispose()') }, $true)[0].Finally.Extent.Text
    $body = [scriptblock]::Create($finally.Substring(1, $finally.Length - 2))
    $script:counts = @{ deletes=0; writes=0; releases=0; disposes=0 }
    function Invoke-RestMethod { $script:counts.deletes++ }
    function Set-Content { $script:counts.writes++ }
    $mutex = New-Object PSObject
    $mutex | Add-Member ScriptMethod ReleaseMutex { $script:counts.releases++ }
    $mutex | Add-Member ScriptMethod Dispose { $script:counts.disposes++ }
    $token = 'test-only-nonsecret-placeholder-value'
    $runtime = @{workerId='test';buildSha='test';endpoint='https://invalid.test'}
    $statusFile = 'mocked-never-written'
    $owned = $false
    . $body
    if ($counts.deletes -ne 0 -or $counts.writes -ne 0 -or $counts.releases -ne 0 -or $counts.disposes -ne 1) { throw 'NON_OWNER_MUTATED' }
    $owned = $true
    . $body
    if ($counts.deletes -ne 1 -or $counts.writes -ne 1 -or $counts.releases -ne 1 -or $counts.disposes -ne 2) { throw 'OWNER_CLEANUP_INCOMPLETE' }
    'PASS'
  `], { encoding: 'utf8' });
  assert.equal(output.trim(), 'PASS');
});

test('Windows worker status never reports stale ONLINE health as current when the supervisor is not running',async()=>{
  const statusSource=await readFile('tools/windows/status-theta-local-worker.ps1','utf8');
  assert.match(statusSource,/taskRunning/);
  assert.match(statusSource,/BLOCKED_RUNTIME_SHA_MISMATCH/);
  assert.match(statusSource,/runtimeShaAligned/);
  assert.match(statusSource,/healthShaAligned/);
  assert.match(statusSource,/STARTING_NEW_RELEASE/);
  assert.match(statusSource,/releaseSha/);
  assert.match(statusSource,/executionGate=if\(\$taskRunning-and\$healthShaAligned\)/);
  const workerSource=await readFile('tools/windows/theta-local-worker.ps1','utf8');
  assert.match(workerSource,/failureCode='THETA_RUNTIME_SHA_MISMATCH'/);
  assert.match(workerSource,/executionGate='LOCKED'/);
  assert.match(workerSource,/runtime\.releasePath/);
  assert.match(workerSource,/THETA_RUNTIME_RELEASE_PATH_MISMATCH/);
});

test('candidate scan timestamp advances only for a real complete or partial evidence scan',()=>{
  assert.equal(completedCandidateEvidenceScan(report('SUCCEEDED',null)),true);
  assert.equal(completedCandidateEvidenceScan(report('DEGRADED','SHADOW_SCAN_PARTIAL')),true);
  assert.equal(completedCandidateEvidenceScan(report('SKIPPED','MARKET_CLOSED_NO_SHADOW_EVIDENCE')),false);
  assert.equal(completedCandidateEvidenceScan(report('DEGRADED','OPTION_MARKET_SESSION_UNCONFIRMED')),false);
});

test('Windows worker spools a read-only probe during database loss and backfills only after recovery',async()=>{
  const source=await readFile('tools/windows/theta-local-worker.ps1','utf8');
  assert.match(source,/RUNTIME_EVIDENCE_CYCLE/);
  assert.match(source,/theta-no-submit-probe\.ts/);
  assert.match(source,/databaseRecoverySuccesses -ge 2/);
  assert.match(source,/theta-local-evidence-backfill\.ts/);
  assert.doesNotMatch(source,/MASTER_PAPER_EXECUTION_ENABLED\s*=\s*true/i);
  assert.doesNotMatch(source,/FOLLOWER_PAPER_EXECUTION_ENABLED\s*=\s*true/i);
});
