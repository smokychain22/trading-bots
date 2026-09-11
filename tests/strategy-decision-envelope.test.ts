import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrategyDecisionEnvelope } from '../src/theta/strategy-decision-envelope.js';
import type { NewRiskDecisionReceipt } from '../src/theta/decision-assembly.js';

const receipt: NewRiskDecisionReceipt = {
  decisionId:'d1', snapshotId:'s1', fusionSnapshotHash:'a'.repeat(64), timestamp:'2026-09-12T12:00:00.000Z',
  underlying:'AAPL', winningAction:'OPEN_FULL', selectedCandidateId:'best', quantity:1,
  alternatives:[
    { candidateId:'best', disposition:'OPEN_FULL', evNet:20, returnPerCapitalDay:0.02, aegisState:'ALLOW_FULL', quantity:1, executionRecommendedAction:'SUBMIT', rejectionReason:null },
    { candidateId:'second', disposition:'OPEN_REDUCED', evNet:10, returnPerCapitalDay:0.01, aegisState:'ALLOW_REDUCED', quantity:1, executionRecommendedAction:'SUBMIT', rejectionReason:null },
  ], ownershipSnapshotId:'s1', regimeSnapshotId:'s1', executionAuthorized:false, reasonCodes:['CANDIDATE_SELECTED'],
  plainEnglishExplanation:'Selected.', failClosedReason:null, policyVersion:'policy-v1', modelVersions:{},
};

test('decision envelope is replayable and retains second-best and invalidation evidence', () => {
  const first = buildStrategyDecisionEnvelope({ strategyVersionId:'strategy-v1', strategyBranch:'THETA_CONVENTIONAL', receipt });
  const second = buildStrategyDecisionEnvelope({ strategyVersionId:'strategy-v1', strategyBranch:'THETA_CONVENTIONAL', receipt });
  assert.deepEqual(first, second);
  assert.equal(first.secondBestCandidateId, 'second');
  assert.equal(first.executionAuthorized, false);
  assert.ok(first.invalidationConditions.includes('AEGIS_STATE_TIGHTENS'));
  assert.equal(first.economics.evNet, 20);
});

test('missing economics remain UNKNOWN in a hold envelope', () => {
  const held = buildStrategyDecisionEnvelope({ strategyVersionId:'strategy-v1', strategyBranch:'THETA_CONVENTIONAL',
    receipt:{ ...receipt, winningAction:'SYSTEM_HOLD', selectedCandidateId:null, quantity:0, alternatives:[],
      failClosedReason:'provider state unavailable', reasonCodes:['PROVIDER_STATE_INVALID'] } });
  assert.equal(held.economics.evNet, null);
  assert.deepEqual(held.hardBlockers, ['PROVIDER_STATE_INVALID']);
});
