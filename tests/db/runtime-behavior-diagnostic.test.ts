import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresRuntimeBehaviorDiagnosticStore, type RuntimeBehaviorDiagnosticInput } from '../../src/theta/runtime-behavior-diagnostic.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

test('PostgreSQL behavior diagnostics are immutable, replay-safe, and count consecutive WAIT cycles', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString:url.toString(),max:2 });
  const store = new PostgresRuntimeBehaviorDiagnosticStore(pool);
  const insertScan = async (scanId:string,at:string):Promise<void> => {
    await pool.query(`INSERT INTO research.theta_shadow_scan_run(scan_id,mode,contract_version,started_at,finished_at,
      universe_version,lattice_version,strategy_version,branches_json,eligible_symbols_json,max_underlyings,
      symbols_attempted,symbols_completed,candidate_count,completeness_state,missing_scope_json,content_hash,
      global_wait_earned,global_wait_evidence_json)
      VALUES($1,'THETA_SHADOW_ONLY','test-v1',$2,$2,'universe-v1','lattice-v1','strategy-v1','[]','[]',1,
      1,1,2,'COMPLETE','[]',$3,true,'{"earned":true}')`,[scanId,at,hash(scanId)]);
  };
  const diagnosticInput = (scanId:string,observedAt:string):RuntimeBehaviorDiagnosticInput => ({
    scanId,observedAt,completeness:'COMPLETE',globalWaitEarned:true,globalWaitReasons:['ALL_APPLICABLE_BRANCHES_EXHAUSTED'],
    candidateCount:2,feasibleCandidateCount:0,selectedCandidateCount:0,hardRejectedCount:1,softRankedCount:1,
    dataInsufficientCount:0,quantityZeroCount:0,aegisVetoCount:0,nearMissCount:1,providerBlockers:[],
    actionPlansReady:0,actionPlanBlockers:[],
  });
  try {
    const firstScan=randomUUID(),secondScan=randomUUID();
    await insertScan(firstScan,'2026-09-14T14:00:00.000Z');
    const first=await store.persist(diagnosticInput(firstScan,'2026-09-14T14:00:00.000Z'));
    const replay=await store.persist(diagnosticInput(firstScan,'2026-09-14T14:00:00.000Z'));
    assert.deepEqual(replay,first);
    assert.equal(first.consecutiveWaitCycles,1);
    await insertScan(secondScan,'2026-09-14T14:01:00.000Z');
    const second=await store.persist(diagnosticInput(secondScan,'2026-09-14T14:01:00.000Z'));
    assert.equal(second.consecutiveWaitCycles,2);
    await assert.rejects(pool.query(`UPDATE research.theta_runtime_behavior_diagnostic
      SET wait_classification='ACTION_READY' WHERE scan_id=$1`,[firstScan]));
  } finally {
    await pool.end();
  }
});
