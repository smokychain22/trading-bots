import assert from 'node:assert/strict';
import test from 'node:test';
import { splitDecisionEvidence, validateGlobalWaitEvidence, type DecisionEvidenceItem } from '../src/theta/decision-evidence.js';

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
    hardGateCounts: {}, softEvidenceFamiliesObserved: ['IV'],
  });
  assert.deepEqual(result, { earned: true, violations: [] });
});
