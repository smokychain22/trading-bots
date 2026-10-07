import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  classifyPaperExecutionState,firstPaperCanaryActivationBlockers, fullyLockedPaperExecutionControl, resolveEffectivePaperExecutionControl,
} from '../src/execution/paper-execution-authorization.js';

const persisted={pauseNewOrders:true,masterExecutionEnabled:true,followerExecutionEnabled:false,
  authorizationEventId:'b7b415d4-1585-49bd-95dd-839067227b42'} as const;

test('full execution lock disables every submission lane and preserves authorization provenance',()=>{
  const result=fullyLockedPaperExecutionControl(persisted);
  assert.deepEqual(result,{pauseNewOrders:true,masterExecutionEnabled:false,followerExecutionEnabled:false,
    authorizationEventId:persisted.authorizationEventId});
  assert.deepEqual(fullyLockedPaperExecutionControl(result),result);
});

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
  quoteReady:true,latestCompleteScanAt:'2026-09-18T14:55:00.000Z',migrationHead:'061_paper_execution_control_normalization',
  requiredSchemaBaselinePresent:true}});

test('first canary activation requires every Paper-only operational gate',()=>{
  assert.deepEqual(firstPaperCanaryActivationBlockers(activation()),[]);
});

test('first canary activation cannot use Optionomics as execution quote authority', () => {
  const source = readFileSync('src/execution/paper-execution-authorization.ts', 'utf8');
  const quoteGate = source.slice(source.indexOf('AS required_schema_baseline_present,'),
    source.indexOf('AS quote_ready'));
  assert.match(quoteGate, /provider='ALPACA'/);
  assert.match(quoteGate, /cn\.environment='PAPER'/);
  assert.match(quoteGate, /pc\.checked_at>now\(\)-interval '1 hour'/);
  assert.doesNotMatch(quoteGate, /optionomics_quote_qualification_run/i);
});

test('an additive migration head remains valid when the required schema baseline exists',()=>{
  const valid=activation();
  assert.deepEqual(firstPaperCanaryActivationBlockers({...valid,database:{...valid.database,
    migrationHead:'062_policy_neutral_risk_evidence',requiredSchemaBaselinePresent:true}}),[]);
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

test('first canary activation cannot bypass the environment pause or required schema baseline',()=>{
  const valid=activation();
  const blockers=firstPaperCanaryActivationBlockers({...valid,
    runtime:{...valid.runtime,environmentPauseNewOrders:true},database:{...valid.database,migrationHead:'062_policy_neutral_risk_evidence',requiredSchemaBaselinePresent:false}});
  assert.deepEqual(blockers,['ENVIRONMENT_NEW_ENTRY_PAUSE_ACTIVE','PRODUCTION_SCHEMA_BASELINE_061_MISSING']);
});

test('Paper execution state keeps permission separate from technical acceptance and canary reconciliation',()=>{
  assert.equal(classifyPaperExecutionState({ownerPermissionGranted:true,technicalSessionState:'PENDING_PHASE7_ACCEPTANCE',
    priorBrokerOrderCount:0,firstCanaryAccepted:false,pauseNewOrders:true}),'LOCKED_WAITING_FOR_TECHNICAL_ACCEPTANCE');
  assert.equal(classifyPaperExecutionState({ownerPermissionGranted:true,technicalSessionState:'ACCEPTED',
    priorBrokerOrderCount:0,firstCanaryAccepted:false,pauseNewOrders:false}),'FIRST_CANARY_ARMED');
  assert.equal(classifyPaperExecutionState({ownerPermissionGranted:true,technicalSessionState:'ACCEPTED',
    priorBrokerOrderCount:1,firstCanaryAccepted:false,pauseNewOrders:true}),'FIRST_CANARY_SUBMITTED');
  assert.equal(classifyPaperExecutionState({ownerPermissionGranted:true,technicalSessionState:'ACCEPTED',
    priorBrokerOrderCount:1,firstCanaryAccepted:true,pauseNewOrders:true}),'FIRST_CANARY_RECONCILED');
  assert.equal(classifyPaperExecutionState({ownerPermissionGranted:true,technicalSessionState:'ACCEPTED',
    priorBrokerOrderCount:1,firstCanaryAccepted:true,pauseNewOrders:false}),'AUTONOMOUS_PAPER_ACTIVE');
});

test('accepted-canary runtime wiring is read-only until its governed database transition',()=>{
  const evaluator=readFileSync('src/execution/postgres-first-canary-acceptance.ts','utf8');
  const runtime=readFileSync('src/theta/autonomous-runtime.ts','utf8');
  assert.match(runtime,/reconcileFirstCanaryAcceptance/);
  assert.match(evaluator,/getOrderByClientOrderId/);
  assert.match(evaluator,/getOrders\('all'\)/);
  assert.doesNotMatch(evaluator,/\.submitOrder\(|\.replaceOrder\(|\.cancelOrder\(/);
  assert.match(evaluator,/activateAutonomousPaperAfterAcceptedCanary/);
});

test('the governed activation may re-arm a canary that ended with zero fills, but only up to the bounded limit; a used (filled) canary is never re-armed', () => {
  const valid=activation();
  assert.deepEqual(firstPaperCanaryActivationBlockers({...valid,database:{...valid.database,unfilledCanaryCount:2}}),[],
    'zero-fill CANCELED/EXPIRED canaries do not count as a used canary');
  assert.ok(firstPaperCanaryActivationBlockers({...valid,database:{...valid.database,unfilledCanaryCount:3}})
    .includes('FIRST_CANARY_UNFILLED_REARM_LIMIT_REACHED'));
  assert.ok(firstPaperCanaryActivationBlockers({...valid,database:{...valid.database,priorBrokerOrderCount:1,unfilledCanaryCount:0}})
    .includes('FIRST_CANARY_ALREADY_USED'));
});

test('a zero-fill canary is judged by single-leg fills AND mleg leg fills: a canceled spread with one filled leg consumes the lane', async () => {
  const { unfilledTerminalBrokerOrderSql } = await import('../src/execution/paper-execution-authorization.js');
  const sql = unfilledTerminalBrokerOrderSql('bo');
  assert.match(sql, /status IN \('CANCELED','EXPIRED'\)/);
  assert.match(sql, /NOT EXISTS\(SELECT 1 FROM trade\.fill uf/);
  assert.match(sql, /NOT EXISTS\(SELECT 1 FROM trade\.broker_order_leg_state uls WHERE uls\.order_intent_id=bo\.order_intent_id AND uls\.filled_quantity>0\)/);
  assert.doesNotMatch(sql, /REJECTED/, 'a rejected canary is never treated as an unused lane');
});
