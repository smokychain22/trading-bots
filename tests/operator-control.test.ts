import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOperatorControl,type OperatorControlState } from '../src/customer/operator-control.js';

const initial:OperatorControlState={newEntriesPaused:false,emergencyExecutionLock:false,brokerSubmissionBlocked:false,
  reconciliationEnabled:true,managementEnabled:true,source:'DEFAULT',asOf:null};
test('pause blocks new broker submissions while management and reconciliation remain active',()=>{
  const state=applyOperatorControl(initial,'PAUSE_NEW_ENTRIES','2026-09-15T14:00:00Z');
  assert.equal(state.brokerSubmissionBlocked,true);assert.equal(state.managementEnabled,true);assert.equal(state.reconciliationEnabled,true);
});
test('emergency lock cannot be cleared by ordinary resume',()=>{
  const locked=applyOperatorControl(initial,'EMERGENCY_EXECUTION_LOCK','2026-09-15T14:00:00Z');
  const resumed=applyOperatorControl(locked,'RESUME_NEW_ENTRIES','2026-09-15T14:01:00Z');
  assert.equal(resumed.emergencyExecutionLock,true);assert.equal(resumed.brokerSubmissionBlocked,true);
});
