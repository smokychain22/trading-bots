import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStrategyEvaluationResponse } from '../src/theta/strategy-evaluation-contract.js';

const response = () => ({
  contractVersion:'theta-strategy-evaluation-runtime-v1', snapshotId:'snapshot-1', timestamp:'2026-09-12T12:00:00.000Z',
  strategyVersionId:'theta-conventional@1.0.0-research', empiricalReadiness:'EV_MODEL_NOT_EMPIRICALLY_READY',
  applicableBranches:['THETA_CONVENTIONAL'], candidateEvaluations:[{ candidateId:'c1', branch:'THETA_CONVENTIONAL',
    applicable:true, action:'WAIT', expectedAfterCostValue:null, returnPerCapitalDay:null, tailRisk:null,
    uncertainty:null, hardBlockers:[], softEvidence:['IV_UNKNOWN'] }],
  actionValues:[{ action:'WAIT', expectedAfterCostValue:null, tailRisk:null, capitalDays:null,
    executionCost:null, opportunityCost:null, uncertainty:null }], selectedAction:'WAIT', executionAuthorized:false,
});

test('strategy response preserves unknown economics and cannot authorize execution', () => {
  const parsed = parseStrategyEvaluationResponse(response());
  assert.equal(parsed.candidateEvaluations[0]?.expectedAfterCostValue, null);
  assert.equal(parsed.executionAuthorized, false);
});

test('strategy response rejects invented EV while empirical readiness is blocked', () => {
  const payload = response();
  const candidate = payload.candidateEvaluations[0];
  if (candidate === undefined) throw new Error('fixture candidate missing');
  candidate.expectedAfterCostValue = 12 as never;
  assert.throws(() => parseStrategyEvaluationResponse(payload), /expected value must remain UNKNOWN/);
});
