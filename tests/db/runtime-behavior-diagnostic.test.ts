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
    scanId,decisionIds:[],observedAt,session:'OPEN',universeSize:1,strategiesConsidered:5,strategiesApplicable:1,
    strategiesRejected:4,strategyDiagnostics:[],completeness:'COMPLETE',globalWaitEarned:true,
    globalWaitReasons:['ALL_APPLICABLE_BRANCHES_EXHAUSTED'],
    candidateCount:2,feasibleCandidateCount:0,selectedCandidateCount:0,hardRejectedCount:1,softRankedCount:1,
    dataInsufficientCount:0,quantityZeroCount:0,aegisVetoCount:0,nearMissCount:1,providerBlockers:[],
    softEconomicRejectionCount:1,dataUnknownRejectionCount:0,quoteRejectionCount:0,liquidityRejectionCount:0,
    hardGateCounts:{},finalAction:'WAIT',waitReasons:['ALL_APPLICABLE_BRANCHES_EXHAUSTED'],bestRejectedCandidates:[],
    antiParalysisFindings:[],
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

test('PostgreSQL persists the v6 exact zero-quantity breakdown and classifies by evaluated causes only', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString);
  const url = new URL(connectionString);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname), 'Disposable local database only');
  const pool = new Pool({ connectionString:url.toString(),max:2 });
  const store = new PostgresRuntimeBehaviorDiagnosticStore(pool);
  const scanId = randomUUID();
  try {
    await pool.query(`INSERT INTO research.theta_shadow_scan_run(scan_id,mode,contract_version,started_at,finished_at,
      universe_version,lattice_version,strategy_version,branches_json,eligible_symbols_json,max_underlyings,
      symbols_attempted,symbols_completed,candidate_count,completeness_state,missing_scope_json,content_hash,
      global_wait_earned,global_wait_evidence_json)
      VALUES($1,'THETA_SHADOW_ONLY','test-v1','2026-09-15T14:00:00Z','2026-09-15T14:00:00Z','universe-v1','lattice-v1','strategy-v1',
      '[]','[]',1,1,1,100,'COMPLETE','[]',$2,false,'{"earned":false}')`,[scanId,hash(scanId)]);
    const persisted = await store.persist({
      scanId,decisionIds:[],observedAt:'2026-09-15T14:00:00.000Z',session:'OPEN',universeSize:3,strategiesConsidered:5,
      strategiesApplicable:2,strategiesRejected:3,strategyDiagnostics:[],completeness:'COMPLETE',globalWaitEarned:false,
      globalWaitReasons:[],candidateCount:100,feasibleCandidateCount:4,selectedCandidateCount:0,hardRejectedCount:96,
      softRankedCount:4,dataInsufficientCount:0,quantityZeroCount:100,riskEvaluatedZeroCount:0,
      sizingZeroBreakdown:{ Q_REJECTED_UPSTREAM:60, BRANCH_NOT_APPLICABLE:40 },aegisVetoCount:0,nearMissCount:0,
      providerBlockers:[],softEconomicRejectionCount:0,dataUnknownRejectionCount:0,quoteRejectionCount:0,
      liquidityRejectionCount:0,hardGateCounts:{},finalAction:'SYSTEM_HOLD',waitReasons:[],bestRejectedCandidates:[],
      antiParalysisFindings:[],actionPlansReady:0,actionPlanBlockers:[],
    });
    assert.equal(persisted.contractVersion,'theta-runtime-behavior-diagnostic-v6');
    assert.notEqual(persisted.waitClassification,'RISK_WAIT');
    const row = await pool.query(`SELECT contract_version,wait_classification,quantity_zero_count,diagnostic_json
      FROM research.theta_runtime_behavior_diagnostic WHERE scan_id=$1`,[scanId]);
    assert.equal(row.rows[0].contract_version,'theta-runtime-behavior-diagnostic-v6');
    assert.equal(row.rows[0].quantity_zero_count,100,'the historical column keeps counting every zero-quantity candidate');
    assert.equal(row.rows[0].diagnostic_json.riskEvaluatedZeroCount,0);
    assert.deepEqual(row.rows[0].diagnostic_json.sizingZeroBreakdown,{ BRANCH_NOT_APPLICABLE:40, Q_REJECTED_UPSTREAM:60 });
    assert.ok(row.rows[0].diagnostic_json.reasonCodes.includes('SIZING_ZERO_CAUSE:Q_REJECTED_UPSTREAM:60'));
  } finally {
    await pool.end();
  }
});
