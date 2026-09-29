import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateFirstPaperCanaryGovernance, evaluateLiveGraduationGovernance,
  type LiveGraduationEvidence, type LiveGraduationThresholdPolicy,
} from '../src/theta/paper-live-graduation-governance.js';

const evidence: LiveGraduationEvidence = {
  resolvedPaperEpisodes: 100, independentSessions: 40, paperTimeSpanDays:90,
  regimesObserved: ['CALM','TREND','STRESS'], effectiveN: 50,
  afterCostEv: 1, profitFactor: 1.2, payoffRatio:1.1, expectedShortfall: 5, maxDrawdown: 10,
  calibrationBrierScore: 0.2, executionQuality: 0.9, paperSimulationDiscrepancy: 0.1,
  providerReliability:0.999,runtimeReliability:0.999,strategySpecificCriteriaPassed:true,
};
const policy: LiveGraduationThresholdPolicy = {
  policyVersion: 'owner-approved-test-policy', minResolvedPaperEpisodes: 50, minIndependentSessions: 20,
  minPaperTimeSpanDays:60,minRegimes: 3, minEffectiveN: 25, minAfterCostEv: 0, minProfitFactor: 1,
  minPayoffRatio:1,maxExpectedShortfall: 10,
  maxDrawdown: 20, maxCalibrationBrierScore: 0.25, minExecutionQuality: 0.8,
  maxPaperSimulationDiscrepancy: 0.2,minProviderReliability:0.99,minRuntimeReliability:0.99,
  strategySpecificCriteriaVersion:'test-strategy-criteria-v1',
  liveSmallSafetyPolicy:{capitalLimitUsd:1000,dailyLossLimitUsd:100,maximumStrategies:1,maximumSymbols:1,
    killSwitchPolicyVersion:'test-kill-switch-v1',manualReviewRequired:true,automaticDowngradeToPaper:true},
};

test('first Paper canary governance requires owner permission and exactly one SPY Q contract',()=>{
  const ready=evaluateFirstPaperCanaryGovernance({strategy:'THETA_CONVENTIONAL',underlying:'SPY',quantity:1,
    priorBrokerOrderCount:0,currentWorkerProven:true,operationalReadinessPassed:true,ownerPermissionGranted:false,
    masterExecutionEnabled:false,followerExecutionEnabled:false,pauseNewOrders:true});
  assert.equal(ready.state,'READY_FOR_OWNER_AUTHORIZATION');
  assert.deepEqual(ready.blockers,['OWNER_PERMISSION_REQUIRED']);
  assert.equal(ready.liveAuthorized,false);
  const tooLarge=evaluateFirstPaperCanaryGovernance({strategy:'THETA_CONVENTIONAL',underlying:'SPY',quantity:2,
    priorBrokerOrderCount:0,currentWorkerProven:true,operationalReadinessPassed:true,ownerPermissionGranted:false,
    masterExecutionEnabled:false,followerExecutionEnabled:false,pauseNewOrders:true});
  assert.equal(tooLarge.state,'LOCKED');
  assert.ok(tooLarge.blockers.includes('FIRST_CANARY_QUANTITY_MUST_BE_ONE'));
});

test('missing live thresholds remain explicit owner policy gaps rather than invented defaults',()=>{
  const result=evaluateLiveGraduationGovernance(evidence,{...policy,policyVersion:null,minEffectiveN:null});
  assert.equal(result.state,'POLICY_NOT_SET');
  assert.equal(result.liveAuthorized,false);
  assert.ok(result.blockers.includes('LIVE_GRADUATION_POLICY_VERSION_NOT_SET'));
  assert.ok(result.blockers.includes('LIVE_GRADUATION_THRESHOLD_NOT_SET:minEffectiveN'));
});

test('passing supplied evidence only reaches owner review and never grants live authority',()=>{
  const result=evaluateLiveGraduationGovernance(evidence,policy);
  assert.equal(result.state,'READY_FOR_OWNER_REVIEW');
  assert.equal(result.liveAuthorized,false);
  assert.deepEqual(result.blockers,[]);
});

test('unknown or failing empirical evidence cannot reach owner review',()=>{
  const result=evaluateLiveGraduationGovernance({...evidence,afterCostEv:null,independentSessions:2},policy);
  assert.equal(result.state,'EVIDENCE_INSUFFICIENT');
  assert.ok(result.blockers.includes('AFTER_COST_EV_UNKNOWN'));
  assert.ok(result.blockers.includes('INDEPENDENT_SESSIONS_INSUFFICIENT'));
  assert.equal(result.liveAuthorized,false);
});
