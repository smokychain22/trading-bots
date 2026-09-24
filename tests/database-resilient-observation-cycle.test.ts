import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runDatabaseResilientObservationCycle, type DecisionSnapshotIdentity,
  type ObservationStage } from '../src/theta/database-resilient-observation-cycle.js';
import { LocalEvidenceSpool, type DecisionCheckpointStage } from '../src/theta/local-evidence-spool.js';

const identity:DecisionSnapshotIdentity={decisionCycleId:'cycle-1',snapshotId:'snapshot-1',
  decisionAsOf:'2026-09-24T14:00:00.000Z',sourceSha:'1234567890abcdef1234567890abcdef12345678',workerId:'worker-1'};
const ordered:readonly DecisionCheckpointStage[]=['ACCOUNT_READY','CONTRACTS_READY','QUOTES_READY','Q_READY',
  'EVENT_READY','AEGIS_READY','SIZING_READY','DECISION_READY','PLAN_READY'];
const dbDrop=()=>Object.assign(new Error('private database host'),{code:'57P03'});

function harness(){
  const root=mkdtempSync(join(tmpdir(),'theta-resilient-'));
  const spool=new LocalEvidenceSpool(join(root,'spool.sqlite'));
  return {spool,cleanup:()=>{spool.close();rmSync(root,{recursive:true,force:true});}};
}

const stages=(dropAt:DecisionCheckpointStage|null=null):ObservationStage[]=>ordered.map((stage)=>({
  stage,criticality:'REQUIRED' as const,
  run:async(current)=>({identity:current,payload:{stage,brokerMutationAllowed:false},providerObservedAt:{}}),
  persist:async()=>{if(stage===dropAt)throw dbDrop();},
}));

test('database loss at every observed failure boundary preserves computation and blocks mutation',async()=>{
  for(const dropAt of ordered){
    const {spool,cleanup}=harness();
    try{
      const report=await runDatabaseResilientObservationCycle({identity,stages:stages(dropAt),spool,
        allowBrokerMutationAfterCanonicalPersistence:true});
      assert.equal(report.completedStages.length,ordered.length,dropAt);
      assert.equal(report.locallySpooledStages.includes(dropAt),true,dropAt);
      assert.equal(report.observationComputationCapability,'DEGRADED',dropAt);
      assert.equal(report.brokerMutationCapability,'BLOCKED',dropAt);
      assert.equal(spool.verify().valid,true,dropAt);
    }finally{cleanup();}
  }
});

test('optional shadow computation and persistence failure cannot poison Q',async()=>{
  const {spool,cleanup}=harness();
  try{
    const critical=stages();
    critical.splice(4,0,{stage:'SHADOW_READY',criticality:'OPTIONAL_RESEARCH',run:async()=>{throw dbDrop();}});
    const report=await runDatabaseResilientObservationCycle({identity,stages:critical,spool,
      allowBrokerMutationAfterCanonicalPersistence:false});
    assert.equal(report.completedStages.includes('Q_READY'),true);
    assert.equal(report.completedStages.includes('DECISION_READY'),true);
    assert.deepEqual(report.optionalFailures,['SHADOW_READY:POSTGRES_57P03']);
    assert.equal(report.blockingFailure,null);
    assert.equal(report.brokerMutationCapability,'BLOCKED');
  }finally{cleanup();}
});

test('mixed-cycle evidence fails closed at the exact stage',async()=>{
  const {spool,cleanup}=harness();
  try{
    const report=await runDatabaseResilientObservationCycle({identity,spool,
      allowBrokerMutationAfterCanonicalPersistence:true,stages:[{
        stage:'ACCOUNT_READY',criticality:'REQUIRED',
        run:async(current)=>({identity:{...current,snapshotId:'old-snapshot'},payload:{},providerObservedAt:{}}),
      }]});
    assert.equal(report.observationComputationCapability,'BLOCKED');
    assert.equal(report.blockingFailure,'ACCOUNT_READY:EVIDENCE_IDENTITY_MISMATCH');
    assert.equal(report.brokerMutationCapability,'BLOCKED');
  }finally{cleanup();}
});

test('broker mutation can only reach the separate gate when every required stage is canonically persisted',async()=>{
  const {spool,cleanup}=harness();
  try{
    const report=await runDatabaseResilientObservationCycle({identity,stages:stages(),spool,
      allowBrokerMutationAfterCanonicalPersistence:true});
    assert.equal(report.observationComputationCapability,'COMPLETE');
    assert.equal(report.brokerMutationCapability,'ELIGIBLE_AFTER_SEPARATE_EXECUTION_GATE');
    assert.equal(report.postgresPersistedStages.length,ordered.length);
  }finally{cleanup();}
});
