import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGlobalWaitEvidenceFromFrontier, splitDecisionEvidence, validateGlobalWaitEvidence,
  type DecisionEvidenceItem } from '../src/theta/decision-evidence.js';
import type { CanonicalStrategyFrontier } from '../src/theta/canonical-strategy-frontier.js';

const now = '2026-09-12T14:00:00.000Z';
const item = (overrides: Partial<DecisionEvidenceItem>): DecisionEvidenceItem => ({
  family: 'BROKER_QUOTE', category: 'HARD_GATE', code: 'EXECUTABLE_QUOTE_UNAVAILABLE',
  state: 'UNKNOWN', value: null,
  provenance: { provider: 'ALPACA', operationAlias: 'option_snapshot', asOf: null, retrievedAt: now },
  ...overrides,
});

test('soft evidence never becomes a mechanical blocker merely because it is weak or unknown', () => {
  const result = splitDecisionEvidence([
    item({ category: 'SOFT_EVIDENCE', family: 'RSI', code: 'RSI_WEAK', state: 'DEGRADED' }),
    item({ category: 'HARD_GATE', state: 'UNKNOWN' }),
  ]);
  assert.deepEqual(result.hardBlockers.map((evidence) => evidence.code), ['EXECUTABLE_QUOTE_UNAVAILABLE']);
  assert.deepEqual(result.softEvidence.map((evidence) => evidence.code), ['RSI_WEAK']);
});

test('global WAIT is not earned when one underlying or validated branch was skipped', () => {
  const result = validateGlobalWaitEvidence({
    reason: 'DATA_INSUFFICIENT', eligibleUnderlyingCount: 3, underlyingsEvaluated: 2,
    contractsEvaluated: 40, validatedBranchesEligible: ['THETA_Q', 'THETA_RECOVERY'],
    validatedBranchesEvaluated: ['THETA_Q'], existingPositionManagementEvaluated: true,
    recoveryOpportunitiesEvaluated: true, coveredCallOpportunitiesEvaluated: true,
    redeploymentAlternativesEvaluated: true, hardGateCounts: {}, softEvidenceFamiliesObserved: ['RSI'],
    blockedBranches: { THETA_H: ['RESEARCH_ONLY'] }, unclassifiedHardBlockers: [], bestCandidateId: null,
    secondBestCandidateId: null, bestRejectedCandidateId: 'candidate-1',
  });
  assert.equal(result.earned, false);
  assert.deepEqual(result.violations, ['ELIGIBLE_UNIVERSE_NOT_EXHAUSTED', 'VALIDATED_BRANCHES_NOT_EXHAUSTED']);
});

test('global WAIT can be earned without requiring every soft indicator to agree', () => {
  const result = validateGlobalWaitEvidence({
    reason: 'NO_POSITIVE_AFTER_COST_EV', eligibleUnderlyingCount: 2, underlyingsEvaluated: 2,
    contractsEvaluated: 24, validatedBranchesEligible: ['THETA_Q'], validatedBranchesEvaluated: ['THETA_Q'],
    existingPositionManagementEvaluated: true, recoveryOpportunitiesEvaluated: true,
    coveredCallOpportunitiesEvaluated: true, redeploymentAlternativesEvaluated: true,
    hardGateCounts: {}, softEvidenceFamiliesObserved: ['IV'], blockedBranches: {}, unclassifiedHardBlockers: [],
    bestCandidateId: null, secondBestCandidateId: null, bestRejectedCandidateId: 'candidate-1',
  });
  assert.deepEqual(result, { earned: true, violations: [] });
});

test('global WAIT rejects contradictory best and second-best evidence', () => {
  const result = validateGlobalWaitEvidence({
    reason: 'EXECUTION_NOT_FEASIBLE', eligibleUnderlyingCount: 1, underlyingsEvaluated: 1,
    contractsEvaluated: 2, validatedBranchesEligible: ['THETA_Q'], validatedBranchesEvaluated: ['THETA_Q'],
    existingPositionManagementEvaluated: true, recoveryOpportunitiesEvaluated: true,
    coveredCallOpportunitiesEvaluated: true, redeploymentAlternativesEvaluated: true,
    hardGateCounts: {}, softEvidenceFamiliesObserved: [], blockedBranches: {}, unclassifiedHardBlockers: [],
    bestCandidateId: 'same', secondBestCandidateId: 'same', bestRejectedCandidateId: null,
  });
  assert.deepEqual(result.violations, ['SECOND_BEST_DUPLICATES_BEST']);
});

test('global WAIT persistence derives real hard, soft and blocked-branch evidence from the frontier',()=>{
  const frontier={snapshotId:'snapshot',timestamp:now,branchesConsidered:['THETA_CONVENTIONAL'],
    branchesEvaluated:['THETA_CONVENTIONAL'],selectedCandidateId:null,secondBestCandidateId:null,
    bestRejectedCandidateId:'q1',branches:[{branch:'THETA_CONVENTIONAL',evaluationState:'EVALUATED',routeReasons:[],
      candidates:[{candidateId:'q1',hardBlockers:['AEGIS_HARD_VETO','THETA_Q_ACTION_INFEASIBLE'],
        softEvidence:['EVENT_STATE:CLEAR','IV:KNOWN']}]}]} as unknown as CanonicalStrategyFrontier;
  const evidence=buildGlobalWaitEvidenceFromFrontier({frontier,eligibleUnderlyingCount:1,underlyingsEvaluated:1,
    existingPositionManagementEvaluated:true,recoveryOpportunitiesEvaluated:true,
    coveredCallOpportunitiesEvaluated:true,redeploymentAlternativesEvaluated:true});
  assert.equal(evidence.reason,'HARD_AEGIS_VETO');
  assert.deepEqual(evidence.hardGateCounts,{AEGIS_HARD_VETO:1,STRATEGY_ECONOMIC_REJECT:1});
  assert.deepEqual(evidence.softEvidenceFamiliesObserved,['EVENT_CONTEXT','IV']);
  assert.deepEqual(evidence.unclassifiedHardBlockers,[]);
  assert.equal(validateGlobalWaitEvidence(evidence).earned,true);
});

test('an unclassified hard blocker prevents a persisted global WAIT from self-certifying',()=>{
  const frontier={snapshotId:'snapshot',timestamp:now,branchesConsidered:['THETA_CONVENTIONAL'],
    branchesEvaluated:['THETA_CONVENTIONAL'],selectedCandidateId:null,secondBestCandidateId:null,
    bestRejectedCandidateId:'q1',branches:[{branch:'THETA_CONVENTIONAL',evaluationState:'EVALUATED',routeReasons:[],
      candidates:[{candidateId:'q1',hardBlockers:['NEW_UNCLASSIFIED_BLOCKER'],softEvidence:[]}]}]
  } as unknown as CanonicalStrategyFrontier;
  const evidence=buildGlobalWaitEvidenceFromFrontier({frontier,eligibleUnderlyingCount:1,underlyingsEvaluated:1,
    existingPositionManagementEvaluated:true,recoveryOpportunitiesEvaluated:true,
    coveredCallOpportunitiesEvaluated:true,redeploymentAlternativesEvaluated:true});
  assert.deepEqual(evidence.unclassifiedHardBlockers,['NEW_UNCLASSIFIED_BLOCKER']);
  assert.deepEqual(validateGlobalWaitEvidence(evidence),{earned:false,violations:['UNCLASSIFIED_HARD_BLOCKERS']});
});

test('research branch incompleteness remains visible without poisoning a complete Q global WAIT',()=>{
  const frontier={snapshotId:'snapshot',timestamp:now,
    branchesConsidered:['THETA_CONVENTIONAL','THETA_DEFINED_RISK'],branchesEvaluated:['THETA_CONVENTIONAL'],
    selectedCandidateId:null,secondBestCandidateId:null,bestRejectedCandidateId:'q1',branches:[
      {branch:'THETA_CONVENTIONAL',evaluationState:'EVALUATED',routeReasons:[],candidates:[{
        candidateId:'q1',hardBlockers:['THETA_Q_ACTION_INFEASIBLE'],softEvidence:['EVENT_STATE:CLEAR']}]},
      {branch:'THETA_DEFINED_RISK',evaluationState:'BLOCKED_MISSING_INPUT',routeReasons:['RESEARCH_QUOTES_MISSING'],
        candidates:[{candidateId:'d1',hardBlockers:['RESEARCH_ONLY_BLOCKER'],softEvidence:['FLOW:UNKNOWN']}]},
    ]} as unknown as CanonicalStrategyFrontier;
  const evidence=buildGlobalWaitEvidenceFromFrontier({frontier,eligibleUnderlyingCount:1,underlyingsEvaluated:1,
    existingPositionManagementEvaluated:true,recoveryOpportunitiesEvaluated:true,
    coveredCallOpportunitiesEvaluated:true,redeploymentAlternativesEvaluated:true});
  assert.equal(evidence.contractsEvaluated,1);
  assert.deepEqual(evidence.validatedBranchesEligible,['THETA_CONVENTIONAL']);
  assert.deepEqual(evidence.validatedBranchesEvaluated,['THETA_CONVENTIONAL']);
  assert.deepEqual(evidence.hardGateCounts,{STRATEGY_ECONOMIC_REJECT:1});
  assert.deepEqual(evidence.unclassifiedHardBlockers,[]);
  assert.deepEqual(evidence.blockedBranches.THETA_DEFINED_RISK,
    ['BLOCKED_MISSING_INPUT','RESEARCH_QUOTES_MISSING']);
  assert.deepEqual(validateGlobalWaitEvidence(evidence),{earned:true,violations:[]});
});
