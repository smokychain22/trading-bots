import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstPaperCanaryActivationBlockers, resolveEffectivePaperExecutionControl,
} from '../src/execution/paper-execution-authorization.js';

const persisted={pauseNewOrders:true,masterExecutionEnabled:true,followerExecutionEnabled:false,
  authorizationEventId:'b7b415d4-1585-49bd-95dd-839067227b42'} as const;

test('persisted owner authority enables management while new risk remains paused',()=>{
  const result=resolveEffectivePaperExecutionControl({environmentMasterEnabled:true,environmentFollowerEnabled:false,
    environmentPauseNewOrders:false,persisted,operatorNewEntriesPaused:false,operatorEmergencyExecutionLock:false});
  assert.equal(result.managementSubmissionEnabled,true);
  assert.equal(result.newRiskSubmissionEnabled,false);
  assert.equal(result.pauseNewOrders,true);
  assert.equal(result.followerEnabled,false);
});

test('master authority requires both environment opt-in and immutable authorization lineage',()=>{
  const noEnvironment=resolveEffectivePaperExecutionControl({environmentMasterEnabled:false,environmentFollowerEnabled:false,
    environmentPauseNewOrders:false,persisted,operatorNewEntriesPaused:false,operatorEmergencyExecutionLock:false});
  const noLineage=resolveEffectivePaperExecutionControl({environmentMasterEnabled:true,environmentFollowerEnabled:false,
    environmentPauseNewOrders:false,persisted:{...persisted,authorizationEventId:null},
    operatorNewEntriesPaused:false,operatorEmergencyExecutionLock:false});
  assert.equal(noEnvironment.managementSubmissionEnabled,false);
  assert.equal(noLineage.managementSubmissionEnabled,false);
});

test('emergency lock blocks management and new risk without unlocking followers',()=>{
  const result=resolveEffectivePaperExecutionControl({environmentMasterEnabled:true,environmentFollowerEnabled:false,
    environmentPauseNewOrders:false,persisted:{...persisted,pauseNewOrders:false},
    operatorNewEntriesPaused:false,operatorEmergencyExecutionLock:true});
  assert.equal(result.managementSubmissionEnabled,false);
  assert.equal(result.newRiskSubmissionEnabled,false);
  assert.equal(result.followerEnabled,false);
});

test('new risk opens only when every pause layer is clear',()=>{
  const result=resolveEffectivePaperExecutionControl({environmentMasterEnabled:true,environmentFollowerEnabled:false,
    environmentPauseNewOrders:false,persisted:{...persisted,pauseNewOrders:false},
    operatorNewEntriesPaused:false,operatorEmergencyExecutionLock:false});
  assert.equal(result.managementSubmissionEnabled,true);
  assert.equal(result.newRiskSubmissionEnabled,true);
});

const activation=()=>({activatedAt:'2026-09-18T15:00:00.000Z',runtime:{brokerAccountStatus:'ACTIVE',brokerPositionCount:0,
  brokerOpenOrderCount:0,brokerLocalOnlyIntentCount:0,marketOpen:true,calendarSessionConfirmed:true,
  optionsCapabilityVerified:true,environmentMasterEnabled:true,environmentPauseNewOrders:false,
  environmentFollowerEnabled:false,runtimeMode:'MASTER_THETA_PAPER'},database:{managementAuthorized:true,
  followerExecutionEnabled:false,priorBrokerOrderCount:0,activeIntentCount:0,masterCount:1,masterSelfCopyCount:0,
  quoteReady:true,latestCompleteScanAt:'2026-09-18T14:55:00.000Z',migrationHead:'058_terminal_partial_close_accounting'}});

test('first canary activation requires every Paper-only operational gate',()=>{
  assert.deepEqual(firstPaperCanaryActivationBlockers(activation()),[]);
});

test('first canary activation rejects follower/live-adjacent state, stale evidence, and any prior order',()=>{
  const valid=activation();
  const blockers=firstPaperCanaryActivationBlockers({...valid,
    runtime:{...valid.runtime,environmentFollowerEnabled:true,brokerOpenOrderCount:1},
    database:{...valid.database,priorBrokerOrderCount:1,masterSelfCopyCount:1,
      latestCompleteScanAt:'2026-09-18T14:00:00.000Z'}});
  assert.deepEqual(blockers,['FOLLOWER_EXECUTION_NOT_LOCKED','FIRST_CANARY_REQUIRES_ZERO_OPEN_ORDERS',
    'FIRST_CANARY_ALREADY_USED','MASTER_SELF_COPY_INVARIANT_FAILED','RECENT_COMPLETE_STRATEGY_SCAN_MISSING']);
});

test('first canary activation cannot bypass the environment pause or schema head',()=>{
  const valid=activation();
  const blockers=firstPaperCanaryActivationBlockers({...valid,
    runtime:{...valid.runtime,environmentPauseNewOrders:true},database:{...valid.database,migrationHead:'057_other'}});
  assert.deepEqual(blockers,['ENVIRONMENT_NEW_ENTRY_PAUSE_ACTIVE','PRODUCTION_SCHEMA_HEAD_NOT_058']);
});
