import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectivePaperExecutionControl } from '../src/execution/paper-execution-authorization.js';

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
