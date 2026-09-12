import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { AutonomousRuntimeReport } from '../src/theta/autonomous-runtime.js';
import { completedCandidateEvidenceScan } from '../src/worker/postgres-worker-runtime-store.js';

const report=(status:string|null,errorCode:string|null):AutonomousRuntimeReport=>({
  correlationId:'theta-runtime:2026-09-12T14:30',status:status==='DEGRADED'?'DEGRADED':'SUCCEEDED',
  runtimeVersion:'test',policyVersion:'test',jobsAttempted:1,jobsCompleted:1,
  jobResults:[{jobType:'OPPORTUNITY_SCAN',outcome:'RAN',status,errorCode}],reconciliation:null,
  executionGate:'LOCKED',masterPaperOrdersSubmitted:0,followerPaperOrdersSubmitted:0,liveOrdersSubmitted:0,
});

test('Windows supervisor exports once after a complete scan without gaining an order surface', async () => {
  const source = await readFile('tools/windows/theta-local-worker.ps1', 'utf8');
  assert.match(source, /last-auto-export-session/);
  assert.match(source, /OPPORTUNITY_SCAN/);
  assert.match(source, /\.status -eq 'SUCCEEDED'/);
  assert.match(source, /npm run theta:research-export -- --latest/);
  assert.match(source, /CURRENT_SESSION_EXPORTED/);
  assert.match(source, /BLOCKED_ON_EVIDENCE/);
  assert.doesNotMatch(source, /\/v2\/orders/i);
  assert.doesNotMatch(source, /APCA-API-KEY-ID|APCA-API-SECRET-KEY/);
});

test('Windows installer does not silently queue evidence capture on laptop battery',async()=>{
  const source=await readFile('tools/windows/install-theta-local-worker.ps1','utf8');
  assert.match(source,/-AllowStartIfOnBatteries/);
  assert.match(source,/-DontStopIfGoingOnBatteries/);
});

test('candidate scan timestamp advances only for a real complete or partial evidence scan',()=>{
  assert.equal(completedCandidateEvidenceScan(report('SUCCEEDED',null)),true);
  assert.equal(completedCandidateEvidenceScan(report('DEGRADED','SHADOW_SCAN_PARTIAL')),true);
  assert.equal(completedCandidateEvidenceScan(report('SKIPPED','MARKET_CLOSED_NO_SHADOW_EVIDENCE')),false);
  assert.equal(completedCandidateEvidenceScan(report('DEGRADED','OPTION_MARKET_SESSION_UNCONFIRMED')),false);
});
