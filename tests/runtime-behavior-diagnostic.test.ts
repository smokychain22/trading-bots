import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRuntimeBehavior, type RuntimeBehaviorDiagnosticInput } from '../src/theta/runtime-behavior-diagnostic.js';

const input = (overrides: Partial<RuntimeBehaviorDiagnosticInput> = {}): RuntimeBehaviorDiagnosticInput => ({
  scanId:'11111111-1111-4111-8111-111111111111',observedAt:'2026-09-14T14:00:00.000Z',
  completeness:'COMPLETE',globalWaitEarned:true,globalWaitReasons:['ALL_APPLICABLE_BRANCHES_EXHAUSTED'],
  candidateCount:10,feasibleCandidateCount:0,selectedCandidateCount:0,hardRejectedCount:5,softRankedCount:5,
  dataInsufficientCount:0,quantityZeroCount:0,aegisVetoCount:0,nearMissCount:1,providerBlockers:[],
  actionPlansReady:0,actionPlanBlockers:[],...overrides,
});

test('a complete, fully searched WAIT is classified as healthy without inventing a frequency threshold',()=>{
  const result=classifyRuntimeBehavior(input());
  assert.equal(result.waitClassification,'HEALTHY_WAIT');
  assert.equal(result.overtradingState,'NO_NEW_ACTION');
  assert.ok(result.reasonCodes.includes('NO_EMPIRICAL_FREQUENCY_THRESHOLD'));
});

test('causal provider, quote, risk, and empty-universe waits stay distinct',()=>{
  assert.equal(classifyRuntimeBehavior(input({completeness:'PARTIAL',providerBlockers:['PROVIDER_UNAVAILABLE']})).waitClassification,'DATA_WAIT');
  assert.equal(classifyRuntimeBehavior(input({actionPlanBlockers:['FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_NOT_YET_QUALIFIED']})).waitClassification,'QUOTE_WAIT');
  assert.equal(classifyRuntimeBehavior(input({quantityZeroCount:2})).waitClassification,'RISK_WAIT');
  assert.equal(classifyRuntimeBehavior(input({completeness:'DATA_INSUFFICIENT',candidateCount:0})).waitClassification,'NO_OPPORTUNITY');
});

test('a feasible unselected candidate surfaces policy strictness rather than being called healthy WAIT',()=>{
  const result=classifyRuntimeBehavior(input({globalWaitEarned:false,feasibleCandidateCount:2}));
  assert.equal(result.waitClassification,'OVERSTRICT_POLICY_WAIT');
  assert.ok(result.reasonCodes.includes('FEASIBLE_CANDIDATE_OBSERVED'));
});

test('multiple action plans in one bounded scan are visible as a potential overtrading condition',()=>{
  assert.equal(classifyRuntimeBehavior(input({actionPlansReady:1})).overtradingState,'SINGLE_BOUNDED_ACTION');
  const multiple=classifyRuntimeBehavior(input({actionPlansReady:2}));
  assert.equal(multiple.waitClassification,'ACTION_READY');
  assert.equal(multiple.overtradingState,'MULTIPLE_ACTION_PLANS_SAME_SCAN');
});
