import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBranchResearchReadiness, type BranchResearchEvidence } from '../src/research/branch-research-readiness.js';

const base = (branch: BranchResearchEvidence['branch']): BranchResearchEvidence => ({
  branch,evaluatedCandidateCount:2,exactContractIdentity:'KNOWN',pointInTimeQuote:'KNOWN',dteLattice:'KNOWN',
  strikeLattice:'KNOWN',liquidity:'KNOWN',greeks:'KNOWN',volatilityContext:'KNOWN',eventContext:'KNOWN',
  ownershipContext:'KNOWN',assignmentCapacity:'KNOWN',spreadPermission:'KNOWN',boundedRiskEconomics:'KNOWN',
  managementFrontier:'KNOWN',outcomeLabelContract:'KNOWN',strategyVersion:'strategy-v1',featureVersion:'feature-v1',
  riskVersion:'risk-v1',executionVersion:'execution-v1',
});

test('hold-strike completeness requires ownership and assignment evidence without authorizing execution',()=>{
  const ready=assessBranchResearchReadiness(base('THETA_HOLD_STRIKE'));
  assert.equal(ready.status,'READY_FOR_SHADOW_EVIDENCE');
  assert.equal(ready.executionAuthorized,false);
  const blocked=assessBranchResearchReadiness({...base('THETA_HOLD_STRIKE'),assignmentCapacity:'UNKNOWN'});
  assert.equal(blocked.status,'BLOCKED_MISSING_EVIDENCE');
  assert.deepEqual(blocked.missingEvidence,['assignmentCapacity']);
});

test('defined-risk completeness requires broker spread permission and bounded economics',()=>{
  const blocked=assessBranchResearchReadiness({...base('THETA_DEFINED_RISK'),spreadPermission:'UNKNOWN',boundedRiskEconomics:'UNKNOWN'});
  assert.equal(blocked.status,'BLOCKED_MISSING_EVIDENCE');
  assert.deepEqual(blocked.missingEvidence,['boundedRiskEconomics','spreadPermission']);
  assert.equal(blocked.promotionEligible,false);
});

test('zero candidates is explicit and invalid counts fail closed',()=>{
  assert.equal(assessBranchResearchReadiness({...base('THETA_HOLD_STRIKE'),evaluatedCandidateCount:0}).status,'NO_CANDIDATES_EVALUATED');
  assert.throws(()=>assessBranchResearchReadiness({...base('THETA_HOLD_STRIKE'),evaluatedCandidateCount:-1}),/CANDIDATE_COUNT_INVALID/);
});
