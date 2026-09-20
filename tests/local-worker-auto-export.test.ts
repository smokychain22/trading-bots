import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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
